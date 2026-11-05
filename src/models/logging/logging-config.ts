import type { LogLevel } from '../config/log-level.ts';

/**
 * Les valeurs de configuration que la journalisation lit ; Config les
 * satisfait.
 *
 * @interface
 */
export interface LoggingConfig {
  logLevel: LogLevel;
  logDir: string;
  logFileEnabled: boolean;
  logMaxSizeMb: number;
  logRetentionDays: number;
}
