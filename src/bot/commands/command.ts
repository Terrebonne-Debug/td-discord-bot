import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { ModalSubmitLike } from '../../models/discord/modal-submit-like.ts';

/**
 * Une commande slash : elle déclare ses noms (alias compris) et exécute ses
 * interactions. Le hook optionnel handleSubmit prend en charge les modals
 * qu'elle possède ; il renvoie true quand il a traité la soumission.
 */
export interface Command {
  readonly names: readonly string[];
  handle(interaction: InteractionLike): Promise<void>;
  handleSubmit?(modal: ModalSubmitLike): Promise<boolean>;
}
