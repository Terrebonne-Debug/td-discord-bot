import { start } from './start.ts';

start().catch((error: unknown) => {
  console.error(`Bot startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
