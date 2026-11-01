import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from './config.js';
import { askDeepSeek, describeDeepSeekError } from './deepseek.js';
import { MemoryStore, MemoryUnavailableError } from './memory.js';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

const DM_MEMORY_HINT =
  'Astuce : en privé, la mémoire est désactivée par défaut. Activez-la avec `/memo on`.';

const busyChannels = new Set();

const qCommand = new SlashCommandBuilder()
  .setName('q')
  .setDescription('Pose une question')
  .addStringOption((option) =>
    option
      .setName('prompt')
      .setDescription('Ta question')
      .setRequired(true)
      .setMaxLength(Math.min(config.maxPromptChars, 6000)),
  )
  .toJSON();

// /memo is registered globally so it can be used in DMs, where guild commands
// do not exist. It has no effect in a public channel.
const memoCommand = new SlashCommandBuilder()
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

const guildCommands = [qCommand];
const globalCommands = [memoCommand];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

function splitMessage(text, limit = DISCORD_MESSAGE_LIMIT) {
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

  if (remaining) chunks.push(remaining);
  return chunks;
}

function startTyping(channel) {
  if (!channel?.sendTyping) return () => {};

  void channel.sendTyping().catch(() => {});
  const timer = setInterval(() => {
    void channel.sendTyping().catch(() => {});
  }, TYPING_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}

function stripBotMention(content, botId) {
  if (!botId) return content.trim();
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ').trim();
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

function describeRequestError(error) {
  if (error?.memoryUnavailable) {
    return 'Conversation memory is temporarily unavailable. Please try again shortly.';
  }
  return describeDeepSeekError(error);
}

/**
 * Keep one in-flight request per conversation and keep the lock until the
 * reply has been sent, so two answers cannot interleave in the same
 * conversation.
 *
 * `scope` picks the memory collection: 'channel' reads channel_memories with a
 * channel id, 'dm' reads dm_memories with a user id and only when that user
 * opted in. Callers derive both from the event source, never from user input.
 */
async function respond({ lockKey, scope, key }, prompt, sendReply) {
  if (busyChannels.has(lockKey)) return false;

  busyChannels.add(lockKey);
  try {
    let history;
    try {
      history = await memory.getHistory(scope, key);
    } catch (error) {
      throw new MemoryUnavailableError(error);
    }

    const reply = await askDeepSeek(history, prompt);

    try {
      await memory.appendTurn(scope, key, prompt, reply);
    } catch (error) {
      console.error(`Could not save the conversation turn: ${error?.message ?? error}`);
    }

    await sendReply(reply);
    return true;
  } finally {
    busyChannels.delete(lockKey);
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
    console.error(`Could not show the DM memory hint: ${error?.message ?? error}`);
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
        ? `Mémoire privée activée : je retiendrai nos ${config.maxHistoryTurns} derniers échanges.`
        : 'Mémoire privée désactivée et historique effacé.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error(`Could not update the DM memory preference: ${error?.message ?? error}`);
    await interaction
      .reply({
        content: 'Impossible de modifier la mémoire privée pour le moment. Réessayez plus tard.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  console.log(
    `DeepSeek: model=${config.deepseekModel} base=${config.deepseekBaseUrl} ` +
      `thinking=${config.deepseekThinking}` +
      (config.deepseekThinking === 'enabled' ? ` effort=${config.deepseekEffort}` : ''),
  );
  console.log(
    memory.mode === 'mongo'
      ? `Memory: MongoDB db=${config.mongodbDb}` +
          (config.memoryTtlDays ? ` ttl=${config.memoryTtlDays}d` : '') +
          '.'
      : 'Memory: in-RAM fallback (lost on restart, private memory disabled).',
  );

  try {
    if (config.discordGuildId) {
      const guild = await readyClient.guilds.fetch(config.discordGuildId);
      await guild.commands.set(guildCommands);
      // Global registration is required for /memo to work in DMs.
      await readyClient.application.commands.set(globalCommands);
      console.log(`Registered /q in ${guild.name} and /memo globally.`);
    } else {
      await readyClient.application.commands.set([...guildCommands, ...globalCommands]);
      console.log(
        `Registered ${guildCommands.length + globalCommands.length} global slash commands ` +
          '(they can take up to an hour to appear).',
      );
    }
  } catch (error) {
    console.error(`Could not register slash commands: ${error?.message ?? error}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'memo') {
    try {
      await handleMemo(interaction);
    } catch (error) {
      console.error(`Failed to handle /memo: ${error?.message ?? error}`);
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

    if (prompt.length > config.maxPromptChars) {
      await interaction.reply({
        content: `Please keep questions under ${config.maxPromptChars} characters.`,
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
          content: 'I am still working on the previous question in this channel. Try again shortly.',
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
    console.error(`Failed to handle /${interaction.commandName}: ${error?.message ?? error}`);

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
});

client.on(Events.MessageCreate, async (message) => {
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

    if (prompt.length > config.maxPromptChars) {
      await message.reply({
        content: `Please keep questions under ${config.maxPromptChars} characters.`,
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
        content: 'I am still working on the previous question in this channel. Try again shortly.',
        allowedMentions: { repliedUser: false },
      });
    } else if (isDM) {
      await maybeShowDmHint(message.author.id, (content) =>
        message.channel.send({ content }),
      );
    }
  } catch (error) {
    console.error(`Failed to handle message: ${error?.message ?? error}`);
    await message
      .reply({
        content: describeRequestError(error),
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  } finally {
    stopTyping();
  }
});

client.on(Events.Error, (error) => {
  console.error(`Discord client error: ${error?.message ?? error}`);
});

const memory = await MemoryStore.connect({
  uri: config.mongodbUri,
  dbName: config.mongodbDb,
  timeoutMs: config.mongodbTimeoutMs,
  maxHistoryTurns: config.maxHistoryTurns,
  ttlDays: config.memoryTtlDays,
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    client.destroy();
    memory.close().finally(() => process.exit(0));
  });
}

client.login(config.discordToken).catch((error) => {
  console.error(`Discord login failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
