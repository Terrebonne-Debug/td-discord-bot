/**
 * The logger interface the bot depends on. winston is an implementation
 * detail of src/logging.ts: everywhere else only receives a BotLogger.
 */
export interface BotLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Returns a logger whose records carry the given context (scope, key…). */
  child(bindings: Record<string, unknown>): BotLogger;
  /** Flushes pending writes before shutdown. */
  flush(): Promise<void>;
}
