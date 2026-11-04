import { MemoryUnavailableError } from '../../memory/memory-unavailable-error.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import type { ConversationMemory } from '../../models/memory/conversation-memory.ts';
import type { Turn } from '../../models/memory/turn.ts';
import type { ConversationStrategy } from './conversation-strategy.ts';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The conversation algorithm shared by /q and message mentions, parameterized
 * by a ConversationStrategy: validate, lock the conversation, load history,
 * ask the model, store the turn, deliver the reply.
 */
export class ConversationService {
  #memory: ConversationMemory;
  #ask: (history: Turn[], prompt: string) => Promise<string>;
  #logger: BotLogger;
  #busyConversations = new Set<string>();

  constructor({
    memory,
    ask,
    logger,
  }: {
    memory: ConversationMemory;
    ask: (history: Turn[], prompt: string) => Promise<string>;
    logger: BotLogger;
  }) {
    this.#memory = memory;
    this.#ask = ask;
    this.#logger = logger;
  }

  async handle(strategy: ConversationStrategy): Promise<void> {
    try {
      const prompt = await strategy.prepare();
      if (prompt === null) return;

      const stopWork = await strategy.beginWork();
      try {
        const handled = await this.#respond(strategy, prompt);
        if (!handled) await strategy.reportBusy();
      } finally {
        stopWork();
      }
    } catch (error) {
      this.#logger.error(
        `${strategy.errorLabel()}: ${messageOf(error)}`,
        strategy.errorFields(),
      );
      await strategy.reportError(error).catch(() => {});
    }
  }

  /**
   * Keep one in-flight request per conversation and keep the lock until the
   * reply has been sent, so two answers cannot interleave in the same
   * conversation. The memory key comes from the strategy, never from user
   * input.
   */
  async #respond(strategy: ConversationStrategy, prompt: string): Promise<boolean> {
    const lockKey = strategy.lockKey();
    const memoryKey = strategy.memoryKey();
    const log = this.#logger.child(memoryKey === null ? {} : { key: memoryKey });

    if (this.#busyConversations.has(lockKey)) {
      log.warn('Conversation occupée : requête ignorée', { lockKey });
      return false;
    }

    this.#busyConversations.add(lockKey);
    try {
      let history: Turn[] = [];
      if (memoryKey !== null) {
        try {
          history = await this.#memory.getHistory(memoryKey);
        } catch (error) {
          throw new MemoryUnavailableError(error);
        }
      }
      log.debug('Historique chargé', { turns: history.length });

      const startedAt = performance.now();
      const reply = await this.#ask(history, prompt);
      log.info('Réponse du modèle reçue', {
        ms: Math.round(performance.now() - startedAt),
        chars: reply.length,
      });

      if (memoryKey !== null) {
        try {
          await this.#memory.appendTurn(memoryKey, prompt, reply);
        } catch (error) {
          log.warn(`Could not save the conversation turn: ${messageOf(error)}`);
        }
      }

      await strategy.sendReply(reply);
      return true;
    } finally {
      this.#busyConversations.delete(lockKey);
    }
  }
}
