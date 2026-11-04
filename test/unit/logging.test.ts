import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  activeLogFilename,
  archiveLogs,
  createConsoleLogger,
  createRootLogger,
  fileTransportOptions,
  isArchivableLogFile,
} from '../../src/logging.ts';
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

test('createConsoleLogger respects the configured level', (t) => {
  const info = t.mock.method(console, 'info');
  const warn = t.mock.method(console, 'warn');

  const logger = createConsoleLogger('warn');
  logger.info('hidden');
  logger.warn('visible');

  assert.equal(info.mock.calls.length, 0);
  assert.equal(warn.mock.calls.length, 1);
  assert.equal(warn.mock.calls[0].arguments[0], 'visible');
});

test('createConsoleLogger appends structured fields to the message', (t) => {
  const debug = t.mock.method(console, 'debug');

  const logger = createConsoleLogger('debug');
  logger.debug('msg', { a: 1 });

  assert.equal(debug.mock.calls[0].arguments[0], 'msg {"a":1}');
});

test('createConsoleLogger child and flush are harmless', async () => {
  const logger = createConsoleLogger('debug');

  assert.equal(logger.child({ scope: 'channel' }), logger);
  await assert.doesNotReject(logger.flush());
});

test('fileTransportOptions maps rotation from the configuration', () => {
  assert.deepEqual(
    fileTransportOptions(config({ logDir: '/var/log/td', logMaxSizeMb: 5 })),
    {
      filename: path.join('/var/log/td', 'bot-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
    },
  );
});

test('isArchivableLogFile only matches finished rotations of dated logs', () => {
  const active = activeLogFilename('2026-11-02');

  assert.equal(isArchivableLogFile('bot-2026-11-01.log', active), true);
  assert.equal(isArchivableLogFile('bot-2026-11-02.log', active), false);
  assert.equal(isArchivableLogFile('bot-2026-11-02.log.1', active), true);
  assert.equal(isArchivableLogFile('bot-2026-11-02.log.12', active), true);
  assert.equal(isArchivableLogFile('bot-2026-11-02.log.gz', active), false);
  assert.equal(isArchivableLogFile('bot-2026-11-02.txt', active), false);
  assert.equal(isArchivableLogFile('.hash-audit.json', active), false);
});

test('activeLogFilename formats the dated filename', () => {
  assert.equal(activeLogFilename('2026-11-02'), 'bot-2026-11-02.log');
});

test('archiveLogs tolerates a missing log directory', async () => {
  await assert.doesNotReject(archiveLogs('/nonexistent-td-logs', 14));
});

test('createRootLogger logs through every level, in both console formats', async () => {
  const pretty = createRootLogger(config({ logLevel: 'debug' }), { isTTY: true });
  pretty.debug('d', { n: 1 });
  pretty.info('i');
  pretty.warn('w');
  pretty.error('e');
  const prettyChild = pretty.child({ scope: 'channel' });
  prettyChild.info('with context');
  await pretty.flush();

  const json = createRootLogger(config({ logLevel: 'debug' }), { isTTY: false });
  json.debug('d', { n: 1 });
  json.info('i');
  json.warn('w');
  json.error('e');
  await json.flush();
});
