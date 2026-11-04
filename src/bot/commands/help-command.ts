import { Commands } from '../commands.ts';
import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';

/** `/aide` et `/help` : exactement le même comportement, la liste des commandes. */
export class HelpCommand implements Command {
  readonly names = ['aide', 'help'] as const;

  async handle(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: Commands.helpText(),
      allowedMentions: { parse: [] },
    });
  }
}
