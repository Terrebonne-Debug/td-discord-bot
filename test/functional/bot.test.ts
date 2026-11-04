import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ChannelType, Events, MessageFlags } from 'discord.js';
import { Bot } from '../../src/bot/bot.ts';
import type { BotSettings } from '../../src/models/bot/bot-settings.ts';
import type { Turn } from '../../src/models/memory/turn.ts';
import {
  BOT_USER_ID,
  createFakeClient,
  createFakeInteraction,
  createFakeMemory,
  createFakeMessage,
  createFakeModalSubmit,
  createLogger,
} from '../helpers/fakes.ts';
import type { FakeClient, FakeMemory } from '../helpers/fakes.ts';

const settings: BotSettings = {
  maxPromptChars: 50,
  githubToken: 'gh-token',
  githubRepository: 'Terrebonne-Debug/td-discord-bot',
};

const memoOn = MessageFlags.Ephemeral;
const LONG_REPLY = `${'a'.repeat(2000)}${'b'.repeat(10)}`;

function setup({
  memory = createFakeMemory(),
  ask = async () => 'reply',
  client = createFakeClient(),
  buildInfo = { version: '1.0.0', commit: 'abc1234' },
  createIssue = async () => 'https://github.com/owner/repo/issues/1',
  botSettings = settings,
}: {
  memory?: FakeMemory;
  ask?: (history: Turn[], prompt: string) => Promise<string>;
  client?: FakeClient;
  buildInfo?: { version: string; commit: string };
  createIssue?: (title: string, body: string) => Promise<string>;
  botSettings?: BotSettings;
} = {}) {
  const logger = createLogger();
  const bot = new Bot({
    client,
    memory,
    settings: botSettings,
    ask,
    buildInfo,
    createIssue,
    logger,
  });
  return { bot, memory, logger, client };
}

function typingChannel() {
  return { sendTyping: async () => {} };
}

async function deferred() {
  let resolve: (value?: unknown) => void = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('/q in a guild uses shared channel memory and replies through the interaction', async () => {
  const memory = createFakeMemory({
    histories: { 'channel-1': [{ role: 'user', content: 'earlier' }] },
  });
  const asks: Array<{ history: Turn[]; prompt: string }> = [];
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
      .map(({ method, key }) => ({ method, key })),
    [
      { method: 'getHistory', key: 'channel-1' },
      { method: 'appendTurn', key: 'channel-1' },
    ],
  );

  assert.deepEqual(interaction.calls.map((call) => call.method), [
    'deferReply',
    'editReply',
  ]);
  assert.equal(interaction.calls[1].payload?.content, 'the answer');
  assert.deepEqual(interaction.calls[1].payload?.allowedMentions, { parse: [] });
  assert.deepEqual(logger.messages('error'), []);
});

test('/q in a DM answers without reading or storing any memory', async () => {
  const memory = createFakeMemory({ histories: { 'user-1': [{ role: 'user', content: 'old' }] } });
  const asks: Array<{ history: Turn[]; prompt: string }> = [];
  const { bot } = setup({
    memory,
    ask: async (history, prompt) => {
      asks.push({ history, prompt });
      return 'private answer';
    },
  });

  const interaction = createFakeInteraction({
    guildId: null,
    channelId: null,
    userId: 'user-1',
    channel: typingChannel(),
  });

  await bot.handleInteraction(interaction);

  assert.deepEqual(asks, [{ history: [], prompt: 'hello' }]);
  assert.equal(
    memory.calls.some(
      (call) => call.method === 'getHistory' || call.method === 'appendTurn',
    ),
    false,
  );
  assert.equal(interaction.calls.at(-1)?.method, 'editReply');
  assert.equal(interaction.calls.at(-1)?.payload?.content, 'private answer');
});

