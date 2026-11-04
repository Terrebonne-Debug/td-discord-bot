import type { MessageFlags, MessageMentionOptions } from 'discord.js';

/** Text-only reply payload, shared by every send path. */
export interface ReplyPayload {
  content: string;
  allowedMentions?: MessageMentionOptions;
  flags?: MessageFlags;
}
