import assert from 'node:assert/strict';
import test from 'node:test';
import { Bot } from '../../src/bot/bot.ts';
import { createFakeClient, createLogger } from '../helpers/fakes.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('splitMessage handles empty, short and exactly-limit messages', () => {
  assert.deepEqual(Bot.splitMessage('   '), ['The model returned an empty response.']);
  assert.deepEqual(Bot.splitMessage('  hello  '), ['hello']);

  const exact = 'a'.repeat(2000);
  assert.deepEqual(Bot.splitMessage(exact), [exact]);
});

test('splitMessage prefers newlines, then spaces, then hard cuts', () => {
  const withNewline = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
  assert.deepEqual(Bot.splitMessage(withNewline), ['a'.repeat(1500), 'b'.repeat(1500)]);

  const withSpace = `${'a'.repeat(1500)} ${'b'.repeat(1500)}`;
  assert.deepEqual(Bot.splitMessage(withSpace), ['a'.repeat(1500), 'b'.repeat(1500)]);

  const noSeparator = 'a'.repeat(2500);
  assert.deepEqual(Bot.splitMessage(noSeparator), ['a'.repeat(2000), 'a'.repeat(500)]);

  const manyChunks = 'c'.repeat(4500);
  assert.deepEqual(Bot.splitMessage(manyChunks), [
    'c'.repeat(2000),
    'c'.repeat(2000),
    'c'.repeat(500),
  ]);
});

test('splitMessage falls back to a hard cut when early separators are too far left', () => {
  const text = `${'a'.repeat(500)}\n${'b'.repeat(2500)}`;
  const chunks = Bot.splitMessage(text);

  assert.equal(chunks[0].length, 2000);
  assert.equal(chunks.join(''), text);
});

test('stripBotMention removes mentions and trims whitespace', () => {
  assert.equal(Bot.stripBotMention('<@!bot-1> hello', 'bot-1'), 'hello');
  assert.equal(Bot.stripBotMention('<@bot-1> hello <@bot-1>', 'bot-1'), 'hello');
  assert.equal(Bot.stripBotMention('  hello  ', null), 'hello');
  assert.equal(Bot.stripBotMention('  hello  ', undefined), 'hello');
});

test('describeRequestError prioritises memory failures', () => {
  assert.match(
    Bot.describeRequestError({ memoryUnavailable: true }),
    /Conversation memory is temporarily unavailable/,
  );
  assert.match(Bot.describeRequestError({ status: 429 }), /rate limiting/);
});

test('startTyping is a no-op without a usable channel', () => {
  assert.equal(typeof Bot.startTyping(null), 'function');
  assert.doesNotThrow(() => Bot.startTyping({})());
});

test('startTyping sends immediately and repeats until stopped', async () => {
  let calls = 0;
  const stop = Bot.startTyping(
    {
      sendTyping: async () => {
        calls += 1;
      },
    },
    5,
  );

  await delay(2);
  assert.equal(calls, 1);

  await delay(20);
  const afterInterval = calls;
  assert.ok(afterInterval >= 2);

  stop();
  await delay(15);
  assert.equal(calls, afterInterval);
});

test('startTyping swallows sendTyping failures', async () => {
  const stop = Bot.startTyping(
    {
      sendTyping: async () => {
        throw new Error('typing failed');
      },
    },
    1,
  );

  await delay(10);
  stop();
  await delay(5);
});

const COMMAND_NAMES = ['q', 'version', 'aide', 'help', 'feature-request'];

test('registerCommands registers every command in the guild only', async () => {
  const client = createFakeClient();
  const logger = createLogger();
  const settings = {
    discordGuildId: 'guild-1',
    maxPromptChars: 4000,
  };

  await Bot.registerCommands(client, settings, logger);

  assert.equal(client.fetchedGuildId, 'guild-1');
  assert.equal(client.guildCommands.length, 5);
  assert.deepEqual(
    client.guildCommands.map((command) => command.name),
    COMMAND_NAMES,
  );
  assert.equal(client.globalCommands.length, 0);
  assert.match(logger.messages('info')[0], /Registered 5 slash commands in Guild Name\./);
});

test('registerCommands registers every command globally without a guild id', async () => {
  const client = createFakeClient();
  const logger = createLogger();
  const settings = {
    discordGuildId: null,
    maxPromptChars: 10_000,
  };

  await Bot.registerCommands(client, settings, logger);

  assert.equal(client.fetchedGuildId, undefined);
  assert.deepEqual(
    client.globalCommands.map((command) => command.name),
    COMMAND_NAMES,
  );
  assert.equal(client.globalCommands[0].options[0].max_length, 6000);
  assert.match(logger.messages('info')[0], /5 global slash commands/);
});

test('registerCommands logs instead of throwing when Discord rejects the update', async () => {
  const client = createFakeClient();
  client.guilds.fetch = async () => {
    throw new Error('discord down');
  };
  const logger = createLogger();

  await Bot.registerCommands(client, { discordGuildId: 'guild-1', maxPromptChars: 4000 }, logger);

  assert.match(logger.messages('error')[0], /Could not register slash commands: discord down/);
});
