// Utilitaire hors-ligne : affiche la mémoire déchiffrée d'un canal public.
//
//   node scripts/decrypt-memory.ts <channelId>
//
// Lit MONGODB_URI, MONGODB_DB et MEMORY_ENCRYPTION_KEY depuis l'environnement
// (ou .env). Les entrées encore en clair (avant l'activation du chiffrement)
// sont affichées telles quelles ; une entrée chiffrée sans clé valide est
// signalée à sa place. Ce script ne fait rien d'autre.

import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { decryptTurn, isEncryptedTurn, parseMemoryKey } from '../src/crypto.ts';
import type { Turn } from '../src/models/memory/turn.ts';

const channelId = process.argv[2];
const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB?.trim() || 'td-discord-bot';
const key = parseMemoryKey(process.env.MEMORY_ENCRYPTION_KEY?.trim() || null);

type PrintableTurn = Turn | { role: string; content: string };

function printableTurns(turns: unknown, aad: string): PrintableTurn[] {
  if (!Array.isArray(turns)) return [];

  return turns.map((turn): PrintableTurn => {
    if (isEncryptedTurn(turn)) {
      if (!key) {
        return { role: '?', content: '<entrée chiffrée sans clé (définir MEMORY_ENCRYPTION_KEY)>' };
      }
      try {
        return decryptTurn(turn, key, aad);
      } catch {
        return { role: '?', content: '<déchiffrement impossible (entrée altérée ou mauvaise clé)>' };
      }
    }
    return turn as Turn;
  });
}

if (!channelId) {
  console.error('Usage : node scripts/decrypt-memory.ts <channelId>');
  process.exitCode = 1;
} else if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exitCode = 1;
} else {
  const client = new MongoClient(uri, {
    appName: 'td-discord-bot-decrypt',
    serverSelectionTimeoutMS: 5_000,
  });

  try {
    await client.connect();
    const doc = await client
      .db(dbName)
      .collection<{ _id: string; turns?: unknown }>('channel_memories')
      .findOne({ _id: channelId });

    if (!doc) {
      console.error(`Aucune mémoire pour le canal ${channelId}.`);
      process.exitCode = 1;
    } else {
      const turns = printableTurns(doc.turns, channelId);
      console.log(JSON.stringify({ channelId, turns }, null, 2));
    }
  } catch (error) {
    console.error(`Échec de la lecture : ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
