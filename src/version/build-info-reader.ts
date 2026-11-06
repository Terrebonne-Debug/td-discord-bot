import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Version } from '../constants.ts';
import type { BuildInfo } from '../models/version/build-info.ts';

function defaultRunGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

/**
 * Lit la version npm depuis package.json et le hash court du commit depuis
 * git, résolus une fois au démarrage. Git ou package.json manquants
 * dégradent en « inconnu » plutôt que d'échouer le démarrage.
 *
 * @class BuildInfoReader
 */
export class BuildInfoReader {
  /** @type {string} Le répertoire de travail à inspecter. */
  #cwd: string;
  /** @type {(args: string[], cwd: string) => string} La commande git injectée. */
  #runGit: (args: string[], cwd: string) => string;

  /**
   * @constructor
   * @param {string} [cwd=process.cwd()] - Le répertoire à inspecter.
   * @param {(args: string[], cwd: string) => string} [runGit=defaultRunGit] - La commande git.
   */
  constructor({
    cwd = process.cwd(),
    runGit = defaultRunGit,
  }: {
    cwd?: string;
    runGit?: (args: string[], cwd: string) => string;
  } = {}) {
    this.#cwd = cwd;
    this.#runGit = runGit;
  }

  /**
   * Lit la version et le commit.
   *
   * @method
   * @returns {BuildInfo} La version et le commit de cette compilation.
   */
  read(): BuildInfo {
    let version: string = Version.unknownVersion;
    try {
      const packageJson = JSON.parse(
        readFileSync(path.join(this.#cwd, Version.packageFilename), 'utf8'),
      ) as { version?: string };
      version = packageJson.version ?? Version.unknownVersion;
    } catch {
      /** Déploiement sans package.json : la version reste inconnue. */
    }

    let commit: string = Version.unknownCommit;
    try {
      commit = this.#runGit(['rev-parse', '--short', 'HEAD'], this.#cwd).trim();
    } catch {
      /** Pas de dépôt git (déploiement hors source) : le commit reste inconnu. */
    }

    return { version, commit };
  }
}
