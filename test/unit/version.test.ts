import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readBuildInfo } from '../../src/version.ts';

const runGitOk = (args: string[], _cwd: string): string => {
  assert.deepEqual(args, ['rev-parse', '--short', 'HEAD']);
  return 'abc1234\n';
};

const runGitBroken = (): string => {
  throw new Error('git not available');
};

test('readBuildInfo reads the package version and the short git commit', () => {
  // Le cwd pointe vers la racine du projet, où package.json existe.
  const info = readBuildInfo({ cwd: process.cwd(), runGit: runGitOk });

  assert.equal(info.version, '1.0.0');
  assert.equal(info.commit, 'abc1234');
});

test('readBuildInfo degrades to unknown without git', () => {
  const info = readBuildInfo({ cwd: process.cwd(), runGit: runGitBroken });

  assert.equal(info.version, '1.0.0');
  assert.equal(info.commit, 'unknown');
});

test('readBuildInfo degrades to unknown without a package.json', () => {
  const info = readBuildInfo({ cwd: '/chemin/inexistant', runGit: runGitOk });

  assert.equal(info.version, 'unknown');
  assert.equal(info.commit, 'abc1234');
});

test('readBuildInfo degrades to unknown when package.json has no version', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'td-version-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{}');

    const info = readBuildInfo({ cwd: dir, runGit: runGitOk });

    assert.equal(info.version, 'unknown');
    assert.equal(info.commit, 'abc1234');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
