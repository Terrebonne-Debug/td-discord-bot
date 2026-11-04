import type { MessageChannelLike } from './message-channel-like.ts';
import type { ReplyPayload } from './reply-payload.ts';

/** The slice of a Discord message the bot reads. */
export interface MessageLike {
  author: { bot: boolean; id: string };
  system: boolean;
  channelId: string;
  content: string;
  channel: MessageChannelLike;
  mentions: { users: { has(id: string): boolean } };
  reply(payload: ReplyPayload): Promise<unknown>;
}
