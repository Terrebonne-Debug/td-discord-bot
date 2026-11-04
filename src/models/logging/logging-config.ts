import type { LogLevel } from '../config/log-level.ts';

/** The configuration values the logging module reads; Config satisfies it. */
export interface LoggingConfig {
  logLevel: LogLevel;
  logDir: string;
  logFileEnabled: boolean;
  logMaxSizeMb: number;
  logRetentionDays: number;
}