test('/version replies with the version and the last commit', async () => {
  const { bot } = setup({ buildInfo: { version: '1.2.3', commit: 'deadbeef' } });

  const interaction = createFakeInteraction({ commandName: 'version' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.length, 1);
  assert.equal(interaction.calls[0].method, 'reply');
  assert.match(interaction.calls[0].payload?.content ?? '', /1\.2\.3/);
  assert.match(interaction.calls[0].payload?.content ?? '', /deadbeef/);
});

test('/aide and /help reply with exactly the same command list', async () => {
  const { bot } = setup();

  const aide = createFakeInteraction({ commandName: 'aide' });
  await bot.handleInteraction(aide);
  const help = createFakeInteraction({ commandName: 'help' });
  await bot.handleInteraction(help);

  const aideContent = aide.calls[0].payload?.content ?? '';
  const helpContent = help.calls[0].payload?.content ?? '';

  assert.equal(aideContent, helpContent);
  assert.match(aideContent, /\/q/);
  assert.match(aideContent, /\/version/);
  assert.match(aideContent, /\/aide/);
  assert.match(aideContent, /\/feature-request/);
  assert.equal(aideContent.includes('`/help` (alias'), false, 'pas de ligne /help séparée');
});

test('/feature-request shows the title and description modal', async () => {
  const { bot } = setup();

  const interaction = createFakeInteraction({ commandName: 'feature-request' });
  await bot.handleInteraction(interaction);

  assert.deepEqual(interaction.calls.map((call) => call.method), ['showModal']);
  assert.equal(interaction.modals.length, 1);
  const json = (interaction.modals[0] as { toJSON(): Record<string, any> }).toJSON();
  assert.equal(json.custom_id, 'feature-request');
  assert.equal(json.title, 'Demande de fonctionnalité');
  const inputs = json.components.map((row: Record<string, any>) => row.components[0]);
  assert.equal(inputs[0].custom_id, 'titre');
  assert.equal(inputs[0].max_length, 200);
  assert.equal(inputs[1].custom_id, 'description');
  assert.equal(inputs[1].max_length, 4000);
});

test('/feature-request replies it is not configured without a GitHub token', async () => {
  const issues: string[] = [];
  const { bot } = setup({
    botSettings: { ...settings, githubToken: null },
    createIssue: async () => {
      issues.push('appelé');
      return 'url';
    },
  });

  const interaction = createFakeInteraction({ commandName: 'feature-request' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.length, 1);
  assert.match(interaction.calls[0].payload?.content ?? '', /GITHUB_TOKEN manquant/);
  assert.equal(interaction.calls[0].payload?.flags, MessageFlags.Ephemeral);
  assert.equal(interaction.modals.length, 0);
  assert.deepEqual(issues, []);
});

test('/feature-request handler failures are logged instead of crashing', async () => {
  const { bot, logger } = setup();

  const interaction = createFakeInteraction({
    commandName: 'feature-request',
    failures: { showModal: 1 },
  });
  await bot.handleInteraction(interaction);

  assert.match(logger.messages('error')[0], /Failed to handle \/feature-request: showModal failed/);
});

test('a feature-request submit creates the issue with title and description', async () => {
  const issues: Array<{ title: string; body: string }> = [];
  const { bot, logger } = setup({
    createIssue: async (title, body) => {
      issues.push({ title, body });
      return 'https://github.com/owner/repo/issues/7';
    },
  });

  const modal = createFakeModalSubmit({
    title: 'Ajouter un système de sondages',
    description: 'Des sondages générés par IA dans un salon dédié.',
  });
  await bot.handleInteraction(modal);

  assert.deepEqual(modal.calls.map((call) => call.method), ['deferReply', 'editReply']);
  assert.equal(
    modal.calls[1].payload?.content,
    'Demande créée : https://github.com/owner/repo/issues/7',
  );
  assert.deepEqual(issues, [
    {
      title: 'Ajouter un système de sondages',
      body: '**Demande**\n\nDes sondages générés par IA dans un salon dédié.\n\n---\nDemandé depuis Discord par alice.',
    },
  ]);
  assert.match(logger.messages('info')[0], /Issue de demande créée/);
});

test('a feature-request submit truncates titles beyond 200 characters', async () => {
  const issues: Array<{ title: string; body: string }> = [];
  const { bot } = setup({
    createIssue: async (title, body) => {
      issues.push({ title, body });
      return 'url';
    },
  });

  await bot.handleInteraction(createFakeModalSubmit({ title: 'x'.repeat(300) }));

  assert.equal(issues[0].title.length, 200);
  assert.equal(issues[0].title.endsWith('…'), true);
});

test('a feature-request submit rejects an empty title or description', async () => {
  const issues: string[] = [];
  const { bot } = setup({
    createIssue: async () => {
      issues.push('appelé');
      return 'url';
    },
  });

  const emptyTitle = createFakeModalSubmit({ title: '   ' });
  await bot.handleInteraction(emptyTitle);
  const emptyDescription = createFakeModalSubmit({ description: '' });
  await bot.handleInteraction(emptyDescription);

  for (const modal of [emptyTitle, emptyDescription]) {
    assert.equal(modal.calls.length, 1);
    assert.equal(modal.calls[0].payload?.content, 'Le titre et la description sont requis.');
    assert.equal(modal.calls[0].payload?.flags, MessageFlags.Ephemeral);
  }
  assert.deepEqual(issues, []);
});

test('a feature-request submit ignores unknown modals', async () => {
  const issues: string[] = [];
  const { bot } = setup({
    createIssue: async () => {
      issues.push('appelé');
      return 'url';
    },
  });

  const modal = createFakeModalSubmit({ customId: 'autre-modal' });
  await bot.handleInteraction(modal);

  assert.deepEqual(modal.calls, []);
  assert.deepEqual(issues, []);
});

test('a feature-request submit handler failure is logged instead of crashing', async () => {
  const { bot, logger } = setup();

  await bot.handleInteraction(createFakeModalSubmit({ failures: { getTextInputValue: 1 } }));

  assert.match(logger.messages('error')[0], /Failed to handle feature-request submit/);
});

test('createIssueFor posts through the configured token and repository', async () => {
  const calls: Array<{ url: string; token: string; body: string }> = [];
  const fetchFn = async (input: string | Request | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      token: (init.headers as Record<string, string>).Authorization?.replace('Bearer ', '') ?? '',
      body: init.body as string,
    });
    return {
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/x/y/issues/1' }),
    } as Response;
  };

  const createIssue = Bot.createIssueFor(settings, fetchFn);
  const url = await createIssue('titre', 'corps');

  assert.equal(url, 'https://github.com/x/y/issues/1');
  assert.equal(calls[0].token, 'gh-token');
  assert.equal(calls[0].url, 'https://api.github.com/repos/Terrebonne-Debug/td-discord-bot/issues');
  assert.deepEqual(JSON.parse(calls[0].body), { title: 'titre', body: 'corps' });
});

