import { MessageFlags } from 'discord.js';
import { Bot } from '../bot.ts';
import type { ConversationStrategy } from './conversation-strategy.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';

/** La variante /q : interaction slash, réponses via deferReply/editReply. */
export class SlashConversation implements ConversationStrategy {
  #interaction: InteractionLike;
  #settings: BotSettings;
  #logger: BotLogger;
  #isDM: boolean;

  constructor(interaction: InteractionLike, settings: BotSettings, logger: BotLogger) {
    this.#interaction = interaction;
    this.#settings = settings;
    this.#logger = logger;
    this.#isDM = !interaction.inGuild();
  }

  lockKey(): string {
    // Une interaction de guilde porte toujours un identifiant de canal.
    return this.#isDM ? this.#interaction.user.id : this.#interaction.channelId!;
  }

  memoryKey(): string | null {
    return this.#isDM ? null : this.#interaction.channelId!;
  }

  async prepare(): Promise<string | null> {
    const prompt = this.#interaction.options.getString('prompt', true).trim();
    if (!prompt) {
      await this.#interaction.reply({
        content: 'Please include a question.',
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    if (prompt.length > this.#settings.maxPromptChars) {
      await this.#interaction.reply({
        content: `Please keep questions under ${this.#settings.maxPromptChars} characters.`,
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    this.#logger.debug('Question reçue', {
      source: 'slash',
      isDM: this.#isDM,
      promptChars: prompt.length,
    });
    return prompt;
  }

  async beginWork(): Promise<() => void> {
    await this.#interaction.deferReply();
    return Bot.startTyping(this.#interaction.channel);
  }

  async reportBusy(): Promise<void> {
    await this.#interaction.editReply({
      content: 'I am still working on the previous question in this channel. Try again shortly.',
    });
  }

  async sendReply(reply: string): Promise<void> {
    const chunks = Bot.splitMessage(reply);
    this.#logger.debug('Envoi de la réponse', { chunks: chunks.length });
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

  async reportError(error: unknown): Promise<void> {
    const content = Bot.describeRequestError(error);
    if (this.#interaction.deferred || this.#interaction.replied) {
      await this.#interaction.editReply({ content });
    } else {
      await this.#interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }

  errorLabel(): string {
    return 'Failed to handle /q';
  }

  errorFields(): Record<string, unknown> {
    return { key: this.memoryKey() };
  }
}
