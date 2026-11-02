import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../../src/memory.ts';
import { createLogger } from '../helpers/fakes.ts';
import { collection, TEST_MONGODB_URI, withMongo } from '../helpers/mongo.ts';

async function connect({
  dbName = 'unused',
  ttlDays = null,
  maxHistoryTurns = 2,
}: { dbName?: string; ttlDays?: number | null; maxHistoryTurns?: number } = {}) {
  return MemoryStore.connect({
    uri: TEST_MONGODB_URI,
    dbName,
    timeoutMs: 5_000,
    maxHistoryTurns,
    ttlDays,
  });
}

test('connect falls back to in-RAM memory without a URI', async (t) => {
  const warn = t.mock.method(console, 'warn');
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
  });

  assert.equal(store.mode, 'memory');
  assert.match(warn.mock.calls[0].arguments[0], /MONGODB_URI is not set/);
  await store.close();
});

test('connect reports the RAM fallback to the injected logger', async () => {
  const logger = createLogger();
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
    logger,
  });

  assert.equal(store.mode, 'memory');
  assert.match(logger.messages('warn')[0], /MONGODB_URI is not set/);
  await store.close();
});

test('connect falls back to in-RAM memory when MongoDB is unreachable', async (t) => {
  const warn = t.mock.method(console, 'warn');
  const store = await MemoryStore.connect({
    uri: 'mongodb://127.0.0.1:1',
    dbName: 'unused',
    timeoutMs: 250,
    maxHistoryTurns: 2,
  });

  assert.equal(store.mode, 'memory');
  assert.match(warn.mock.calls[0].arguments[0], /MongoDB is unavailable/);
  await store.close();
});

test('in-RAM memory trims channel history to the configured turns', async () => {
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
  });

  assert.deepEqual(await store.getHistory('chan'), []);
  await store.appendTurn('chan', 'p1', 'r1');
  await store.appendTurn('chan', 'p2', 'r2');
  await store.appendTurn('chan', 'p3', 'r3');

  assert.deepEqual(await store.getHistory('chan'), [
    { role: 'user', content: 'p2' },
    { role: 'assistant', content: 'r2' },
    { role: 'user', content: 'p3' },
    { role: 'assistant', content: 'r3' },
  ]);

  await store.close();
});

test('MongoDB channel memory trims turns per channel', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName, maxHistoryTurns: 2 });

    try {
      await store.appendTurn('same-id', 'c1', 'cr1');
      await store.appendTurn('same-id', 'c2', 'cr2');
      await store.appendTurn('same-id', 'c3', 'cr3');

      assert.deepEqual(await store.getHistory('same-id'), [
        { role: 'user', content: 'c2' },
        { role: 'assistant', content: 'cr2' },
        { role: 'user', content: 'c3' },
        { role: 'assistant', content: 'cr3' },
      ]);
      assert.deepEqual(await store.getHistory('missing'), []);
      assert.equal(
        await collection(db, 'channel_memories').countDocuments({ _id: 'same-id' }),
        1,
      );

      const doc = await collection(db, 'channel_memories').findOne({ _id: 'same-id' });
      assert.ok(doc);
      assert.deepEqual(doc.turns, [
        { role: 'user', content: 'c2' },
        { role: 'assistant', content: 'cr2' },
        { role: 'user', content: 'c3' },
        { role: 'assistant', content: 'cr3' },
      ]);
    } finally {
      await store.close();
    }
  });
});

test('close ignores a failing MongoDB client close', async () => {
  const store = new MemoryStore({
    client: {
      close: async () => {
        throw new Error('close failed');
      },
    },
    maxHistoryTurns: 2,
  });

  await assert.doesNotReject(store.close());
});

test('stored turns are normalised before being sent to the model', async () => {
  await withMongo(async ({ db, dbName }) => {
    await collection(db, 'channel_memories').insertOne({
      _id: 'chan',
      turns: [
        { role: 'user', content: 'ok' },
        { role: 'system', content: 'skip' },
        { role: 'assistant', content: 42 },
        null,
        { role: 'assistant', content: 'ok2' },
      ],
      updatedAt: new Date(),
    });
    await collection(db, 'channel_memories').insertOne({
      _id: 'broken',
      turns: 'not-an-array',
      updatedAt: new Date(),
    });

    const store = await connect({ dbName, maxHistoryTurns: 10 });

    try {
      assert.deepEqual(await store.getHistory('chan'), [
        { role: 'user', content: 'ok' },
        { role: 'assistant', content: 'ok2' },
      ]);
      assert.deepEqual(await store.getHistory('broken'), []);
    } finally {
      await store.close();
    }
  });
});

test('MEMORY_TTL_DAYS creates a TTL index on channel_memories', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName, ttlDays: 2 });

    try {
      assert.equal(store.mode, 'mongo');

      const indexes = await collection(db, 'channel_memories').indexes();
      const ttl = indexes.find(
        (index) => index.key.updatedAt === 1 && index.expireAfterSeconds !== undefined,
      );
      assert.ok(ttl);
      assert.equal(ttl.expireAfterSeconds, 2 * 86_400);
    } finally {
      await store.close();
    }
  });
});

test('a conflicting TTL index is reported without disabling MongoDB memory', async (t) => {
  const warn = t.mock.method(console, 'warn');

  await withMongo(async ({ db, dbName }) => {
    await collection(db, 'channel_memories').createIndex({ updatedAt: 1 });

    const store = await connect({ dbName, ttlDays: 2 });

    try {
      assert.equal(store.mode, 'mongo');
      assert.ok(
        warn.mock.calls.some((call) =>
          String(call.arguments[0]).includes(
            'Could not create the TTL index on channel_memories',
          ),
        ),
      );
    } finally {
      await store.close();
    }
  });
});
