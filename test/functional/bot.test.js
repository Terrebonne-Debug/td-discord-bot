import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ChannelType, Events, MessageFlags } from 'discord.js';
import { createBot } from '../../src/bot.js';
import {
  BOT_USER_ID,
  createFakeClient,
  createFakeInteraction,
  createFakeMemory,
  createFakeMessage,
  createLogger,
} from '../helpers/fakes.js';

const settings = {
  maxPromptChars: 50,
  maxHistoryTurns: 2,
};

const memoOn = MessageFlags.Ephemeral;
const LONG_REPLY = `${'a'.repeat(2000)}${'b'.repeat(10)}`;

function setup({ memory = createFakeMemory(), ask = async () => 'reply', client = createFakeClient() } = {}) {
  const logger = createLogger();
  const bot = createBot({ client, memory, settings, ask, logger });
  return { bot, memory, logger, client };
}

function typingChannel() {
  return { sendTyping: async () => {} };
}

async function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('/q in a guild uses shared channel memory and replies through the interaction', async () => {
  const memory = createFakeMemory({
    histories: { 'channel:channel-1': [{ role: 'user', content: 'earlier' }] },
  });
  const asks = [];
  const { bot, logger } = setup({
    memory,
    ask: async (history, prompt) => {
      asks.push({ history, prompt });
      return 'the answer';
    },
  });

  const interaction = createFakeInteraction({
    prompt: 'hello',
    guildId: 'guild-1',
    channelId: 'channel-1',
    channel: typingChannel(),
  });

  await bot.handleInteraction(interaction);

  assert.deepEqual(asks, [
    {
      history: [{ role: 'user', content: 'earlier' }],
      prompt: 'hello',
    },
  ]);
  assert.deepEqual(
    memory.calls
      .filter((call) => call.method === 'getHistory' || call.method === 'appendTurn')
      .map(({ method, scope, key }) => ({ method, scope, key })),
    [
      { method: 'getHistory', scope: 'channel', key: 'channel-1' },
      { method: 'appendTurn', scope: 'channel', key: 'channel-1' },
    ],
  );

  assert.deepEqual(interaction.calls.map((call) => call.method), [
    'deferReply',
    'editReply',
  ]);
  assert.equal(interaction.calls[1].payload.content, 'the answer');
  assert.deepEqual(interaction.calls[1].payload.allowedMentions, { parse: [] });
  assert.deepEqual(logger.entries.error, []);
});

test('/q in a DM uses private memory and shows the opt-in hint once', async () => {
  const memory = createFakeMemory({ hintResults: [true] });
  const { bot } = setup({ memory, ask: async () => 'private answer' });

  const interaction = createFakeInteraction({
    guildId: null,
    channelId: null,
    userId: 'user-1',
    channel: typingChannel(),
  });

  await bot.handleInteraction(interaction);

  assert.deepEqual(
    memory.calls
      .filter((call) => ['getHistory', 'appendTurn', 'showDmHintOnce'].includes(call.method))
      .map(({ method, scope, key, userId }) => ({ method, scope, key, userId })),
    [
      { method: 'getHistory', scope: 'dm', key: 'user-1', userId: undefined },
      { method: 'appendTurn', scope: 'dm', key: 'user-1', userId: undefined },
      { method: 'showDmHintOnce', scope: undefined, key: undefined, userId: 'user-1' },
    ],
  );

  const hint = interaction.calls.at(-1);
  assert.equal(hint.method, 'followUp');
  assert.match(hint.payload.content, /mémoire est désactivée par défaut/);
  assert.equal(hint.payload.flags, memoOn);
});

