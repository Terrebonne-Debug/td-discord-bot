import { MongoClient } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import { createConsoleLogger } from './logging.ts';
import type { BotLogger } from './logging.ts';
import type { MemoryMode, Turn } from './types.ts';

const CHANNEL_COLLECTION = 'channel_memories';

export class MemoryUnavailableError extends Error {
  memoryUnavailable = true;

  constructor(cause: unknown) {
    super('Conversation memory is unavailable.', { cause });
    this.name = 'MemoryUnavailableError';
  }
}

export interface MemoryConnectOptions {
  uri: string | null;
  dbName: string;
  timeoutMs: number;
  maxHistoryTurns: number;
  ttlDays?: number | null;
  logger?: BotLogger;
}

/**
 * The conversation-memory API the rest of the bot depends on. MemoryStore
 * implements it, and tests inject plain objects that do too.
 */
export interface ConversationMemory {
  readonly mode: MemoryMode;
  getHistory(key: string): Promise<Turn[]>;
  appendTurn(key: string, prompt: string, reply: string): Promise<boolean>;
  close(): Promise<void>;
}

/** The only thing MemoryStore needs from a MongoDB client after connecting. */
export interface Closeable {
  close(): Promise<void>;
}

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

/** A document in channel_memories. */
interface MemoryDocument {
  _id: string;
  turns?: Turn[];
  createdAt?: Date;
  updatedAt?: Date;
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

  constructor({
    client = null,
    db = null,
    maxHistoryTurns,
    logger = createConsoleLogger(),
  }: {
    client?: Closeable | null;
    db?: Db | null;
    maxHistoryTurns: number;
    logger?: BotLogger;
  }) {
    this.#client = client;
    this.#db = db;
    this.#maxMessages = maxHistoryTurns * 2;
    this.#channels = new Map();
    this.#mode = db ? 'mongo' : 'memory';
    this.#logger = logger;
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
    logger = createConsoleLogger(),
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
      return new MemoryStore({ client, db, maxHistoryTurns, logger });
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
    const history = normalizeTurns(doc?.turns);
    this.#logger.debug('Historique lu', {
      key,
      mode: this.#mode,
      turns: history.length,
    });
    return history;
  }

  async appendTurn(key: string, prompt: string, reply: string): Promise<boolean> {
    const turn: Turn[] = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: reply },
    ];

    if (this.#mode === 'memory') {
      const history = [...(this.#channels.get(key) ?? []), ...turn];
      if (history.length > this.#maxMessages) {
        history.splice(0, history.length - this.#maxMessages);
      }
      this.#channels.set(key, history);
    } else {
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
