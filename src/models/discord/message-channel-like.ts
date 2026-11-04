import type { ChannelType } from 'discord.js';
import type { ReplyPayload } from './reply-payload.ts';
import type { TypingChannel } from './typing-channel.ts';

/** The slice of a message's channel the bot reads. */
export interface MessageChannelLike extends TypingChannel {
  type: ChannelType;
  send(payload: ReplyPayload): Promise<unknown>;
}
