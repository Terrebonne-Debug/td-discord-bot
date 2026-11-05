import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BuildInfo } from '../../models/version/build-info.ts';

/**
 * `/version` : affiche le numéro de version et le dernier commit.
 *
 * @class VersionCommand
 */
export class VersionCommand implements Command {
  /** @type {readonly string[]} Le nom de la commande. */
  readonly names = ['version'] as const;

  /** @type {BuildInfo} La version et le commit de cette compilation. */
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
      content: `**td-discord-bot ${this.#buildInfo.version}**\nCommit : \`${this.#buildInfo.commit}\``,
      allowedMentions: { parse: [] },
    });
  }
}
