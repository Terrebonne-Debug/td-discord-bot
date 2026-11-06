import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Crypto, Limits } from '../constants.ts';
import type { EncryptedTurn } from '../models/crypto/encrypted-turn.ts';
import type { Turn } from '../models/memory/turn.ts';

/**
 * Scelle et descelle les tours de conversation avec AES-256-GCM. Les
 * données authentifiées supplémentaires sont l'identifiant du canal : une
 * entrée copiée dans le document d'un autre canal ne se déchiffre plus.
 *
 * @class MemoryCipher
 */
export class MemoryCipher {
  /**
   * Analyse et valide MEMORY_ENCRYPTION_KEY : 64 caractères hexadécimaux
   * (32 octets), ou null quand elle est absente.
   *
   * @static
   * @function
   * @param {string | null} hex - La clé hexadécimale brute.
   * @returns {Buffer | null} La clé binaire, ou null.
   */
  static parseKey(hex: string | null): Buffer | null {
    if (!hex) return null;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        `MEMORY_ENCRYPTION_KEY doit contenir ${Limits.memoryEncryptionKeyHexLength} caractères hexadécimaux (${Limits.memoryEncryptionKeyBytes} octets).`,
      );
    }
    return Buffer.from(hex, 'hex');
  }

  /**
   * @static
   * @function
   * @param {unknown} value - L'entrée à inspecter.
   * @returns {boolean} Vrai pour une entrée scellée.
   */
  static isEncryptedTurn(value: unknown): value is EncryptedTurn {
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

  /** @type {Buffer} La clé de chiffrement binaire. */
  #key: Buffer;

  /**
   * @constructor
   * @param {Buffer} key - La clé de chiffrement (32 octets).
   */
  constructor(key: Buffer) {
    this.#key = key;
  }

  /**
   * Scelle un tour pour le stockage en base.
   *
   * @method
   * @param {Turn['role']} role - Le rôle du tour.
   * @param {string} content - Le contenu du tour.
   * @param {string} aad - L'identifiant du canal (données authentifiées).
   * @returns {EncryptedTurn} L'entrée scellée.
   */
  encryptTurn(role: Turn['role'], content: string, aad: string): EncryptedTurn {
    const iv = randomBytes(12);
    const cipher = createCipheriv(Crypto.algorithm, this.#key, iv);
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

  /**
   * Descelle une entrée ; lève une erreur si l'entrée a été altérée, si la
   * clé est fausse ou si les données authentifiées diffèrent.
   *
   * @method
   * @param {EncryptedTurn} entry - L'entrée scellée.
   * @param {string} aad - L'identifiant du canal.
   * @returns {Turn} Le tour en clair.
   * @throws Quand l'authentification échoue.
   */
  decryptTurn(entry: EncryptedTurn, aad: string): Turn {
    const decipher = createDecipheriv(Crypto.algorithm, this.#key, Buffer.from(entry.iv, 'hex'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, 'hex')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as Turn;
  }
}
