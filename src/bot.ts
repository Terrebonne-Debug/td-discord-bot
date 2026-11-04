import {
  ActionRowBuilder,
  ChannelType,
  Events,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { askDeepSeek, describeDeepSeekError } from './deepseek.ts';
import { createGitHubIssue } from './github.ts';
import { MemoryUnavailableError } from './memory.ts';
import { createConsoleLogger } from './logging.ts';
import type { BotSettings } from './models/bot/bot-settings.ts';
import type { BotClient } from './models/discord/bot-client.ts';
import type { CommandClient } from './models/discord/command-client.ts';
import type { InteractionLike } from './models/discord/interaction-like.ts';
import type { MessageChannelLike } from './models/discord/message-channel-like.ts';
import type { MessageLike } from './models/discord/message-like.ts';
import type { ModalSubmitLike } from './models/discord/modal-submit-like.ts';
import type { ReplyPayload } from './models/discord/reply-payload.ts';
import type { TypingChannel } from './models/discord/typing-channel.ts';
import type { BotLogger } from './models/logging/bot-logger.ts';
import type { ConversationMemory } from './models/memory/conversation-memory.ts';
import type { Turn } from './models/memory/turn.ts';
import type { BuildInfo } from './models/version/build-info.ts';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
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

export function startTyping(
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

export function stripBotMention(content: string, botId: string | null | undefined): string {
  if (!botId) return content.trim();
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ').trim();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeRequestError(error: unknown): string {
  if ((error as { memoryUnavailable?: boolean } | null | undefined)?.memoryUnavailable) {
    return 'Conversation memory is temporarily unavailable. Please try again shortly.';
  }
  return describeDeepSeekError(error);
}

/** Single source of truth for the slash commands: registration and help. */
const COMMANDS: Array<{ name: string; description: string; help: string }> = [
  {
    name: 'q',
    description: 'Pose une question',
    help: '`/q <question>` — pose une question au bot.',
  },
  {
    name: 'version',
    description: 'Affiche la version du bot',
    help: '`/version` — affiche le numéro de version et le dernier commit.',
  },
  {
    name: 'aide',
    description: 'Liste les commandes disponibles',
    help: '`/aide` (alias : `/help`) — affiche cette liste.',
  },
  {
    name: 'help',
    description: 'Liste les commandes disponibles (alias de /aide)',
    help: '`/help` (alias : `/aide`) — affiche cette liste.',
  },
  {
    name: 'feature-request',
    description: 'Crée une issue GitHub de suggestion',
    help: '`/feature-request` — ouvre un formulaire (titre + description) pour créer une issue GitHub.',
  },
];

/** Le texte de /aide et /help, dérivé des mêmes définitions. */
export function buildHelpText(): string {
  const lines = COMMANDS.filter((command) => command.name !== 'help').map(
    (command) => `- ${command.help}`,
  );
  return ['**Commandes disponibles**', ...lines].join('\n');
}

function buildCommands(settings: { maxPromptChars: number }) {
  return COMMANDS.map((command) => {
    const builder = new SlashCommandBuilder()
      .setName(command.name)
      .setDescription(command.description);

    if (command.name === 'q') {
      builder.addStringOption((option) =>
        option
          .setName('prompt')
          .setDescription('Ta question')
          .setRequired(true)
          .setMaxLength(Math.min(settings.maxPromptChars, 6000)),
      );
    }

    return builder.toJSON();
  });
}

/**
 * Le formulaire de /feature-request : un titre court et une description,
 * Discord n'offrant pas de saisie multi-champs dans une slash command.
 */
export function buildFeatureRequestModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('feature-request')
    .setTitle('Demande de fonctionnalité')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('titre')
          .setLabel('Titre')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Résumé court de la suggestion')
          .setRequired(true)
          .setMaxLength(200),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Décris la fonctionnalité souhaitée')
          .setRequired(true)
          .setMaxLength(4000),
      ),
    );
}

