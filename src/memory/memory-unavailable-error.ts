/** Thrown when the conversation memory cannot be read; shows a specific reply. */
export class MemoryUnavailableError extends Error {
  memoryUnavailable = true;

  constructor(cause: unknown) {
    super('Conversation memory is unavailable.', { cause });
    this.name = 'MemoryUnavailableError';
  }
}
