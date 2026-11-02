import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from './config.ts';
import type { LogLevel } from './config.ts';

/**
 * The logger interface the bot depends on. winston is an implementation
 * detail of this module: everywhere else only receives a BotLogger.
 */
export interface BotLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Returns a logger whose records carry the given context (scope, key…). */
  child(bindings: Record<string, unknown>): BotLogger;
  /** Flushes pending writes before shutdown. */
  flush(): Promise<void>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function isEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[threshold];
}

function formatConsoleMessage(message: string, fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return message;
  return `${message} ${JSON.stringify(fields)}`;
}

/**
 * Console-only logger without files. Default of every path that does not
 * receive an injected logger (tests, memory fallback…), so warnings still
 * reach the standard console streams.
 */
export function createConsoleLogger(threshold: LogLevel = config.logLevel): BotLogger {
  const write =
    (level: LogLevel, method: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, fields?: Record<string, unknown>): void => {
      if (!isEnabled(level, threshold)) return;
      console[method](formatConsoleMessage(message, fields));
    };

  const logger: BotLogger = {
    debug: write('debug', 'debug'),
    info: write('info', 'info'),
    warn: write('warn', 'warn'),
    error: write('error', 'error'),
    child: () => logger,
    flush: async () => {},
  };
  return logger;
}

/** The configuration values the logging module reads; Config satisfies it. */
export interface LoggingConfig {
  logLevel: LogLevel;
  logDir: string;
  logFileEnabled: boolean;
  logMaxSizeMb: number;
  logRetentionDays: number;
}

/**
 * Options of the rotating file transport, exposed as a pure function so the
 * mapping from configuration can be unit-tested.
 */
export function fileTransportOptions(appConfig: LoggingConfig): {
  filename: string;
  datePattern: string;
  maxSize: string;
} {
  return {
    filename: path.join(appConfig.logDir, 'bot-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: `${appConfig.logMaxSizeMb}m`,
  };
}

/** Adapts a winston logger to the BotLogger interface. */
function toBotLogger(winstonLogger: winston.Logger): BotLogger {
  const write =
    (level: LogLevel) =>
    (message: string, fields?: Record<string, unknown>): void => {
      winstonLogger.log(level, message, fields ?? {});
    };

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (bindings) => toBotLogger(winstonLogger.child(bindings)),
    flush: () =>
      new Promise<void>((resolve) => {
        winstonLogger.end(() => resolve());
      }),
  };
}

const consoleFormat = winston.format.printf(({ level, message, timestamp, ...fields }) => {
  const extras = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  return `${timestamp} [${level.toUpperCase()}] ${message}${extras}`;
});

// --- Archivage : compression gzip et rétention -------------------------------

/** Fichiers produits par la rotation : bot-AAAA-MM-JJ.log[.n]. */
const LOG_FILENAME_PATTERN = /^bot-\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/;

const ARCHIVE_SWEEP_INTERVAL_MS = 24 * 3_600_000;

/** Nom du fichier journal actif pour une date donnée (yyyy-MM-dd). */
export function activeLogFilename(date: string): string {
  return `bot-${date}.log`;
}

/** Un fichier est archivé s'il vient de la rotation et n'est pas l'actif. */
export function isArchivableLogFile(name: string, activeName: string): boolean {
  return LOG_FILENAME_PATTERN.test(name) && name !== activeName;
}

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
 * Compresse les fichiers journalisés dont la rotation est terminée et
 * supprime les archives plus vieilles que la rétention. Le fichier actif du
 * jour n'est jamais touché.
 */
export async function archiveLogs(
  logDir: string,
  retentionDays: number,
  now = new Date(),
): Promise<void> {
  const names = await readdir(logDir).catch(() => [] as string[]);
  const activeName = activeLogFilename(todayAsFilename(now));
  const cutoffMs = now.getTime() - retentionDays * 86_400_000;

  for (const name of names) {
    const filePath = path.join(logDir, name);

    if (isArchivableLogFile(name, activeName)) {
      try {
        await gzipFile(filePath);
      } catch {
        // Fichier inatteignable (rotation concurrente…) : le prochain
        // balayage réessaiera.
      }
      continue;
    }

    if (name.endsWith('.gz')) {
      try {
        if ((await stat(filePath)).mtimeMs < cutoffMs) {
          await unlink(filePath);
        }
      } catch {
        // L'archive a pu disparaître entre le listage et l'effacement.
      }
    }
  }
}

/**
 * Balayage immédiat puis quotidien, sans jamais bloquer l'arrêt du bot.
 * archiveLogs est totale (elle n'échoue jamais), le rejet n'a donc pas à
 * être observé ici.
 */
function scheduleArchiveSweeps(logDir: string, retentionDays: number): void {
  const sweep = () => {
    void archiveLogs(logDir, retentionDays);
  };

  sweep();
  const timer = setInterval(sweep, ARCHIVE_SWEEP_INTERVAL_MS);
  timer.unref();
}

/**
 * Production logger: readable console output in a terminal (JSON otherwise),
 * plus a rotating JSON file whose finished rotations are gzip-archived and
 * kept for the configured retention.
 */
export function createRootLogger(
  appConfig: LoggingConfig = config,
  stdout: { isTTY?: boolean } = process.stdout,
): BotLogger {
  const consoleTransport = new winston.transports.Console({
    format: stdout.isTTY
      ? winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          consoleFormat,
        )
      : winston.format.combine(winston.format.timestamp(), winston.format.json()),
  });

  const fileTransport = appConfig.logFileEnabled
    ? new DailyRotateFile(fileTransportOptions(appConfig))
    : null;

  const logger = winston.createLogger({
    level: appConfig.logLevel,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [consoleTransport, ...(fileTransport ? [fileTransport] : [])],
  });

  const botLogger = toBotLogger(logger);

  if (fileTransport) {
    scheduleArchiveSweeps(appConfig.logDir, appConfig.logRetentionDays);
  }

  return botLogger;
}
