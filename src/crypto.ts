import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedTurn } from './models/crypto/encrypted-turn.ts';
import type { Turn } from './models/memory/turn.ts';

export function isEncryptedTurn(value: unknown): value is EncryptedTurn {
  return (
    typeof value === 'object' &&
    value !== null &&
    'iv' in value &&
    'ciphertext' in value &&
    'authTag' in value &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string' &&
    typeof value.authTag === 'string'
  );
}

/**
 * Parses and validates MEMORY_ENCRYPTION_KEY: 64 hexadecimal characters
 * (32 bytes), or null when unset.
 */
export function parseMemoryKey(hex: string | null): Buffer | null {
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('MEMORY_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptTurn(
  role: Turn['role'],
  content: string,
  key: Buffer,
  aad: string,
): EncryptedTurn {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ role, content }), 'utf8'),
    cipher.final(),
  ]);

  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

/** Throws when the entry was tampered with, the key is wrong or the AAD differs. */
export function decryptTurn(entry: EncryptedTurn, key: Buffer, aad: string): Turn {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as Turn;
}
