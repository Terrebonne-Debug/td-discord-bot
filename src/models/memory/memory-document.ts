import type { EncryptedTurn } from '../crypto/encrypted-turn.ts';
import type { Turn } from './turn.ts';

/** A document in channel_memories: sealed or legacy-plaintext turns. */
export interface MemoryDocument {
  _id: string;
  turns?: Array<Turn | EncryptedTurn>;
  createdAt?: Date;
  updatedAt?: Date;
}
