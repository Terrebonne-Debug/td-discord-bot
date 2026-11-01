import { start } from './start.js';

start().catch((error) => {
  console.error(`Bot startup failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
