/**
 * One stored exchange: a user prompt followed by an assistant reply. These
 * are the only roles conversation memory ever contains.
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** Memory scope: a public channel (keyed by channel id) or a private
 * conversation (keyed by user id, opt-in). */
export type MemoryScope = 'channel' | 'dm';

/** How conversation memory is backed. */
export type MemoryMode = 'mongo' | 'memory';
