import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { createBot, registerCommands } from '../../src/bot.ts';
import { parseMemoryKey } from '../../src/crypto.ts';
import { askDeepSeek, createDeepSeekClient } from '../../src/deepseek.ts';
import { MemoryStore } from '../../src/memory.ts';
import type { DeepSeekSettings } from '../../src/models/deepseek/deepseek-settings.ts';
import type { Turn } from '../../src/models/memory/turn.ts';
import { startFakeDeepSeek } from '../helpers/fake-deepseek-server.ts';
import { startFakeDiscord } from '../helpers/fake-discord-server.ts';
import type { FakeDiscord } from '../helpers/fake-discord-server.ts';
import { createLogger } from '../helpers/fakes.ts';
import { collection, TEST_MONGODB_URI, withMongo } from '../helpers/mongo.ts';

const TEST_KEY = parseMemoryKey('ab'.repeat(32))!;

const settings: DeepSeekSettings & {
  maxHistoryTurns: number;
  maxPromptChars: number;
  discordGuildId: string;
  githubToken: string;
  githubRepository: string;
} = {
  deepseekModel: 'deepseek-v4-flash',
  deepseekMaxTokens: 512,
  deepseekThinking: 'disabled',
  deepseekEffort: 'max',
  deepseekTemperature: 0.2,
  systemPrompt: 'E2E system prompt',
  maxHistoryTurns: 2,
  maxPromptChars: 4000,
  discordGuildId: 'guild-1',
  githubToken: 'gh-token',
  githubRepository: 'Terrebonne-Debug/td-discord-bot',
};

function makeClient(discord: FakeDiscord): Client {
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
  'real discord.js client + MongoDB memory + DeepSeek SDK: channels share memory, DMs store nothing',
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
          encryptionKey: TEST_KEY,
        });
        assert.equal(memory.mode, 'mongo');

        const client = makeClient(discord);
        const anthropic = createDeepSeekClient({
          deepseekApiKey: 'test-key',
          deepseekBaseUrl: deepseek.url,
          deepseekTimeoutMs: 5_000,
        });
        const ask = (history: Turn[], prompt: string) =>
          askDeepSeek(history, prompt, anthropic, settings);

        const issues: Array<{ title: string; body: string }> = [];
        createBot({
          client,
          memory,
          settings,
          ask,
          buildInfo: { version: '9.9.9', commit: 'abc1234' },
          createIssue: async (title, body) => {
            issues.push({ title, body });
            return 'https://github.com/owner/repo/issues/7';
          },
          logger,
        });

        const ready = once(client, Events.ClientReady);
        await client.login('test-discord-token');
        await ready;

        try {
          await registerCommands(client, settings, logger);

          const guildCommands = await discord.waitForRequest(
            (request) => request.kind === 'guildCommands',
          );
          assert.deepEqual(
            guildCommands.body.map((command: Record<string, any>) => command.name),
            ['q', 'version', 'aide', 'help', 'feature-request'],
          );

          // ---- Public channel: shared memory ------------------------------
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

          // The channel history is really in MongoDB — encrypted at rest.
          const channelDoc = await collection(db, 'channel_memories').findOne({
            _id: discord.guildChannelId,
          });
          assert.ok(channelDoc);
          const raw = JSON.stringify(channelDoc.turns);
          assert.equal(raw.includes('first question'), false, 'aucun prompt en clair');
          assert.equal(raw.includes('second question'), false, 'aucun prompt en clair');
          assert.equal(channelDoc.turns.length, 4);
          for (const turn of channelDoc.turns) {
            assert.equal(typeof turn.iv, 'string');
            assert.equal(typeof turn.ciphertext, 'string');
            assert.equal(typeof turn.authTag, 'string');
          }

          // ---- DM: answered, but nothing is ever stored -------------------
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

          assert.deepEqual(deepseek.calls.at(-1)!.messages, [
            { role: 'user', content: 'private hello' },
          ]);
          assert.equal(
            await collection(db, 'dm_memories').countDocuments({ _id: 'user-1' }),
            0,
          );

          // A second DM also has no memory of the first.
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
          assert.deepEqual(deepseek.calls.at(-1)!.messages, [
            { role: 'user', content: 'second private' },
          ]);

          // The channel history survived all the DM traffic.
          const freshMemory = await MemoryStore.connect({
            uri: TEST_MONGODB_URI,
            dbName,
            timeoutMs: 5_000,
            maxHistoryTurns: 2,
            ttlDays: null,
            encryptionKey: TEST_KEY,
          });
          try {
            assert.deepEqual(await freshMemory.getHistory(discord.guildChannelId), [
              { role: 'user', content: 'first question' },
              { role: 'assistant', content: 'echo: first question' },
              { role: 'user', content: 'second question' },
              { role: 'assistant', content: 'echo: second question' },
            ]);
          } finally {
            await freshMemory.close();
          }

          // With another key, the stored history is unreadable.
          const wrongKeyMemory = await MemoryStore.connect({
            uri: TEST_MONGODB_URI,
            dbName,
            timeoutMs: 5_000,
            maxHistoryTurns: 2,
            ttlDays: null,
            encryptionKey: parseMemoryKey('cd'.repeat(32)),
            logger,
          });
          try {
            assert.deepEqual(await wrongKeyMemory.getHistory(discord.guildChannelId), []);
          } finally {
            await wrongKeyMemory.close();
          }

          // ---- Guild slash command ----------------------------------------
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

          // ---- /version and /feature-request ------------------------------
          discord.dispatchCommand({
            interactionId: 'interaction-version',
            commandName: 'version',
          });
          const versionReply = await discord.waitForRequest(
            (request) =>
              request.kind === 'interactionCallback' &&
              request.interactionId === 'interaction-version',
          );
          assert.match(versionReply.body.data.content, /9\.9\.9/);
          assert.match(versionReply.body.data.content, /abc1234/);

          // ---- /feature-request : commande, modal, création d'issue ---------
          discord.dispatchCommand({
            interactionId: 'interaction-feature',
            commandName: 'feature-request',
          });
          const modalCallback = await discord.waitForRequest(
            (request) =>
              request.kind === 'interactionCallback' &&
              request.interactionId === 'interaction-feature',
          );
          assert.equal(modalCallback.body.type, 9);
          assert.equal(modalCallback.body.data.custom_id, 'feature-request');

          discord.dispatchModalSubmit({
            interactionId: 'interaction-feature-modal',
            customId: 'feature-request',
            title: 'Un mode quiz',
            description: 'Ajouter des quiz générés par IA.',
          });

          await discord.waitForRequest(
            (request) =>
              request.kind === 'editReply' &&
              request.body.content ===
                'Demande créée : https://github.com/owner/repo/issues/7',
          );
          assert.deepEqual(issues, [
            {
              title: 'Un mode quiz',
              body: '**Demande**\n\nAjouter des quiz générés par IA.\n\n---\nDemandé depuis Discord par Alice.',
            },
          ]);

          // Channel memory was never touched by the DM flows.
          assert.equal(
            await collection(db, 'channel_memories').countDocuments({ _id: 'user-1' }),
            0,
          );
          assert.deepEqual(logger.messages('error'), []);
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
