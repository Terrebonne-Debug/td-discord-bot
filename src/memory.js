import { MongoClient } from 'mongodb';

const CHANNEL_COLLECTION = 'channel_memories';
const DM_COLLECTION = 'dm_memories';
const DM_PREFERENCES_COLLECTION = 'dm_preferences';

export class MemoryUnavailableError extends Error {
  constructor(cause) {
    super('Conversation memory is unavailable.', { cause });
    this.name = 'MemoryUnavailableError';
    this.memoryUnavailable = true;
  }
}

function assertScope(scope) {
  if (scope !== 'channel' && scope !== 'dm') {
    throw new Error(`Unknown memory scope: ${scope}`);
  }
}

function normalizeTurns(turns) {
  if (!Array.isArray(turns)) return [];

  return turns
    .filter(
      (turn) =>
        turn &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string',
    )
    .map(({ role, content }) => ({ role, content }));
}

async function ensureTtlIndexes(db, ttlDays) {
  if (!ttlDays) return;

  const options = { expireAfterSeconds: ttlDays * 86_400 };
  for (const name of [CHANNEL_COLLECTION, DM_COLLECTION]) {
    try {
      await db.collection(name).createIndex({ updatedAt: 1 }, options);
    } catch (error) {
      console.warn(`Could not create the TTL index on ${name}: ${error?.message ?? error}`);
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
export class MemoryStore {
  #client;
  #db;
  #maxMessages;
  #channels;
  #mode;

  constructor({ client = null, db = null, maxHistoryTurns }) {
    this.#client = client;
    this.#db = db;
    this.#maxMessages = maxHistoryTurns * 2;
    this.#channels = new Map();
    this.#mode = db ? 'mongo' : 'memory';
  }

  get mode() {
    return this.#mode;
  }

  static async connect({ uri, dbName, timeoutMs, maxHistoryTurns, ttlDays = null }) {
    if (!uri) {
      console.warn(
        'MONGODB_URI is not set; conversation memory stays in RAM and is lost on restart.',
      );
      return new MemoryStore({ maxHistoryTurns });
    }

    const client = new MongoClient(uri, {
      appName: 'td-discord-bot',
      serverSelectionTimeoutMS: timeoutMs,
    });

    try {
      await client.connect();
      const db = client.db(dbName);
      await db.command({ ping: 1 });
      await ensureTtlIndexes(db, ttlDays);
      return new MemoryStore({ client, db, maxHistoryTurns });
    } catch (error) {
      console.warn(
        `MongoDB is unavailable (${error?.message ?? error}); ` +
          'falling back to in-RAM memory, lost on restart.',
      );
      await client.close().catch(() => {});
      return new MemoryStore({ maxHistoryTurns });
    }
  }

  async getHistory(scope, key) {
    assertScope(scope);

    // Private memory is opt-in: without an explicit preference, nothing is
    // read (and nothing is written by appendTurn).
    if (scope === 'dm' && !(await this.isDmEnabled(key))) return [];

    if (this.#mode === 'memory') {
      return normalizeTurns(this.#channels.get(key));
    }

    const doc = await this.#collection(scope).findOne(
      { _id: key },
      { projection: { turns: { $slice: -this.#maxMessages } } },
    );
    return normalizeTurns(doc?.turns);
  }

  async appendTurn(scope, key, prompt, reply) {
    assertScope(scope);

    if (scope === 'dm' && !(await this.isDmEnabled(key))) return false;

    const turn = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: reply },
    ];

    if (this.#mode === 'memory') {
      const history = [...(this.#channels.get(key) ?? []), ...turn];
      if (history.length > this.#maxMessages) {
        history.splice(0, history.length - this.#maxMessages);
      }
      this.#channels.set(key, history);
      return true;
    }

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
    return true;
  }

  async isDmEnabled(userId) {
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
  async setDmEnabled(userId, enabled) {
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

    if (!enabled) {
      await this.#db.collection(DM_COLLECTION).deleteOne({ _id: userId });
    }
  }

  /**
   * Create the user's preference document (memory off) the first time they
   * talk to the bot in private, so the opt-in hint is shown exactly once.
   * Returns true only for the call that created the document.
   */
  async showDmHintOnce(userId) {
    if (this.#mode !== 'mongo') return false;

    const existing = await this.#preferences().findOne(
      { _id: userId },
      { projection: { _id: 1 } },
    );
    if (existing) return false;

    try {
      const now = new Date();
      await this.#preferences().insertOne({
        _id: userId,
        enabled: false,
        hinted: true,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch (error) {
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  async close() {
    if (!this.#client) return;
    await this.#client.close().catch(() => {});
  }

  #collection(scope) {
    return this.#db.collection(scope === 'channel' ? CHANNEL_COLLECTION : DM_COLLECTION);
  }

  #preferences() {
    return this.#db.collection(DM_PREFERENCES_COLLECTION);
  }
}
