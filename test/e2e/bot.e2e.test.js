import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from 'discord.js';
import { createBot, registerCommands } from '../../src/bot.js';
import { askDeepSeek, createDeepSeekClient } from '../../src/deepseek.js';
import { MemoryStore } from '../../src/memory.js';
import { startFakeDeepSeek } from '../helpers/fake-deepseek-server.js';
import { startFakeDiscord } from '../helpers/fake-discord-server.js';
import { createLogger } from '../helpers/fakes.js';
import { TEST_MONGODB_URI, withMongo } from '../helpers/mongo.js';

const settings = {
  deepseekModel: 'deepseek-v4-flash',
  deepseekMaxTokens: 512,
  deepseekThinking: 'disabled',
  deepseekEffort: 'max',
  deepseekTemperature: 0.2,
  systemPrompt: 'E2E system prompt',
  maxHistoryTurns: 2,
  maxPromptChars: 4000,
  discordGuildId: 'guild-1',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeClient(discord) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    rest: { api: discord.url },
  });
  return client;
}

test(
  'real discord.js client + MongoDB memory + DeepSeek SDK: guild shares memory, DMs stay private until opt-in',
  { timeout: 30_000 },
  async () => {
    const discord = await startFakeDiscord();
    const deepseek = await startFakeDeepSeek({
      replies: (body) => `echo: ${body.messages.at(-1).content}`,
    });

    try {
      await withMongo(async ({ db, dbName }) => {
        const logger = createLogger();
        const memory = await MemoryStore.connect({
          uri: TEST_MONGODB_URI,
          dbName,
          timeoutMs: 5_000,
          maxHistoryTurns: 2,
          ttlDays: null,
        });
        assert.equal(memory.mode, 'mongo');

        const client = makeClient(discord);
        const anthropic = createDeepSeekClient({
          deepseekApiKey: 'test-key',
          deepseekBaseUrl: deepseek.url,
          deepseekTimeoutMs: 5_000,
        });
        const ask = (history, prompt) =>
          askDeepSeek(history, prompt, anthropic, settings);

        createBot({ client, memory, settings, ask, logger });

        const ready = once(client, Events.ClientReady);
        await client.login('test-discord-token');
        await ready;

        try {
          await registerCommands(client, settings, logger);

          const globalCommands = await discord.waitForRequest(
            (request) => request.kind === 'globalCommands',
          );
          const guildCommands = await discord.waitForRequest(
            (request) => request.kind === 'guildCommands',
          );
          assert.deepEqual(
            globalCommands.body.map((command) => command.name),
            ['memo'],
          );
          assert.deepEqual(
            guildCommands.body.map((command) => command.name),
            ['q'],
          );

          // ---- Public channel: shared memory, no per-user choice ----------
          discord.dispatchMessage(
            discord.messageData({
              id: 'message-1',
              content: `<@${discord.botUser.id}> first question`,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === discord.guildChannelId &&
              request.body.content === 'echo: first question',
          );

          discord.dispatchMessage(
            discord.messageData({
              id: 'message-2',
              content: `<@${discord.botUser.id}> second question`,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === discord.guildChannelId &&
              request.body.content === 'echo: second question',
          );

          assert.deepEqual(deepseek.calls[1].messages, [
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'echo: first question' },
            { role: 'user', content: 'second question' },
          ]);

          // The channel history is really in MongoDB, not just in a Map.
          const channelDoc = await db
            .collection('channel_memories')
            .findOne({ _id: discord.guildChannelId });
          assert.deepEqual(
            channelDoc.turns.map(({ role, content }) => ({ role, content })),
            [
              { role: 'user', content: 'first question' },
              { role: 'assistant', content: 'echo: first question' },
              { role: 'user', content: 'second question' },
              { role: 'assistant', content: 'echo: second question' },
            ],
          );

          // ---- DM without opt-in: no memory, one hint ----------------------
          discord.dispatchMessage(
            discord.messageData({
              id: 'dm-message-1',
              content: 'private hello',
              channelId: 'dm-1',
              guildIdForMessage: null,
              channelType: 1,
              mentionBot: false,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === 'dm-1' &&
              request.body.content === 'echo: private hello',
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === 'dm-1' &&
              /Astuce/.test(request.body.content),
          );

          assert.deepEqual(deepseek.calls.at(-1).messages, [
            { role: 'user', content: 'private hello' },
          ]);
          assert.equal(
            await db.collection('dm_memories').countDocuments({ _id: 'user-1' }),
            0,
          );
          assert.equal(
            (await db.collection('dm_preferences').findOne({ _id: 'user-1' })).hinted,
            true,
          );

          // Second DM still has no memory, and the hint is not repeated.
          discord.dispatchMessage(
            discord.messageData({
              id: 'dm-message-2',
              content: 'second private',
              channelId: 'dm-1',
              guildIdForMessage: null,
              channelType: 1,
              mentionBot: false,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === 'dm-1' &&
              request.body.content === 'echo: second private',
          );
          assert.deepEqual(deepseek.calls.at(-1).messages, [
            { role: 'user', content: 'second private' },
          ]);

          await delay(100);
          assert.equal(
            discord.requests.filter(
              (request) =>
                request.kind === 'message' &&
                request.channelId === 'dm-1' &&
                /Astuce/.test(request.body.content),
            ).length,
            1,
          );

          // ---- /memo on: opt in, then private memory persists -------------
          discord.dispatchCommand({
            interactionId: 'interaction-memo-on',
            commandName: 'memo',
            subcommand: 'on',
            dm: true,
          });
          const memoOnReply = await discord.waitForRequest(
            (request) =>
              request.kind === 'interactionCallback' &&
              request.interactionId === 'interaction-memo-on',
          );
          assert.match(memoOnReply.body.data.content, /Mémoire privée activée/);
          assert.equal(memoOnReply.body.data.flags, MessageFlags.Ephemeral);

          const preference = await db
            .collection('dm_preferences')
            .findOne({ _id: 'user-1' });
          assert.equal(preference.enabled, true);

          discord.dispatchMessage(
            discord.messageData({
              id: 'dm-message-3',
              content: 'after opt-in',
              channelId: 'dm-1',
              guildIdForMessage: null,
              channelType: 1,
              mentionBot: false,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === 'dm-1' &&
              request.body.content === 'echo: after opt-in',
          );

          discord.dispatchMessage(
            discord.messageData({
              id: 'dm-message-4',
              content: 'remember this',
              channelId: 'dm-1',
              guildIdForMessage: null,
              channelType: 1,
              mentionBot: false,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === 'dm-1' &&
              request.body.content === 'echo: remember this',
          );

          assert.deepEqual(deepseek.calls.at(-1).messages, [
            { role: 'user', content: 'after opt-in' },
            { role: 'assistant', content: 'echo: after opt-in' },
            { role: 'user', content: 'remember this' },
          ]);

          const freshMemory = await MemoryStore.connect({
            uri: TEST_MONGODB_URI,
            dbName,
            timeoutMs: 5_000,
            maxHistoryTurns: 2,
            ttlDays: null,
          });
          try {
            assert.deepEqual(await freshMemory.getHistory('dm', 'user-1'), [
              { role: 'user', content: 'after opt-in' },
              { role: 'assistant', content: 'echo: after opt-in' },
              { role: 'user', content: 'remember this' },
              { role: 'assistant', content: 'echo: remember this' },
            ]);
            assert.deepEqual(await freshMemory.getHistory('channel', discord.guildChannelId), [
              { role: 'user', content: 'first question' },
              { role: 'assistant', content: 'echo: first question' },
              { role: 'user', content: 'second question' },
              { role: 'assistant', content: 'echo: second question' },
            ]);
          } finally {
            await freshMemory.close();
          }

          // ---- /memo off: erases private memory ---------------------------
          discord.dispatchCommand({
            interactionId: 'interaction-memo-off',
            commandName: 'memo',
            subcommand: 'off',
            dm: true,
          });
          const memoOffReply = await discord.waitForRequest(
            (request) =>
              request.kind === 'interactionCallback' &&
              request.interactionId === 'interaction-memo-off',
          );
          assert.match(memoOffReply.body.data.content, /historique effacé/);
          assert.equal(
            await db.collection('dm_memories').countDocuments({ _id: 'user-1' }),
            0,
          );

          discord.dispatchMessage(
            discord.messageData({
              id: 'dm-message-5',
              content: 'forgotten',
              channelId: 'dm-1',
              guildIdForMessage: null,
              channelType: 1,
              mentionBot: false,
            }),
          );
          await discord.waitForRequest(
            (request) =>
              request.kind === 'message' &&
              request.channelId === 'dm-1' &&
              request.body.content === 'echo: forgotten',
          );
          assert.deepEqual(deepseek.calls.at(-1).messages, [
            { role: 'user', content: 'forgotten' },
          ]);

          // ---- Guild slash command and the /memo refusal ------------------
          discord.dispatchCommand({
            interactionId: 'interaction-q',
            commandName: 'q',
            options: [{ name: 'prompt', type: 3, value: 'slash question' }],
          });
          const deferred = await discord.waitForRequest(
            (request) =>
              request.kind === 'interactionCallback' &&
              request.interactionId === 'interaction-q',
          );
          assert.equal(deferred.body.type, 5);

          const slashAnswer = await discord.waitForRequest(
            (request) =>
              request.kind === 'editReply' &&
              request.body.content === 'echo: slash question',
          );
          assert.deepEqual(slashAnswer.body.allowed_mentions, { parse: [] });

          discord.dispatchCommand({
            interactionId: 'interaction-memo-guild',
            commandName: 'memo',
            subcommand: 'on',
          });
          const refusal = await discord.waitForRequest(
            (request) =>
              request.kind === 'interactionCallback' &&
              request.interactionId === 'interaction-memo-guild',
          );
          assert.match(refusal.body.data.content, /message privé/);
          assert.equal(refusal.body.data.flags, MessageFlags.Ephemeral);

          // Channel memory was never touched by the DM flows.
          assert.equal(
            await db
              .collection('channel_memories')
              .countDocuments({ _id: 'user-1' }),
            0,
          );
          assert.deepEqual(logger.entries.error, []);
        } finally {
          client.destroy();
          await memory.close();
        }
      });
    } finally {
      await discord.close();
      await deepseek.close();
    }
  },
);
