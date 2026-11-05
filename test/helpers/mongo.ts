import type { Collection, Db } from 'mongodb';
import { MongoClient } from 'mongodb';

export const TEST_MONGODB_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017';

/**
 * Les collections du bot sont indexées par des identifiants en chaînes
 * (identifiant de canal ou d'utilisateur). Le type Document par défaut du
 * pilote attend un ObjectId : les tests utilisent donc cet accesseur typé
 * au lieu de db.collection() directement.
 *
 * @function
 * @param {Db} db - La base de données.
 * @param {string} name - Le nom de la collection.
 * @returns {Collection<{ _id: string; [key: string]: any }>} La collection typée.
 */
export function collection(db: Db, name: string): Collection<{ _id: string; [key: string]: any }> {
  return db.collection(name);
}

let counter = 0;

export function uniqueDbName(prefix = 'td-bot-test'): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

/**
 * Connecte au MongoDB de test, expose un client brut et une base isolée,
 * puis supprime cette base et se déconnecte en sortant.
 *
 * @function
 * @param {(context: { client: MongoClient; db: Db; dbName: string }) => Promise<unknown>} fn - Le test à exécuter.
 * @returns {Promise<unknown>} Le résultat du test.
 */
export async function withMongo(
  fn: (context: { client: MongoClient; db: Db; dbName: string }) => Promise<unknown>,
): Promise<unknown> {
  const client = new MongoClient(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const dbName = uniqueDbName();

  try {
    return await fn({ client, db: client.db(dbName), dbName });
  } finally {
    await client
      .db(dbName)
      .dropDatabase()
      .catch(() => {});
    await client.close();
  }
}
