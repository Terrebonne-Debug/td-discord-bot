import 'dotenv/config';

const THINKING_MODES = new Set(['enabled', 'disabled']);
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max']);

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  if (value.startsWith('your_')) {
    throw new Error(`${name} still has its placeholder value. Set a real value in .env.`);
  }
  return value;
}

function optional(env, name, fallback) {
  const value = env[name]?.trim();
  return value || fallback;
}

function positiveInt(env, name, fallback) {
  const raw = optional(env, name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received: ${raw}).`);
  }
  return value;
}

function optionalNumber(env, name, min, max) {
  const raw = optional(env, name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max} (received: ${raw}).`);
  }
  return value;
}

function optionalPositiveInt(env, name) {
  const raw = optional(env, name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received: ${raw}).`);
  }
  return value;
}

/**
 * Build the frozen configuration from an environment-like object. Exported as
 * a pure function so every validation branch can be tested without reloading
 * the module.
 */
export function parseConfig(env = process.env) {
  const thinking = optional(env, 'DEEPSEEK_THINKING', 'enabled').toLowerCase();
  if (!THINKING_MODES.has(thinking)) {
    throw new Error(`DEEPSEEK_THINKING must be "enabled" or "disabled" (received: ${thinking}).`);
  }

  const effort = optional(env, 'DEEPSEEK_EFFORT', 'max').toLowerCase();
  if (!EFFORT_LEVELS.has(effort)) {
    throw new Error(
      `DEEPSEEK_EFFORT must be one of ${[...EFFORT_LEVELS].join(', ')} (received: ${effort}).`,
    );
  }

  return Object.freeze({
    discordToken: required(env, 'DISCORD_TOKEN'),
    discordGuildId: optional(env, 'DISCORD_GUILD_ID', null),

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
    // in-RAM memory (lost on restart), and private memory stays disabled.
    mongodbUri: optional(env, 'MONGODB_URI', null),
    mongodbDb: optional(env, 'MONGODB_DB', 'td-discord-bot'),
    mongodbTimeoutMs: positiveInt(env, 'MONGODB_TIMEOUT_MS', 5000),
    memoryTtlDays: optionalPositiveInt(env, 'MEMORY_TTL_DAYS'),
  });
}

export const config = parseConfig(process.env);
