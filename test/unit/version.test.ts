import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BuildInfoReader } from '../../src/version/build-info-reader.ts';

const runGitOk = (args: string[], _cwd: string): string => {
  assert.deepEqual(args, ['rev-parse', '--short', 'HEAD']);
  return 'abc1234\n';
};

const runGitBroken = (): string => {
  throw new Error('git not available');
};

test('BuildInfoReader lit la version du paquet et le commit git court', () => {
  /** Le cwd pointe vers la racine du projet, où package.json existe. */
  const info = new BuildInfoReader({ cwd: process.cwd(), runGit: runGitOk }).read();

  assert.equal(info.version, '1.0.0');
  assert.equal(info.commit, 'abc1234');
});

test('BuildInfoReader dégrade en inconnu sans git', () => {
  const info = new BuildInfoReader({ cwd: process.cwd(), runGit: runGitBroken }).read();

  assert.equal(info.version, '1.0.0');
  assert.equal(info.commit, 'inconnu');
});

test('BuildInfoReader dégrade en inconnu sans package.json', () => {
  const info = new BuildInfoReader({ cwd: '/chemin/inexistant', runGit: runGitOk }).read();

  assert.equal(info.version, 'inconnue');
  assert.equal(info.commit, 'abc1234');
});

test("BuildInfoReader dégrade en inconnu quand package.json n'a pas de version", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'td-version-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{}');

    const info = new BuildInfoReader({ cwd: dir, runGit: runGitOk }).read();

    assert.equal(info.version, 'inconnue');
    assert.equal(info.commit, 'abc1234');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
