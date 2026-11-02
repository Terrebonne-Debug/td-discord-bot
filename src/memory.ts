import { MongoClient } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import { createConsoleLogger } from './logging.ts';
import type { BotLogger } from './logging.ts';
import type { MemoryMode, MemoryScope, Turn } from './types.ts';

const CHANNEL_COLLECTION = 'channel_memories';
const DM_COLLECTION = 'dm_memories';
const DM_PREFERENCES_COLLECTION = 'dm_preferences';

/** A document in channel_memories or dm_memories. */
interface MemoryDocument {
  _id: string;
  turns?: Turn[];
  createdAt?: Date;
  updatedAt?: Date;
}

/** A document in dm_preferences: the opt-in flag, no conversation content. */
interface PreferenceDocument {
  _id: string;
  enabled?: boolean;
  hinted?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

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
  getHistory(scope: MemoryScope, key: string): Promise<Turn[]>;
  appendTurn(scope: MemoryScope, key: string, prompt: string, reply: string): Promise<boolean>;
  isDmEnabled(userId: string): Promise<boolean>;
  setDmEnabled(userId: string, enabled: boolean): Promise<void>;
  showDmHintOnce(userId: string): Promise<boolean>;
  close(): Promise<void>;
}

/** The only thing MemoryStore needs from a MongoDB client after connecting. */
export interface Closeable {
  close(): Promise<void>;
}

function assertScope(scope: string): asserts scope is MemoryScope {
  if (scope !== 'channel' && scope !== 'dm') {
    throw new Error(`Unknown memory scope: ${scope}`);
  }
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

async function ensureTtlIndexes(
  db: Db,
  ttlDays: number | null,
  logger: BotLogger,
): Promise<void> {
  if (!ttlDays) return;

  const options = { expireAfterSeconds: ttlDays * 86_400 };
  for (const name of [CHANNEL_COLLECTION, DM_COLLECTION]) {
    try {
      await db.collection(name).createIndex({ updatedAt: 1 }, options);
    } catch (error) {
      logger.warn(`Could not create the TTL index on ${name}: ${error}`);
    }
  }
}

/**
 * Conversation memory with a hard separation between guild channels and
 * private messages:
 *
 * - channel scope  -> channel_memories, keyed by channel id
 * - dm scope       -> dm_memories, keyed by user id, only when that user opted in
 * - dm_preferences -> per-user opt-in flag; the only DM-side collection that is
 *                     read without an opt-in, and it contains no conversation.
 *
 * Scope selects the collection; a key from one scope can never address the
 * other collection.
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

  async getHistory(scope: MemoryScope, key: string): Promise<Turn[]> {
    assertScope(scope);

    // Private memory is opt-in: without an explicit preference, nothing is
    // read (and nothing is written by appendTurn).
    if (scope === 'dm' && !(await this.isDmEnabled(key))) return [];

    if (this.#mode === 'memory') {
      const history = normalizeTurns(this.#channels.get(key));
      this.#logger.debug('Historique lu', {
        scope,
        key,
        mode: this.#mode,
        turns: history.length,
      });
      return history;
    }

    const doc = await this.#collection(scope).findOne(
      { _id: key },
      { projection: { turns: { $slice: -this.#maxMessages } } },
    );
    const history = normalizeTurns(doc?.turns);
    this.#logger.debug('Historique lu', {
      scope,
      key,
      mode: this.#mode,
      turns: history.length,
    });
    return history;
  }

  async appendTurn(
    scope: MemoryScope,
    key: string,
    prompt: string,
    reply: string,
  ): Promise<boolean> {
    assertScope(scope);

    if (scope === 'dm' && !(await this.isDmEnabled(key))) return false;

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
      await this.#collection(scope).updateOne(
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

    this.#logger.debug('Tour enregistré', { scope, key, mode: this.#mode });
    return true;
  }

  async isDmEnabled(userId: string): Promise<boolean> {
    if (this.#mode !== 'mongo') return false;

    const preference = await this.#preferences().findOne(
      { _id: userId },
      { projection: { enabled: 1 } },
    );
    return preference?.enabled === true;
  }

  /**
   * Persist the user's private-memory choice. Turning it off also deletes the
   * stored private history: off means the bot keeps nothing.
   */
  async setDmEnabled(userId: string, enabled: boolean): Promise<void> {
    if (this.#mode !== 'mongo') {
      throw new MemoryUnavailableError(new Error('MongoDB is not connected.'));
    }

    const now = new Date();
    await this.#preferences().updateOne(
      { _id: userId },
      {
        $set: { enabled, hinted: true, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    this.#logger.debug('Préférence de mémoire privée mise à jour', { userId, enabled });

    if (!enabled) {
      await this.#collection('dm').deleteOne({ _id: userId });
    }
  }

  /**
   * Create the user's preference document (memory off) the first time they
   * talk to the bot in private, so the opt-in hint is shown exactly once.
   * Returns true only for the call that created the document.
   */
  async showDmHintOnce(userId: string): Promise<boolean> {
    if (this.#mode !== 'mongo') return false;

    const now = new Date();
    const result = await this.#preferences().updateOne(
      { _id: userId },
      {
        $setOnInsert: { enabled: false, hinted: true, createdAt: now },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );

    // upsertedCount is 1 only for the call that created the document, which
    // makes this atomic even if two messages arrive at the same time.
    const created = result.upsertedCount === 1;
    this.#logger.debug('Hint de mémoire privée', { userId, created });
    return created;
  }

  async close(): Promise<void> {
    await closeQuietly(this.#client);
  }

  #collection(scope: MemoryScope): Collection<MemoryDocument> {
    // #db is always set in 'mongo' mode, and these accessors are only reached
    // from 'mongo' code paths.
    return this.#db!.collection<MemoryDocument>(
      scope === 'channel' ? CHANNEL_COLLECTION : DM_COLLECTION,
    );
  }

  #preferences(): Collection<PreferenceDocument> {
    return this.#db!.collection<PreferenceDocument>(DM_PREFERENCES_COLLECTION);
  }
}
