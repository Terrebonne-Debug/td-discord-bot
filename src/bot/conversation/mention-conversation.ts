import { ChannelType } from 'discord.js';
import { Bot } from '../bot.ts';
import type { ConversationStrategy } from './conversation-strategy.ts';
import type { MessageLike } from '../../models/discord/message-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import type { BotSettings } from '../../models/bot/bot-settings.ts';

/** La variante mention : message Discord, réponses via reply/send. */
export class MentionConversation implements ConversationStrategy {
  #message: MessageLike;
  #botUserId: string | null;
  #settings: BotSettings;
  #logger: BotLogger;
  #isDM: boolean;

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

  lockKey(): string {
    return this.#isDM ? this.#message.author.id : this.#message.channelId;
  }

  memoryKey(): string | null {
    return this.#isDM ? null : this.#message.channelId;
  }

  async prepare(): Promise<string | null> {
    const prompt = Bot.stripBotMention(this.#message.content, this.#botUserId);
    if (!prompt) {
      await this.#message.reply({
        content: 'Hi! Mention me with a question, or use `/q`.',
        allowedMentions: { repliedUser: false },
      });
      return null;
    }

    if (prompt.length > this.#settings.maxPromptChars) {
      await this.#message.reply({
        content: `Please keep questions under ${this.#settings.maxPromptChars} characters.`,
        allowedMentions: { repliedUser: false },
      });
      return null;
    }

    this.#logger.debug('Message reçu', {
      source: 'message',
      isDM: this.#isDM,
      promptChars: prompt.length,
    });
    return prompt;
  }

  async beginWork(): Promise<() => void> {
    return Bot.startTyping(this.#message.channel);
  }

  async reportBusy(): Promise<void> {
    await this.#message.reply({
      content: 'I am still working on the previous question in this channel. Try again shortly.',
      allowedMentions: { repliedUser: false },
    });
  }

  async sendReply(reply: string): Promise<void> {
    const chunks = Bot.splitMessage(reply);
    this.#logger.debug('Envoi de la réponse', { chunks: chunks.length });

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

  async reportError(error: unknown): Promise<void> {
    await this.#message
      .reply({
        content: Bot.describeRequestError(error),
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  }

  errorLabel(): string {
    return 'Failed to handle message';
  }

  errorFields(): Record<string, unknown> {
    return { isDM: this.#isDM };
  }
}
