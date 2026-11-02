import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../../src/memory.ts';
import type { MemoryUnavailableError } from '../../src/memory.ts';
import type { MemoryScope } from '../../src/types.ts';
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

test('in-RAM fallback keeps channel history only and never private memory', async () => {
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
  });

  assert.deepEqual(await store.getHistory('channel', 'chan'), []);
  await store.appendTurn('channel', 'chan', 'p1', 'r1');
  await store.appendTurn('channel', 'chan', 'p2', 'r2');
  await store.appendTurn('channel', 'chan', 'p3', 'r3');

  assert.deepEqual(await store.getHistory('channel', 'chan'), [
    { role: 'user', content: 'p2' },
    { role: 'assistant', content: 'r2' },
    { role: 'user', content: 'p3' },
    { role: 'assistant', content: 'r3' },
  ]);

  assert.deepEqual(await store.getHistory('dm', 'user'), []);
  assert.equal(await store.appendTurn('dm', 'user', 'p', 'r'), false);
  assert.equal(await store.isDmEnabled('user'), false);
  assert.equal(await store.showDmHintOnce('user'), false);
  await assert.rejects(
    store.setDmEnabled('user', true),
    (error: MemoryUnavailableError) =>
      error.name === 'MemoryUnavailableError' &&
      error.memoryUnavailable === true &&
      error.cause instanceof Error,
  );

  await store.close();
});

test('an unknown memory scope is rejected', async () => {
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
  });

  await assert.rejects(store.getHistory('guild' as MemoryScope, 'x'), /Unknown memory scope: guild/);
  await store.close();
});

test('MongoDB channel memory trims turns and is isolated from DM memory', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName, maxHistoryTurns: 2 });

    try {
      await store.appendTurn('channel', 'same-id', 'c1', 'cr1');
      await store.appendTurn('channel', 'same-id', 'c2', 'cr2');
      await store.appendTurn('channel', 'same-id', 'c3', 'cr3');

      assert.deepEqual(await store.getHistory('channel', 'same-id'), [
        { role: 'user', content: 'c2' },
        { role: 'assistant', content: 'cr2' },
        { role: 'user', content: 'c3' },
        { role: 'assistant', content: 'cr3' },
      ]);
      assert.deepEqual(await store.getHistory('channel', 'missing'), []);

      // Private memory is off by default: nothing read, nothing written.
      assert.deepEqual(await store.getHistory('dm', 'same-id'), []);
      assert.equal(await store.appendTurn('dm', 'same-id', 'd1', 'dr1'), false);
      assert.equal(
        await collection(db, 'dm_memories').countDocuments({ _id: 'same-id' }),
        0,
      );
      assert.equal(
        await collection(db, 'channel_memories').countDocuments({ _id: 'same-id' }),
        1,
      );

      // Enabling private memory stores it in its own collection, same key.
      await store.setDmEnabled('same-id', true);
      assert.equal(await store.isDmEnabled('same-id'), true);
      assert.equal(await store.appendTurn('dm', 'same-id', 'd1', 'dr1'), true);

      assert.deepEqual(await store.getHistory('dm', 'same-id'), [
        { role: 'user', content: 'd1' },
        { role: 'assistant', content: 'dr1' },
      ]);
      assert.deepEqual(await store.getHistory('channel', 'same-id'), [
        { role: 'user', content: 'c2' },
        { role: 'assistant', content: 'cr2' },
        { role: 'user', content: 'c3' },
        { role: 'assistant', content: 'cr3' },
      ]);

      const dmDoc = await collection(db, 'dm_memories').findOne({ _id: 'same-id' });
      assert.ok(dmDoc);
      assert.deepEqual(dmDoc.turns, [
        { role: 'user', content: 'd1' },
        { role: 'assistant', content: 'dr1' },
      ]);

      // Turning private memory off deletes its stored history.
      await store.setDmEnabled('same-id', false);
      assert.equal(await store.isDmEnabled('same-id'), false);
      assert.deepEqual(await store.getHistory('dm', 'same-id'), []);
      assert.equal(
        await collection(db, 'dm_memories').countDocuments({ _id: 'same-id' }),
        0,
      );
      assert.equal(
        await collection(db, 'channel_memories').countDocuments({ _id: 'same-id' }),
        1,
      );
    } finally {
      await store.close();
    }
  });
});

test('showDmHintOnce creates the preference document only once', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName });

    try {
      assert.equal(await store.showDmHintOnce('user-1'), true);
      assert.equal(await store.showDmHintOnce('user-1'), false);

      const preference = await collection(db, 'dm_preferences').findOne({ _id: 'user-1' });
      assert.ok(preference);
      assert.equal(preference.enabled, false);
      assert.equal(preference.hinted, true);
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
      assert.deepEqual(await store.getHistory('channel', 'chan'), [
        { role: 'user', content: 'ok' },
        { role: 'assistant', content: 'ok2' },
      ]);
      assert.deepEqual(await store.getHistory('channel', 'broken'), []);
    } finally {
      await store.close();
    }
  });
});

test('MEMORY_TTL_DAYS creates TTL indexes on both memory collections', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName, ttlDays: 2 });

    try {
      assert.equal(store.mode, 'mongo');

      for (const name of ['channel_memories', 'dm_memories']) {
        const indexes = await collection(db, name).indexes();
        const ttl = indexes.find(
          (index) => index.key.updatedAt === 1 && index.expireAfterSeconds !== undefined,
        );
        assert.ok(ttl);
        assert.equal(ttl.expireAfterSeconds, 2 * 86_400);
      }
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

      const dmIndexes = await collection(db, 'dm_memories').indexes();
      assert.ok(dmIndexes.some((index) => index.expireAfterSeconds === 2 * 86_400));
    } finally {
      await store.close();
    }
  });
});
