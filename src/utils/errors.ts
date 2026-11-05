/**
 * Static helpers for error handling — the single place where an unknown
 * rejection is turned into a loggable message.
 */
export class Errors {
  static messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
