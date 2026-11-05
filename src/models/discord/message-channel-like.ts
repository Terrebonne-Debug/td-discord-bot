import type { ChannelType } from 'discord.js';
import type { ReplyPayload } from './reply-payload.ts';
import type { TypingChannel } from './typing-channel.ts';

/**
 * La tranche du canal d'un message que le bot lit.
 *
 * @interface
 */
export interface MessageChannelLike extends TypingChannel {
  type: ChannelType;
  send(payload: ReplyPayload): Promise<unknown>;
}
