import { SlashConversation } from '../conversation/slash-conversation.ts';
import type { ConversationService } from '../conversation/conversation-service.ts';
import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';

/**
 * `/q` : pose une question au modèle avec la mémoire du canal.
 *
 * @class
 */
export class QuestionCommand implements Command {
  /** @type {readonly string[]} Le nom de la commande. */
  readonly names = ['q'] as const;

  /** @type {ConversationService} L'algorithme de conversation partagé. */
  #conversations: ConversationService;
  /** @type {BotSettings} Les réglages du bot. */
  #settings: BotSettings;
  /** @type {BotLogger} Le journal du bot. */
  #logger: BotLogger;

  /**
   * @constructor
   * @param {ConversationService} conversations - L'algorithme partagé.
   * @param {BotSettings} settings - Les réglages du bot.
   * @param {BotLogger} logger - Le journal du bot.
   */
  constructor({
    conversations,
    settings,
    logger,
  }: {
    conversations: ConversationService;
    settings: BotSettings;
    logger: BotLogger;
  }) {
    this.#conversations = conversations;
    this.#settings = settings;
    this.#logger = logger;
  }

  /**
   * Lance la variante slash de l'algorithme de conversation.
   *
   * @method
   * @param {InteractionLike} interaction - L'interaction slash.
   * @returns {Promise<void>}
   */
  async handle(interaction: InteractionLike): Promise<void> {
    await this.#conversations.handle(
      new SlashConversation(interaction, this.#settings, this.#logger),
    );
  }
}
