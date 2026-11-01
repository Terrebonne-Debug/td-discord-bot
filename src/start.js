import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { MemoryStore } from './memory.js';
import { createBot, registerCommands } from './bot.js';

export function createDefaultClient() {
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
export function installShutdownHandlers({ client, memory, logger = console, processRef = process }) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return false;
    shuttingDown = true;
    logger.log(`Received ${signal}; shutting down.`);
    client.destroy();
    await memory.close();
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
  logger = console,
  processRef = process,
} = {}) {
  const memory = await connectMemory({
    uri: appConfig.mongodbUri,
    dbName: appConfig.mongodbDb,
    timeoutMs: appConfig.mongodbTimeoutMs,
    maxHistoryTurns: appConfig.maxHistoryTurns,
    ttlDays: appConfig.memoryTtlDays,
  });

  const client = createClient();
  createBot({ client, memory, settings: appConfig, logger });

  const ready = new Promise((resolve) => {
    client.once(Events.ClientReady, async (readyClient) => {
      logger.log(`Logged in as ${readyClient.user.tag}.`);
      logger.log(
        `DeepSeek: model=${appConfig.deepseekModel} base=${appConfig.deepseekBaseUrl} ` +
          `thinking=${appConfig.deepseekThinking}` +
          (appConfig.deepseekThinking === 'enabled'
            ? ` effort=${appConfig.deepseekEffort}`
            : ''),
      );
      logger.log(
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
