import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { ConfigLoader } from '../config/config-loader.ts';
import { MemoryCipher } from '../crypto/memory-cipher.ts';
import { MemoryStore } from '../memory/memory-store.ts';
import { Bot } from '../bot/bot.ts';
import { LoggerFactory } from '../logging/logger-factory.ts';
import { BuildInfoReader } from '../version/build-info-reader.ts';
import type { BotClient } from '../models/discord/bot-client.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { ConversationMemory } from '../models/memory/conversation-memory.ts';
import type { MemoryConnectOptions } from '../models/memory/memory-connect-options.ts';
import type { ProcessLike } from '../models/start/process-like.ts';
import type { StartupClient } from '../models/start/startup-client.ts';
import type { StartupConfig } from '../models/start/startup-config.ts';

/**
 * Démarre le bot : connecte la mémoire, ouvre la session Discord, enregistre
 * les commandes et installe les gestionnaires d'arrêt qui détruisent le
 * client et ferment MongoDB exactement une fois, même si deux signaux
 * arrivent ensemble.
 *
 * @class Launcher
 */
export class Launcher {
  /**
   * Construit le client Discord avec les intents requis.
   *
   * @static
   * @function
   * @returns {Client} Le client discord.js configuré.
   */
  static createDefaultClient(): Client {
    return new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  /**
   * Installe les gestionnaires SIGINT/SIGTERM.
   *
   * @static
   * @function
   * @param {{ destroy(): void }} client - Le client à détruire.
   * @param {{ close(): Promise<void> }} memory - La mémoire à fermer.
   * @param {BotLogger} [logger] - Le journal du bot.
   * @param {ProcessLike} [processRef=process] - Le processus à observer.
   * @returns {(signal: string) => Promise<boolean>} La fonction d'arrêt.
   */
  static installShutdownHandlers({
    client,
    memory,
    logger = new LoggerFactory().consoleLogger(),
    processRef = process,
  }: {
    client: { destroy(): void };
    memory: { close(): Promise<void> };
    logger?: BotLogger;
    processRef?: ProcessLike;
  }): (signal: string) => Promise<boolean> {
    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<boolean> => {
      if (shuttingDown) return false;
      shuttingDown = true;
      const startedAt = performance.now();
      logger.info(`Reçu ${signal} ; arrêt en cours.`);
      client.destroy();
      await memory.close();
      logger.info('Arrêt terminé', {
        signal,
        ms: Math.round(performance.now() - startedAt),
      });
      await logger.flush();
      return true;
    };

    for (const signal of ['SIGINT', 'SIGTERM']) {
      processRef.on(signal, () => {
        shutdown(signal).then(
          (didShutDown) => {
            if (didShutDown) processRef.exit(0);
          },
          (error) => {
            logger.error(`Échec de l'arrêt : ${error}`);
            processRef.exit(1);
          },
        );
      });
    }

    return shutdown;
  }

  /** @type {StartupConfig} La configuration de démarrage. */
  #appConfig: StartupConfig;
  /** @type {() => BotClient & StartupClient} La fabrique de client. */
  #createClient: () => BotClient & StartupClient;
  /** @type {(options: MemoryConnectOptions) => Promise<ConversationMemory>} La fabrique de mémoire. */
  #connectMemory: (options: MemoryConnectOptions) => Promise<ConversationMemory>;
  /** @type {BotLogger} Le journal du bot. */
  #logger: BotLogger;
  /** @type {ProcessLike} Le processus à observer. */
  #processRef: ProcessLike;

  /**
   * @constructor
   * @param {StartupConfig} [appConfig=config] - La configuration de démarrage.
   * @param {() => BotClient & StartupClient} [createClient] - La fabrique de client.
   * @param {(options: MemoryConnectOptions) => Promise<ConversationMemory>} [connectMemory] - La fabrique de mémoire.
   * @param {BotLogger} [logger] - Le journal du bot.
   * @param {ProcessLike} [processRef=process] - Le processus à observer.
   */
  constructor({
    appConfig = ConfigLoader.load(process.env),
    createClient = Launcher.createDefaultClient,
    connectMemory = MemoryStore.connect,
    logger = new LoggerFactory().rootLogger(),
    processRef = process,
  }: {
    appConfig?: StartupConfig;
    createClient?: () => BotClient & StartupClient;
    connectMemory?: (options: MemoryConnectOptions) => Promise<ConversationMemory>;
    logger?: BotLogger;
    processRef?: ProcessLike;
  } = {}) {
    this.#appConfig = appConfig;
    this.#createClient = createClient;
    this.#connectMemory = connectMemory;
    this.#logger = logger;
    this.#processRef = processRef;
  }

  /**
   * Démarre le bot et attend que Discord soit prêt.
   *
   * @method
   * @returns {Promise<{client: BotClient & StartupClient; memory: ConversationMemory; shutdown: (signal: string) => Promise<boolean>}>} Les dépendances démarrées.
   */
  async start(): Promise<{
    client: BotClient & StartupClient;
    memory: ConversationMemory;
    shutdown: (signal: string) => Promise<boolean>;
  }> {
    this.#logger.info('Démarrage du bot', {
      model: this.#appConfig.deepseekModel,
      thinking: this.#appConfig.deepseekThinking,
      effort: this.#appConfig.deepseekEffort,
      maxHistoryTurns: this.#appConfig.maxHistoryTurns,
      logLevel: this.#appConfig.logLevel,
    });

    const memory = await this.#connectMemory({
      uri: this.#appConfig.mongodbUri,
      dbName: this.#appConfig.mongodbDb,
      timeoutMs: this.#appConfig.mongodbTimeoutMs,
      maxHistoryTurns: this.#appConfig.maxHistoryTurns,
      ttlDays: this.#appConfig.memoryTtlDays,
      encryptionKey: MemoryCipher.parseKey(this.#appConfig.memoryEncryptionKey),
      logger: this.#logger,
    });

    const client = this.#createClient();
    new Bot({
      client,
      memory,
      settings: this.#appConfig,
      buildInfo: new BuildInfoReader().read(),
      logger: this.#logger,
    });

    const ready = new Promise<void>((resolve) => {
      client.once(Events.ClientReady, async (readyClient) => {
        this.#logger.info(`Connecté en tant que ${readyClient.user.tag}.`);
        this.#logger.info(
          `DeepSeek : modèle=${this.#appConfig.deepseekModel} base=${this.#appConfig.deepseekBaseUrl} ` +
            `réflexion=${this.#appConfig.deepseekThinking}` +
            (this.#appConfig.deepseekThinking === 'enabled'
              ? ` effort=${this.#appConfig.deepseekEffort}`
              : ''),
        );
        this.#logger.info(
          memory.mode === 'mongo'
            ? `Mémoire : MongoDB base=${this.#appConfig.mongodbDb}` +
                (this.#appConfig.memoryTtlDays ? ` ttl=${this.#appConfig.memoryTtlDays}j` : '') +
                '.'
            : 'Mémoire : repli en RAM (perdue au redémarrage).',
        );

        await Bot.registerCommands(readyClient, this.#appConfig, this.#logger);
        resolve();
      });
    });

    try {
      await client.login(this.#appConfig.discordToken);
      await ready;
    } catch (error) {
      client.destroy();
      await memory.close();
      throw error;
    }

    const shutdown = Launcher.installShutdownHandlers({
      client,
      memory,
      logger: this.#logger,
      processRef: this.#processRef,
    });
    return { client, memory, shutdown };
  }
}
