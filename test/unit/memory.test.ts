import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCipher } from '../../src/crypto/memory-cipher.ts';
import { MemoryStore } from '../../src/memory/memory-store.ts';
import type { BotLogger } from '../../src/models/logging/bot-logger.ts';
import { createLogger } from '../helpers/fakes.ts';
import { collection, TEST_MONGODB_URI, withMongo } from '../helpers/mongo.ts';

const TEST_KEY = MemoryCipher.parseKey('ab'.repeat(32))!;

async function connect({
  dbName = 'unused',
  ttlDays = null,
  maxHistoryTurns = 2,
  encryptionKey = null,
  logger,
}: {
  dbName?: string;
  ttlDays?: number | null;
  maxHistoryTurns?: number;
  encryptionKey?: Buffer | null;
  logger?: BotLogger;
} = {}) {
  return MemoryStore.connect({
    uri: TEST_MONGODB_URI,
    dbName,
    timeoutMs: 5_000,
    maxHistoryTurns,
    ttlDays,
    encryptionKey,
    logger,
  });
}

test('connect replie sur la mémoire RAM sans URI', async (t) => {
  const warn = t.mock.method(console, 'warn');
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
  });

  assert.equal(store.mode, 'memory');
  assert.match(warn.mock.calls[0].arguments[0], /MONGODB_URI n'est pas défini/);
  await store.close();
});

test('connect rapporte le repli RAM au journal injecté', async () => {
  const logger = createLogger();
  const store = await MemoryStore.connect({
    uri: null,
    dbName: 'unused',
    timeoutMs: 1_000,
    maxHistoryTurns: 2,
    logger,
  });

  assert.equal(store.mode, 'memory');
  assert.match(logger.messages('warn')[0], /MONGODB_URI n'est pas défini/);
  await store.close();
});

test('connect replie sur la mémoire RAM quand MongoDB est injoignable', async (t) => {
  const warn = t.mock.method(console, 'warn');
  const store = await MemoryStore.connect({
    uri: 'mongodb://127.0.0.1:1',
    dbName: 'unused',
    timeoutMs: 250,
    maxHistoryTurns: 2,
  });

  assert.equal(store.mode, 'memory');
  assert.match(warn.mock.calls[0].arguments[0], /MongoDB est indisponible/);
  await store.close();
});

test('la mémoire RAM tronque l\'historique de canal aux tours configurés', async () => {
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

test('la mémoire MongoDB tronque les tours par canal', async () => {
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

test('la mémoire de canal est chiffrée au repos quand une clé est configurée', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName, encryptionKey: TEST_KEY });

    try {
      await store.appendTurn('chan', 'secret prompt', 'secret reply');

      assert.deepEqual(await store.getHistory('chan'), [
        { role: 'user', content: 'secret prompt' },
        { role: 'assistant', content: 'secret reply' },
      ]);

      const doc = await collection(db, 'channel_memories').findOne({ _id: 'chan' });
      assert.ok(doc);
      const raw = JSON.stringify(doc.turns);
      assert.equal(raw.includes('secret prompt'), false, 'aucun texte en clair');
      assert.equal(raw.includes('secret reply'), false, 'aucun texte en clair');
      assert.equal(typeof doc.turns[0].iv, 'string');
      assert.equal(typeof doc.turns[0].ciphertext, 'string');
      assert.equal(typeof doc.turns[0].authTag, 'string');
    } finally {
      await store.close();
    }
  });
});

test('les tours historiques en clair sont encore lus avec les tours chiffrés', async () => {
  await withMongo(async ({ db, dbName }) => {
    await collection(db, 'channel_memories').insertOne({
      _id: 'chan',
      turns: [{ role: 'user', content: 'legacy plaintext' }],
      updatedAt: new Date(),
    });

    const store = await connect({ dbName, encryptionKey: TEST_KEY });

    try {
      await store.appendTurn('chan', 'new prompt', 'new reply');

      assert.deepEqual(await store.getHistory('chan'), [
        { role: 'user', content: 'legacy plaintext' },
        { role: 'user', content: 'new prompt' },
        { role: 'assistant', content: 'new reply' },
      ]);
    } finally {
      await store.close();
    }
  });
});

test('les entrées chiffrées altérées sont ignorées avec un avertissement', async () => {
  await withMongo(async ({ db, dbName }) => {
    const store = await connect({ dbName, encryptionKey: TEST_KEY });

    try {
      await store.appendTurn('chan', 'secret', 'reply');

      /** Corrompt le texte chiffré en base. */
      const doc = await collection(db, 'channel_memories').findOne({ _id: 'chan' });
      assert.ok(doc);
      const tampered = JSON.parse(JSON.stringify(doc.turns));
      tampered[0].ciphertext = `${tampered[0].ciphertext[0] === '0' ? '1' : '0'}${tampered[0].ciphertext.slice(1)}`;
      await collection(db, 'channel_memories').updateOne({ _id: 'chan' }, { $set: { turns: tampered } });

      const logger = createLogger();
      const reader = await connect({ dbName, encryptionKey: TEST_KEY, logger });
      try {
        assert.deepEqual(await reader.getHistory('chan'), [
          { role: 'assistant', content: 'reply' },
        ]);
        assert.match(logger.messages('warn')[0], /déchiffrement impossible/);
      } finally {
        await reader.close();
      }
    } finally {
      await store.close();
    }
  });
});

test('les entrées chiffrées sans clé sont ignorées avec un avertissement', async () => {
  await withMongo(async ({ db, dbName }) => {
    const writer = await connect({ dbName, encryptionKey: TEST_KEY });
    try {
      await writer.appendTurn('chan', 'secret', 'reply');
    } finally {
      await writer.close();
    }

    const logger = createLogger();
    const reader = await connect({ dbName, logger });
    try {
      assert.deepEqual(await reader.getHistory('chan'), []);
      assert.match(logger.messages('warn')[0], /stockée en clair/);
      assert.match(logger.messages('warn')[1], /MEMORY_ENCRYPTION_KEY non configuré/);
    } finally {
      await reader.close();
    }
  });
});

test('connect avertit quand MongoDB est utilisé sans clé de chiffrement', async () => {
  await withMongo(async ({ dbName }) => {
    const logger = createLogger();
    const store = await connect({ dbName, logger });

    try {
      assert.match(logger.messages('warn')[0], /stockée en clair/);
    } finally {
      await store.close();
    }
  });
});

test('close ignore un échec de fermeture du client MongoDB', async () => {
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

test('les tours stockés sont normalisés avant l\'envoi au modèle', async () => {
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

test('MEMORY_TTL_DAYS crée un index TTL sur channel_memories', async () => {
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

test('un index TTL en conflit est rapporté sans désactiver la mémoire MongoDB', async (t) => {
  const warn = t.mock.method(console, 'warn');

  await withMongo(async ({ db, dbName }) => {
    await collection(db, 'channel_memories').createIndex({ updatedAt: 1 });

    const store = await connect({ dbName, ttlDays: 2 });

    try {
      assert.equal(store.mode, 'mongo');
      assert.ok(
        warn.mock.calls.some((call) =>
          String(call.arguments[0]).includes(
            'Impossible de créer l\'index TTL sur channel_memories',
          ),
        ),
      );
    } finally {
      await store.close();
    }
  });
});

