import { MongoClient } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import { MemoryCipher } from '../crypto/memory-cipher.ts';
import { LoggerFactory } from '../logging/logger-factory.ts';
import type { EncryptedTurn } from '../models/crypto/encrypted-turn.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { Closeable } from '../models/memory/closeable.ts';
import type { ConversationMemory } from '../models/memory/conversation-memory.ts';
import type { MemoryConnectOptions } from '../models/memory/memory-connect-options.ts';
import type { MemoryDocument } from '../models/memory/memory-document.ts';
import type { MemoryMode } from '../models/memory/memory-mode.ts';
import type { Turn } from '../models/memory/turn.ts';

const CHANNEL_COLLECTION = 'channel_memories';

function isTurn(value: unknown): value is Turn {
  return (
    typeof value === 'object' &&
    value !== null &&
    'role' in value &&
    'content' in value &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string'
  );
}

function normalizeTurns(turns: unknown): Turn[] {
  if (!Array.isArray(turns)) return [];
  return turns.filter(isTurn).map(({ role, content }) => ({ role, content }));
}

async function closeQuietly(client: Closeable | null | undefined): Promise<void> {
  if (!client) return;
  await client.close().catch(() => {});
}

async function ensureTtlIndexes(db: Db, ttlDays: number | null, logger: BotLogger): Promise<void> {
  if (!ttlDays) return;

  const options = { expireAfterSeconds: ttlDays * 86_400 };
  try {
    await db.collection(CHANNEL_COLLECTION).createIndex({ updatedAt: 1 }, options);
  } catch (error) {
    logger.warn(`Could not create the TTL index on ${CHANNEL_COLLECTION}: ${error}`);
  }
}

/**
 * Decrypts the encrypted entries of a stored history. Legacy plaintext
 * entries pass through untouched (normalizeTurns validates them later); an
 * encrypted entry that cannot be decrypted is skipped with a warning so a
 * broken record never fails the conversation.
 */
function decryptTurns(
  turns: Array<Turn | EncryptedTurn> | undefined,
  cipher: MemoryCipher | null,
  aad: string,
  logger: BotLogger,
): Array<Turn | EncryptedTurn> {
  if (!turns) return [];

  const decrypted: Array<Turn | EncryptedTurn> = [];
  for (const turn of turns) {
    if (MemoryCipher.isEncryptedTurn(turn)) {
      if (!cipher) {
        logger.warn(`Encrypted turn skipped: no MEMORY_ENCRYPTION_KEY configured (key ${aad}).`);
        continue;
      }
      try {
        decrypted.push(cipher.decryptTurn(turn, aad));
      } catch {
        logger.warn(`Encrypted turn skipped: decryption failed (key ${aad}).`);
      }
      continue;
    }
    decrypted.push(turn);
  }
  return decrypted;
}

/**
 * Conversation memory for public channels, keyed by channel id and shared by
 * every member of the channel. Private messages are never stored.
 */
export class MemoryStore implements ConversationMemory {
  #client: Closeable | null;
  #db: Db | null;
  #maxMessages: number;
  #channels: Map<string, Turn[]>;
  #mode: MemoryMode;
  #logger: BotLogger;
  #cipher: MemoryCipher | null;

  constructor({
    client = null,
    db = null,
    maxHistoryTurns,
    encryptionKey = null,
    logger = new LoggerFactory().consoleLogger(),
  }: {
    client?: Closeable | null;
    db?: Db | null;
    maxHistoryTurns: number;
    encryptionKey?: Buffer | null;
    logger?: BotLogger;
  }) {
    this.#client = client;
    this.#db = db;
    this.#maxMessages = maxHistoryTurns * 2;
    this.#channels = new Map();
    this.#mode = db ? 'mongo' : 'memory';
    this.#logger = logger;
    this.#cipher = encryptionKey ? new MemoryCipher(encryptionKey) : null;
  }

  get mode(): MemoryMode {
    return this.#mode;
  }

  static async connect({
    uri,
    dbName,
    timeoutMs,
    maxHistoryTurns,
    ttlDays = null,
    encryptionKey = null,
    logger = new LoggerFactory().consoleLogger(),
  }: MemoryConnectOptions): Promise<MemoryStore> {
    if (!uri) {
      logger.warn(
        'MONGODB_URI is not set; conversation memory stays in RAM and is lost on restart.',
      );
      return new MemoryStore({ maxHistoryTurns, logger });
    }

    const client = new MongoClient(uri, {
      appName: 'td-discord-bot',
      serverSelectionTimeoutMS: timeoutMs,
    });

    try {
      const startedAt = performance.now();
      await client.connect();
      const db = client.db(dbName);
      await db.command({ ping: 1 });
      logger.debug('MongoDB connecté', {
        dbName,
        ms: Math.round(performance.now() - startedAt),
      });
      await ensureTtlIndexes(db, ttlDays, logger);
      if (!encryptionKey) {
        logger.warn('MEMORY_ENCRYPTION_KEY is not set; channel memory is stored in plaintext.');
      }
      return new MemoryStore({ client, db, maxHistoryTurns, encryptionKey, logger });
    } catch (error) {
      logger.warn(
        `MongoDB is unavailable (${error}); ` +
          'falling back to in-RAM memory, lost on restart.',
      );
      await closeQuietly(client);
      return new MemoryStore({ maxHistoryTurns, logger });
    }
  }

  async getHistory(key: string): Promise<Turn[]> {
    if (this.#mode === 'memory') {
      const history = normalizeTurns(this.#channels.get(key));
      this.#logger.debug('Historique lu', {
        key,
        mode: this.#mode,
        turns: history.length,
      });
      return history;
    }

    const doc = await this.#collection().findOne(
      { _id: key },
      { projection: { turns: { $slice: -this.#maxMessages } } },
    );
    const history = normalizeTurns(
      decryptTurns(doc?.turns, this.#cipher, key, this.#logger),
    );
    this.#logger.debug('Historique lu', {
      key,
      mode: this.#mode,
      turns: history.length,
    });
    return history;
  }

  async appendTurn(key: string, prompt: string, reply: string): Promise<boolean> {
    if (this.#mode === 'memory') {
      const turn: Turn[] = [
        { role: 'user', content: prompt },
        { role: 'assistant', content: reply },
      ];
      const history = [...(this.#channels.get(key) ?? []), ...turn];
      if (history.length > this.#maxMessages) {
        history.splice(0, history.length - this.#maxMessages);
      }
      this.#channels.set(key, history);
    } else {
      const turn: Array<Turn | EncryptedTurn> = this.#cipher
        ? [
            this.#cipher.encryptTurn('user', prompt, key),
            this.#cipher.encryptTurn('assistant', reply, key),
          ]
        : [
            { role: 'user', content: prompt },
            { role: 'assistant', content: reply },
          ];

      await this.#collection().updateOne(
        { _id: key },
        {
          $push: {
            turns: { $each: turn, $slice: -this.#maxMessages },
          },
          $set: { updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }

    this.#logger.debug('Tour enregistré', { key, mode: this.#mode });
    return true;
  }

  async close(): Promise<void> {
    await closeQuietly(this.#client);
  }

  #collection(): Collection<MemoryDocument> {
    // #db is always set in 'mongo' mode, and this accessor is only reached
    // from 'mongo' code paths.
    return this.#db!.collection<MemoryDocument>(CHANNEL_COLLECTION);
  }
}
