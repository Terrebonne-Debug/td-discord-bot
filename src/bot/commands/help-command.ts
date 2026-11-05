import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import { Commands } from '../commands.ts';
import type { Command } from './command.ts';

/**
 * `/aide` et `/help` : exactement le même comportement, la liste des
 * commandes.
 *
 * @class HelpCommand
 */
export class HelpCommand implements Command {
  /** @type {readonly string[]} Les deux noms, alias l'un de l'autre. */
  readonly names = ['aide', 'help'] as const;

  /**
   * Répond avec la liste des commandes disponibles.
   *
   * @method
   * @param {InteractionLike} interaction - L'interaction slash.
   * @returns {Promise<void>}
   */
  async handle(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: Commands.helpText(),
      allowedMentions: { parse: [] },
    });
  }
}
