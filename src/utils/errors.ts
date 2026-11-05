/**
 * Aides statiques pour la gestion d'erreurs — le seul endroit où un rejet
 * inconnu devient un message journalisable.
 *
 * @class Errors
 */
export class Errors {
  /**
   * @static
   * @function
   * @param {unknown} error - Le rejet à formater.
   * @returns {string} Le message journalisable.
   */
  static messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
