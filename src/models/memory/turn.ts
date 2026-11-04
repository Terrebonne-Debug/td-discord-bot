/**
 * One stored exchange: a user prompt followed by an assistant reply. These
 * are the only roles conversation memory ever contains.
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}
