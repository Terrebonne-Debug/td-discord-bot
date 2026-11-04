import type { MemoryMode } from './memory-mode.ts';
import type { Turn } from './turn.ts';

/**
 * The conversation-memory API the rest of the bot depends on. MemoryStore
 * implements it, and tests inject plain objects that do too.
 */
export interface ConversationMemory {
  readonly mode: MemoryMode;
  getHistory(key: string): Promise<Turn[]>;
  appendTurn(key: string, prompt: string, reply: string): Promise<boolean>;
  close(): Promise<void>;
}