test('/q in a DM does not repeat the hint after the first time', async () => {
  const memory = createFakeMemory({ hintResults: [false] });
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({ guildId: null, userId: 'user-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.some((call) => call.method === 'followUp'), false);
});

test('a failing hint lookup is logged and does not fail the answer', async () => {
  const memory = createFakeMemory({ failures: { showDmHintOnce: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({ guildId: null, userId: 'user-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.at(-1).method, 'editReply');
  assert.match(logger.entries.error[0], /Could not show the DM memory hint: showDmHintOnce failed/);
});

test('a failing hint message is logged and does not fail the answer', async () => {
  const memory = createFakeMemory({ hintResults: [true] });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({
    guildId: null,
    userId: 'user-1',
    failures: { followUp: 1 },
  });
  await bot.handleInteraction(interaction);

  assert.match(logger.entries.error[0], /Could not show the DM memory hint: followUp failed/);
});

test('/q in a DM answers without a hint when memory is in fallback mode', async () => {
  const memory = createFakeMemory({ mode: 'memory', hintResults: [true] });
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({ guildId: null, userId: 'user-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.at(-1).payload.content, 'reply');
  assert.equal(memory.calls.some((call) => call.method === 'showDmHintOnce'), false);
});

test('non-Error failures are logged without crashing', async () => {
  const { bot, logger } = setup({
    ask: async () => {
      throw 'model exploded';
    },
  });
  const message = createFakeMessage();

  await assert.doesNotReject(bot.handleMessage(message));

  assert.match(logger.entries.error[0], /Failed to handle message: model exploded/);
  assert.match(message.calls.at(-1).payload.content, /request failed/);
});

test('/memo is refused in a public channel', async () => {
  const memory = createFakeMemory();
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({
    commandName: 'memo',
    guildId: 'guild-1',
  });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.length, 1);
  assert.equal(interaction.calls[0].method, 'reply');
  assert.match(interaction.calls[0].payload.content, /qu'en message privé/);
  assert.equal(interaction.calls[0].payload.flags, memoOn);
  assert.equal(memory.calls.some((call) => call.method === 'setDmEnabled'), false);
});

test('/memo explains that private memory needs MongoDB in fallback mode', async () => {
  const memory = createFakeMemory({ mode: 'memory' });
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({
    commandName: 'memo',
    guildId: null,
    userId: 'user-1',
  });
  await bot.handleInteraction(interaction);

  assert.match(interaction.calls[0].payload.content, /nécessite MongoDB/);
  assert.equal(memory.calls.some((call) => call.method === 'setDmEnabled'), false);
});

test('/memo on enables private memory in a DM', async () => {
  const memory = createFakeMemory();
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({
    commandName: 'memo',
    guildId: null,
    userId: 'user-1',
    subcommand: 'on',
  });
  await bot.handleInteraction(interaction);

  assert.deepEqual(
    memory.calls.find((call) => call.method === 'setDmEnabled'),
    { method: 'setDmEnabled', userId: 'user-1', enabled: true },
  );
  assert.match(interaction.calls[0].payload.content, /Mémoire privée activée/);
  assert.match(interaction.calls[0].payload.content, /2 derniers échanges/);
  assert.equal(interaction.calls[0].payload.flags, memoOn);
});

test('/memo off disables private memory in a DM', async () => {
  const memory = createFakeMemory();
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({
    commandName: 'memo',
    guildId: null,
    userId: 'user-1',
    subcommand: 'off',
  });
  await bot.handleInteraction(interaction);

  assert.deepEqual(
    memory.calls.find((call) => call.method === 'setDmEnabled'),
    { method: 'setDmEnabled', userId: 'user-1', enabled: false },
  );
  assert.match(interaction.calls[0].payload.content, /historique effacé/);
});

test('/memo reports a failed preference update and tolerates a failed reply', async () => {
  const memory = createFakeMemory({ failures: { setDmEnabled: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({
    commandName: 'memo',
    guildId: null,
    userId: 'user-1',
    failures: { reply: 1 },
  });

  await bot.handleInteraction(interaction);

  assert.match(logger.entries.error[0], /Could not update the DM memory preference/);
  assert.equal(interaction.calls.length, 1);
});

test('a /memo handler failure is logged instead of crashing', async () => {
  const { bot, logger } = setup();
  const interaction = createFakeInteraction({
    commandName: 'memo',
    guildId: 'guild-1',
    failures: { reply: 1 },
  });

  await bot.handleInteraction(interaction);

  assert.match(logger.entries.error[0], /Failed to handle \/memo: reply failed/);
});

test('non-command interactions and unknown commands are ignored', async () => {
  const { bot, memory } = setup();

  await bot.handleInteraction(createFakeInteraction({ chatInput: false }));
  await bot.handleInteraction(createFakeInteraction({ commandName: 'other' }));

  assert.equal(memory.calls.length, 0);
});

test('/q rejects empty and oversized prompts before deferring', async () => {
  const { bot, memory } = setup();

  const empty = createFakeInteraction({ prompt: '   ' });
  await bot.handleInteraction(empty);
  assert.equal(empty.calls[0].payload.content, 'Please include a question.');
  assert.equal(empty.calls[0].payload.flags, memoOn);

  const long = createFakeInteraction({ prompt: 'x'.repeat(51) });
  await bot.handleInteraction(long);
  assert.match(long.calls[0].payload.content, /under 50 characters/);

  assert.equal(memory.calls.length, 0);
});

test('a second /q in the same channel waits while the first is in flight', async () => {
  const gate = await deferred();
  const memory = createFakeMemory();
  const { bot } = setup({
    memory,
    ask: async () => {
      await gate.promise;
      return 'first answer';
    },
  });

  const first = createFakeInteraction({ prompt: 'first', channelId: 'channel-1' });
  const second = createFakeInteraction({ prompt: 'second', channelId: 'channel-1' });

  const firstRun = bot.handleInteraction(first);
  await new Promise((resolve) => setImmediate(resolve));
  await bot.handleInteraction(second);

  assert.match(
    second.calls.find((call) => call.method === 'editReply').payload.content,
    /still working on the previous question/,
  );

  gate.resolve();
  await firstRun;
  assert.equal(first.calls.at(-1).payload.content, 'first answer');
});

test('/q reports a memory read failure with the memory-specific message', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({ channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.match(logger.entries.error[0], /Failed to handle \/q/);
  assert.match(interaction.calls.at(-1).payload.content, /memory is temporarily unavailable/);
  assert.equal(interaction.calls.at(-1).payload.flags, undefined);
});

test('/q reports model failures after deferring', async () => {
  const { bot } = setup({
    ask: async () => {
      throw Object.assign(new Error('rate limited'), { status: 429 });
    },
  });

  const interaction = createFakeInteraction({ channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.deferred, true);
  assert.equal(interaction.calls.at(-1).method, 'editReply');
  assert.match(interaction.calls.at(-1).payload.content, /rate limiting/);
});

test('/q replies ephemerally when an early failure happens before deferring', async () => {
  const { bot } = setup();

  const interaction = createFakeInteraction({ prompt: '   ', failures: { reply: 1 } });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.deferred, false);
  assert.equal(interaction.calls.length, 2);
  assert.equal(interaction.calls.at(-1).method, 'reply');
  assert.match(interaction.calls.at(-1).payload.content, /request failed/);
  assert.equal(interaction.calls.at(-1).payload.flags, memoOn);
});

test('/q tolerates a failure of the error reply itself', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({
    channelId: 'channel-1',
    failures: { editReply: 1 },
  });

  await assert.doesNotReject(bot.handleInteraction(interaction));
  assert.equal(interaction.calls.filter((call) => call.method === 'editReply').length, 1);
  assert.match(logger.entries.error[0], /Failed to handle \/q/);
});

test('/q splits long model answers into an edit and follow-ups', async () => {
  const { bot } = setup({ ask: async () => LONG_REPLY });

  const interaction = createFakeInteraction({ channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.deepEqual(interaction.calls.map((call) => call.method), [
    'deferReply',
    'editReply',
    'followUp',
  ]);
  assert.equal(interaction.calls[1].payload.content.length, 2000);
  assert.equal(interaction.calls[2].payload.content, 'b'.repeat(10));
});

test('/q tolerates a channel without typing support', async () => {
  const { bot } = setup();

  const interaction = createFakeInteraction({ channelId: 'channel-1', channel: null });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.at(-1).payload.content, 'reply');
});

test('a failing appendTurn is logged but the answer is still sent', async () => {
  const memory = createFakeMemory({ failures: { appendTurn: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({ channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.match(logger.entries.error[0], /Could not save the conversation turn/);
  assert.equal(interaction.calls.at(-1).payload.content, 'reply');
});

test('/q responds with a memory error when the interaction is already deferred', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({ channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.deferred, true);
  assert.equal(interaction.calls.at(-1).method, 'editReply');
  assert.match(interaction.calls.at(-1).payload.content, /memory is temporarily unavailable/);
});

test('messages from bots and system messages are ignored', async () => {
  const { bot, memory } = setup();

  await bot.handleMessage(
    createFakeMessage({ author: { id: 'other-bot', bot: true } }),
  );
  await bot.handleMessage(createFakeMessage({ system: true }));

  assert.equal(memory.calls.length, 0);
});

test('guild messages without a mention are ignored', async () => {
  const { bot, memory } = setup();

  await bot.handleMessage(createFakeMessage({ mentionsBot: false }));

  assert.equal(memory.calls.length, 0);
});

test('a mentioned guild message answers with shared channel memory', async () => {
  const memory = createFakeMemory({
    histories: { 'channel:channel-1': [{ role: 'user', content: 'earlier' }] },
  });
  const asks = [];
  const { bot } = setup({
    memory,
    ask: async (history, prompt) => {
      asks.push({ history, prompt });
      return 'guild answer';
    },
  });

  const message = createFakeMessage({
    content: `<@${BOT_USER_ID}> question`,
    channelId: 'channel-1',
  });
  await bot.handleMessage(message);

  assert.deepEqual(asks[0].history, [{ role: 'user', content: 'earlier' }]);
  assert.equal(asks[0].prompt, 'question');
  assert.equal(message.calls.at(-1).method, 'reply');
  assert.equal(message.calls.at(-1).payload.content, 'guild answer');
  assert.deepEqual(message.calls.at(-1).payload.allowedMentions, {
    parse: [],
    repliedUser: false,
  });
  assert.deepEqual(
    memory.calls
      .filter((call) => call.method === 'getHistory' || call.method === 'appendTurn')
      .map(({ method, scope, key }) => ({ method, scope, key })),
    [
      { method: 'getHistory', scope: 'channel', key: 'channel-1' },
      { method: 'appendTurn', scope: 'channel', key: 'channel-1' },
    ],
  );
});

test('a DM message answers privately and sends the opt-in hint in the DM', async () => {
  const memory = createFakeMemory({ hintResults: [true] });
  const { bot } = setup({ memory });

  const message = createFakeMessage({
    content: 'hello privately',
    author: { id: 'user-1', bot: false },
    channelType: ChannelType.DM,
    channelId: 'dm-1',
  });
  await bot.handleMessage(message);

  assert.deepEqual(
    memory.calls
      .filter((call) => ['getHistory', 'appendTurn', 'showDmHintOnce'].includes(call.method))
      .map(({ method, scope, key, userId }) => ({ method, scope, key, userId })),
    [
      { method: 'getHistory', scope: 'dm', key: 'user-1', userId: undefined },
      { method: 'appendTurn', scope: 'dm', key: 'user-1', userId: undefined },
      { method: 'showDmHintOnce', scope: undefined, key: undefined, userId: 'user-1' },
    ],
  );
  assert.equal(message.calls.at(-1).method, 'send');
  assert.match(message.calls.at(-1).payload.content, /memo on/);
});

test('an empty mention asks for a question', async () => {
  const { bot, memory } = setup();
  const message = createFakeMessage({ content: `<@${BOT_USER_ID}>` });

  await bot.handleMessage(message);

  assert.equal(message.calls[0].payload.content, 'Hi! Mention me with a question, or use `/q`.');
  assert.equal(memory.calls.length, 0);
});

test('an oversized message is refused before calling the model', async () => {
  const { bot, memory } = setup();
  const message = createFakeMessage({
    content: `<@${BOT_USER_ID}> ${'x'.repeat(51)}`,
  });

  await bot.handleMessage(message);

  assert.match(message.calls[0].payload.content, /under 50 characters/);
  assert.equal(memory.calls.length, 0);
});

test('a second mentioned message waits while the first is in flight', async () => {
  const gate = await deferred();
  const { bot } = setup({
    ask: async () => {
      await gate.promise;
      return 'done';
    },
  });

  const first = createFakeMessage({ content: `<@${BOT_USER_ID}> first` });
  const second = createFakeMessage({ content: `<@${BOT_USER_ID}> second` });

  const firstRun = bot.handleMessage(first);
  await new Promise((resolve) => setImmediate(resolve));
  await bot.handleMessage(second);

  assert.match(
    second.calls.find((call) => call.method === 'reply').payload.content,
    /still working on the previous question/,
  );

  gate.resolve();
  await firstRun;
});

test('a message answer longer than the limit is split across replies', async () => {
  const { bot } = setup({ ask: async () => LONG_REPLY });
  const message = createFakeMessage();

  await bot.handleMessage(message);

  const sends = message.calls.filter((call) => call.method === 'reply' || call.method === 'send');
  assert.deepEqual(sends.map((call) => call.method), ['reply', 'send']);
  assert.equal(sends[0].payload.content.length, 2000);
  assert.equal(sends[1].payload.content, 'b'.repeat(10));
});

test('message errors are reported through the error description', async () => {
  const { bot } = setup({
    ask: async () => {
      throw Object.assign(new Error('expired key'), { status: 401 });
    },
  });
  const message = createFakeMessage();

  await bot.handleMessage(message);

  assert.match(message.calls.at(-1).payload.content, /rejected the API key/);
});

test('a memory read failure in a message is reported as such', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot } = setup({ memory });
  const message = createFakeMessage();

  await bot.handleMessage(message);

  assert.match(message.calls.at(-1).payload.content, /memory is temporarily unavailable/);
});

test('a failing message reply is logged and swallowed', async () => {
  const { bot, logger } = setup({
    ask: async () => {
      throw new Error('model down');
    },
  });
  const message = createFakeMessage({ failures: { reply: 1 } });

  await assert.doesNotReject(bot.handleMessage(message));

  assert.match(logger.entries.error[0], /Failed to handle message: model down/);
});

test('a failing typing indicator does not prevent the answer', async () => {
  const { bot } = setup();
  const message = createFakeMessage({ failures: { typing: 1 } });

  await bot.handleMessage(message);

  assert.equal(message.calls.at(-1).payload.content, 'reply');
});

test('a DM message still works when the channel cannot send typing indicators', async () => {
  const { bot } = setup();
  const message = createFakeMessage({
    content: 'hello',
    author: { id: 'user-1', bot: false },
    channelType: ChannelType.DM,
    channelId: 'dm-1',
    withoutTyping: true,
  });

  await bot.handleMessage(message);

  assert.equal(message.calls.at(-1).payload.content, 'reply');
});

test('messages work without a cached bot user', async () => {
  const memory = createFakeMemory();
  const logger = createLogger();
  const client = new EventEmitter();
  client.on = EventEmitter.prototype.on.bind(client);
  const bot = createBot({ client, memory, settings, ask: async () => 'reply', logger });

  const dm = createFakeMessage({
    content: '  hello  ',
    author: { id: 'user-1', bot: false },
    channelType: ChannelType.DM,
    channelId: 'dm-1',
  });
  await bot.handleMessage(dm);

  assert.equal(dm.calls.at(-1).payload.content, 'reply');
});

test('Discord client errors are logged', () => {
  const client = createFakeClient();
  const logger = createLogger();
  createBot({ client, memory: createFakeMemory(), settings, logger });

  client.emit(Events.Error, new Error('ws closed'));

  assert.match(logger.entries.error[0], /Discord client error: ws closed/);
});
