import { MongoClient } from 'mongodb';

export const TEST_MONGODB_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017';

let counter = 0;

export function uniqueDbName(prefix = 'td-bot-test') {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

/**
 * Connect to the test MongoDB, expose a raw client and an isolated database,
 * then drop that database and disconnect on the way out.
 */
export async function withMongo(fn) {
  const client = new MongoClient(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const dbName = uniqueDbName();

  try {
    return await fn({ client, db: client.db(dbName), dbName });
  } finally {
    await client.db(dbName).dropDatabase().catch(() => {});
    await client.close();
  }
}
