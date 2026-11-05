import type { Collection, Db } from 'mongodb';
import { MongoClient } from 'mongodb';
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

/**
 * Mémoire de conversation des canaux publics, indexée par identifiant de
 * canal et partagée par tous ses membres. Les messages privés ne sont
 * jamais stockés. Toute la logique vit dans la classe : aucune fonction
 * libre.
 *
 * @class MemoryStore
 */
export class MemoryStore implements ConversationMemory {
  /** @type {string} La collection des mémoires de canaux. */
  static #channelCollection = 'channel_memories';

  /**
   * Reconnaît un tour valide dans une entrée stockée.
   *
   * @function
   * @param {unknown} value - L'entrée à inspecter.
   * @returns {boolean} Vrai pour un tour utilisateur/assistant textuel.
   */
  static #isTurn(value: unknown): value is Turn {
    return (
      typeof value === 'object' &&
      value !== null &&
      'role' in value &&
      'content' in value &&
      (value.role === 'user' || value.role === 'assistant') &&
      typeof value.content === 'string'
    );
  }

  /**
   * Filtre et normalise des tours stockés.
   *
   * @function
   * @param {unknown} turns - Les tours bruts.
   * @returns {Turn[]} Les tours valides.
   */
  static #normalizeTurns(turns: unknown): Turn[] {
    if (!Array.isArray(turns)) return [];
    return turns.filter(MemoryStore.#isTurn).map(({ role, content }) => ({ role, content }));
  }

  /**
   * Ferme un client MongoDB sans jamais échouer.
   *
   * @function
   * @param {Closeable | null | undefined} client - Le client à fermer.
   * @returns {Promise<void>}
   */
  static async #closeQuietly(client: Closeable | null | undefined): Promise<void> {
    if (!client) return;
    await client.close().catch(() => {});
  }

  /**
   * Crée l'index TTL d'expiration quand un TTL est configuré.
   *
   * @function
   * @param {Db} db - La base de données.
   * @param {number | null} ttlDays - L'expiration en jours.
   * @param {BotLogger} logger - Le journal du bot.
   * @returns {Promise<void>}
   */
  static async #ensureTtlIndexes(db: Db, ttlDays: number | null, logger: BotLogger): Promise<void> {
    if (!ttlDays) return;

    const options = { expireAfterSeconds: ttlDays * 86_400 };
    try {
      await db.collection(MemoryStore.#channelCollection).createIndex({ updatedAt: 1 }, options);
    } catch (error) {
      logger.warn(
        `Impossible de créer l'index TTL sur ${MemoryStore.#channelCollection} : ${error}`,
      );
    }
  }

  /**
   * Déchiffre les entrées chiffrées d'un historique stocké. Les entrées
   * historiques en clair passent telles quelles (#normalizeTurns les valide
   * ensuite) ; une entrée chiffrée indéchiffrable est ignorée avec un
   * avertissement, pour qu'un enregistrement cassé ne fasse jamais échouer
   * la conversation.
   *
   * @function
   * @param {Array<Turn | EncryptedTurn> | undefined} turns - Les tours stockés.
   * @param {MemoryCipher | null} cipher - Le chiffreur, ou null sans clé.
   * @param {string} aad - L'identifiant du canal.
   * @param {BotLogger} logger - Le journal du bot.
   * @returns {Array<Turn | EncryptedTurn>} Les tours déchiffrés ou passés tels quels.
   */
  static #decryptTurns(
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
          logger.warn(`Tour chiffré ignoré : MEMORY_ENCRYPTION_KEY non configuré (clé ${aad}).`);
          continue;
        }
        try {
          decrypted.push(cipher.decryptTurn(turn, aad));
        } catch {
          logger.warn(`Tour chiffré ignoré : déchiffrement impossible (clé ${aad}).`);
        }
        continue;
      }
      decrypted.push(turn);
    }
    return decrypted;
  }

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

  /**
   * Connecte la mémoire MongoDB, ou replie sur la RAM.
   *
   * @static
   * @function
   * @param {MemoryConnectOptions} options - Les options de connexion.
   * @returns {Promise<MemoryStore>} Le magasin prêt à l'emploi.
   */
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
        "MONGODB_URI n'est pas défini ; la mémoire de conversation reste en RAM et sera perdue au redémarrage.",
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
      await MemoryStore.#ensureTtlIndexes(db, ttlDays, logger);
      if (!encryptionKey) {
        logger.warn(
          "MEMORY_ENCRYPTION_KEY n'est pas défini ; la mémoire des canaux est stockée en clair.",
        );
      }
      return new MemoryStore({ client, db, maxHistoryTurns, encryptionKey, logger });
    } catch (error) {
      logger.warn(
        `MongoDB est indisponible (${error}); ` +
          'repli sur la mémoire en RAM, perdue au redémarrage.',
      );
      await MemoryStore.#closeQuietly(client);
      return new MemoryStore({ maxHistoryTurns, logger });
    }
  }

  async getHistory(key: string): Promise<Turn[]> {
    if (this.#mode === 'memory') {
      const history = MemoryStore.#normalizeTurns(this.#channels.get(key));
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
    const history = MemoryStore.#normalizeTurns(
      MemoryStore.#decryptTurns(doc?.turns, this.#cipher, key, this.#logger),
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
    await MemoryStore.#closeQuietly(this.#client);
  }

  #collection(): Collection<MemoryDocument> {
    /**
     * #db is always set in 'mongo' mode, and this accessor is only reached
     * from 'mongo' code paths.
     */
    return this.#db!.collection<MemoryDocument>(MemoryStore.#channelCollection);
  }
}
