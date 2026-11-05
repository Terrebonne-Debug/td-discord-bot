/**
 * L'interface de journal dont le bot dépend. winston est un détail
 * d'implémentation de src/logging/ : partout ailleurs, seul un BotLogger
 * est reçu.
 *
 * @interface
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
