import { ChannelType, Events, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { MessageMentionOptions } from 'discord.js';
import { askDeepSeek, describeDeepSeekError } from './deepseek.ts';
import { MemoryUnavailableError } from './memory.ts';
import type { ConversationMemory } from './memory.ts';
import { createConsoleLogger } from './logging.ts';
import type { BotLogger } from './logging.ts';
import type { MemoryScope, Turn } from './types.ts';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

const DM_MEMORY_HINT =
  'Astuce : en privé, la mémoire est désactivée par défaut. Activez-la avec `/memo on`.';

export interface ReplyPayload {
  content: string;
  allowedMentions?: MessageMentionOptions;
  flags?: MessageFlags;
}

/** A channel that can show the typing indicator. */
export interface TypingChannel {
  sendTyping?: () => Promise<unknown>;
}

/** The slice of a chat-input interaction the bot reads. */
export interface InteractionLike {
  commandName: string;
  channelId: string | null;
  user: { id: string };
  channel: TypingChannel | null;
  deferred: boolean;
  replied: boolean;
  isChatInputCommand(): boolean;
  inGuild(): boolean;
  options: {
    getString(name: string, required: true): string;
    getString(name: string, required?: boolean): string | null;
    getSubcommand(): string;
  };
  deferReply(): Promise<unknown>;
  reply(payload: ReplyPayload): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
  followUp(payload: ReplyPayload): Promise<unknown>;
}

/** The slice of a message's channel the bot reads. */
export interface MessageChannelLike extends TypingChannel {
  type: ChannelType;
  send(payload: ReplyPayload): Promise<unknown>;
}

/** The slice of a Discord message the bot reads. */
export interface MessageLike {
  author: { bot: boolean; id: string };
  system: boolean;
  channelId: string;
  content: string;
  channel: MessageChannelLike;
  mentions: { users: { has(id: string): boolean } };
  reply(payload: ReplyPayload): Promise<unknown>;
}

/** The slice of the Discord client the bot's event handlers need. */
export interface BotClient {
  user: { id: string } | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** The settings createBot reads; the full Config satisfies this. */
export interface BotSettings {
  maxPromptChars: number;
  maxHistoryTurns: number;
}

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

function buildCommands(settings: { maxPromptChars: number }) {
  const q = new SlashCommandBuilder()
    .setName('q')
    .setDescription('Pose une question')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Ta question')
        .setRequired(true)
        .setMaxLength(Math.min(settings.maxPromptChars, 6000)),
    )
    .toJSON();

  // /memo is registered globally so it can be used in DMs, where guild
  // commands do not exist. It has no effect in a public channel.
  const memo = new SlashCommandBuilder()
    .setName('memo')
    .setDescription('Gère la mémoire privée de nos échanges en MP')
    .addSubcommand((subcommand) =>
      subcommand.setName('on').setDescription('Active la mémoire de nos échanges privés'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('off')
        .setDescription("Désactive la mémoire privée et efface l'historique stocké"),
    )
    .toJSON();

  return { q, memo };
}

/** The slice of the Discord client registerCommands needs. */
export interface CommandClient {
  guilds: {
    fetch(
      id: string,
    ): Promise<{ name: string; commands: { set(commands: readonly unknown[]): Promise<unknown> } }>;
  };
  application: { commands: { set(commands: readonly unknown[]): Promise<unknown> } } | null;
}

export async function registerCommands(
  client: CommandClient,
  settings: { discordGuildId: string | null; maxPromptChars: number },
  logger: BotLogger = createConsoleLogger(),
): Promise<void> {
  const { q, memo } = buildCommands(settings);

  try {
    if (settings.discordGuildId) {
      const guild = await client.guilds.fetch(settings.discordGuildId);
      await guild.commands.set([q]);
      // Global registration is required for /memo to work in DMs. After login
      // the application always exists; commands are registered post-ready.
      await client.application!.commands.set([memo]);
      logger.info(`Registered /q in ${guild.name} and /memo globally.`);
    } else {
      await client.application!.commands.set([q, memo]);
      logger.info(
        'Registered 2 global slash commands (they can take up to an hour to appear).',
      );
    }
  } catch (error) {
    logger.error(`Could not register slash commands: ${messageOf(error)}`);
  }
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
  logger = createConsoleLogger(),
}: {
  client: BotClient;
  memory: ConversationMemory;
  settings: BotSettings;
  ask?: (history: Turn[], prompt: string) => Promise<string>;
  logger?: BotLogger;
}) {
  const busyConversations = new Set<string>();

  /**
   * Keep one in-flight request per conversation and keep the lock until the
   * reply has been sent, so two answers cannot interleave in the same
   * conversation.
   *
   * `scope` picks the memory collection: 'channel' reads channel_memories with
   * a channel id, 'dm' reads dm_memories with a user id and only when that
   * user opted in. Callers derive both from the event source, never from user
   * input.
   */
  async function respond(
    { lockKey, scope, key }: { lockKey: string; scope: MemoryScope; key: string },
    prompt: string,
    sendReply: (reply: string) => Promise<unknown>,
  ): Promise<boolean> {
    const log = logger.child({ scope, key });

    if (busyConversations.has(lockKey)) {
      log.warn('Conversation occupée : requête ignorée', { lockKey });
      return false;
    }

    busyConversations.add(lockKey);
    try {
      let history: Turn[];
      try {
        history = await memory.getHistory(scope, key);
      } catch (error) {
        throw new MemoryUnavailableError(error);
      }
      log.debug('Historique chargé', { turns: history.length });

      const startedAt = performance.now();
      const reply = await ask(history, prompt);
      log.info('Réponse du modèle reçue', {
        ms: Math.round(performance.now() - startedAt),
        chars: reply.length,
      });

      try {
        await memory.appendTurn(scope, key, prompt, reply);
      } catch (error) {
        log.warn(`Could not save the conversation turn: ${messageOf(error)}`);
      }

      await sendReply(reply);
      return true;
    } finally {
      busyConversations.delete(lockKey);
    }
  }

  /** Show the DM opt-in hint at most once per user. */
  async function maybeShowDmHint(
    userId: string,
    sendHint: (content: string) => Promise<unknown>,
  ): Promise<void> {
    if (memory.mode !== 'mongo') return;

    try {
      if (await memory.showDmHintOnce(userId)) {
        await sendHint(DM_MEMORY_HINT);
        logger.debug('Hint de mémoire privée affiché', { userId });
      }
    } catch (error) {
      logger.warn(`Could not show the DM memory hint: ${messageOf(error)}`);
    }
  }

  async function handleMemo(interaction: InteractionLike): Promise<void> {
    if (interaction.inGuild()) {
      await interaction.reply({
        content:
          "Ce choix n'existe qu'en message privé. Dans un canal, la mémoire du canal est partagée et toujours active.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (memory.mode !== 'mongo') {
      await interaction.reply({
        content:
          'La mémoire privée nécessite MongoDB, actuellement indisponible. Nos échanges restent sans mémoire.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const enabled = interaction.options.getSubcommand() === 'on';

    try {
      await memory.setDmEnabled(interaction.user.id, enabled);
      logger.info(enabled ? 'Mémoire privée activée' : 'Mémoire privée désactivée', {
        userId: interaction.user.id,
      });
      await interaction.reply({
        content: enabled
          ? `Mémoire privée activée : je retiendrai nos ${settings.maxHistoryTurns} derniers échanges.`
          : 'Mémoire privée désactivée et historique effacé.',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error(`Could not update the DM memory preference: ${messageOf(error)}`);
      await interaction
        .reply({
          content: 'Impossible de modifier la mémoire privée pour le moment. Réessayez plus tard.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
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

  async function handleInteraction(interaction: InteractionLike): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'memo') {
      try {
        await handleMemo(interaction);
      } catch (error) {
        logger.error(`Failed to handle /memo: ${messageOf(error)}`);
      }
      return;
    }

    if (interaction.commandName !== 'q') return;

    const isDM = !interaction.inGuild();
    const target = isDM
      ? { lockKey: interaction.user.id, scope: 'dm' as const, key: interaction.user.id }
      : {
          // A guild interaction always carries a channel id.
          lockKey: interaction.channelId!,
          scope: 'channel' as const,
          key: interaction.channelId!,
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
        } else if (isDM) {
          await maybeShowDmHint(interaction.user.id, (content) =>
            interaction.followUp({ content, flags: MessageFlags.Ephemeral }),
          );
        }
      } finally {
        stopTyping();
      }
    } catch (error) {
      logger.error(`Failed to handle /${interaction.commandName}: ${messageOf(error)}`, {
        scope: target.scope,
        key: target.key,
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
      ? { lockKey: message.author.id, scope: 'dm' as const, key: message.author.id }
      : { lockKey: message.channelId, scope: 'channel' as const, key: message.channelId };

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
      } else if (isDM) {
        await maybeShowDmHint(message.author.id, (content) =>
          message.channel.send({ content }),
        );
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
