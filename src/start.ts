import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.ts';
import type { LogLevel } from './config.ts';
import { MemoryStore } from './memory.ts';
import type { ConversationMemory, MemoryConnectOptions } from './memory.ts';
import { createBot, registerCommands } from './bot.ts';
import type { BotClient } from './bot.ts';
import { createConsoleLogger, createRootLogger } from './logging.ts';
import type { BotLogger } from './logging.ts';

/** The configuration values start() reads; the full Config satisfies this. */
export interface StartupConfig {
  discordToken: string;
  discordGuildId: string | null;
  deepseekModel: string;
  deepseekBaseUrl: string;
  deepseekThinking: string;
  deepseekEffort: string;
  maxHistoryTurns: number;
  maxPromptChars: number;
  mongodbUri: string | null;
  mongodbDb: string;
  mongodbTimeoutMs: number;
  memoryTtlDays: number | null;
  logLevel: LogLevel;
}

/** The slice of the Discord client the startup flow needs. */
export interface StartupClient {
  once(event: string, listener: (...args: any[]) => void): unknown;
  login(token: string): Promise<unknown>;
  destroy(): void;
}

/** The slice of process installShutdownHandlers needs. */
export interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  exit(code: number): void;
}

export function createDefaultClient(): Client {
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
 * Register SIGINT/SIGTERM handlers that destroy the client and close MongoDB
 * exactly once, even when the two signals arrive together.
 */
export function installShutdownHandlers({
  client,
  memory,
  logger = createConsoleLogger(),
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

export async function start({
  appConfig = config,
  createClient = createDefaultClient,
  connectMemory = MemoryStore.connect,
  logger = createRootLogger(config),
  processRef = process,
}: {
  appConfig?: StartupConfig;
  createClient?: () => BotClient & StartupClient;
  connectMemory?: (options: MemoryConnectOptions) => Promise<ConversationMemory>;
  logger?: BotLogger;
  processRef?: ProcessLike;
} = {}) {
  logger.info('Démarrage du bot', {
    model: appConfig.deepseekModel,
    thinking: appConfig.deepseekThinking,
    effort: appConfig.deepseekEffort,
    maxHistoryTurns: appConfig.maxHistoryTurns,
    logLevel: appConfig.logLevel,
  });

  const memory = await connectMemory({
    uri: appConfig.mongodbUri,
    dbName: appConfig.mongodbDb,
    timeoutMs: appConfig.mongodbTimeoutMs,
    maxHistoryTurns: appConfig.maxHistoryTurns,
    ttlDays: appConfig.memoryTtlDays,
    logger,
  });

  const client = createClient();
  createBot({ client, memory, settings: appConfig, logger });

  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`Logged in as ${readyClient.user.tag}.`);
      logger.info(
        `DeepSeek: model=${appConfig.deepseekModel} base=${appConfig.deepseekBaseUrl} ` +
          `thinking=${appConfig.deepseekThinking}` +
          (appConfig.deepseekThinking === 'enabled'
            ? ` effort=${appConfig.deepseekEffort}`
            : ''),
      );
      logger.info(
        memory.mode === 'mongo'
          ? `Memory: MongoDB db=${appConfig.mongodbDb}` +
              (appConfig.memoryTtlDays ? ` ttl=${appConfig.memoryTtlDays}d` : '') +
              '.'
          : 'Memory: in-RAM fallback (lost on restart, private memory disabled).',
      );

      await registerCommands(readyClient, appConfig, logger);
      resolve();
    });
  });

  try {
    await client.login(appConfig.discordToken);
    await ready;
  } catch (error) {
    client.destroy();
    await memory.close();
    throw error;
  }

  const shutdown = installShutdownHandlers({ client, memory, logger, processRef });
  return { client, memory, shutdown };
}
