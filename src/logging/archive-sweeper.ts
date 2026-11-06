import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { Logging } from '../constants.ts';

/**
 * Compresse les fichiers journaux dont la rotation est terminée et supprime
 * les archives plus vieilles que la rétention. Le fichier actif du jour
 * n'est jamais touché. Le balayage n'échoue jamais : un fichier illisible
 * est laissé pour le prochain passage. Toute la logique vit dans la classe :
 * aucune fonction libre.
 *
 * @class ArchiveSweeper
 */
export class ArchiveSweeper {
  /** @type {RegExp} Fichiers produits par la rotation : bot-AAAA-MM-JJ.log[.n]. */
  static #filenamePattern = /^bot-\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/;

  /** @type {number} L'intervalle quotidien de balayage, en millisecondes. */
  static #sweepIntervalMs = Logging.sweepIntervalMs;

  /**
   * Nom du fichier journal actif pour une date donnée (yyyy-MM-dd).
   *
   * @static
   * @function
   * @param {string} date - La date au format yyyy-MM-dd.
   * @returns {string} Le nom du fichier actif.
   */
  static activeLogFilename(date: string): string {
    return `bot-${date}.log`;
  }

  /**
   * Un fichier est archivé s'il vient de la rotation et n'est pas l'actif.
   *
   * @static
   * @function
   * @param {string} name - Le nom du fichier.
   * @param {string} activeName - Le nom du fichier actif.
   * @returns {boolean} Vrai si le fichier doit être archivé.
   */
  static isArchivableLogFile(name: string, activeName: string): boolean {
    return ArchiveSweeper.#filenamePattern.test(name) && name !== activeName;
  }

  /**
   * La date du jour au format yyyy-MM-dd, alignée sur le pattern %DATE%.
   *
   * @function
   * @param {Date} now - L'instant courant.
   * @returns {string} La date formatée.
   */
  static #todayAsFilename(now: Date): string {
    return new Intl.DateTimeFormat(Logging.dateFormat).format(now);
  }

  /**
   * Compresse un fichier en .gz puis supprime l'original.
   *
   * @function
   * @param {string} filePath - Le fichier à compresser.
   * @returns {Promise<void>}
   */
  static async #gzipFile(filePath: string): Promise<void> {
    const gzPath = `${filePath}${Logging.gzipExtension}`;
    await pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzPath));
    await unlink(filePath);
  }

  /** @type {string} Le dossier des journaux. */
  #logDir: string;
  /** @type {number} La rétention en jours. */
  #retentionDays: number;

  /**
   * @constructor
   * @param {string} logDir - Le dossier des journaux.
   * @param {number} retentionDays - La rétention en jours.
   */
  constructor(logDir: string, retentionDays: number) {
    this.#logDir = logDir;
    this.#retentionDays = retentionDays;
  }

  /**
   * Balaye une fois : compresse les rotations terminées, purge les archives
   * expirées.
   *
   * @method
   * @param {Date} [now=new Date()] - L'instant de référence.
   * @returns {Promise<void>}
   */
  async sweep(now: Date = new Date()): Promise<void> {
    const names = await readdir(this.#logDir).catch(() => [] as string[]);
    const activeName = ArchiveSweeper.activeLogFilename(ArchiveSweeper.#todayAsFilename(now));
    const cutoffMs = now.getTime() - this.#retentionDays * 86_400_000;

    for (const name of names) {
      const filePath = path.join(this.#logDir, name);

      if (ArchiveSweeper.isArchivableLogFile(name, activeName)) {
        try {
          await ArchiveSweeper.#gzipFile(filePath);
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
    const timer = setInterval(run, ArchiveSweeper.#sweepIntervalMs);
    timer.unref();
  }
}
