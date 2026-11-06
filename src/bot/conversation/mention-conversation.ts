import { ChannelType } from 'discord.js';
import { keepQuestionsUnder, LogFields, LogMessages, Messages } from '../../constants.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';
import type { MessageLike } from '../../models/discord/message-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import { Bot } from '../bot.ts';
import type { ConversationStrategy } from './conversation-strategy.ts';

/**
 * La variante mention : message Discord, réponses via reply/send.
 *
 * @class MentionConversation
 */
export class MentionConversation implements ConversationStrategy {
  #message: MessageLike;
  #botUserId: string | null;
  #settings: BotSettings;
  #logger: BotLogger;
  #isDM: boolean;

  /**
   * @constructor
   * @param {MessageLike} message - Le message mentionnant le bot.
   * @param {string | null} botUserId - L'identifiant du bot, ou null.
   * @param {BotSettings} settings - Les réglages du bot.
   * @param {BotLogger} logger - Le journal du bot.
   */
  constructor(
    message: MessageLike,
    botUserId: string | null,
    settings: BotSettings,
    logger: BotLogger,
  ) {
    this.#message = message;
    this.#botUserId = botUserId;
    this.#settings = settings;
    this.#logger = logger;
    this.#isDM = message.channel.type === ChannelType.DM;
  }

  /**
   * @method
   * @returns {string} La clé du verrou de conversation.
   */
  lockKey(): string {
    return this.#isDM ? this.#message.author.id : this.#message.channelId;
  }

  /**
   * @method
   * @returns {string | null} La clé de mémoire, ou null en message privé.
   */
  memoryKey(): string | null {
    return this.#isDM ? null : this.#message.channelId;
  }

  /**
   * Valide et extrait le prompt ; répond lui-même en cas d'entrée invalide.
   *
   * @method
   * @returns {Promise<string | null>} Le prompt, ou null si rien à traiter.
   */
  async prepare(): Promise<string | null> {
    const prompt = Bot.stripBotMention(this.#message.content, this.#botUserId);
    if (!prompt) {
      await this.#message.reply({
        content: Messages.mentionPrompt,
        allowedMentions: { repliedUser: false },
      });
      return null;
    }

    if (prompt.length > this.#settings.maxPromptChars) {
      await this.#message.reply({
        content: keepQuestionsUnder(this.#settings.maxPromptChars),
        allowedMentions: { repliedUser: false },
      });
      return null;
    }

    this.#logger.debug(LogMessages.messageReceived, {
      source: LogFields.source,
      isDM: this.#isDM,
      promptChars: prompt.length,
    });
    return prompt;
  }

  /**
   * Démarre l'indicateur de frappe.
   *
   * @method
   * @returns {Promise<() => void>} La fonction d'arrêt de l'indicateur.
   */
  async beginWork(): Promise<() => void> {
    return Bot.startTyping(this.#message.channel);
  }

  /**
   * Répond quand la conversation est déjà occupée.
   *
   * @method
   * @returns {Promise<void>}
   */
  async reportBusy(): Promise<void> {
    await this.#message.reply({
      content: Messages.busyConversation,
      allowedMentions: { repliedUser: false },
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

    for (const [index, chunk] of chunks.entries()) {
      const payload = {
        content: chunk,
        allowedMentions: { parse: [], repliedUser: false },
      };

      if (index === 0) {
        await this.#message.reply(payload);
      } else {
        await this.#message.channel.send(payload);
      }
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
    await this.#message
      .reply({
        content: Bot.describeRequestError(error),
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  }

  /**
   * @method
   * @returns {string} L'identité de journalisation des erreurs.
   */
  errorLabel(): string {
    return LogMessages.handleMessageFailed;
  }

  /**
   * @method
   * @returns {Record<string, unknown>} Les champs structurés de l'erreur.
   */
  errorFields(): Record<string, unknown> {
    return { isDM: this.#isDM };
  }
}