test('createIssueFor throws without a GitHub token', () => {
  const createIssue = Bot.createIssueFor({ ...settings, githubToken: null });

  assert.throws(() => createIssue('titre', 'corps'), /GITHUB_TOKEN is not set/);
});

test('a feature-request submit tolerates a failure of the error reply itself', async () => {
  const { bot, logger } = setup({
    createIssue: async () => {
      throw new Error('api down');
    },
  });

  const modal = createFakeModalSubmit({ failures: { editReply: 1 } });
  await assert.doesNotReject(bot.handleInteraction(modal));
  assert.match(logger.messages('error')[0], /Could not create the feature request issue/);
});

test('a feature-request submit reports a creation failure', async () => {
  const { bot, logger } = setup({
    createIssue: async () => {
      throw new Error('api down');
    },
  });

  const modal = createFakeModalSubmit();
  await bot.handleInteraction(modal);

  assert.match(logger.messages('error')[0], /Could not create the feature request issue: api down/);
  assert.equal(modal.calls.at(-1)?.method, 'editReply');
  assert.match(modal.calls.at(-1)?.payload?.content ?? '', /Impossible de créer la demande/);
});

test('non-Error failures are logged without crashing', async () => {
  const { bot, logger } = setup({
    ask: async () => {
      throw 'model exploded';
    },
  });
  const message = createFakeMessage();

  await assert.doesNotReject(bot.handleMessage(message));

  assert.match(logger.messages('error')[0], /Failed to handle message: model exploded/);
  assert.match(message.calls.at(-1)?.payload?.content ?? '', /request failed/);
});

test('non-command interactions and unknown commands are ignored', async () => {
  const { bot, memory } = setup();

  await bot.handleInteraction(createFakeInteraction({ chatInput: false }));
  // Une commande /memo résiduelle sur Discord est ignorée silencieusement.
  await bot.handleInteraction(createFakeInteraction({ commandName: 'memo' }));
  await bot.handleInteraction(createFakeInteraction({ commandName: 'other' }));

  assert.equal(memory.calls.length, 0);
});

