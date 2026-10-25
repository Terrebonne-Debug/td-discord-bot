import 'dotenv/config';

const THINKING_MODES = new Set(['enabled', 'disabled']);
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max']);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  if (value.startsWith('your_')) {
    throw new Error(`${name} still has its placeholder value. Set a real value in .env.`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function positiveInt(name, fallback) {
  const raw = optional(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received: ${raw}).`);
  }
  return value;
}

function optionalNumber(name, min, max) {
  const raw = optional(name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max} (received: ${raw}).`);
  }
  return value;
}

const thinking = optional('DEEPSEEK_THINKING', 'enabled').toLowerCase();
if (!THINKING_MODES.has(thinking)) {
  throw new Error(`DEEPSEEK_THINKING must be "enabled" or "disabled" (received: ${thinking}).`);
}

const effort = optional('DEEPSEEK_EFFORT', 'max').toLowerCase();
if (!EFFORT_LEVELS.has(effort)) {
  throw new Error(
    `DEEPSEEK_EFFORT must be one of ${[...EFFORT_LEVELS].join(', ')} (received: ${effort}).`,
  );
}

export const config = Object.freeze({
  discordToken: required('DISCORD_TOKEN'),
  discordGuildId: optional('DISCORD_GUILD_ID', null),

  deepseekApiKey: required('DEEPSEEK_API_KEY'),
  deepseekBaseUrl: optional('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/anthropic').replace(
    /\/+$/,
    '',
  ),
  deepseekModel: optional('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
  deepseekThinking: thinking,
  deepseekEffort: effort,
  deepseekMaxTokens: positiveInt('DEEPSEEK_MAX_TOKENS', 8192),
  deepseekTemperature: optionalNumber('DEEPSEEK_TEMPERATURE', 0, 2),
  deepseekTimeoutMs: positiveInt('DEEPSEEK_TIMEOUT_MS', 180_000),

  systemPrompt: optional(
    'SYSTEM_PROMPT',
    'You are a helpful Discord bot powered by DeepSeek. Answer clearly and concisely, using Markdown that renders well in Discord.',
  ),
  maxHistoryTurns: positiveInt('MAX_HISTORY_TURNS', 10),
  maxPromptChars: positiveInt('MAX_PROMPT_CHARS', 4000),
});
