import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { createDefaultClient, installShutdownHandlers, start } from '../../src/start.js';
import { createFakeClient, createFakeMemory, createLogger } from '../helpers/fakes.js';

function makeProcess() {
  const processRef = new EventEmitter();
  processRef.exits = [];
  processRef.exit = (code) => {
    processRef.exits.push(code);
    processRef.emit('exit', code);
  };
  return processRef;
}

function appConfig(overrides = {}) {
  return {
    discordToken: 'discord-token',
    discordGuildId: 'guild-1',
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'http://127.0.0.1:9999',
    deepseekThinking: 'enabled',
    deepseekEffort: 'max',
    maxHistoryTurns: 2,
    maxPromptChars: 4000,
    mongodbUri: 'mongodb://127.0.0.1:27017',
    mongodbDb: 'test-db',
    mongodbTimeoutMs: 1234,
    memoryTtlDays: 7,
    ...overrides,
  };
}

test('createDefaultClient enables the required intents and channel partials', () => {
  const client = createDefaultClient();

  assert.ok(client instanceof Client);
  for (const intent of [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ]) {
    assert.equal(client.options.intents.has(intent), true);
  }
  assert.ok(client.options.partials.includes(Partials.Channel));

  client.destroy();
});

test('shutdown destroys the client and closes memory exactly once', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory();
  const logger = createLogger();
  const processRef = makeProcess();

  installShutdownHandlers({ client, memory, logger, processRef });

  processRef.emit('SIGINT');
  const [code] = await once(processRef, 'exit');

  assert.equal(code, 0);
  assert.equal(client.destroyed, true);
  assert.ok(memory.calls.some((call) => call.method === 'close'));
  assert.deepEqual(logger.entries.log, ['Received SIGINT; shutting down.']);

  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(processRef.exits, [0]);
  assert.equal(memory.calls.filter((call) => call.method === 'close').length, 1);
});

test('a failed shutdown is logged and exits with a non-zero code', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ failures: { close: 1 } });
  const logger = createLogger();
  const processRef = makeProcess();

  installShutdownHandlers({ client, memory, logger, processRef });

  processRef.emit('SIGTERM');
  const [code] = await once(processRef, 'exit');

  assert.equal(code, 1);
  assert.match(logger.entries.error[0], /Shutdown failed: Error: close failed/);
});

test('start connects MongoDB, logs settings and registers the commands', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ mode: 'mongo' });
  const logger = createLogger();
  const processRef = makeProcess();
  const connectCalls = [];

  const result = await start({
    appConfig: appConfig(),
    createClient: () => client,
    connectMemory: async (options) => {
      connectCalls.push(options);
      return memory;
    },
    logger,
    processRef,
  });

  assert.deepEqual(connectCalls, [
    {
      uri: 'mongodb://127.0.0.1:27017',
      dbName: 'test-db',
      timeoutMs: 1234,
      maxHistoryTurns: 2,
      ttlDays: 7,
    },
  ]);
  assert.equal(result.client, client);
  assert.equal(result.memory, memory);
  assert.equal(typeof result.shutdown, 'function');

  assert.deepEqual(logger.entries.log, [
    'Logged in as TestBot#0001.',
    'DeepSeek: model=deepseek-v4-flash base=http://127.0.0.1:9999 thinking=enabled effort=max',
    'Memory: MongoDB db=test-db ttl=7d.',
    'Registered /q in Guild Name and /memo globally.',
  ]);
  assert.equal(client.globalCommands.length, 1);
  assert.equal(client.globalCommands[0].name, 'memo');
  assert.equal(client.guildCommands.length, 1);
  assert.equal(client.guildCommands[0].name, 'q');

  processRef.emit('SIGINT');
  await once(processRef, 'exit');
  assert.equal(client.destroyed, true);
});

test('start logs MongoDB memory without a TTL when none is configured', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ mode: 'mongo' });
  const logger = createLogger();

  await start({
    appConfig: appConfig({ memoryTtlDays: null }),
    createClient: () => client,
    connectMemory: async () => memory,
    logger,
    processRef: makeProcess(),
  });

  assert.ok(logger.entries.log.includes('Memory: MongoDB db=test-db.'));
});

test('start logs the in-RAM fallback when MongoDB is unavailable', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ mode: 'memory' });
  const logger = createLogger();
  const processRef = makeProcess();

  await start({
    appConfig: appConfig({
      discordGuildId: null,
      deepseekThinking: 'disabled',
      memoryTtlDays: null,
    }),
    createClient: () => client,
    connectMemory: async () => memory,
    logger,
    processRef,
  });

  assert.deepEqual(logger.entries.log, [
    'Logged in as TestBot#0001.',
    'DeepSeek: model=deepseek-v4-flash base=http://127.0.0.1:9999 thinking=disabled',
    'Memory: in-RAM fallback (lost on restart, private memory disabled).',
    'Registered 2 global slash commands (they can take up to an hour to appear).',
  ]);
  assert.deepEqual(
    client.globalCommands.map((command) => command.name),
    ['q', 'memo'],
  );
});

test('start cleans up and rethrows when Discord login fails', async () => {
  const client = createFakeClient();
  client.login = async () => {
    throw new Error('bad token');
  };
  const memory = createFakeMemory();
  const logger = createLogger();

  await assert.rejects(
    start({
      appConfig: appConfig(),
      createClient: () => client,
      connectMemory: async () => memory,
      logger,
      processRef: makeProcess(),
    }),
    /bad token/,
  );

  assert.equal(client.destroyed, true);
  assert.ok(memory.calls.some((call) => call.method === 'close'));
  assert.deepEqual(logger.entries.log, []);
});
