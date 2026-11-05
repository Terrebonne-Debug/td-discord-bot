import type { InteractionLike } from './interaction-like.ts';
import type { ReplyPayload } from './reply-payload.ts';

/**
 * La tranche d'une soumission de modal que le bot lit.
 *
 * @interface
 */
export interface ModalSubmitLike {
  customId: string;
  user: { id: string; username: string };
  deferred: boolean;
  replied: boolean;
  isChatInputCommand(): this is InteractionLike;
  isModalSubmit(): this is ModalSubmitLike;
  fields: { getTextInputValue(name: string): string };
  deferReply(): Promise<unknown>;
  reply(payload: ReplyPayload): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
  followUp(payload: ReplyPayload): Promise<unknown>;
}
