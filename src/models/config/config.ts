import type { EffortLevel } from './effort-level.ts';
import type { LogLevel } from './log-level.ts';
import type { ThinkingMode } from './thinking-mode.ts';

/**
 * Chaque valeur de configuration, après validation et défauts.
 *
 * @interface
 */
export interface Config {
  discordToken: string;
  discordGuildId: string | null;

  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekThinking: ThinkingMode;
  deepseekEffort: EffortLevel;
  deepseekMaxTokens: number;
  deepseekTemperature: number | null;
  deepseekTimeoutMs: number;

  systemPrompt: string;
  maxHistoryTurns: number;
  maxPromptChars: number;

  mongodbUri: string | null;
  mongodbDb: string;
  mongodbTimeoutMs: number;
  memoryTtlDays: number | null;
  memoryEncryptionKey: string | null;

  logLevel: LogLevel;
  logDir: string;
  logFileEnabled: boolean;
  logMaxSizeMb: number;
  logRetentionDays: number;

  githubToken: string | null;
  githubRepository: string;
}
