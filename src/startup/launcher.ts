import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config/config-loader.ts';
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
 * Boots the bot: connects memory, logs the bot in, registers the commands
 * and installs the shutdown handlers that destroy the client and close
 * MongoDB exactly once, even when two signals arrive together.
 */
export class Launcher {
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
      logger.info(`Received ${signal}; shutting down.`);
      client.destroy();
      await memory.close();
      logger.info('Shutdown terminé', {
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
            logger.error(`Shutdown failed: ${error}`);
            processRef.exit(1);
          },
        );
      });
    }

    return shutdown;
  }

  #appConfig: StartupConfig;
  #createClient: () => BotClient & StartupClient;
  #connectMemory: (options: MemoryConnectOptions) => Promise<ConversationMemory>;
  #logger: BotLogger;
  #processRef: ProcessLike;

  constructor({
    appConfig = config,
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
        this.#logger.info(`Logged in as ${readyClient.user.tag}.`);
        this.#logger.info(
          `DeepSeek: model=${this.#appConfig.deepseekModel} base=${this.#appConfig.deepseekBaseUrl} ` +
            `thinking=${this.#appConfig.deepseekThinking}` +
            (this.#appConfig.deepseekThinking === 'enabled'
              ? ` effort=${this.#appConfig.deepseekEffort}`
              : ''),
        );
        this.#logger.info(
          memory.mode === 'mongo'
            ? `Memory: MongoDB db=${this.#appConfig.mongodbDb}` +
                (this.#appConfig.memoryTtlDays ? ` ttl=${this.#appConfig.memoryTtlDays}d` : '') +
                '.'
            : 'Memory: in-RAM fallback (lost on restart).',
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
