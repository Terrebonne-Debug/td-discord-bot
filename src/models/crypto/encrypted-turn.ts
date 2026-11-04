/**
 * A turn entry as stored in MongoDB: the {role, content} JSON sealed with
 * AES-256-GCM. The additional authenticated data is the channel id, so an
 * entry copied into another channel's document no longer decrypts.
 */
export interface EncryptedTurn {
  iv: string;
  ciphertext: string;
  authTag: string;
}
