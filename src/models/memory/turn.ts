/**
 * Un échange stocké : un prompt utilisateur suivi d'une réponse assistante.
 * Ce sont les seuls rôles que la mémoire de conversation contient.
 *
 * @interface
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}
