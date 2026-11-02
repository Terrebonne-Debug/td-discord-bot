// Preloaded with --import so no test can accidentally read the developer's
// real .env or shell configuration.
process.env.DOTENV_CONFIG_PATH = '/dev/null';

const DEFAULTS: Record<string, string> = {
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_GUILD_ID: '',
  DEEPSEEK_API_KEY: 'test-deepseek-key',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic',
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  DEEPSEEK_THINKING: 'enabled',
  DEEPSEEK_EFFORT: 'max',
  DEEPSEEK_MAX_TOKENS: '8192',
  DEEPSEEK_TIMEOUT_MS: '180000',
  DEEPSEEK_TEMPERATURE: '',
  SYSTEM_PROMPT: '',
  MAX_HISTORY_TURNS: '10',
  MAX_PROMPT_CHARS: '4000',
  MONGODB_URI: '',
  MONGODB_DB: 'td-discord-bot',
  MONGODB_TIMEOUT_MS: '5000',
  MEMORY_TTL_DAYS: '',
};

for (const [name, value] of Object.entries(DEFAULTS)) {
  process.env[name] = value;
}
