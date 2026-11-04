import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config/config-loader.ts';
import type { LogLevel } from '../models/config/log-level.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { LoggingConfig } from '../models/logging/logging-config.ts';
import { ArchiveSweeper } from './archive-sweeper.ts';

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function isEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[threshold];
}

function formatConsoleMessage(message: string, fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return message;
  return `${message} ${JSON.stringify(fields)}`;
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

/**
 * Builds the bot's loggers: a console-only fallback without files, and the
 * production logger (readable console in a terminal, JSON otherwise, plus a
 * rotating JSON file whose finished rotations are gzip-archived with the
 * configured retention).
 */
export class LoggerFactory {
  #appConfig: LoggingConfig;

  constructor(appConfig: LoggingConfig = config) {
    this.#appConfig = appConfig;
  }

  /** Console-only logger, default of every path without an injected logger. */
  consoleLogger(threshold: LogLevel = this.#appConfig.logLevel): BotLogger {
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

  /**
   * Options of the rotating file transport, exposed as a public method so
   * the mapping from configuration can be unit-tested.
   */
  fileTransportOptions(): {
    filename: string;
    datePattern: string;
    maxSize: string;
  } {
    return {
      filename: path.join(this.#appConfig.logDir, 'bot-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: `${this.#appConfig.logMaxSizeMb}m`,
    };
  }

  rootLogger(stdout: { isTTY?: boolean } = process.stdout): BotLogger {
    const consoleTransport = new winston.transports.Console({
      format: stdout.isTTY
        ? winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            consoleFormat,
          )
        : winston.format.combine(winston.format.timestamp(), winston.format.json()),
    });

    const fileTransport = this.#appConfig.logFileEnabled
      ? new DailyRotateFile(this.fileTransportOptions())
      : null;

    const logger = winston.createLogger({
      level: this.#appConfig.logLevel,
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [consoleTransport, ...(fileTransport ? [fileTransport] : [])],
    });

    const botLogger = toBotLogger(logger);

    if (fileTransport) {
      new ArchiveSweeper(this.#appConfig.logDir, this.#appConfig.logRetentionDays).start();
    }

    return botLogger;
  }
}
