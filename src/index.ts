import { start } from './start.ts';
import { config } from './config.ts';
import { createRootLogger } from './logging.ts';

const logger = createRootLogger(config);

start({ logger }).catch(async (error: unknown) => {
  logger.error(`Bot startup failed: ${error instanceof Error ? error.message : String(error)}`);
  await logger.flush();
  process.exitCode = 1;
});
