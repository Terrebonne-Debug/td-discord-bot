import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { Launcher } from '../../src/startup/launcher.ts';
import type { MemoryConnectOptions } from '../../src/models/memory/memory-connect-options.ts';
import type { ProcessLike } from '../../src/models/start/process-like.ts';
import type { StartupConfig } from '../../src/models/start/startup-config.ts';
import { createFakeClient, createFakeMemory, createLogger } from '../helpers/fakes.ts';

function makeProcess(): EventEmitter & { exits: number[]; exit(code: number): void } {
  const processRef = new EventEmitter();
  const fake = Object.assign(processRef, {
    exits: [] as number[],
    exit(code: number) {
      fake.exits.push(code);
      fake.emit('exit', code);
    },
  });
  return fake as EventEmitter & { exits: number[]; exit(code: number): void };
}

function appConfig(overrides: Partial<StartupConfig> = {}): StartupConfig {
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
    memoryEncryptionKey: 'e'.repeat(64),
    logLevel: 'info',
    githubToken: 'gh-token',
    githubRepository: 'Terrebonne-Debug/td-discord-bot',
    ...overrides,
  };
}

test('Launcher.createDefaultClient active les intents requis et les partials de canal', () => {
  const client = Launcher.createDefaultClient();

  assert.ok(client instanceof Client);
  for (const intent of [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ]) {
    assert.equal(client.options.intents.has(intent), true);
  }
  assert.ok(client.options.partials?.includes(Partials.Channel));

  client.destroy();
});

test('l\'arrêt détruit le client et ferme la mémoire exactement une fois', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory();
  const logger = createLogger();
  const processRef = makeProcess();

  Launcher.installShutdownHandlers({ client, memory, logger, processRef });

  processRef.emit('SIGINT');
  const [code] = await once(processRef, 'exit');

  assert.equal(code, 0);
  assert.equal(client.destroyed, true);
  assert.ok(memory.calls.some((call) => call.method === 'close'));
  assert.deepEqual(logger.messages('info'), [
    'Reçu SIGINT ; arrêt en cours.',
    'Arrêt terminé',
  ]);

  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(processRef.exits, [0]);
  assert.equal(memory.calls.filter((call) => call.method === 'close').length, 1);
});

test('un arrêt échoué est journalisé et sort avec un code non nul', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ failures: { close: 1 } });
  const logger = createLogger();
  const processRef = makeProcess();

  Launcher.installShutdownHandlers({ client, memory, logger, processRef });

  processRef.emit('SIGTERM');
  const [code] = await once(processRef, 'exit');

  assert.equal(code, 1);
  assert.match(logger.messages('error')[0], /Échec de l'arrêt : Error: close a échoué/);
});

test('Launcher.start connecte MongoDB, journalise les réglages et enregistre les commandes', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ mode: 'mongo' });
  const logger = createLogger();
  const processRef = makeProcess();
  const connectCalls: MemoryConnectOptions[] = [];

  const result = await new Launcher({
    appConfig: appConfig(),
    createClient: () => client,
    connectMemory: async (options) => {
      connectCalls.push(options);
      return memory;
    },
    logger,
    processRef,
  }).start();

  assert.deepEqual(connectCalls, [
    {
      uri: 'mongodb://127.0.0.1:27017',
      dbName: 'test-db',
      timeoutMs: 1234,
      maxHistoryTurns: 2,
      ttlDays: 7,
      encryptionKey: Buffer.from('e'.repeat(64), 'hex'),
      logger,
    },
  ]);
  assert.equal(result.client, client);
  assert.equal(result.memory, memory);
  assert.equal(typeof result.shutdown, 'function');

  assert.deepEqual(logger.messages('info'), [
    'Démarrage du bot',
    'Connecté en tant que TestBot#0001.',
    'DeepSeek : modèle=deepseek-v4-flash base=http://127.0.0.1:9999 réflexion=enabled effort=max',
    'Mémoire : MongoDB base=test-db ttl=7j.',
    '5 commandes slash enregistrées dans Guild Name.',
  ]);
  assert.equal(client.globalCommands.length, 0);
  assert.equal(client.guildCommands.length, 5);
  assert.equal(client.guildCommands[0].name, 'q');

  processRef.emit('SIGINT');
  await once(processRef, 'exit');
  assert.equal(client.destroyed, true);
});

test('Launcher.start journalise la mémoire MongoDB sans TTL quand aucun n\'est configuré', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ mode: 'mongo' });
  const logger = createLogger();

  await new Launcher({
    appConfig: appConfig({ memoryTtlDays: null }),
    createClient: () => client,
    connectMemory: async () => memory,
    logger,
    processRef: makeProcess(),
  }).start();

  assert.ok(logger.messages('info').includes('Mémoire : MongoDB base=test-db.'));
});

test('Launcher.start journalise le repli en RAM quand MongoDB est indisponible', async () => {
  const client = createFakeClient();
  const memory = createFakeMemory({ mode: 'memory' });
  const logger = createLogger();
  const processRef = makeProcess();

  await new Launcher({
    appConfig: appConfig({
      discordGuildId: null,
      deepseekThinking: 'disabled',
      memoryTtlDays: null,
    }),
    createClient: () => client,
    connectMemory: async () => memory,
    logger,
    processRef,
  }).start();

  assert.deepEqual(logger.messages('info'), [
    'Démarrage du bot',
    'Connecté en tant que TestBot#0001.',
    'DeepSeek : modèle=deepseek-v4-flash base=http://127.0.0.1:9999 réflexion=disabled',
    'Mémoire : repli en RAM (perdue au redémarrage).',
    '5 commandes slash globales enregistrées (elles peuvent mettre jusqu\'à une heure à apparaître).',
  ]);
  assert.deepEqual(
    client.globalCommands.map((command) => command.name),
    ['q', 'version', 'aide', 'help', 'feature-request'],
  );
});

test('Launcher.start nettoie et relève l\'erreur quand la connexion Discord échoue', async () => {
  const client = createFakeClient();
  client.login = async () => {
    throw new Error('bad token');
  };
  const memory = createFakeMemory();
  const logger = createLogger();

  await assert.rejects(
    new Launcher({
      appConfig: appConfig(),
      createClient: () => client,
      connectMemory: async () => memory,
      logger,
      processRef: makeProcess(),
    }).start(),
    /bad token/,
  );

  assert.equal(client.destroyed, true);
  assert.ok(memory.calls.some((call) => call.method === 'close'));
  assert.deepEqual(logger.messages('info'), ['Démarrage du bot']);
});
