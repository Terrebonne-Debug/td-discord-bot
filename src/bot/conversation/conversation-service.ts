import { MemoryUnavailableError } from '../../memory/memory-unavailable-error.ts';
import { Errors } from '../../utils/errors.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import type { ConversationMemory } from '../../models/memory/conversation-memory.ts';
import type { Turn } from '../../models/memory/turn.ts';
import type { ConversationStrategy } from './conversation-strategy.ts';

/**
 * L'algorithme de conversation partagé par `/q` et les mentions de message,
 * paramétré par une ConversationStrategy : valider, verrouiller la
 * conversation, charger l'historique, interroger le modèle, enregistrer le
 * tour, livrer la réponse.
 *
 * @class ConversationService
 */
export class ConversationService {
  /** @type {ConversationMemory} La mémoire des canaux. */
  #memory: ConversationMemory;
  /** @type {(history: Turn[], prompt: string) => Promise<string>} Le modèle. */
  #ask: (history: Turn[], prompt: string) => Promise<string>;
  /** @type {BotLogger} Le journal du bot. */
  #logger: BotLogger;
  /** @type {Set<string>} Les conversations en cours de traitement. */
  #busyConversations = new Set<string>();

  /**
   * @constructor
   * @param {ConversationMemory} memory - La mémoire des canaux.
   * @param {(history: Turn[], prompt: string) => Promise<string>} ask - Le modèle.
   * @param {BotLogger} logger - Le journal du bot.
   */
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

  /**
   * Déroule l'algorithme complet pour une stratégie donnée.
   *
   * @method
   * @param {ConversationStrategy} strategy - La source de la conversation.
   * @returns {Promise<void>}
   */
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
        `${strategy.errorLabel()} : ${Errors.messageOf(error)}`,
        strategy.errorFields(),
      );
      await strategy.reportError(error).catch(() => {});
    }
  }

  /**
   * Garde une seule requête en vol par conversation et conserve le verrou
   * jusqu'à l'envoi de la réponse, pour que deux réponses ne s'entrelacent
   * pas. La clé de mémoire vient de la stratégie, jamais de l'entrée
   * utilisateur.
   *
   * @method
   * @param {ConversationStrategy} strategy - La source de la conversation.
   * @param {string} prompt - Le prompt validé.
   * @returns {Promise<boolean>} Faux quand la conversation était occupée.
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
          log.warn(`Impossible d'enregistrer le tour de conversation : ${Errors.messageOf(error)}`);
        }
      }

      await strategy.sendReply(reply);
      return true;
    } finally {
      this.#busyConversations.delete(lockKey);
    }
  }
}
