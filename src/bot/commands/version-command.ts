import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BuildInfo } from '../../models/version/build-info.ts';

/** `/version` : affiche le numéro de version et le dernier commit. */
export class VersionCommand implements Command {
  readonly names = ['version'] as const;

  #buildInfo: BuildInfo;

  constructor(buildInfo: BuildInfo) {
    this.#buildInfo = buildInfo;
  }

  async handle(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: `**td-discord-bot ${this.#buildInfo.version}**\nCommit : \`${this.#buildInfo.commit}\``,
      allowedMentions: { parse: [] },
    });
  }
}
