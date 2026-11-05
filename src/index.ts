/**
 * Point d'entrée : un simple amorçage, toute la logique vit dans Launcher.
 */

import { ConfigLoader } from './config/config-loader.ts';
import { LoggerFactory } from './logging/logger-factory.ts';
import { Launcher } from './startup/launcher.ts';
import { Errors } from './utils/errors.ts';

const logger = new LoggerFactory(ConfigLoader.load(process.env)).rootLogger();

new Launcher({ logger }).start().catch(async (error: unknown) => {
  logger.error(`Échec du démarrage du bot : ${Errors.messageOf(error)}`);
  await logger.flush();
  process.exitCode = 1;
});
