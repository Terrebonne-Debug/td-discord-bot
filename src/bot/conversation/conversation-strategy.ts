/**
 * Encapsule la façon dont une conversation atteint le bot : l'algorithme
 * partagé (verrou, historique, modèle, mémoire, réponse) est le même pour une
 * interaction `/q` et pour un message mentionné ; seules l'extraction, la
 * validation, la livraison et la gestion d'erreur diffèrent.
 *
 * @interface
 */
export interface ConversationStrategy {
  /**
   * @method
   * @returns {string} La clé du verrou de conversation (un seul appel en vol).
   */
  lockKey(): string;
  /**
   * @method
   * @returns {string | null} La clé de mémoire, ou null en message privé
   * (jamais mémorisé).
   */
  memoryKey(): string | null;
  /**
   * Valide et extrait le prompt. Répond lui-même en cas d'entrée invalide et
   * renvoie null pour signifier que rien ne doit être traité.
   *
   * @method
   * @returns {Promise<string | null>}
   */
  prepare(): Promise<string | null>;
  /**
   * Effet de bord avant l'appel au modèle.
   *
   * @method
   * @returns {Promise<() => void>} La fonction d'arrêt de l'effet.
   */
  beginWork(): Promise<() => void>;
  /**
   * Répond quand la conversation est déjà occupée.
   *
   * @method
   * @returns {Promise<void>}
   */
  reportBusy(): Promise<void>;
  /**
   * Envoie la réponse, découpée si nécessaire.
   *
   * @method
   * @param {string} reply - La réponse du modèle.
   * @returns {Promise<void>}
   */
  sendReply(reply: string): Promise<void>;
  /**
   * Répond à une erreur de traitement avec le message adapté.
   *
   * @method
   * @param {unknown} error - L'erreur à décrire.
   * @returns {Promise<void>}
   */
  reportError(error: unknown): Promise<void>;
  /**
   * @method
   * @returns {string} L'identité de journalisation des erreurs.
   */
  errorLabel(): string;
  /**
   * @method
   * @returns {Record<string, unknown>} Les champs structurés de l'erreur.
   */
  errorFields(): Record<string, unknown>;
}
