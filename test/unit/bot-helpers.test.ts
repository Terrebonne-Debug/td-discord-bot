import assert from 'node:assert/strict';
import test from 'node:test';
import { Bot } from '../../src/bot/bot.ts';
import { createFakeClient, createLogger } from '../helpers/fakes.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Bot.splitMessage gère les messages vides, courts et exactement à la limite', () => {
  assert.deepEqual(Bot.splitMessage('   '), ['Le modèle a renvoyé une réponse vide.']);
  assert.deepEqual(Bot.splitMessage('  hello  '), ['hello']);

  const exact = 'a'.repeat(2000);
  assert.deepEqual(Bot.splitMessage(exact), [exact]);
});

test('Bot.splitMessage préfère les retours à la ligne, puis les espaces, puis les coupes franches', () => {
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

test('Bot.splitMessage replie sur une coupe franche quand les séparateurs sont trop à gauche', () => {
  const text = `${'a'.repeat(500)}\n${'b'.repeat(2500)}`;
  const chunks = Bot.splitMessage(text);

  assert.equal(chunks[0].length, 2000);
  assert.equal(chunks.join(''), text);
});

test('Bot.stripBotMention retire les mentions et nettoie les espaces', () => {
  assert.equal(Bot.stripBotMention('<@!bot-1> hello', 'bot-1'), 'hello');
  assert.equal(Bot.stripBotMention('<@bot-1> hello <@bot-1>', 'bot-1'), 'hello');
  assert.equal(Bot.stripBotMention('  hello  ', null), 'hello');
  assert.equal(Bot.stripBotMention('  hello  ', undefined), 'hello');
});

test('Bot.describeRequestError priorise les échecs de mémoire', () => {
  assert.match(
    Bot.describeRequestError({ memoryUnavailable: true }),
    /mémoire de conversation est momentanément indisponible/,
  );
  assert.match(Bot.describeRequestError({ status: 429 }), /limite le débit/);
});

test('Bot.startTyping est sans effet sans canal utilisable', () => {
  assert.equal(typeof Bot.startTyping(null), 'function');
  assert.doesNotThrow(() => Bot.startTyping({})());
});

test("Bot.startTyping envoie immédiatement et répète jusqu'à l'arrêt", async () => {
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

test('Bot.startTyping avale les échecs de sendTyping', async () => {
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

test('Bot.registerCommands enregistre chaque commande dans la guilde seulement', async () => {
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
  assert.match(logger.messages('info')[0], /5 commandes slash enregistrées dans Guild Name\./);
});

test('Bot.registerCommands enregistre chaque commande globalement sans identifiant de guilde', async () => {
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
  assert.match(logger.messages('info')[0], /5 commandes slash globales enregistrées/);
});

test('Bot.registerCommands journalise au lieu de lever quand Discord rejette la mise à jour', async () => {
  const client = createFakeClient();
  /**
   * Un échec non-Error (ici une chaîne) couvre aussi la branche de
   * journalisation des rejets inhabituels.
   */
  client.guilds.fetch = async () => {
    throw 'discord en panne';
  };
  const logger = createLogger();

  await Bot.registerCommands(client, { discordGuildId: 'guild-1', maxPromptChars: 4000 }, logger);

  assert.match(
    logger.messages('error')[0],
    /Impossible d'enregistrer les commandes slash : discord en panne/,
  );
});
