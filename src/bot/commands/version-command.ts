import { Commands as CommandNames, versionReply } from '../../constants.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BuildInfo } from '../../models/version/build-info.ts';
import type { Command } from './command.ts';

/**
 * `/version` : affiche le numéro de version et le dernier commit.
 *
 * @class VersionCommand
 */
export class VersionCommand implements Command {
  readonly names: readonly string[] = [CommandNames.version];

  #buildInfo: BuildInfo;

  /**
   * @constructor
   * @param {BuildInfo} buildInfo - La version et le commit.
   */
  constructor(buildInfo: BuildInfo) {
    this.#buildInfo = buildInfo;
  }

  /**
   * Répond avec la version et le dernier commit.
   *
   * @method
   * @param {InteractionLike} interaction - L'interaction slash.
   * @returns {Promise<void>}
   */
  async handle(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: versionReply(this.#buildInfo.version, this.#buildInfo.commit),
      allowedMentions: { parse: [] },
    });
  }
}
