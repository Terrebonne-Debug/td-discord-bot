import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BuildInfo } from '../models/version/build-info.ts';

function defaultRunGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).toString();
}

/**
 * Reads the npm version from package.json and the short commit hash from git,
 * both resolved once at startup. Missing git or package.json degrade to
 * 'unknown' instead of failing the boot.
 */
export class BuildInfoReader {
  #cwd: string;
  #runGit: (args: string[], cwd: string) => string;

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

  read(): BuildInfo {
    let version = 'unknown';
    try {
      const packageJson = JSON.parse(
        readFileSync(path.join(this.#cwd, 'package.json'), 'utf8'),
      ) as { version?: string };
      version = packageJson.version ?? 'unknown';
    } catch {
      /** Déploiement sans package.json : la version reste inconnue. */
    }

    let commit = 'unknown';
    try {
      commit = this.#runGit(['rev-parse', '--short', 'HEAD'], this.#cwd).trim();
    } catch {
      /** Pas de dépôt git (déploiement hors source) : le commit reste inconnu. */
    }

    return { version, commit };
  }
}

