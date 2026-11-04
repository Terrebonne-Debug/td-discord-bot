/** A channel that can show the typing indicator. */
export interface TypingChannel {
  sendTyping?: () => Promise<unknown>;
}
