import { SlashConversation } from '../conversation/slash-conversation.ts';
import type { ConversationService } from '../conversation/conversation-service.ts';
import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';

/** `/q` : pose une question au modèle avec la mémoire du canal. */
export class QuestionCommand implements Command {
  readonly names = ['q'] as const;

  #conversations: ConversationService;
  #settings: BotSettings;
  #logger: BotLogger;

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

  async handle(interaction: InteractionLike): Promise<void> {
    await this.#conversations.handle(
      new SlashConversation(interaction, this.#settings, this.#logger),
    );
  }
}
