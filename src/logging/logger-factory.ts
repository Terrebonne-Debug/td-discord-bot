import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { ConfigLoader } from '../config/config-loader.ts';
import { Logging } from '../constants.ts';
import type { LogLevel } from '../models/config/log-level.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { LoggingConfig } from '../models/logging/logging-config.ts';
import { ArchiveSweeper } from './archive-sweeper.ts';

/**
 * Construit les journaux du bot : un repli console sans fichiers, et le
 * journal de production (console lisible dans un terminal, JSON sinon, plus
 * un fichier JSON rotatif dont les rotations terminées sont archivées en
 * gzip avec la rétention configurée). Toute la logique vit dans la classe :
 * aucune fonction libre.
 *
 * @class LoggerFactory
 */
export class LoggerFactory {
  static #levelOrder: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

  static #consoleFormat: ReturnType<typeof winston.format.printf> = winston.format.printf(
    ({ level, message, timestamp, ...fields }) => {
      const extras = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${extras}`;
    },
  );

  /**
   * Indique si un niveau passe le seuil configuré.
   *
   * @function
   * @param {LogLevel} level - Le niveau du message.
   * @param {LogLevel} threshold - Le seuil configuré.
   * @returns {boolean} Vrai si le niveau est autorisé.
   */
  static #isEnabled(level: LogLevel, threshold: LogLevel): boolean {
    return LoggerFactory.#levelOrder[level] <= LoggerFactory.#levelOrder[threshold];
  }

  /**
   * Formate un message console avec ses champs structurés.
   *
   * @function
   * @param {string} message - Le message.
   * @param {Record<string, unknown>} [fields] - Les champs structurés.
   * @returns {string} Le message formaté.
   */
  static #formatConsoleMessage(message: string, fields?: Record<string, unknown>): string {
    if (!fields || Object.keys(fields).length === 0) return message;
    return `${message} ${JSON.stringify(fields)}`;
  }

  /**
   * Adapte un journal winston à l'interface BotLogger.
   *
   * @function
   * @param {winston.Logger} winstonLogger - Le journal winston brut.
   * @returns {BotLogger} Le journal adapté.
   */
  static #toBotLogger(winstonLogger: winston.Logger): BotLogger {
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
      child: (bindings) => LoggerFactory.#toBotLogger(winstonLogger.child(bindings)),
      flush: () =>
        new Promise<void>((resolve) => {
          winstonLogger.end(() => resolve());
        }),
    };
  }

  #appConfig: LoggingConfig;

  /**
   * @constructor
   * @param {LoggingConfig} [appConfig=ConfigLoader.load(process.env)] - La configuration de journalisation.
   */
  constructor(appConfig: LoggingConfig = ConfigLoader.load(process.env)) {
    this.#appConfig = appConfig;
  }

  /**
   * Journal console sans fichiers, défaut des chemins sans journal injecté.
   *
   * @method
   * @param {LogLevel} [threshold] - Le seuil de niveau (défaut : la config).
   * @returns {BotLogger} Le journal console.
   */
  consoleLogger(threshold: LogLevel = this.#appConfig.logLevel): BotLogger {
    const write =
      (level: LogLevel, method: 'debug' | 'info' | 'warn' | 'error') =>
      (message: string, fields?: Record<string, unknown>): void => {
        if (!LoggerFactory.#isEnabled(level, threshold)) return;
        console[method](LoggerFactory.#formatConsoleMessage(message, fields));
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
   * Options du transport de fichier rotatif, exposées comme méthode publique
   * pour que la correspondance depuis la configuration soit testable.
   *
   * @method
   * @returns {{ filename: string; datePattern: string; maxSize: string }} Les options du transport.
   */
  fileTransportOptions(): {
    filename: string;
    datePattern: string;
    maxSize: string;
  } {
    return {
      filename: path.join(this.#appConfig.logDir, Logging.filenamePattern),
      datePattern: Logging.dailyDatePattern,
      maxSize: `${this.#appConfig.logMaxSizeMb}m`,
    };
  }

  /**
   * Le journal de production : console plus fichier rotatif archivé.
   *
   * @method
   * @param {{ isTTY?: boolean }} [stdout=process.stdout] - La sortie standard.
   * @returns {BotLogger} Le journal de production.
   */
  rootLogger(stdout: { isTTY?: boolean } = process.stdout): BotLogger {
    const consoleTransport = new winston.transports.Console({
      format: stdout.isTTY
        ? winston.format.combine(
            winston.format.timestamp({ format: Logging.timestampFormat }),
            LoggerFactory.#consoleFormat,
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

    const botLogger = LoggerFactory.#toBotLogger(logger);

    if (fileTransport) {
      new ArchiveSweeper(this.#appConfig.logDir, this.#appConfig.logRetentionDays).start();
    }

    return botLogger;
  }
}
