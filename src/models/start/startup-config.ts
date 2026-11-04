import type { LogLevel } from '../config/log-level.ts';

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
  memoryEncryptionKey: string | null;
  logLevel: LogLevel;
  githubToken: string | null;
  githubRepository: string;
}
