import { EventEmitter } from 'node:events';
import { ChannelType, Events } from 'discord.js';

export const BOT_USER_ID = 'bot-user';

export function createLogger() {
  const entries = { log: [], error: [] };
  return {
    entries,
    log: (message) => entries.log.push(message),
    error: (message) => entries.error.push(message),
  };
}

export function createFakeClient({ userId = BOT_USER_ID, tag = 'TestBot#0001' } = {}) {
  const client = new EventEmitter();
  client.user = { id: userId, tag };
  client.destroyed = false;
  client.destroy = () => {
    client.destroyed = true;
  };
  client.login = async () => {
    client.emit(Events.ClientReady, client);
  };
  client.application = {
    commands: {
      set: async (commands) => {
        client.globalCommands = commands;
      },
    },
  };
  client.guilds = {
    fetch: async (id) => {
      client.fetchedGuildId = id;
      return {
        name: 'Guild Name',
        commands: {
          set: async (commands) => {
            client.guildCommands = commands;
          },
        },
      };
    },
  };
  return client;
}

function makeFailureCounter(failures) {
  const remaining = {
    reply: 0,
    deferReply: 0,
    editReply: 0,
    followUp: 0,
    send: 0,
    typing: 0,
    ...failures,
  };

  return (method) => {
    if (remaining[method] > 0) {
      remaining[method] -= 1;
      throw new Error(`${method} failed`);
    }
  };
}

export function createFakeInteraction({
  commandName = 'q',
  prompt = 'hello',
  subcommand = 'on',
  guildId = null,
  channelId = 'channel-1',
  userId = 'user-1',
  channel = null,
  chatInput = true,
  failures = {},
} = {}) {
  const calls = [];
  const fail = makeFailureCounter(failures);

  const interaction = {
    commandName,
    channelId,
    channel,
    user: { id: userId },
    deferred: false,
    replied: false,
    calls,
    inGuild: () => Boolean(guildId),
    isChatInputCommand: () => chatInput,
    options: {
      getString: () => prompt,
      getSubcommand: () => subcommand,
    },
    async reply(payload) {
      calls.push({ method: 'reply', payload });
      fail('reply');
      interaction.replied = true;
    },
    async deferReply() {
      calls.push({ method: 'deferReply' });
      fail('deferReply');
      interaction.deferred = true;
    },
    async editReply(payload) {
      calls.push({ method: 'editReply', payload });
      fail('editReply');
      interaction.replied = true;
    },
    async followUp(payload) {
      calls.push({ method: 'followUp', payload });
      fail('followUp');
      interaction.replied = true;
    },
  };

  return interaction;
}

export function createFakeMessage({
  content = `<@${BOT_USER_ID}> hello`,
  author = { id: 'user-1', bot: false },
  system = false,
  channelType = ChannelType.GuildText,
  channelId = 'channel-1',
  mentionsBot = true,
  botUserId = BOT_USER_ID,
  withoutTyping = false,
  failures = {},
} = {}) {
  const calls = [];
  const fail = makeFailureCounter(failures);

  const channel = {
    id: channelId,
    type: channelType,
    send: async (payload) => {
      calls.push({ method: 'send', payload });
      fail('send');
      return {};
    },
  };

  if (!withoutTyping) {
    channel.sendTyping = async () => {
      calls.push({ method: 'sendTyping' });
      fail('typing');
    };
  }

  const message = {
    author,
    system,
    channel,
    channelId,
    content,
    calls,
    mentions: {
      users: new Map(mentionsBot ? [[botUserId, {}]] : []),
    },
    async reply(payload) {
      calls.push({ method: 'reply', payload });
      fail('reply');
      return {};
    },
  };

  return message;
}

export function createFakeMemory({
  mode = 'mongo',
  histories = {},
  hintResults = [],
  failures = {},
} = {}) {
  const calls = [];
  const remaining = { ...failures };
  const fail = (method) => {
    if (remaining[method] > 0) {
      remaining[method] -= 1;
      throw new Error(`${method} failed`);
    }
  };

  return {
    mode,
    calls,
    async getHistory(scope, key) {
      calls.push({ method: 'getHistory', scope, key });
      fail('getHistory');
      return histories[`${scope}:${key}`] ?? [];
    },
    async appendTurn(scope, key, prompt, reply) {
      calls.push({ method: 'appendTurn', scope, key, prompt, reply });
      fail('appendTurn');
      return true;
    },
    async isDmEnabled(userId) {
      calls.push({ method: 'isDmEnabled', userId });
      fail('isDmEnabled');
      return false;
    },
    async setDmEnabled(userId, enabled) {
      calls.push({ method: 'setDmEnabled', userId, enabled });
      fail('setDmEnabled');
    },
    async showDmHintOnce(userId) {
      calls.push({ method: 'showDmHintOnce', userId });
      fail('showDmHintOnce');
      return hintResults.shift() ?? false;
    },
    async close() {
      calls.push({ method: 'close' });
      fail('close');
    },
  };
}