test('/q rejects empty and oversized prompts before deferring', async () => {
  const { bot, memory } = setup();

  const empty = createFakeInteraction({ prompt: '   ' });
  await bot.handleInteraction(empty);
  assert.equal(empty.calls[0].payload?.content, 'Please include a question.');
  assert.equal(empty.calls[0].payload?.flags, memoOn);

  const long = createFakeInteraction({ prompt: 'x'.repeat(51) });
  await bot.handleInteraction(long);
  assert.match(long.calls[0].payload?.content ?? '', /under 50 characters/);

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

  const first = createFakeInteraction({ prompt: 'first', guildId: 'guild-1', channelId: 'channel-1' });
  const second = createFakeInteraction({ prompt: 'second', guildId: 'guild-1', channelId: 'channel-1' });

  const firstRun = bot.handleInteraction(first);
  await new Promise((resolve) => setImmediate(resolve));
  await bot.handleInteraction(second);

  assert.match(
    second.calls.find((call) => call.method === 'editReply')?.payload?.content ?? '',
    /still working on the previous question/,
  );

  gate.resolve();
  await firstRun;
  assert.equal(first.calls.at(-1)?.payload?.content, 'first answer');
});

test('/q reports a memory read failure with the memory-specific message', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({ guildId: 'guild-1', channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.match(logger.messages('error')[0], /Failed to handle \/q/);
  assert.match(interaction.calls.at(-1)?.payload?.content ?? '', /memory is temporarily unavailable/);
  assert.equal(interaction.calls.at(-1)?.payload?.flags, undefined);
});

test('/q reports model failures after deferring', async () => {
  const { bot } = setup({
    ask: async () => {
      throw Object.assign(new Error('rate limited'), { status: 429 });
    },
  });

  const interaction = createFakeInteraction({ guildId: 'guild-1', channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.deferred, true);
  assert.equal(interaction.calls.at(-1)?.method, 'editReply');
  assert.match(interaction.calls.at(-1)?.payload?.content ?? '', /rate limiting/);
});

test('/q replies ephemerally when an early failure happens before deferring', async () => {
  const { bot } = setup();

  const interaction = createFakeInteraction({ prompt: '   ', failures: { reply: 1 } });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.deferred, false);
  assert.equal(interaction.calls.length, 2);
  assert.equal(interaction.calls.at(-1)?.method, 'reply');
  assert.match(interaction.calls.at(-1)?.payload?.content ?? '', /request failed/);
  assert.equal(interaction.calls.at(-1)?.payload?.flags, memoOn);
});

test('/q tolerates a failure of the error reply itself', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({
    guildId: 'guild-1',
    channelId: 'channel-1',
    failures: { editReply: 1 },
  });

  await assert.doesNotReject(bot.handleInteraction(interaction));
  assert.equal(interaction.calls.filter((call) => call.method === 'editReply').length, 1);
  assert.match(logger.messages('error')[0], /Failed to handle \/q/);
});

test('/q splits long model answers into an edit and follow-ups', async () => {
  const { bot } = setup({ ask: async () => LONG_REPLY });

  const interaction = createFakeInteraction({ guildId: 'guild-1', channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.deepEqual(interaction.calls.map((call) => call.method), [
    'deferReply',
    'editReply',
    'followUp',
  ]);
  assert.equal(interaction.calls[1].payload?.content.length, 2000);
  assert.equal(interaction.calls[2].payload?.content, 'b'.repeat(10));
});

test('/q tolerates a channel without typing support', async () => {
  const { bot } = setup();

  const interaction = createFakeInteraction({ channelId: 'channel-1', channel: null });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.calls.at(-1)?.payload?.content, 'reply');
});

test('a failing appendTurn is logged but the answer is still sent', async () => {
  const memory = createFakeMemory({ failures: { appendTurn: 1 } });
  const { bot, logger } = setup({ memory });

  const interaction = createFakeInteraction({ guildId: 'guild-1', channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.match(logger.messages('warn')[0], /Could not save the conversation turn/);
  assert.equal(interaction.calls.at(-1)?.payload?.content, 'reply');
});

test('/q responds with a memory error when the interaction is already deferred', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot } = setup({ memory });

  const interaction = createFakeInteraction({ guildId: 'guild-1', channelId: 'channel-1' });
  await bot.handleInteraction(interaction);

  assert.equal(interaction.deferred, true);
  assert.equal(interaction.calls.at(-1)?.method, 'editReply');
  assert.match(interaction.calls.at(-1)?.payload?.content ?? '', /memory is temporarily unavailable/);
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
    histories: { 'channel-1': [{ role: 'user', content: 'earlier' }] },
  });
  const asks: Array<{ history: Turn[]; prompt: string }> = [];
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
  assert.equal(message.calls.at(-1)?.method, 'reply');
  assert.equal(message.calls.at(-1)?.payload?.content, 'guild answer');
  assert.deepEqual(message.calls.at(-1)?.payload?.allowedMentions, {
    parse: [],
    repliedUser: false,
  });
  assert.deepEqual(
    memory.calls
      .filter((call) => call.method === 'getHistory' || call.method === 'appendTurn')
      .map(({ method, key }) => ({ method, key })),
    [
      { method: 'getHistory', key: 'channel-1' },
      { method: 'appendTurn', key: 'channel-1' },
    ],
  );
});

