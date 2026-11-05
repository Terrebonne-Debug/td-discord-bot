/**
 * Une entrée de tour telle que stockée dans MongoDB : le JSON {role, content}
 * scellé avec AES-256-GCM. Les données authentifiées supplémentaires sont
 * l'identifiant du canal : une entrée copiée dans le document d'un autre
 * canal ne se déchiffre plus.
 *
 * @interface
 */
export interface EncryptedTurn {
  iv: string;
  ciphertext: string;
  authTag: string;
}
