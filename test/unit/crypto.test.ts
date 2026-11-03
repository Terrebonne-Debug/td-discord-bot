import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { decryptTurn, encryptTurn, isEncryptedTurn, parseMemoryKey } from '../../src/crypto.ts';

const key = randomBytes(32);
const otherKey = randomBytes(32);

test('encryptTurn and decryptTurn round-trip through the sealed entry', () => {
  const entry = encryptTurn('user', 'contenu secret', key, 'channel-1');

  assert.equal(isEncryptedTurn(entry), true);
  assert.equal(entry.iv.length, 24);
  assert.equal(entry.ciphertext.length > 0, true);
  assert.equal(entry.authTag.length, 32);

  assert.deepEqual(decryptTurn(entry, key, 'channel-1'), {
    role: 'user',
    content: 'contenu secret',
  });
});

test('decryptTurn rejects a tampered entry', () => {
  const entry = encryptTurn('assistant', 'réponse', key, 'channel-1');
  const tampered = {
    ...entry,
    ciphertext: `${entry.ciphertext[0] === '0' ? '1' : '0'}${entry.ciphertext.slice(1)}`,
  };

  assert.throws(() => decryptTurn(tampered, key, 'channel-1'));
});

test('decryptTurn rejects the wrong key', () => {
  const entry = encryptTurn('user', 'secret', key, 'channel-1');

  assert.throws(() => decryptTurn(entry, otherKey, 'channel-1'));
});

test('decryptTurn rejects the wrong channel (AAD)', () => {
  const entry = encryptTurn('user', 'secret', key, 'channel-1');

  assert.throws(() => decryptTurn(entry, key, 'autre-canal'));
});

test('parseMemoryKey accepts null and 64 hex characters, rejects the rest', () => {
  assert.equal(parseMemoryKey(null), null);
  assert.equal(parseMemoryKey(''), null);

  const parsed = parseMemoryKey('ab'.repeat(32));
  assert.ok(parsed instanceof Buffer);
  assert.equal(parsed.length, 32);

  assert.throws(() => parseMemoryKey('abc'), /64 hexadecimal characters/);
  assert.throws(() => parseMemoryKey('z'.repeat(64)), /64 hexadecimal characters/);
});

test('isEncryptedTurn only matches sealed entries', () => {
  assert.equal(isEncryptedTurn({ iv: 'aa', ciphertext: 'bb', authTag: 'cc' }), true);
  assert.equal(isEncryptedTurn({ role: 'user', content: 'clair' }), false);
  assert.equal(isEncryptedTurn({ iv: 1, ciphertext: 'bb', authTag: 'cc' }), false);
  assert.equal(isEncryptedTurn(null), false);
});
