import 'dotenv/config';
import type { Config } from '../models/config/config.ts';
import type { EffortLevel } from '../models/config/effort-level.ts';
import type { LogLevel } from '../models/config/log-level.ts';
import type { ThinkingMode } from '../models/config/thinking-mode.ts';

const THINKING_MODES = new Set<string>(['enabled', 'disabled']);
const EFFORT_LEVELS = new Set<string>(['low', 'medium', 'high', 'max']);
const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Variable d'environnement requise manquante : ${name}. Voir .env.example.`);
  }
  if (value.startsWith('your_')) {
    throw new Error(`${name} a encore sa valeur d'exemple. Définis une vraie valeur dans .env.`);
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
    throw new Error(`${name} doit être un entier positif (reçu : ${raw}).`);
  }
  return value;
}

function optionalNumber(env: NodeJS.ProcessEnv, name: string, min: number, max: number): number | null {
  const raw = optional(env, name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} doit être un nombre de ${min} à ${max} (reçu : ${raw}).`);
  }
  return value;
}

function optionalPositiveInt(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = optional(env, name, '');
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} doit être un entier positif (reçu : ${raw}).`);
  }
  return value;
}

function optionalBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = optional(env, name, String(fallback)).toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} doit valoir « true » ou « false » (reçu : ${raw}).`);
}

/**
 * Construit la configuration figée depuis un objet d'environnement. Pure,
 * pour que chaque branche de validation soit testable sans recharger le
 * module.
 *
 * @class ConfigLoader
 */
export class ConfigLoader {
  /**
   * Analyse et valide l'environnement.
   *
   * @method
   * @param {NodeJS.ProcessEnv} [env=process.env] - L'environnement à lire.
   * @returns {Readonly<Config>} La configuration figée.
   * @throws Quand une valeur requise manque ou est invalide.
   */
  parse(env: NodeJS.ProcessEnv = process.env): Readonly<Config> {
    const thinkingRaw = optional(env, 'DEEPSEEK_THINKING', 'enabled').toLowerCase();
    if (!THINKING_MODES.has(thinkingRaw)) {
      throw new Error(
        `DEEPSEEK_THINKING doit valoir « enabled » ou « disabled » (reçu : ${thinkingRaw}).`,
      );
    }
    const thinking = thinkingRaw as ThinkingMode;

    const effortRaw = optional(env, 'DEEPSEEK_EFFORT', 'max').toLowerCase();
    if (!EFFORT_LEVELS.has(effortRaw)) {
      throw new Error(
        `DEEPSEEK_EFFORT doit être l'un de ${[...EFFORT_LEVELS].join(', ')} (reçu : ${effortRaw}).`,
      );
    }
    const effort = effortRaw as EffortLevel;

    const logLevelRaw = optional(env, 'LOG_LEVEL', 'info').toLowerCase();
    if (!LOG_LEVELS.has(logLevelRaw)) {
      throw new Error(`LOG_LEVEL doit être l'un de ${[...LOG_LEVELS].join(', ')} (reçu : ${logLevelRaw}).`);
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
        'Tu es un bot Discord utile propulsé par DeepSeek. Réponds clairement et de façon concise, avec du Markdown qui s\'affiche bien dans Discord.',
      ),
      maxHistoryTurns: positiveInt(env, 'MAX_HISTORY_TURNS', 10),
      maxPromptChars: positiveInt(env, 'MAX_PROMPT_CHARS', 4000),

      /**
       * Mémoire de conversation. Sans MongoDB joignable, le bot replie sur
       * une mémoire en RAM (perdue au redémarrage).
       */
      mongodbUri: optional(env, 'MONGODB_URI', '') || null,
      mongodbDb: optional(env, 'MONGODB_DB', 'td-discord-bot'),
      mongodbTimeoutMs: positiveInt(env, 'MONGODB_TIMEOUT_MS', 5000),
      /**
       * L'historique des canaux expire toujours : 30 jours après sa dernière
       * mise à jour par défaut, MEMORY_TTL_DAYS remplace.
       */
      memoryTtlDays: optionalPositiveInt(env, 'MEMORY_TTL_DAYS') ?? 30,
      /** Validée par MemoryCipher.parseKey au démarrage. */
      memoryEncryptionKey: optional(env, 'MEMORY_ENCRYPTION_KEY', '') || null,

      logLevel,
      logDir: optional(env, 'LOG_DIR', './logs'),
      logFileEnabled: optionalBoolean(env, 'LOG_FILE_ENABLED', true),
      logMaxSizeMb: positiveInt(env, 'LOG_MAX_SIZE_MB', 10),
      logRetentionDays: positiveInt(env, 'LOG_RETENTION_DAYS', 14),

      /**
       * Création d'issues GitHub (/feature-request). Sans jeton, la commande
       * répond qu'elle n'est pas configurée.
       */
      githubToken: optional(env, 'GITHUB_TOKEN', '') || null,
      githubRepository: optional(env, 'GITHUB_REPOSITORY', 'Terrebonne-Debug/td-discord-bot'),
    });
  }
}

/** The process configuration, loaded once at module import. */
export const config = new ConfigLoader().parse(process.env);