test('a DM message answers without reading or storing any memory', async () => {
  const memory = createFakeMemory();
  const asks: Array<{ history: Turn[]; prompt: string }> = [];
  const { bot } = setup({
    memory,
    ask: async (history, prompt) => {
      asks.push({ history, prompt });
      return 'private answer';
    },
  });

  const message = createFakeMessage({
    content: 'hello privately',
    author: { id: 'user-1', bot: false },
    channelType: ChannelType.DM,
    channelId: 'dm-1',
  });
  await bot.handleMessage(message);

  assert.deepEqual(asks, [{ history: [], prompt: 'hello privately' }]);
  assert.equal(memory.calls.length, 0);
  assert.equal(message.calls.at(-1)?.method, 'reply');
  assert.equal(message.calls.at(-1)?.payload?.content, 'private answer');
});

test('an empty mention asks for a question', async () => {
  const { bot, memory } = setup();
  const message = createFakeMessage({ content: `<@${BOT_USER_ID}>` });

  await bot.handleMessage(message);

  assert.equal(message.calls[0].payload?.content, 'Hi! Mention me with a question, or use `/q`.');
  assert.equal(memory.calls.length, 0);
});

test('an oversized message is refused before calling the model', async () => {
  const { bot, memory } = setup();
  const message = createFakeMessage({
    content: `<@${BOT_USER_ID}> ${'x'.repeat(51)}`,
  });

  await bot.handleMessage(message);

  assert.match(message.calls[0].payload?.content ?? '', /under 50 characters/);
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
    second.calls.find((call) => call.method === 'reply')?.payload?.content ?? '',
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
  assert.equal(sends[0].payload?.content.length, 2000);
  assert.equal(sends[1].payload?.content, 'b'.repeat(10));
});

test('message errors are reported through the error description', async () => {
  const { bot } = setup({
    ask: async () => {
      throw Object.assign(new Error('expired key'), { status: 401 });
    },
  });
  const message = createFakeMessage();

  await bot.handleMessage(message);

  assert.match(message.calls.at(-1)?.payload?.content ?? '', /rejected the API key/);
});

test('a memory read failure in a message is reported as such', async () => {
  const memory = createFakeMemory({ failures: { getHistory: 1 } });
  const { bot } = setup({ memory });
  const message = createFakeMessage();

  await bot.handleMessage(message);

  assert.match(message.calls.at(-1)?.payload?.content ?? '', /memory is temporarily unavailable/);
});

test('a failing message reply is logged and swallowed', async () => {
  const { bot, logger } = setup({
    ask: async () => {
      throw new Error('model down');
    },
  });
  const message = createFakeMessage({ failures: { reply: 1 } });

  await assert.doesNotReject(bot.handleMessage(message));

  assert.match(logger.messages('error')[0], /Failed to handle message: model down/);
});

test('a failing typing indicator does not prevent the answer', async () => {
  const { bot } = setup();
  const message = createFakeMessage({ failures: { typing: 1 } });

  await bot.handleMessage(message);

  assert.equal(message.calls.at(-1)?.payload?.content, 'reply');
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

  assert.equal(message.calls.at(-1)?.payload?.content, 'reply');
});

test('messages work without a cached bot user', async () => {
  const memory = createFakeMemory();
  const logger = createLogger();
  const client = Object.assign(new EventEmitter(), { user: null });
  client.on = EventEmitter.prototype.on.bind(client) as unknown as typeof client.on;
  const bot = new Bot({ client, memory, settings, ask: async () => 'reply', logger });

  const dm = createFakeMessage({
    content: '  hello  ',
    author: { id: 'user-1', bot: false },
    channelType: ChannelType.DM,
    channelId: 'dm-1',
  });
  await bot.handleMessage(dm);

  assert.equal(dm.calls.at(-1)?.payload?.content, 'reply');
});

test('Discord client errors are logged', () => {
  const client = createFakeClient();
  const logger = createLogger();
  new Bot({ client, memory: createFakeMemory(), settings, logger });

  client.emit(Events.Error, new Error('ws closed'));

  assert.match(logger.messages('error')[0], /Discord client error: ws closed/);
});
