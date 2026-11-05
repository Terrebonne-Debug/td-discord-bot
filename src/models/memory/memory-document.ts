import type { EncryptedTurn } from '../crypto/encrypted-turn.ts';
import type { Turn } from './turn.ts';

/**
 * Un document de channel_memories : tours scellés ou historiques en clair.
 *
 * @interface
 */
export interface MemoryDocument {
  _id: string;
  turns?: Array<Turn | EncryptedTurn>;
  createdAt?: Date;
  updatedAt?: Date;
}
