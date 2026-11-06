import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureRequestCreated,
  keepQuestionsUnder,
  LogMessages,
  Messages,
  versionReply,
} from '../../src/constants.ts';

test('LogMessages.startupFailed formate le message de démarrage', () => {
  assert.equal(
    LogMessages.startupFailed('jeton invalide'),
    'Échec du démarrage du bot : jeton invalide',
  );
});

test('les gabarits de messages utilisateur sont stables', () => {
  assert.equal(keepQuestionsUnder(50), 'Garde tes questions sous 50 caractères.');
  assert.equal(
    featureRequestCreated('https://github.com/owner/repo/issues/7'),
    'Demande créée : https://github.com/owner/repo/issues/7',
  );
  assert.equal(versionReply('1.2.3', 'abc1234'), '**td-discord-bot 1.2.3**\nCommit : `abc1234`');
});

test('les messages de base sont en français', () => {
  assert.match(Messages.mentionPrompt, /Mentionne-moi/);
  assert.match(LogMessages.botStartup, /Démarrage du bot/);
});
