import { ChannelType, Events, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { askDeepSeek, describeDeepSeekError } from './deepseek.js';
import { MemoryUnavailableError } from './memory.js';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

const DM_MEMORY_HINT =
  'Astuce : en privé, la mémoire est désactivée par défaut. Activez-la avec `/memo on`.';

export function splitMessage(text, limit = DISCORD_MESSAGE_LIMIT) {
  const normalized = text.trim();
  if (!normalized) return ['The model returned an empty response.'];
  if (normalized.length <= limit) return [normalized];

  const chunks = [];
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

export function startTyping(channel, intervalMs = TYPING_INTERVAL_MS) {
  if (!channel?.sendTyping) return () => {};

  void channel.sendTyping().catch(() => {});
  const timer = setInterval(() => {
    void channel.sendTyping().catch(() => {});
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}

export function stripBotMention(content, botId) {
  if (!botId) return content.trim();
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ').trim();
}

function messageOf(error) {
  return error?.message ?? error;
}

export function describeRequestError(error) {
  if (error?.memoryUnavailable) {
    return 'Conversation memory is temporarily unavailable. Please try again shortly.';
  }
  return describeDeepSeekError(error);
}

function buildCommands(settings) {
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

export async function registerCommands(client, settings, logger = console) {
  const { q, memo } = buildCommands(settings);

  try {
    if (settings.discordGuildId) {
      const guild = await client.guilds.fetch(settings.discordGuildId);
      await guild.commands.set([q]);
      // Global registration is required for /memo to work in DMs.
      await client.application.commands.set([memo]);
      logger.log(`Registered /q in ${guild.name} and /memo globally.`);
    } else {
      await client.application.commands.set([q, memo]);
      logger.log(
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
export function createBot({ client, memory, settings, ask = askDeepSeek, logger = console }) {
  const busyConversations = new Set();

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
  async function respond({ lockKey, scope, key }, prompt, sendReply) {
    if (busyConversations.has(lockKey)) return false;

    busyConversations.add(lockKey);
    try {
      let history;
      try {
        history = await memory.getHistory(scope, key);
      } catch (error) {
        throw new MemoryUnavailableError(error);
      }

      const reply = await ask(history, prompt);

      try {
        await memory.appendTurn(scope, key, prompt, reply);
      } catch (error) {
        logger.error(`Could not save the conversation turn: ${messageOf(error)}`);
      }

      await sendReply(reply);
      return true;
    } finally {
      busyConversations.delete(lockKey);
    }
  }

  /** Show the DM opt-in hint at most once per user. */
  async function maybeShowDmHint(userId, sendHint) {
    if (memory.mode !== 'mongo') return;

    try {
      if (await memory.showDmHintOnce(userId)) {
        await sendHint(DM_MEMORY_HINT);
      }
    } catch (error) {
      logger.error(`Could not show the DM memory hint: ${messageOf(error)}`);
    }
  }

  async function handleMemo(interaction) {
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

  async function sendMessageChunks(message, text) {
    const chunks = splitMessage(text);

    for (const [index, chunk] of chunks.entries()) {
      const payload = {
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

  async function sendInteractionChunks(interaction, text) {
    const chunks = splitMessage(text);

    await interaction.editReply({
      content: chunks.shift(),
      allowedMentions: { parse: [] },
    });

    for (const chunk of chunks) {
      await interaction.followUp({
        content: chunk,
        allowedMentions: { parse: [] },
      });
    }
  }

  async function handleInteraction(interaction) {
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
      ? { lockKey: interaction.user.id, scope: 'dm', key: interaction.user.id }
      : { lockKey: interaction.channelId, scope: 'channel', key: interaction.channelId };

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
      logger.error(`Failed to handle /${interaction.commandName}: ${messageOf(error)}`);

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

  async function handleMessage(message) {
    if (message.author.bot || message.system) return;

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = client.user ? message.mentions.users.has(client.user.id) : false;
    if (!isDM && !mentioned) return;

    const target = isDM
      ? { lockKey: message.author.id, scope: 'dm', key: message.author.id }
      : { lockKey: message.channelId, scope: 'channel', key: message.channelId };

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
      logger.error(`Failed to handle message: ${messageOf(error)}`);
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
  client.on(Events.Error, (error) => {
    logger.error(`Discord client error: ${messageOf(error)}`);
  });

  return { handleInteraction, handleMessage };
}
