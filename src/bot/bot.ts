import { ChannelType, Events } from 'discord.js';
import { defaultDeepSeek, DeepSeek } from '../deepseek/deepseek.ts';
import { GitHubIssues } from '../github/github-issues.ts';
import { LoggerFactory } from '../logging/logger-factory.ts';
import { Errors } from '../utils/errors.ts';
import { Commands } from './commands.ts';
import { CommandDispatcher } from './commands/command-dispatcher.ts';
import { FeatureRequestCommand } from './commands/feature-request-command.ts';
import { HelpCommand } from './commands/help-command.ts';
import { QuestionCommand } from './commands/question-command.ts';
import { VersionCommand } from './commands/version-command.ts';
import { ConversationService } from './conversation/conversation-service.ts';
import { MentionConversation } from './conversation/mention-conversation.ts';
import type { BotSettings } from '../models/bot/bot-settings.ts';
import type { BotClient } from '../models/discord/bot-client.ts';
import type { CommandClient } from '../models/discord/command-client.ts';
import type { InteractionLike } from '../models/discord/interaction-like.ts';
import type { MessageLike } from '../models/discord/message-like.ts';
import type { ModalSubmitLike } from '../models/discord/modal-submit-like.ts';
import type { TypingChannel } from '../models/discord/typing-channel.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { ConversationMemory } from '../models/memory/conversation-memory.ts';
import type { Turn } from '../models/memory/turn.ts';
import type { BuildInfo } from '../models/version/build-info.ts';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

/**
 * Façade du bot : branche les événements Discord sur le répartiteur de
 * commandes (patron Commande) et le service de conversation (patron
 * Stratégie). Les dépendances sont injectées pour que tout le flux puisse
 * être piloté en test sans Discord ni DeepSeek.
 */
export class Bot {
  static splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
    const normalized = text.trim();
    if (!normalized) return ['The model returned an empty response.'];
    if (normalized.length <= limit) return [normalized];

    const chunks: string[] = [];
    let remaining = normalized;

    while (remaining.length > limit) {
      let splitAt = remaining.lastIndexOf('\n', limit);
      if (splitAt < limit * 0.6) splitAt = remaining.lastIndexOf(' ', limit);
      if (splitAt < limit * 0.6) splitAt = limit;

      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }

    chunks.push(remaining);
    return chunks;
  }

  static startTyping(
    channel: TypingChannel | null | undefined,
    intervalMs = TYPING_INTERVAL_MS,
  ): () => void {
    /**
     * Bound so the indicator keeps working from the interval callback and so
     * the method is still called on the channel.
     */
    const sendTyping = channel?.sendTyping?.bind(channel);
    if (!sendTyping) return () => {};

    void sendTyping().catch(() => {});
    const timer = setInterval(() => {
      void sendTyping().catch(() => {});
    }, intervalMs);
    timer.unref();

    return () => clearInterval(timer);
  }

  static stripBotMention(content: string, botId: string | null | undefined): string {
    if (!botId) return content.trim();
    return content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ').trim();
  }

  static describeRequestError(error: unknown): string {
    if ((error as { memoryUnavailable?: boolean } | null | undefined)?.memoryUnavailable) {
      return 'Conversation memory is temporarily unavailable. Please try again shortly.';
    }
    return DeepSeek.describeError(error);
  }

  /**
   * The production issue creator used by /feature-request: posts through the
   * GitHub API with the configured token and repository. Exposed as a factory
   * so its branches are unit-testable with an injected fetch.
   */
  static createIssueFor(
    settings: BotSettings,
    fetchFn: typeof fetch = fetch,
  ): (title: string, body: string) => Promise<string> {
    return (title, body) => {
      if (!settings.githubToken) throw new Error('GITHUB_TOKEN is not set.');
      const issues = new GitHubIssues(
        {
          token: settings.githubToken,
          repository: settings.githubRepository,
          title,
          body,
        },
        fetchFn,
      );
      return issues.createIssue();
    };
  }

  static async registerCommands(
    client: CommandClient,
    settings: { discordGuildId: string | null; maxPromptChars: number },
    logger: BotLogger = new LoggerFactory().consoleLogger(),
  ): Promise<void> {
    const commands = Commands.build(settings);

    try {
      if (settings.discordGuildId) {
        const guild = await client.guilds.fetch(settings.discordGuildId);
        await guild.commands.set(commands);
        logger.info(`Registered ${commands.length} slash commands in ${guild.name}.`);
      } else {
        /**
         * After login the application always exists; commands are registered
         * post-ready.
         */
        await client.application!.commands.set(commands);
        logger.info(
          `Registered ${commands.length} global slash commands (they can take up to an hour to appear).`,
        );
      }
    } catch (error) {
      logger.error(`Could not register slash commands: ${Errors.messageOf(error)}`);
    }
  }

  #client: BotClient;
  #settings: BotSettings;
  #logger: BotLogger;
  #conversations: ConversationService;
  #dispatcher: CommandDispatcher;

  constructor({
    client,
    memory,
    settings,
    ask = defaultDeepSeek.ask.bind(defaultDeepSeek),
    buildInfo = { version: 'unknown', commit: 'unknown' },
    createIssue = Bot.createIssueFor(settings),
    logger = new LoggerFactory().consoleLogger(),
  }: {
    client: BotClient;
    memory: ConversationMemory;
    settings: BotSettings;
    ask?: (history: Turn[], prompt: string) => Promise<string>;
    buildInfo?: BuildInfo;
    createIssue?: (title: string, body: string) => Promise<string>;
    logger?: BotLogger;
  }) {
    this.#client = client;
    this.#settings = settings;
    this.#logger = logger;
    this.#conversations = new ConversationService({ memory, ask, logger });
    this.#dispatcher = new CommandDispatcher({
      commands: [
        new QuestionCommand({ conversations: this.#conversations, settings, logger }),
        new VersionCommand(buildInfo),
        new HelpCommand(),
        new FeatureRequestCommand({ settings, createIssue, logger }),
      ],
      logger,
    });

    client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction);
    });
    client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });
    client.on(Events.Error, (error: Error) => {
      this.#logger.error(`Discord client error: ${Errors.messageOf(error)}`);
    });
  }

  async handleInteraction(interaction: InteractionLike | ModalSubmitLike): Promise<void> {
    await this.#dispatcher.dispatch(interaction);
  }

  async handleMessage(message: MessageLike): Promise<void> {
    if (message.author.bot || message.system) return;

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = this.#client.user ? message.mentions.users.has(this.#client.user.id) : false;
    if (!isDM && !mentioned) return;

    await this.#conversations.handle(
      new MentionConversation(message, this.#client.user ? this.#client.user.id : null, this.#settings, this.#logger),
    );
  }
}

