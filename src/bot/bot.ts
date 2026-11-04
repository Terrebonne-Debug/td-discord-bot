import { ChannelType, Events, MessageFlags } from 'discord.js';
import { defaultDeepSeek, DeepSeek } from '../deepseek/deepseek.ts';
import { GitHubIssues } from '../github/github-issues.ts';
import { MemoryUnavailableError } from '../memory/memory-unavailable-error.ts';
import { LoggerFactory } from '../logging/logger-factory.ts';
import { Commands } from './commands.ts';
import type { BotSettings } from '../models/bot/bot-settings.ts';
import type { BotClient } from '../models/discord/bot-client.ts';
import type { CommandClient } from '../models/discord/command-client.ts';
import type { InteractionLike } from '../models/discord/interaction-like.ts';
import type { MessageChannelLike } from '../models/discord/message-channel-like.ts';
import type { MessageLike } from '../models/discord/message-like.ts';
import type { ModalSubmitLike } from '../models/discord/modal-submit-like.ts';
import type { ReplyPayload } from '../models/discord/reply-payload.ts';
import type { TypingChannel } from '../models/discord/typing-channel.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { ConversationMemory } from '../models/memory/conversation-memory.ts';
import type { Turn } from '../models/memory/turn.ts';
import type { BuildInfo } from '../models/version/build-info.ts';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wires the bot's event handlers onto a Discord client. Dependencies are
 * injected so the complete conversation flow can be driven in tests without
 * connecting to Discord or DeepSeek.
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
    // Bound so the indicator keeps working from the interval callback and so
    // the method is still called on the channel.
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
        // After login the application always exists; commands are registered
        // post-ready.
        await client.application!.commands.set(commands);
        logger.info(
          `Registered ${commands.length} global slash commands (they can take up to an hour to appear).`,
        );
      }
    } catch (error) {
      logger.error(`Could not register slash commands: ${messageOf(error)}`);
    }
  }

  #client: BotClient;
  #memory: ConversationMemory;
  #settings: BotSettings;
  #ask: (history: Turn[], prompt: string) => Promise<string>;
  #buildInfo: BuildInfo;
  #createIssue: (title: string, body: string) => Promise<string>;
  #logger: BotLogger;
  #busyConversations = new Set<string>();

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
    this.#memory = memory;
    this.#settings = settings;
    this.#ask = ask;
    this.#buildInfo = buildInfo;
    this.#createIssue = createIssue;
    this.#logger = logger;

    client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction);
    });
    client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });
    client.on(Events.Error, (error: Error) => {
      this.#logger.error(`Discord client error: ${messageOf(error)}`);
    });
  }

  async handleInteraction(interaction: InteractionLike | ModalSubmitLike): Promise<void> {
    if (interaction.isModalSubmit()) {
      try {
        await this.#handleFeatureRequestSubmit(interaction);
      } catch (error) {
        this.#logger.error(`Failed to handle feature-request submit: ${messageOf(error)}`);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'version') {
      await this.#handleVersion(interaction);
      return;
    }

    if (interaction.commandName === 'aide' || interaction.commandName === 'help') {
      await this.#handleHelp(interaction);
      return;
    }

    if (interaction.commandName === 'feature-request') {
      try {
        await this.#handleFeatureRequest(interaction);
      } catch (error) {
        this.#logger.error(`Failed to handle /feature-request: ${messageOf(error)}`);
      }
      return;
    }

    if (interaction.commandName !== 'q') return;

    const isDM = !interaction.inGuild();
    const target = isDM
      ? { lockKey: interaction.user.id, memoryKey: null }
      : {
          // A guild interaction always carries a channel id.
          lockKey: interaction.channelId!,
          memoryKey: interaction.channelId!,
        };

    try {
      const prompt = interaction.options.getString('prompt', true).trim();
      if (!prompt) {
        await interaction.reply({
          content: 'Please include a question.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (prompt.length > this.#settings.maxPromptChars) {
        await interaction.reply({
          content: `Please keep questions under ${this.#settings.maxPromptChars} characters.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      this.#logger.debug('Question reçue', {
        source: 'slash',
        isDM,
        promptChars: prompt.length,
      });

      await interaction.deferReply();
      const stopTyping = Bot.startTyping(interaction.channel);

      try {
        const handled = await this.#respond(target, prompt, (reply) =>
          this.#sendInteractionChunks(interaction, reply),
        );

        if (!handled) {
          await interaction.editReply({
            content:
              'I am still working on the previous question in this channel. Try again shortly.',
          });
        }
      } finally {
        stopTyping();
      }
    } catch (error) {
      this.#logger.error(`Failed to handle /${interaction.commandName}: ${messageOf(error)}`, {
        key: target.memoryKey,
      });

      try {
        const content = Bot.describeRequestError(error);
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch {
        // Interaction expired or the channel is unavailable; nothing else to do.
      }
    }
  }

  async handleMessage(message: MessageLike): Promise<void> {
    if (message.author.bot || message.system) return;

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = this.#client.user ? message.mentions.users.has(this.#client.user.id) : false;
    if (!isDM && !mentioned) return;

    const target = isDM
      ? { lockKey: message.author.id, memoryKey: null }
      : { lockKey: message.channelId, memoryKey: message.channelId };

    const prompt = Bot.stripBotMention(message.content, this.#client.user?.id);
    let stopTyping = () => {};

    try {
      if (!prompt) {
        await message.reply({
          content: 'Hi! Mention me with a question, or use `/q`.',
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      if (prompt.length > this.#settings.maxPromptChars) {
        await message.reply({
          content: `Please keep questions under ${this.#settings.maxPromptChars} characters.`,
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      this.#logger.debug('Message reçu', {
        source: 'message',
        isDM,
        promptChars: prompt.length,
      });

      stopTyping = Bot.startTyping(message.channel);
      const handled = await this.#respond(target, prompt, (reply) =>
        this.#sendMessageChunks(message, reply),
      );

      if (!handled) {
        await message.reply({
          content:
            'I am still working on the previous question in this channel. Try again shortly.',
          allowedMentions: { repliedUser: false },
        });
      }
    } catch (error) {
      this.#logger.error(`Failed to handle message: ${messageOf(error)}`, { isDM });
      await message
        .reply({
          content: Bot.describeRequestError(error),
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
    } finally {
      stopTyping();
    }
  }

  /**
   * Keep one in-flight request per conversation and keep the lock until the
   * reply has been sent, so two answers cannot interleave in the same
   * conversation.
   *
   * `memoryKey` is the channel id whose shared memory is read and appended,
   * or null for private messages, which are never stored. Callers derive it
   * from the event source, never from user input.
   */
  async #respond(
    { lockKey, memoryKey }: { lockKey: string; memoryKey: string | null },
    prompt: string,
    sendReply: (reply: string) => Promise<unknown>,
  ): Promise<boolean> {
    const log = this.#logger.child(memoryKey === null ? {} : { key: memoryKey });

    if (this.#busyConversations.has(lockKey)) {
      log.warn('Conversation occupée : requête ignorée', { lockKey });
      return false;
    }

    this.#busyConversations.add(lockKey);
    try {
      let history: Turn[] = [];
      if (memoryKey !== null) {
        try {
          history = await this.#memory.getHistory(memoryKey);
        } catch (error) {
          throw new MemoryUnavailableError(error);
        }
      }
      log.debug('Historique chargé', { turns: history.length });

      const startedAt = performance.now();
      const reply = await this.#ask(history, prompt);
      log.info('Réponse du modèle reçue', {
        ms: Math.round(performance.now() - startedAt),
        chars: reply.length,
      });

      if (memoryKey !== null) {
        try {
          await this.#memory.appendTurn(memoryKey, prompt, reply);
        } catch (error) {
          log.warn(`Could not save the conversation turn: ${messageOf(error)}`);
        }
      }

      await sendReply(reply);
      return true;
    } finally {
      this.#busyConversations.delete(lockKey);
    }
  }

  async #sendMessageChunks(message: MessageLike, text: string): Promise<void> {
    const chunks = Bot.splitMessage(text);
    this.#logger.debug('Envoi de la réponse', { chunks: chunks.length });

    for (const [index, chunk] of chunks.entries()) {
      const payload: ReplyPayload = {
        content: chunk,
        allowedMentions: { parse: [], repliedUser: false },
      };

      if (index === 0) {
        await message.reply(payload);
      } else {
        await message.channel.send(payload);
      }
    }
  }

  async #sendInteractionChunks(interaction: InteractionLike, text: string): Promise<void> {
    const chunks = Bot.splitMessage(text);
    this.#logger.debug('Envoi de la réponse', { chunks: chunks.length });
    const [first, ...rest] = chunks;

    await interaction.editReply({
      content: first,
      allowedMentions: { parse: [] },
    });

    for (const chunk of rest) {
      await interaction.followUp({
        content: chunk,
        allowedMentions: { parse: [] },
      });
    }
  }

  async #handleVersion(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: `**td-discord-bot ${this.#buildInfo.version}**\nCommit : \`${this.#buildInfo.commit}\``,
      allowedMentions: { parse: [] },
    });
  }

  /** /aide et /help partagent exactement le même comportement. */
  async #handleHelp(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: Commands.helpText(),
      allowedMentions: { parse: [] },
    });
  }

  /** Ouvre le formulaire titre + description. */
  async #handleFeatureRequest(interaction: InteractionLike): Promise<void> {
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

  /** Reçoit le formulaire rempli et crée l'issue GitHub. */
  async #handleFeatureRequestSubmit(interaction: ModalSubmitLike): Promise<void> {
    if (interaction.customId !== 'feature-request') return;

    const title = interaction.fields.getTextInputValue('titre').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    if (!title || !description) {
      await interaction.reply({
        content: 'Le titre et la description sont requis.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      // GitHub limite les titres à 256 caractères ; on tronque largement en deçà.
      const safeTitle = title.length > 200 ? `${title.slice(0, 199)}…` : title;
      const body = `**Demande**\n\n${description}\n\n---\nDemandé depuis Discord par ${interaction.user.username}.`;
      const url = await this.#createIssue(safeTitle, body);
      this.#logger.info('Issue de demande créée', { url, chars: description.length });
      await interaction.editReply({
        content: `Demande créée : ${url}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.#logger.error(`Could not create the feature request issue: ${messageOf(error)}`);
      await interaction
        .editReply({
          content: 'Impossible de créer la demande pour le moment. Réessayez plus tard.',
        })
        .catch(() => {});
    }
  }
}
