import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/** Fichiers produits par la rotation : bot-AAAA-MM-JJ.log[.n]. */
const LOG_FILENAME_PATTERN = /^bot-\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/;

const ARCHIVE_SWEEP_INTERVAL_MS = 24 * 3_600_000;

/** La date du jour au format yyyy-MM-dd, alignée sur le pattern %DATE%. */
function todayAsFilename(now: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(now);
}

async function gzipFile(filePath: string): Promise<void> {
  const gzPath = `${filePath}.gz`;
  await pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzPath));
  await unlink(filePath);
}

/**
 * Compresse les fichiers journaux dont la rotation est terminée et supprime
 * les archives plus vieilles que la rétention. Le fichier actif du jour
 * n'est jamais touché. Le balayage n'échoue jamais : un fichier illisible
 * est laissé pour le prochain passage.
 *
 * @class
 */
export class ArchiveSweeper {
  /** Nom du fichier journal actif pour une date donnée (yyyy-MM-dd). */
  static activeLogFilename(date: string): string {
    return `bot-${date}.log`;
  }

  /** Un fichier est archivé s'il vient de la rotation et n'est pas l'actif. */
  static isArchivableLogFile(name: string, activeName: string): boolean {
    return LOG_FILENAME_PATTERN.test(name) && name !== activeName;
  }

  #logDir: string;
  #retentionDays: number;

  constructor(logDir: string, retentionDays: number) {
    this.#logDir = logDir;
    this.#retentionDays = retentionDays;
  }

  async sweep(now: Date = new Date()): Promise<void> {
    const names = await readdir(this.#logDir).catch(() => [] as string[]);
    const activeName = ArchiveSweeper.activeLogFilename(todayAsFilename(now));
    const cutoffMs = now.getTime() - this.#retentionDays * 86_400_000;

    for (const name of names) {
      const filePath = path.join(this.#logDir, name);

      if (ArchiveSweeper.isArchivableLogFile(name, activeName)) {
        try {
          await gzipFile(filePath);
        } catch {
          /**
           * Fichier inatteignable (rotation concurrente…) : le prochain
           * balayage réessaiera.
           */
        }
        continue;
      }

      if (name.endsWith('.gz')) {
        try {
          if ((await stat(filePath)).mtimeMs < cutoffMs) {
            await unlink(filePath);
          }
        } catch {
          /** L'archive a pu disparaître entre le listage et l'effacement. */
        }
      }
    }
  }

  /**
   * Balaye immédiatement puis chaque jour, sans jamais bloquer l'arrêt du
   * bot. Le balayage n'échoue jamais, aucun gestionnaire n'est requis ici.
   *
   * @method
   * @returns {void}
   */
  start(): void {
    const run = () => {
      void this.sweep();
    };

    run();
    const timer = setInterval(run, ARCHIVE_SWEEP_INTERVAL_MS);
    timer.unref();
  }
}

