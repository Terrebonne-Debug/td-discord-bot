/**
 * Levée quand la mémoire de conversation ne peut pas être lue ; déclenche une
 * réponse spécifique.
 *
 * @class MemoryUnavailableError
 */
export class MemoryUnavailableError extends Error {
  memoryUnavailable = true;

  constructor(cause: unknown) {
    super('La mémoire de conversation est indisponible.', { cause });
    this.name = 'MemoryUnavailableError';
  }
}