export async function registerCommands(
  client: CommandClient,
  settings: { discordGuildId: string | null; maxPromptChars: number },
  logger: BotLogger = createConsoleLogger(),
): Promise<void> {
  const commands = buildCommands(settings);

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

/**
 * The production issue creator used by /feature-request: posts through the
 * GitHub API with the configured token and repository. Exposed as a factory
 * so its branches are unit-testable with an injected fetch.
 */
export function createIssueFor(
  settings: BotSettings,
  fetchFn: typeof fetch = fetch,
): (title: string, body: string) => Promise<string> {
  return (title, body) => {
    if (!settings.githubToken) throw new Error('GITHUB_TOKEN is not set.');
    return createGitHubIssue(
      {
        token: settings.githubToken,
        repository: settings.githubRepository,
        title,
        body,
      },
      fetchFn,
    );
  };
}

/**
 * Wire the bot's event handlers onto a Discord client. Dependencies are
 * injected so the complete conversation flow can be driven in tests without
 * connecting to Discord or DeepSeek.
 */
export function createBot({
  client,
  memory,
  settings,
  ask = askDeepSeek,
  buildInfo = { version: 'unknown', commit: 'unknown' },
  createIssue = createIssueFor(settings),
  logger = createConsoleLogger(),
}: {
  client: BotClient;
  memory: ConversationMemory;
  settings: BotSettings;
  ask?: (history: Turn[], prompt: string) => Promise<string>;
  buildInfo?: BuildInfo;
  createIssue?: (title: string, body: string) => Promise<string>;
  logger?: BotLogger;
}) {
  const busyConversations = new Set<string>();

  /**
   * Keep one in-flight request per conversation and keep the lock until the
   * reply has been sent, so two answers cannot interleave in the same
   * conversation.
   *
   * `memoryKey` is the channel id whose shared memory is read and appended,
   * or null for private messages, which are never stored. Callers derive it
   * from the event source, never from user input.
   */
  async function respond(
    { lockKey, memoryKey }: { lockKey: string; memoryKey: string | null },
    prompt: string,
    sendReply: (reply: string) => Promise<unknown>,
  ): Promise<boolean> {
    const log = logger.child(memoryKey === null ? {} : { key: memoryKey });

    if (busyConversations.has(lockKey)) {
      log.warn('Conversation occupée : requête ignorée', { lockKey });
      return false;
    }

    busyConversations.add(lockKey);
    try {
      let history: Turn[] = [];
      if (memoryKey !== null) {
        try {
          history = await memory.getHistory(memoryKey);
        } catch (error) {
          throw new MemoryUnavailableError(error);
        }
      }
      log.debug('Historique chargé', { turns: history.length });

      const startedAt = performance.now();
      const reply = await ask(history, prompt);
      log.info('Réponse du modèle reçue', {
        ms: Math.round(performance.now() - startedAt),
        chars: reply.length,
      });

      if (memoryKey !== null) {
        try {
          await memory.appendTurn(memoryKey, prompt, reply);
        } catch (error) {
          log.warn(`Could not save the conversation turn: ${messageOf(error)}`);
        }
      }

      await sendReply(reply);
      return true;
    } finally {
      busyConversations.delete(lockKey);
    }
  }

  async function sendMessageChunks(message: MessageLike, text: string): Promise<void> {
    const chunks = splitMessage(text);
    logger.debug('Envoi de la réponse', { chunks: chunks.length });

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

  async function sendInteractionChunks(interaction: InteractionLike, text: string): Promise<void> {
    const chunks = splitMessage(text);
    logger.debug('Envoi de la réponse', { chunks: chunks.length });
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

  async function handleVersion(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: `**td-discord-bot ${buildInfo.version}**\nCommit : \`${buildInfo.commit}\``,
      allowedMentions: { parse: [] },
    });
  }

  /** /aide et /help partagent exactement le même comportement. */
  async function handleHelp(interaction: InteractionLike): Promise<void> {
    await interaction.reply({
      content: buildHelpText(),
      allowedMentions: { parse: [] },
    });
  }

  /** Ouvre le formulaire titre + description. */
  async function handleFeatureRequest(interaction: InteractionLike): Promise<void> {
    if (!settings.githubToken) {
      await interaction.reply({
        content:
          'Les demandes de fonctionnalités ne sont pas configurées (GITHUB_TOKEN manquant).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildFeatureRequestModal());
  }

  /** Reçoit le formulaire rempli et crée l'issue GitHub. */
  async function handleFeatureRequestSubmit(interaction: ModalSubmitLike): Promise<void> {
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
      const url = await createIssue(safeTitle, body);
      logger.info('Issue de demande créée', { url, chars: description.length });
      await interaction.editReply({
        content: `Demande créée : ${url}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.error(`Could not create the feature request issue: ${messageOf(error)}`);
      await interaction
        .editReply({
          content: 'Impossible de créer la demande pour le moment. Réessayez plus tard.',
        })
        .catch(() => {});
    }
  }

  async function handleInteraction(
    interaction: InteractionLike | ModalSubmitLike,
  ): Promise<void> {
    if (interaction.isModalSubmit()) {
      try {
        await handleFeatureRequestSubmit(interaction);
      } catch (error) {
        logger.error(`Failed to handle feature-request submit: ${messageOf(error)}`);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'version') {
      await handleVersion(interaction);
      return;
    }

    if (interaction.commandName === 'aide' || interaction.commandName === 'help') {
      await handleHelp(interaction);
      return;
    }

    if (interaction.commandName === 'feature-request') {
      try {
        await handleFeatureRequest(interaction);
      } catch (error) {
        logger.error(`Failed to handle /feature-request: ${messageOf(error)}`);
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

      if (prompt.length > settings.maxPromptChars) {
        await interaction.reply({
          content: `Please keep questions under ${settings.maxPromptChars} characters.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.debug('Question reçue', {
        source: 'slash',
        isDM,
        promptChars: prompt.length,
      });

      await interaction.deferReply();
      const stopTyping = startTyping(interaction.channel);

      try {
        const handled = await respond(target, prompt, (reply) =>
          sendInteractionChunks(interaction, reply),
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
      logger.error(`Failed to handle /${interaction.commandName}: ${messageOf(error)}`, {
        key: target.memoryKey,
      });

      try {
        const content = describeRequestError(error);
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

  async function handleMessage(message: MessageLike): Promise<void> {
    if (message.author.bot || message.system) return;

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = client.user ? message.mentions.users.has(client.user.id) : false;
    if (!isDM && !mentioned) return;

    const target = isDM
      ? { lockKey: message.author.id, memoryKey: null }
      : { lockKey: message.channelId, memoryKey: message.channelId };

    const prompt = stripBotMention(message.content, client.user?.id);
    let stopTyping = () => {};

    try {
      if (!prompt) {
        await message.reply({
          content: 'Hi! Mention me with a question, or use `/q`.',
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      if (prompt.length > settings.maxPromptChars) {
        await message.reply({
          content: `Please keep questions under ${settings.maxPromptChars} characters.`,
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      logger.debug('Message reçu', {
        source: 'message',
        isDM,
        promptChars: prompt.length,
      });

      stopTyping = startTyping(message.channel);
      const handled = await respond(target, prompt, (reply) =>
        sendMessageChunks(message, reply),
      );

      if (!handled) {
        await message.reply({
          content:
            'I am still working on the previous question in this channel. Try again shortly.',
          allowedMentions: { repliedUser: false },
        });
      }
    } catch (error) {
      logger.error(`Failed to handle message: ${messageOf(error)}`, { isDM });
      await message
        .reply({
          content: describeRequestError(error),
          allowedMentions: { repliedUser: false },
        })
        .catch(() => {});
    } finally {
      stopTyping();
    }
  }

  client.on(Events.InteractionCreate, handleInteraction);
  client.on(Events.MessageCreate, handleMessage);
  client.on(Events.Error, (error: Error) => {
    logger.error(`Discord client error: ${messageOf(error)}`);
  });

  return { handleInteraction, handleMessage };
}
