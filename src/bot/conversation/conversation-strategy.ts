/**
 * Encapsulates how a conversation reaches the bot: the shared algorithm
 * (lock, history, model, memory, reply) is the same for a /q interaction and
 * a mentioned message; only extraction, validation, delivery and error
 * reporting differ.
 */
export interface ConversationStrategy {
  /** Clé du verrou de conversation (un seul appel en vol par conversation). */
  lockKey(): string;
  /** Clé de mémoire, ou null pour les messages privés (jamais mémorisés). */
  memoryKey(): string | null;
  /**
   * Valide et extrait le prompt. Répond lui-même en cas d'entrée invalide et
   * renvoie null pour signifier que rien ne doit être traité.
   */
  prepare(): Promise<string | null>;
  /** Effet de bord avant l'appel modèle ; renvoie la fonction d'arrêt. */
  beginWork(): Promise<() => void>;
  /** Répond quand la conversation est déjà occupée. */
  reportBusy(): Promise<void>;
  /** Envoie la réponse, découpée si nécessaire. */
  sendReply(reply: string): Promise<void>;
  /** Répond à une erreur de traitement avec le message adapté. */
  reportError(error: unknown): Promise<void>;
  /** Identité de journalisation des erreurs de traitement. */
  errorLabel(): string;
  errorFields(): Record<string, unknown>;
}
