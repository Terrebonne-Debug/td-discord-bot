import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigLoader } from '../../src/config/config-loader.ts';

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DISCORD_TOKEN: 'discord-token',
    DEEPSEEK_API_KEY: 'deepseek-key',
    ...overrides,
  };
}

test('ConfigLoader.parse applique chaque défaut', () => {
  const config = new ConfigLoader().parse(baseEnv());

  assert.equal(config.discordToken, 'discord-token');
  assert.equal(config.discordGuildId, null);
  assert.equal(config.deepseekApiKey, 'deepseek-key');
  assert.equal(config.deepseekBaseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(config.deepseekModel, 'deepseek-v4-flash');
  assert.equal(config.deepseekThinking, 'enabled');
  assert.equal(config.deepseekEffort, 'max');
  assert.equal(config.deepseekMaxTokens, 8192);
  assert.equal(config.deepseekTemperature, null);
  assert.equal(config.deepseekTimeoutMs, 180_000);
  assert.match(config.systemPrompt, /bot Discord utile propulsé par DeepSeek/);
  assert.equal(config.maxHistoryTurns, 10);
  assert.equal(config.maxPromptChars, 4000);
  assert.equal(config.mongodbUri, null);
  assert.equal(config.mongodbDb, 'td-discord-bot');
  assert.equal(config.mongodbTimeoutMs, 5000);
  assert.equal(config.memoryTtlDays, 30);
  assert.equal(config.memoryEncryptionKey, null);
  assert.equal(config.logLevel, 'info');
  assert.equal(config.logDir, './logs');
  assert.equal(config.logFileEnabled, true);
  assert.equal(config.logMaxSizeMb, 10);
  assert.equal(config.logRetentionDays, 14);
  assert.equal(config.githubToken, null);
  assert.equal(config.githubRepository, 'Terrebonne-Debug/td-discord-bot');
  assert.ok(Object.isFrozen(config));
});

test('ConfigLoader.parse nettoie les valeurs, minuscule les énumérations et applique chaque remplacement', () => {
  const config = new ConfigLoader().parse({
    DISCORD_TOKEN: '  discord-token  ',
    DISCORD_GUILD_ID: 'guild-1',
    DEEPSEEK_API_KEY: 'deepseek-key',
    DEEPSEEK_BASE_URL: 'http://localhost:9999///',
    DEEPSEEK_MODEL: 'custom-model',
    DEEPSEEK_THINKING: 'DISABLED',
    DEEPSEEK_EFFORT: 'HIGH',
    DEEPSEEK_MAX_TOKENS: '42',
    DEEPSEEK_TEMPERATURE: '0',
    DEEPSEEK_TIMEOUT_MS: '9000',
    SYSTEM_PROMPT: 'Be brief.',
    MAX_HISTORY_TURNS: '3',
    MAX_PROMPT_CHARS: '500',
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    MONGODB_DB: 'custom-db',
    MONGODB_TIMEOUT_MS: '1234',
    MEMORY_TTL_DAYS: '7',
    MEMORY_ENCRYPTION_KEY: 'ab'.repeat(32),
    LOG_LEVEL: 'DEBUG',
    LOG_DIR: '/var/log/td-bot',
    LOG_FILE_ENABLED: 'false',
    LOG_MAX_SIZE_MB: '5',
    LOG_RETENTION_DAYS: '30',
    GITHUB_TOKEN: 'ghp_test',
    GITHUB_REPOSITORY: 'owner/custom-repo',
  });

  assert.equal(config.discordToken, 'discord-token');
  assert.equal(config.discordGuildId, 'guild-1');
  assert.equal(config.deepseekBaseUrl, 'http://localhost:9999');
  assert.equal(config.deepseekModel, 'custom-model');
  assert.equal(config.deepseekThinking, 'disabled');
  assert.equal(config.deepseekEffort, 'high');
  assert.equal(config.deepseekMaxTokens, 42);
  assert.equal(config.deepseekTemperature, 0);
  assert.equal(config.deepseekTimeoutMs, 9000);
  assert.equal(config.systemPrompt, 'Be brief.');
  assert.equal(config.maxHistoryTurns, 3);
  assert.equal(config.maxPromptChars, 500);
  assert.equal(config.mongodbUri, 'mongodb://127.0.0.1:27017');
  assert.equal(config.mongodbDb, 'custom-db');
  assert.equal(config.mongodbTimeoutMs, 1234);
  assert.equal(config.memoryTtlDays, 7);
  assert.equal(config.memoryEncryptionKey, 'ab'.repeat(32));
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.logDir, '/var/log/td-bot');
  assert.equal(config.logFileEnabled, false);
  assert.equal(config.logMaxSizeMb, 5);
  assert.equal(config.logRetentionDays, 30);
  assert.equal(config.githubToken, 'ghp_test');
  assert.equal(config.githubRepository, 'owner/custom-repo');
});

