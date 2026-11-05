import type { ModalSubmitLike } from './modal-submit-like.ts';
import type { ReplyPayload } from './reply-payload.ts';
import type { TypingChannel } from './typing-channel.ts';

/**
 * La tranche d'une interaction slash que le bot lit.
 *
 * @interface
 */
export interface InteractionLike {
  commandName: string;
  channelId: string | null;
  user: { id: string; username: string };
  channel: TypingChannel | null;
  deferred: boolean;
  replied: boolean;
  isChatInputCommand(): this is InteractionLike;
  isModalSubmit(): this is ModalSubmitLike;
  inGuild(): boolean;
  options: {
    getString(name: string, required: true): string;
    getString(name: string, required?: boolean): string | null;
  };
  showModal(modal: unknown): Promise<unknown>;
  deferReply(): Promise<unknown>;
  reply(payload: ReplyPayload): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
  followUp(payload: ReplyPayload): Promise<unknown>;
}
