import type { MessageFlags, MessageMentionOptions } from 'discord.js';

/**
 * Charge de réponse textuelle, partagée par tous les chemins d'envoi.
 *
 * @interface
 */
export interface ReplyPayload {
  content: string;
  allowedMentions?: MessageMentionOptions;
  flags?: MessageFlags;
}
