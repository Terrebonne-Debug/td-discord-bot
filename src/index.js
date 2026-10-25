import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from './config.js';
import { askDeepSeek, describeDeepSeekError } from './deepseek.js';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

const histories = new Map();
const busyChannels = new Set();

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask DeepSeek a question')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Your question')
        .setRequired(true)
        .setMaxLength(Math.min(config.maxPromptChars, 6000)),
    ),
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription("Clear this channel's conversation history"),
].map((command) => command.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

function getHistory(channelId) {
  return histories.get(channelId) ?? [];
}

function rememberTurn(channelId, prompt, reply) {
  const maxMessages = config.maxHistoryTurns * 2;
  const history = [
    ...getHistory(channelId),
    { role: 'user', content: prompt },
    { role: 'assistant', content: reply },
  ];

  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }
  histories.set(channelId, history);
}

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

/**
 * Keep one in-flight request per channel and keep the lock until the reply has
 * been sent, so two answers cannot interleave in the same conversation.
 */
async function respond(channelId, prompt, sendReply) {
  if (busyChannels.has(channelId)) return false;

  busyChannels.add(channelId);
  try {
    const reply = await askDeepSeek(getHistory(channelId), prompt);
    rememberTurn(channelId, prompt, reply);
    await sendReply(reply);
    return true;
  } finally {
    busyChannels.delete(channelId);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  console.log(
    `DeepSeek: model=${config.deepseekModel} base=${config.deepseekBaseUrl} ` +
      `thinking=${config.deepseekThinking}` +
      (config.deepseekThinking === 'enabled' ? ` effort=${config.deepseekEffort}` : ''),
  );

  try {
    if (config.discordGuildId) {
      const guild = await readyClient.guilds.fetch(config.discordGuildId);
      await guild.commands.set(commands);
      console.log(`Registered ${commands.length} slash commands in ${guild.name}.`);
    } else {
      await readyClient.application.commands.set(commands);
      console.log(
        `Registered ${commands.length} global slash commands (they can take up to an hour to appear).`,
      );
    }
  } catch (error) {
    console.error(`Could not register slash commands: ${error?.message ?? error}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channelId = interaction.channelId ?? interaction.user.id;

  try {
    if (interaction.commandName === 'reset') {
      histories.delete(channelId);
      await interaction.reply({
        content: 'Conversation history cleared for this channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName !== 'ask') return;

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
      const handled = await respond(channelId, prompt, (reply) =>
        sendInteractionChunks(interaction, reply),
      );

      if (!handled) {
        await interaction.editReply({
          content: 'I am still working on the previous question in this channel. Try again shortly.',
        });
      }
    } finally {
      stopTyping();
    }
  } catch (error) {
    console.error(`Failed to handle /${interaction.commandName}: ${error?.message ?? error}`);

    try {
      const content = describeDeepSeekError(error);
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

  const isDM = message.channel.isDMBased();
  const mentioned = client.user ? message.mentions.users.has(client.user.id) : false;
  if (!isDM && !mentioned) return;

  const prompt = stripBotMention(message.content, client.user?.id);
  let stopTyping = () => {};

  try {
    if (!prompt) {
      await message.reply({
        content: 'Hi! Mention me with a question, or use `/ask`.',
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
    const handled = await respond(message.channelId, prompt, (reply) =>
      sendMessageChunks(message, reply),
    );

    if (!handled) {
      await message.reply({
        content: 'I am still working on the previous question in this channel. Try again shortly.',
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (error) {
    console.error(`Failed to handle message: ${error?.message ?? error}`);
    await message
      .reply({
        content: describeDeepSeekError(error),
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

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`Received ${signal}; shutting down.`);
    client.destroy();
    process.exit(0);
  });
}

client.login(config.discordToken).catch((error) => {
  console.error(`Discord login failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
