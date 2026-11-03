import 'dotenv/config';

export type ThinkingMode = 'enabled' | 'disabled';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const THINKING_MODES = new Set<string>(['enabled', 'disabled']);
const EFFORT_LEVELS = new Set<string>(['low', 'medium', 'high', 'max']);
const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

/** Every configuration value, after validation and defaulting. */
export interface Config {
  discordToken: string;
  discordGuildId: string | null;

  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekThinking: ThinkingMode;
  deepseekEffort: EffortLevel;
  deepseekMaxTokens: number;
  deepseekTemperature: number | null;
  deepseekTimeoutMs: number;

  systemPrompt: string;
  maxHistoryTurns: number;
  maxPromptChars: number;

  mongodbUri: string | null;
  mongodbDb: string;
  mongodbTimeoutMs: number;
  memoryTtlDays: number | null;

  logLevel: LogLevel;
  logDir: string;
  logFileEnabled: boolean;
  logMaxSizeMb: number;
  logRetentionDays: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  if (value.startsWith('your_')) {
    throw new Error(`${name} still has its placeholder value. Set a real value in .env.`);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value || fallback;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = optional(env, name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received: ${raw}).`);
  }
  return value;
}

function optionalNumber(env: NodeJS.ProcessEnv, name: string, min: number, max: number): number | null {
  const raw = optional(env, name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max} (received: ${raw}).`);
  }
  return value;
}

function optionalPositiveInt(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = optional(env, name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received: ${raw}).`);
  }
  return value;
}

function optionalBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = optional(env, name, String(fallback)).toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false" (received: ${raw}).`);
}

/**
 * Build the frozen configuration from an environment-like object. Exported as
 * a pure function so every validation branch can be tested without reloading
 * the module.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): Readonly<Config> {
  const thinkingRaw = optional(env, 'DEEPSEEK_THINKING', 'enabled').toLowerCase();
  if (!THINKING_MODES.has(thinkingRaw)) {
    throw new Error(`DEEPSEEK_THINKING must be "enabled" or "disabled" (received: ${thinkingRaw}).`);
  }
  const thinking = thinkingRaw as ThinkingMode;

  const effortRaw = optional(env, 'DEEPSEEK_EFFORT', 'max').toLowerCase();
  if (!EFFORT_LEVELS.has(effortRaw)) {
    throw new Error(
      `DEEPSEEK_EFFORT must be one of ${[...EFFORT_LEVELS].join(', ')} (received: ${effortRaw}).`,
    );
  }
  const effort = effortRaw as EffortLevel;

  const logLevelRaw = optional(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!LOG_LEVELS.has(logLevelRaw)) {
    throw new Error(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')} (received: ${logLevelRaw}).`);
  }
  const logLevel = logLevelRaw as LogLevel;

  return Object.freeze({
    discordToken: required(env, 'DISCORD_TOKEN'),
    discordGuildId: optional(env, 'DISCORD_GUILD_ID', '') || null,

    deepseekApiKey: required(env, 'DEEPSEEK_API_KEY'),
    deepseekBaseUrl: optional(env, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com/anthropic').replace(
      /\/+$/,
      '',
    ),
    deepseekModel: optional(env, 'DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    deepseekThinking: thinking,
    deepseekEffort: effort,
    deepseekMaxTokens: positiveInt(env, 'DEEPSEEK_MAX_TOKENS', 8192),
    deepseekTemperature: optionalNumber(env, 'DEEPSEEK_TEMPERATURE', 0, 2),
    deepseekTimeoutMs: positiveInt(env, 'DEEPSEEK_TIMEOUT_MS', 180_000),

    systemPrompt: optional(
      env,
      'SYSTEM_PROMPT',
      'You are a helpful Discord bot powered by DeepSeek. Answer clearly and concisely, using Markdown that renders well in Discord.',
    ),
    maxHistoryTurns: positiveInt(env, 'MAX_HISTORY_TURNS', 10),
    maxPromptChars: positiveInt(env, 'MAX_PROMPT_CHARS', 4000),

    // Conversation memory. Without a reachable MongoDB the bot falls back to
    // in-RAM memory (lost on restart).
    mongodbUri: optional(env, 'MONGODB_URI', '') || null,
    mongodbDb: optional(env, 'MONGODB_DB', 'td-discord-bot'),
    mongodbTimeoutMs: positiveInt(env, 'MONGODB_TIMEOUT_MS', 5000),
    // Channel history always expires: 30 days after its last update by
    // default, MEMORY_TTL_DAYS overrides.
    memoryTtlDays: optionalPositiveInt(env, 'MEMORY_TTL_DAYS') ?? 30,

    logLevel,
    logDir: optional(env, 'LOG_DIR', './logs'),
    logFileEnabled: optionalBoolean(env, 'LOG_FILE_ENABLED', true),
    logMaxSizeMb: positiveInt(env, 'LOG_MAX_SIZE_MB', 10),
    logRetentionDays: positiveInt(env, 'LOG_RETENTION_DAYS', 14),
  });
}

export const config = parseConfig(process.env);
