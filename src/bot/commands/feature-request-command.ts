import { MessageFlags } from 'discord.js';
import { Commands } from '../commands.ts';
import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { ModalSubmitLike } from '../../models/discord/modal-submit-like.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `/feature-request` : ouvre le formulaire titre + description, puis crée l'issue. */
export class FeatureRequestCommand implements Command {
  readonly names = ['feature-request'] as const;

  #settings: BotSettings;
  #createIssue: (title: string, body: string) => Promise<string>;
  #logger: BotLogger;

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

  async handle(interaction: InteractionLike): Promise<void> {
    if (!this.#settings.githubToken) {
      await interaction.reply({
        content:
          'Les demandes de fonctionnalités ne sont pas configurées (GITHUB_TOKEN manquant).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(Commands.featureRequestModal());
  }

  /** Reçoit le formulaire rempli et crée l'issue GitHub ; true si pris en charge. */
  async handleSubmit(modal: ModalSubmitLike): Promise<boolean> {
    if (modal.customId !== 'feature-request') return false;

    const title = modal.fields.getTextInputValue('titre').trim();
    const description = modal.fields.getTextInputValue('description').trim();
    if (!title || !description) {
      await modal.reply({
        content: 'Le titre et la description sont requis.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await modal.deferReply();

    try {
      // GitHub limite les titres à 256 caractères ; on tronque largement en deçà.
      const safeTitle = title.length > 200 ? `${title.slice(0, 199)}…` : title;
      const body = `**Demande**\n\n${description}\n\n---\nDemandé depuis Discord par ${modal.user.username}.`;
      const url = await this.#createIssue(safeTitle, body);
      this.#logger.info('Issue de demande créée', { url, chars: description.length });
      await modal.editReply({
        content: `Demande créée : ${url}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.#logger.error(`Could not create the feature request issue: ${messageOf(error)}`);
      await modal
        .editReply({
          content: 'Impossible de créer la demande pour le moment. Réessayez plus tard.',
        })
        .catch(() => {});
    }

    return true;
  }
}
