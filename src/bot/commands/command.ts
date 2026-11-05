import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { ModalSubmitLike } from '../../models/discord/modal-submit-like.ts';

/**
 * Une commande slash : elle déclare ses noms (alias compris) et exécute ses
 * interactions. Le hook optionnel handleSubmit prend en charge les modals
 * qu'elle possède ; il renvoie true quand il a traité la soumission.
 *
 * @interface
 */
export interface Command {
  /** @type {readonly string[]} Les noms de la commande, alias compris. */
  readonly names: readonly string[];
  /**
   * Exécute l'interaction de la commande.
   *
   * @method
   * @param {InteractionLike} interaction - L'interaction slash.
   * @returns {Promise<void>}
   */
  handle(interaction: InteractionLike): Promise<void>;
  /**
   * Traite une soumission de modal appartenant à la commande.
   *
   * @method
   * @param {ModalSubmitLike} modal - La soumission reçue.
   * @returns {Promise<boolean>} Vrai si la soumission a été prise en charge.
   */
  handleSubmit?(modal: ModalSubmitLike): Promise<boolean>;
}
