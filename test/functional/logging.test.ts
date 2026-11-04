import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArchiveSweeper } from '../../src/logging/archive-sweeper.ts';
import { LoggerFactory } from '../../src/logging/logger-factory.ts';
import type { LoggingConfig } from '../../src/models/logging/logging-config.ts';

function fileConfig(logDir: string, logMaxSizeMb = 1): LoggingConfig {
  return {
    logLevel: 'debug',
    logDir,
    logFileEnabled: true,
    logMaxSizeMb,
    logRetentionDays: 2,
  };
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('condition jamais atteinte dans le délai');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('the rotating file logger turns size rotations into gzip archives', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'td-logs-'));
  const logger = new LoggerFactory(fileConfig(dir)).rootLogger({ isTTY: false });

  try {
    // ~1,5 Mo au total, au-delà du maxSize de 1 Mo : la rotation doit se produire.
    const payload = 'x'.repeat(50_000);
    for (let i = 0; i < 30; i += 1) {
      logger.info(`entry-${i}`, { i, payload });
    }
    await logger.flush();

    const list = () => readdir(dir);
    const rotatedOrArchived = async () => {
      const files = await list();
      return (
        files.some((file) => /\.log\.\d+$/.test(file)) || files.some((file) => file.endsWith('.gz'))
      );
    };
    await waitFor(rotatedOrArchived);

    // Le balayage compresse la rotation terminée et supprime l'original.
    await new ArchiveSweeper(dir, 2).sweep();

    const files = await list();
    assert.ok(
      files.some((file) => /^bot-\d{4}-\d{2}-\d{2}\.log$/.test(file)),
      `fichier actif .log parmi ${files.join(', ')}`,
    );
    assert.ok(
      files.some((file) => file.endsWith('.log.1.gz')),
      `archive .gz parmi ${files.join(', ')}`,
    );
    assert.equal(
      files.some((file) => /\.log\.\d+$/.test(file)),
      false,
      'plus aucun fichier tourné non compressé',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('archiveLogs deletes expired archives, keeps fresh ones and survives unreadable files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'td-logs-'));
  try {
    const day = 86_400_000;
    const now = new Date('2026-11-02T12:00:00Z');
    const activeName = ArchiveSweeper.activeLogFilename(new Intl.DateTimeFormat('en-CA').format(now));

    // Archives expirées et fraîche, contrôlées par leur date de modification.
    await writeFile(path.join(dir, 'vieux.gz'), 'old');
    await utimes(path.join(dir, 'vieux.gz'), now, new Date(now.getTime() - 3 * day));
    await writeFile(path.join(dir, 'frais.gz'), 'fresh');
    await utimes(path.join(dir, 'frais.gz'), now, new Date(now.getTime() - 1 * day));

    // Un « fichier tourné » illisible (répertoire) : le balayage continue.
    await mkdir(path.join(dir, 'bot-2026-11-01.log.2'));
    // Une archive cassée (lien symbolique pendant) : ignorée sans échec.
    await symlink('/cible-inexistante', path.join(dir, 'broken.gz'));
    await writeFile(path.join(dir, activeName), 'active');
    await utimes(path.join(dir, activeName), now, now);

    await new ArchiveSweeper(dir, 2).sweep(now);

    const files = await readdir(dir);
    assert.ok(!files.includes('vieux.gz'), 'archive expirée supprimée');
    assert.ok(files.includes('frais.gz'), 'archive fraîche conservée');
    assert.ok(files.includes(activeName), 'fichier actif intact');
    assert.ok(files.includes('bot-2026-11-01.log.2'), 'répertoire illisible laissé en place');
    assert.ok(files.includes('broken.gz'), 'archive cassée laissée en place');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('archiveLogs tolerates a directory that has disappeared', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'td-logs-'));
  await rm(dir, { recursive: true, force: true });

  await assert.doesNotReject(new ArchiveSweeper(dir, 14).sweep());
});
