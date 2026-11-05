import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationService } from '../../../src/bot/conversation/conversation-service.ts';
import type { ConversationStrategy } from '../../../src/bot/conversation/conversation-strategy.ts';
import { createFakeMemory, createLogger } from '../../helpers/fakes.ts';
import type { Turn } from '../../../src/models/memory/turn.ts';

interface ScriptedStrategy extends ConversationStrategy {
  calls: string[];
  prompt: string | null;
  busyReported: boolean;
  errorReported: string[];
  stopCount: number;
  failReportError: boolean;
  history: Turn[];
}

function scriptedStrategy({
  prompt = 'question',
  lockKey = 'channel-1',
  memoryKey = 'channel-1',
  failReportError = false,
}: {
  prompt?: string | null;
  lockKey?: string;
  memoryKey?: string | null;
  failReportError?: boolean;
} = {}): ScriptedStrategy {
  return {
    calls: [],
    prompt,
    busyReported: false,
    errorReported: [],
    stopCount: 0,
    failReportError,
    history: [],
    lockKey: () => lockKey,
    memoryKey: () => memoryKey,
    async prepare() {
      this.calls.push('prepare');
      return this.prompt;
    },
    async beginWork() {
      this.calls.push('beginWork');
      return () => {
        this.stopCount += 1;
      };
    },
    async reportBusy() {
      this.busyReported = true;
    },
    async sendReply(reply) {
      this.calls.push(`sendReply:${reply}`);
    },
    async reportError(error) {
      if (this.failReportError) throw new Error('reportError failed');
      this.errorReported.push(error instanceof Error ? error.message : String(error));
    },
    errorLabel: () => 'Échec du traitement de /q',
    errorFields: () => ({ key: memoryKey }),
  };
}

function setup({
  memory = createFakeMemory(),
  ask = async () => 'la réponse',
  logger = createLogger(),
}: {
  memory?: ReturnType<typeof createFakeMemory>;
  ask?: (history: Turn[], prompt: string) => Promise<string>;
  logger?: ReturnType<typeof createLogger>;
} = {}) {
  return { service: new ConversationService({ memory, ask, logger }), memory, logger };
}

test('ConversationService ne fait rien quand prepare renvoie null', async () => {
  const strategy = scriptedStrategy({ prompt: null });
  const { service, memory } = setup();

  await service.handle(strategy);

  assert.deepEqual(strategy.calls, ['prepare']);
  assert.equal(strategy.stopCount, 0);
  assert.equal(memory.calls.length, 0);
});

test('ConversationService déroule le flux complet et arrête l\'indicateur', async () => {
  const asks: Array<{ history: Turn[]; prompt: string }> = [];
  const strategy = scriptedStrategy();
  const { service, memory, logger } = setup({
    ask: async (history, prompt) => {
      asks.push({ history, prompt });
      return 'la réponse';
    },
  });

  await service.handle(strategy);

  assert.deepEqual(strategy.calls, ['prepare', 'beginWork', 'sendReply:la réponse']);
  assert.equal(strategy.stopCount, 1);
  assert.deepEqual(asks, [{ history: [], prompt: 'question' }]);
  assert.ok(memory.calls.some((call) => call.method === 'appendTurn'));
  assert.deepEqual(logger.messages('error'), []);
});

test('ConversationService rapporte une conversation occupée sans interroger le modèle', async () => {
  const gate = new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });
  const asks: string[] = [];
  const { service } = setup({
    ask: async () => {
      asks.push('appelé');
      await gate;
      return 'x';
    },
  });

  const first = scriptedStrategy();
  const second = scriptedStrategy();
  const firstRun = service.handle(first);
  await new Promise((resolve) => setImmediate(resolve));
  await service.handle(second);

  assert.equal(second.busyReported, true);
  await firstRun;
  assert.deepEqual(asks, ['appelé']);
});

test('ConversationService rapporte les échecs de mémoire et les journalise avec l\'identité de la stratégie', async () => {
  const strategy = scriptedStrategy();
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { service, logger } = setup({ memory });

  await service.handle(strategy);

  assert.match(strategy.errorReported[0], /La mémoire de conversation est indisponible/);
  assert.match(logger.messages('error')[0], /Échec du traitement de \/q/);
});

test('ConversationService tolère un rapport d\'erreur en échec', async () => {
  const strategy = scriptedStrategy({ failReportError: true });
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { service } = setup({ memory });

  await assert.doesNotReject(service.handle(strategy));
});

test('ConversationService avertit quand le tour ne peut pas être enregistré mais répond quand même', async () => {
  const strategy = scriptedStrategy();
  const memory = createFakeMemory({ failures: { appendTurn: 1 } });
  const { service, logger } = setup({ memory });

  await service.handle(strategy);

  assert.match(logger.messages('warn')[0], /Impossible d'enregistrer le tour de conversation/);
  assert.deepEqual(strategy.calls.at(-1), 'sendReply:la réponse');
});
