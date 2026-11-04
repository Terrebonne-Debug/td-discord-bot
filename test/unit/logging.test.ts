import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ArchiveSweeper } from '../../src/logging/archive-sweeper.ts';
import { LoggerFactory } from '../../src/logging/logger-factory.ts';
import type { LoggingConfig } from '../../src/models/logging/logging-config.ts';

function config(overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    logLevel: 'info',
    logDir: './logs',
    logFileEnabled: false,
    logMaxSizeMb: 10,
    logRetentionDays: 14,
    ...overrides,
  };
}

test('LoggerFactory.consoleLogger respects the configured level', (t) => {
  const info = t.mock.method(console, 'info');
  const warn = t.mock.method(console, 'warn');

  const logger = new LoggerFactory().consoleLogger('warn');
  logger.info('hidden');
  logger.warn('visible');

  assert.equal(info.mock.calls.length, 0);
  assert.equal(warn.mock.calls.length, 1);
  assert.equal(warn.mock.calls[0].arguments[0], 'visible');
});

test('LoggerFactory.consoleLogger appends structured fields to the message', (t) => {
  const debug = t.mock.method(console, 'debug');

  const logger = new LoggerFactory().consoleLogger('debug');
  logger.debug('msg', { a: 1 });

  assert.equal(debug.mock.calls[0].arguments[0], 'msg {"a":1}');
});

test('LoggerFactory.consoleLogger child and flush are harmless', async () => {
  const logger = new LoggerFactory().consoleLogger('debug');

  assert.equal(logger.child({ scope: 'channel' }), logger);
  await assert.doesNotReject(logger.flush());
});

test('LoggerFactory.fileTransportOptions maps rotation from the configuration', () => {
  assert.deepEqual(
    new LoggerFactory(config({ logDir: '/var/log/td', logMaxSizeMb: 5 })).fileTransportOptions(),
    {
      filename: path.join('/var/log/td', 'bot-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
    },
  );
});

test('ArchiveSweeper.isArchivableLogFile only matches finished rotations of dated logs', () => {
  const active = ArchiveSweeper.activeLogFilename('2026-11-02');

  assert.equal(ArchiveSweeper.isArchivableLogFile('bot-2026-11-01.log', active), true);
  assert.equal(ArchiveSweeper.isArchivableLogFile('bot-2026-11-02.log', active), false);
  assert.equal(ArchiveSweeper.isArchivableLogFile('bot-2026-11-02.log.1', active), true);
  assert.equal(ArchiveSweeper.isArchivableLogFile('bot-2026-11-02.log.12', active), true);
  assert.equal(ArchiveSweeper.isArchivableLogFile('bot-2026-11-02.log.gz', active), false);
  assert.equal(ArchiveSweeper.isArchivableLogFile('bot-2026-11-02.txt', active), false);
  assert.equal(ArchiveSweeper.isArchivableLogFile('.hash-audit.json', active), false);
});

test('ArchiveSweeper.activeLogFilename formats the dated filename', () => {
  assert.equal(ArchiveSweeper.activeLogFilename('2026-11-02'), 'bot-2026-11-02.log');
});

test('ArchiveSweeper tolerates a missing log directory', async () => {
  await assert.doesNotReject(new ArchiveSweeper('/nonexistent-td-logs', 14).sweep());
});

test('LoggerFactory.rootLogger logs through every level, in both console formats', async () => {
  const pretty = new LoggerFactory(config({ logLevel: 'debug' })).rootLogger({ isTTY: true });
  pretty.debug('d', { n: 1 });
  pretty.info('i');
  pretty.warn('w');
  pretty.error('e');
  const prettyChild = pretty.child({ scope: 'channel' });
  prettyChild.info('with context');
  await pretty.flush();

  const json = new LoggerFactory(config({ logLevel: 'debug' })).rootLogger({ isTTY: false });
  json.debug('d', { n: 1 });
  json.info('i');
  json.warn('w');
  json.error('e');
  await json.flush();
});
