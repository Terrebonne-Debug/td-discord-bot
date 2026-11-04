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
    errorLabel: () => 'Failed to handle /q',
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

test('ConversationService does nothing when prepare returns null', async () => {
  const strategy = scriptedStrategy({ prompt: null });
  const { service, memory } = setup();

  await service.handle(strategy);

  assert.deepEqual(strategy.calls, ['prepare']);
  assert.equal(strategy.stopCount, 0);
  assert.equal(memory.calls.length, 0);
});

test('ConversationService runs the full flow and stops the work indicator', async () => {
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

test('ConversationService reports a busy conversation without asking the model', async () => {
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

test('ConversationService reports memory failures and logs them with the strategy identity', async () => {
  const strategy = scriptedStrategy();
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { service, logger } = setup({ memory });

  await service.handle(strategy);

  assert.match(strategy.errorReported[0], /Conversation memory is unavailable/);
  assert.match(logger.messages('error')[0], /Failed to handle \/q/);
});

test('ConversationService tolerates a failing error report', async () => {
  const strategy = scriptedStrategy({ failReportError: true });
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { service } = setup({ memory });

  await assert.doesNotReject(service.handle(strategy));
});

test('ConversationService warns when the turn cannot be saved but still answers', async () => {
  const strategy = scriptedStrategy();
  const memory = createFakeMemory({ failures: { appendTurn: 1 } });
  const { service, logger } = setup({ memory });

  await service.handle(strategy);

  assert.match(logger.messages('warn')[0], /Could not save the conversation turn/);
  assert.deepEqual(strategy.calls.at(-1), 'sendReply:la réponse');
});
