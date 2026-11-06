import { MessageFlags } from 'discord.js';
import {
  Commands as CommandNames,
  featureRequestCreated,
  Limits,
  LogMessages,
  Messages,
} from '../../constants.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { ModalSubmitLike } from '../../models/discord/modal-submit-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import { Errors } from '../../utils/errors.ts';
import { Commands } from '../commands.ts';
import type { Command } from './command.ts';

/**
 * `/feature-request` : ouvre le formulaire titre + description, puis crée
 * l'issue GitHub.
 *
 * @class FeatureRequestCommand
 */
export class FeatureRequestCommand implements Command {
  /** @type {readonly string[]} Le nom de la commande. */
  readonly names = [CommandNames.featureRequest] as const;

  /** @type {BotSettings} Les réglages du bot (jeton et dépôt GitHub). */
  #settings: BotSettings;
  /** @type {(title: string, body: string) => Promise<string>} Le créateur d'issue. */
  #createIssue: (title: string, body: string) => Promise<string>;
  /** @type {BotLogger} Le journal du bot. */
  #logger: BotLogger;

  /**
   * @constructor
   * @param {BotSettings} settings - Les réglages du bot.
   * @param {(title: string, body: string) => Promise<string>} createIssue - Le créateur d'issue.
   * @param {BotLogger} logger - Le journal du bot.
   */
  constructor({
    settings,
    createIssue,
    logger,
  }: {
    settings: BotSettings;
    createIssue: (title: string, body: string) => Promise<string>;
    logger: BotLogger;
  }) {
    this.#settings = settings;
    this.#createIssue = createIssue;
    this.#logger = logger;
  }

  /**
   * Vérifie la configuration puis ouvre le formulaire.
   *
   * @method
   * @param {InteractionLike} interaction - L'interaction slash.
   * @returns {Promise<void>}
   */
  async handle(interaction: InteractionLike): Promise<void> {
    if (!this.#settings.githubToken) {
      await interaction.reply({
        content: Messages.featureRequestNotConfigured,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(Commands.featureRequestModal());
  }

  /**
   * Reçoit le formulaire rempli et crée l'issue GitHub.
   *
   * @method
   * @param {ModalSubmitLike} modal - La soumission de modal.
   * @returns {Promise<boolean>} Vrai si la soumission a été prise en charge.
   */
  async handleSubmit(modal: ModalSubmitLike): Promise<boolean> {
    if (modal.customId !== CommandNames.featureRequest) return false;

    const title = modal.fields.getTextInputValue(CommandNames.titleField).trim();
    const description = modal.fields.getTextInputValue(CommandNames.descriptionField).trim();
    if (!title || !description) {
      await modal.reply({
        content: Messages.featureRequestTitleAndDescriptionRequired,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await modal.deferReply();

    try {
      /** GitHub limite les titres à 256 caractères ; on tronque largement en deçà. */
      const safeTitle =
        title.length > Limits.featureRequestTitle
          ? `${title.slice(0, Limits.truncatedTitleLength)}…`
          : title;
      const body = `**Demande**\n\n${description}\n\n---\nDemandé depuis Discord par ${modal.user.username}.`;
      const url = await this.#createIssue(safeTitle, body);
      this.#logger.info(LogMessages.issueCreated, { url, chars: description.length });
      await modal.editReply({
        content: featureRequestCreated(url),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.#logger.error(LogMessages.featureRequestIssueFailed(Errors.messageOf(error)));
      await modal
        .editReply({
          content: Messages.featureRequestCreationFailed,
        })
        .catch(() => {});
    }

    return true;
  }
}