test("ConfigLoader.parse rejette les variables requises manquantes ou d'exemple", () => {
  assert.throws(
    () => new ConfigLoader().parse({ DEEPSEEK_API_KEY: 'key' }),
    /Variable d'environnement requise manquante : DISCORD_TOKEN/,
  );
  assert.throws(
    () => new ConfigLoader().parse({ DISCORD_TOKEN: 'token' }),
    /Variable d'environnement requise manquante : DEEPSEEK_API_KEY/,
  );
  assert.throws(
    () => new ConfigLoader().parse({ DISCORD_TOKEN: '   ', DEEPSEEK_API_KEY: 'key' }),
    /requise manquante/,
  );
  assert.throws(
    () =>
      new ConfigLoader().parse({ DISCORD_TOKEN: 'your_discord_token', DEEPSEEK_API_KEY: 'key' }),
    /a encore sa valeur d'exemple/,
  );
});

test("ConfigLoader.parse rejette les valeurs d'énumération invalides", () => {
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_THINKING: 'sometimes' })),
    /DEEPSEEK_THINKING doit valoir « enabled » ou « disabled »/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_EFFORT: 'extreme' })),
    /DEEPSEEK_EFFORT doit être l'un de/,
  );
});

test('ConfigLoader.parse rejette les entiers positifs et nombres invalides', () => {
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_MAX_TOKENS: '0' })),
    /DEEPSEEK_MAX_TOKENS doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_MAX_TOKENS: 'abc' })),
    /DEEPSEEK_MAX_TOKENS doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_TIMEOUT_MS: '-5' })),
    /DEEPSEEK_TIMEOUT_MS doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ MAX_HISTORY_TURNS: '1.5' })),
    /MAX_HISTORY_TURNS doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ MAX_PROMPT_CHARS: 'nope' })),
    /MAX_PROMPT_CHARS doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ MONGODB_TIMEOUT_MS: '0' })),
    /MONGODB_TIMEOUT_MS doit être un entier positif/,
  );
});

test('ConfigLoader.parse valide les réglages de journalisation', () => {
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ LOG_LEVEL: 'verbose' })),
    /LOG_LEVEL doit être l'un de/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ LOG_FILE_ENABLED: 'oui' })),
    /LOG_FILE_ENABLED doit valoir « true » ou « false »/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ LOG_MAX_SIZE_MB: '0' })),
    /LOG_MAX_SIZE_MB doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ LOG_RETENTION_DAYS: '-1' })),
    /LOG_RETENTION_DAYS doit être un entier positif/,
  );
});

test('ConfigLoader.parse valide la température et le TTL facultatifs', () => {
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_TEMPERATURE: '-1' })),
    /DEEPSEEK_TEMPERATURE doit être un nombre de 0 à 2/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_TEMPERATURE: '2.5' })),
    /DEEPSEEK_TEMPERATURE doit être un nombre de 0 à 2/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ DEEPSEEK_TEMPERATURE: 'warm' })),
    /DEEPSEEK_TEMPERATURE doit être un nombre de 0 à 2/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ MEMORY_TTL_DAYS: '0' })),
    /MEMORY_TTL_DAYS doit être un entier positif/,
  );
  assert.throws(
    () => new ConfigLoader().parse(baseEnv({ MEMORY_TTL_DAYS: 'forever' })),
    /MEMORY_TTL_DAYS doit être un entier positif/,
  );
});
