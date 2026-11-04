import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MemoryCipher } from '../../src/crypto/memory-cipher.ts';

const key = randomBytes(32);
const otherKey = randomBytes(32);
const cipher = new MemoryCipher(key);

test('MemoryCipher encryptTurn and decryptTurn round-trip through the sealed entry', () => {
  const entry = cipher.encryptTurn('user', 'contenu secret', 'channel-1');

  assert.equal(MemoryCipher.isEncryptedTurn(entry), true);
  assert.equal(entry.iv.length, 24);
  assert.equal(entry.ciphertext.length > 0, true);
  assert.equal(entry.authTag.length, 32);

  assert.deepEqual(cipher.decryptTurn(entry, 'channel-1'), {
    role: 'user',
    content: 'contenu secret',
  });
});

test('MemoryCipher decryptTurn rejects a tampered entry', () => {
  const entry = cipher.encryptTurn('assistant', 'réponse', 'channel-1');
  const tampered = {
    ...entry,
    ciphertext: `${entry.ciphertext[0] === '0' ? '1' : '0'}${entry.ciphertext.slice(1)}`,
  };

  assert.throws(() => cipher.decryptTurn(tampered, 'channel-1'));
});

test('MemoryCipher decryptTurn rejects the wrong key', () => {
  const entry = cipher.encryptTurn('user', 'secret', 'channel-1');

  assert.throws(() => new MemoryCipher(otherKey).decryptTurn(entry, 'channel-1'));
});

test('MemoryCipher decryptTurn rejects the wrong channel (AAD)', () => {
  const entry = cipher.encryptTurn('user', 'secret', 'channel-1');

  assert.throws(() => cipher.decryptTurn(entry, 'autre-canal'));
});

test('MemoryCipher.parseKey accepts null and 64 hex characters, rejects the rest', () => {
  assert.equal(MemoryCipher.parseKey(null), null);
  assert.equal(MemoryCipher.parseKey(''), null);

  const parsed = MemoryCipher.parseKey('ab'.repeat(32));
  assert.ok(parsed instanceof Buffer);
  assert.equal(parsed.length, 32);

  assert.throws(() => MemoryCipher.parseKey('abc'), /64 hexadecimal characters/);
  assert.throws(() => MemoryCipher.parseKey('z'.repeat(64)), /64 hexadecimal characters/);
});

test('MemoryCipher.isEncryptedTurn only matches sealed entries', () => {
  assert.equal(MemoryCipher.isEncryptedTurn({ iv: 'aa', ciphertext: 'bb', authTag: 'cc' }), true);
  assert.equal(MemoryCipher.isEncryptedTurn({ role: 'user', content: 'clair' }), false);
  assert.equal(MemoryCipher.isEncryptedTurn({ iv: 1, ciphertext: 'bb', authTag: 'cc' }), false);
  assert.equal(MemoryCipher.isEncryptedTurn(null), false);
});
