import type { MemoryMode } from './memory-mode.ts';
import type { Turn } from './turn.ts';

/**
 * L'API de mémoire de conversation dont le reste du bot dépend. MemoryStore
 * l'implémente, et les tests injectent des objets simples qui le font aussi.
 *
 * @interface
 */
export interface ConversationMemory {
  readonly mode: MemoryMode;
  getHistory(key: string): Promise<Turn[]>;
  appendTurn(key: string, prompt: string, reply: string): Promise<boolean>;
  close(): Promise<void>;
}
