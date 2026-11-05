import type { BotLogger } from '../logging/bot-logger.ts';

/**
 * Options de MemoryStore.connect().
 *
 * @interface
 */
export interface MemoryConnectOptions {
  uri: string | null;
  dbName: string;
  timeoutMs: number;
  maxHistoryTurns: number;
  ttlDays?: number | null;
  encryptionKey?: Buffer | null;
  logger?: BotLogger;
}
