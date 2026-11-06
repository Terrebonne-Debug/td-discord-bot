import { MessageFlags } from 'discord.js';
import { Commands, keepQuestionsUnder, LogFields, LogMessages, Messages } from '../../constants.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import { Bot } from '../bot.ts';
import type { ConversationStrategy } from './conversation-strategy.ts';

/**
 * La variante `/q` : interaction slash, réponses via deferReply/editReply.
 *
 * @class SlashConversation
 */
export class SlashConversation implements ConversationStrategy {
  #interaction: InteractionLike;
  #settings: BotSettings;
  #logger: BotLogger;
  #isDM: boolean;

  /**
   * @constructor
   * @param {InteractionLike} interaction - L'interaction slash à servir.
   * @param {BotSettings} settings - Les réglages du bot.
   * @param {BotLogger} logger - Le journal du bot.
   */
  constructor(interaction: InteractionLike, settings: BotSettings, logger: BotLogger) {
    this.#interaction = interaction;
    this.#settings = settings;
    this.#logger = logger;
    this.#isDM = !interaction.inGuild();
  }

  /**
   * @method
   * @returns {string} La clé du verrou de conversation.
   */
  lockKey(): string {
    /** Une interaction de guilde porte toujours un identifiant de canal. */
    return this.#isDM ? this.#interaction.user.id : this.#interaction.channelId!;
  }

  /**
   * @method
   * @returns {string | null} La clé de mémoire, ou null en message privé.
   */
  memoryKey(): string | null {
    return this.#isDM ? null : this.#interaction.channelId!;
  }

  /**
   * Valide et extrait le prompt ; répond lui-même en cas d'entrée invalide.
   *
   * @method
   * @returns {Promise<string | null>} Le prompt, ou null si rien à traiter.
   */
  async prepare(): Promise<string | null> {
    const prompt = this.#interaction.options.getString('prompt', true).trim();
    if (!prompt) {
      await this.#interaction.reply({
        content: Messages.pleaseAskQuestion,
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    if (prompt.length > this.#settings.maxPromptChars) {
      await this.#interaction.reply({
        content: keepQuestionsUnder(this.#settings.maxPromptChars),
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    this.#logger.debug(LogMessages.questionReceived, {
      source: LogFields.source,
      isDM: this.#isDM,
      promptChars: prompt.length,
    });
    return prompt;
  }

  /**
   * Diffère la réponse puis démarre l'indicateur de frappe.
   *
   * @method
   * @returns {Promise<() => void>} La fonction d'arrêt de l'indicateur.
   */
  async beginWork(): Promise<() => void> {
    await this.#interaction.deferReply();
    return Bot.startTyping(this.#interaction.channel);
  }

  /**
   * Répond quand la conversation est déjà occupée.
   *
   * @method
   * @returns {Promise<void>}
   */
  async reportBusy(): Promise<void> {
    await this.#interaction.editReply({
      content: Messages.busyConversation,
    });
  }

  /**
   * Envoie la réponse, découpée en morceaux si nécessaire.
   *
   * @method
   * @param {string} reply - La réponse du modèle.
   * @returns {Promise<void>}
   */
  async sendReply(reply: string): Promise<void> {
    const chunks = Bot.splitMessage(reply);
    this.#logger.debug(LogMessages.replySending, { chunks: chunks.length });
    const [first, ...rest] = chunks;

    await this.#interaction.editReply({
      content: first,
      allowedMentions: { parse: [] },
    });

    for (const chunk of rest) {
      await this.#interaction.followUp({
        content: chunk,
        allowedMentions: { parse: [] },
      });
    }
  }

  /**
   * Répond à une erreur de traitement avec le message adapté.
   *
   * @method
   * @param {unknown} error - L'erreur à décrire.
   * @returns {Promise<void>}
   */
  async reportError(error: unknown): Promise<void> {
    const content = Bot.describeRequestError(error);
    if (this.#interaction.deferred || this.#interaction.replied) {
      await this.#interaction.editReply({ content });
    } else {
      await this.#interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }

  /**
   * @method
   * @returns {string} L'identité de journalisation des erreurs.
   */
  errorLabel(): string {
    return LogMessages.handleSlashFailed(Commands.question);
  }

  /**
   * @method
   * @returns {Record<string, unknown>} Les champs structurés de l'erreur.
   */
  errorFields(): Record<string, unknown> {
    return { key: this.memoryKey() };
  }
}
