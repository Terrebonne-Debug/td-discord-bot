import 'dotenv/config';
import type { Config } from '../models/config/config.ts';
import type { EffortLevel } from '../models/config/effort-level.ts';
import type { LogLevel } from '../models/config/log-level.ts';
import type { ThinkingMode } from '../models/config/thinking-mode.ts';

/**
 * Construit la configuration figée depuis un objet d'environnement. Toute la
 * logique de lecture et de validation vit dans la classe : aucune fonction
 * libre, aucun effet de bord hors de la méthode load.
 *
 * @class ConfigLoader
 */
export class ConfigLoader {
  /** @type {Set<string>} Les modes de réflexion acceptés. */
  static #thinkingModes = new Set<string>(['enabled', 'disabled']);
  /** @type {Set<string>} Les niveaux d'effort acceptés. */
  static #effortLevels = new Set<string>(['low', 'medium', 'high', 'max']);
  /** @type {Set<string>} Les niveaux de journalisation acceptés. */
  static #logLevels = new Set<string>(['debug', 'info', 'warn', 'error']);

  /**
   * Charge la configuration depuis l'environnement courant (ou donné). Le
   * point d'entrée unique du module : les consommateurs appellent
   * ConfigLoader.load au lieu d'importer un objet pré-construit.
   *
   * @static
   * @function
   * @param {NodeJS.ProcessEnv} [env=process.env] - L'environnement à lire.
   * @returns {Readonly<Config>} La configuration figée.
   * @throws Quand une valeur requise manque ou est invalide.
   */
  static load(env: NodeJS.ProcessEnv = process.env): Readonly<Config> {
    return new ConfigLoader().parse(env);
  }

  /**
   * Analyse et valide l'environnement.
   *
   * @method
   * @param {NodeJS.ProcessEnv} [env=process.env] - L'environnement à lire.
   * @returns {Readonly<Config>} La configuration figée.
   * @throws Quand une valeur requise manque ou est invalide.
   */
  parse(env: NodeJS.ProcessEnv = process.env): Readonly<Config> {
    const thinkingRaw = this.#optional(env, 'DEEPSEEK_THINKING', 'enabled').toLowerCase();
    if (!ConfigLoader.#thinkingModes.has(thinkingRaw)) {
      throw new Error(
        `DEEPSEEK_THINKING doit valoir « enabled » ou « disabled » (reçu : ${thinkingRaw}).`,
      );
    }
    const thinking = thinkingRaw as ThinkingMode;

    const effortRaw = this.#optional(env, 'DEEPSEEK_EFFORT', 'max').toLowerCase();
    if (!ConfigLoader.#effortLevels.has(effortRaw)) {
      throw new Error(
        `DEEPSEEK_EFFORT doit être l'un de ${[...ConfigLoader.#effortLevels].join(', ')} (reçu : ${effortRaw}).`,
      );
    }
    const effort = effortRaw as EffortLevel;

    const logLevelRaw = this.#optional(env, 'LOG_LEVEL', 'info').toLowerCase();
    if (!ConfigLoader.#logLevels.has(logLevelRaw)) {
      throw new Error(
        `LOG_LEVEL doit être l'un de ${[...ConfigLoader.#logLevels].join(', ')} (reçu : ${logLevelRaw}).`,
      );
    }
    const logLevel = logLevelRaw as LogLevel;

    return Object.freeze({
      discordToken: this.#required(env, 'DISCORD_TOKEN'),
      discordGuildId: this.#optional(env, 'DISCORD_GUILD_ID', '') || null,

      deepseekApiKey: this.#required(env, 'DEEPSEEK_API_KEY'),
      deepseekBaseUrl: this.#optional(
        env,
        'DEEPSEEK_BASE_URL',
        'https://api.deepseek.com/anthropic',
      ).replace(/\/+$/, ''),
      deepseekModel: this.#optional(env, 'DEEPSEEK_MODEL', 'deepseek-v4-flash'),
      deepseekThinking: thinking,
      deepseekEffort: effort,
      deepseekMaxTokens: this.#positiveInt(env, 'DEEPSEEK_MAX_TOKENS', 8192),
      deepseekTemperature: this.#optionalNumber(env, 'DEEPSEEK_TEMPERATURE', 0, 2),
      deepseekTimeoutMs: this.#positiveInt(env, 'DEEPSEEK_TIMEOUT_MS', 180_000),

      systemPrompt: this.#optional(
        env,
        'SYSTEM_PROMPT',
        "Tu es un bot Discord utile propulsé par DeepSeek. Réponds clairement et de façon concise, avec du Markdown qui s'affiche bien dans Discord.",
      ),
      maxHistoryTurns: this.#positiveInt(env, 'MAX_HISTORY_TURNS', 10),
      maxPromptChars: this.#positiveInt(env, 'MAX_PROMPT_CHARS', 4000),

      /**
       * Mémoire de conversation. Sans MongoDB joignable, le bot replie sur
       * une mémoire en RAM (perdue au redémarrage).
       */
      mongodbUri: this.#optional(env, 'MONGODB_URI', '') || null,
      mongodbDb: this.#optional(env, 'MONGODB_DB', 'td-discord-bot'),
      mongodbTimeoutMs: this.#positiveInt(env, 'MONGODB_TIMEOUT_MS', 5000),
      /**
       * L'historique des canaux expire toujours : 30 jours après sa dernière
       * mise à jour par défaut, MEMORY_TTL_DAYS remplace.
       */
      memoryTtlDays: this.#optionalPositiveInt(env, 'MEMORY_TTL_DAYS') ?? 30,
      /** Validée par MemoryCipher.parseKey au démarrage. */
      memoryEncryptionKey: this.#optional(env, 'MEMORY_ENCRYPTION_KEY', '') || null,

      logLevel,
      logDir: this.#optional(env, 'LOG_DIR', './logs'),
      logFileEnabled: this.#optionalBoolean(env, 'LOG_FILE_ENABLED', true),
      logMaxSizeMb: this.#positiveInt(env, 'LOG_MAX_SIZE_MB', 10),
      logRetentionDays: this.#positiveInt(env, 'LOG_RETENTION_DAYS', 14),

      /**
       * Création d'issues GitHub (/feature-request). Sans jeton, la commande
       * répond qu'elle n'est pas configurée.
       */
      githubToken: this.#optional(env, 'GITHUB_TOKEN', '') || null,
      githubRepository: this.#optional(env, 'GITHUB_REPOSITORY', 'Terrebonne-Debug/td-discord-bot'),
    });
  }

  /**
   * Lit une variable requise.
   *
   * @method
   * @param {NodeJS.ProcessEnv} env - L'environnement.
   * @param {string} name - Le nom de la variable.
   * @returns {string} La valeur nettoyée.
   * @throws Quand la variable manque ou garde sa valeur d'exemple.
   */
  #required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`Variable d'environnement requise manquante : ${name}. Voir .env.example.`);
    }
    if (value.startsWith('your_')) {
      throw new Error(`${name} a encore sa valeur d'exemple. Définis une vraie valeur dans .env.`);
    }
    return value;
  }

  /**
   * Lit une variable optionnelle avec repli.
   *
   * @method
   * @param {NodeJS.ProcessEnv} env - L'environnement.
   * @param {string} name - Le nom de la variable.
   * @param {string} fallback - La valeur de repli.
   * @returns {string} La valeur ou le repli.
   */
  #optional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
    const value = env[name]?.trim();
    return value || fallback;
  }

  /**
   * Lit un entier strictement positif.
   *
   * @method
   * @param {NodeJS.ProcessEnv} env - L'environnement.
   * @param {string} name - Le nom de la variable.
   * @param {number} fallback - Le repli.
   * @returns {number} L'entier validé.
   * @throws Quand la valeur n'est pas un entier positif.
   */
  #positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
    const raw = this.#optional(env, name, String(fallback));
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} doit être un entier positif (reçu : ${raw}).`);
    }
    return value;
  }

  /**
   * Lit un nombre optionnel borné.
   *
   * @method
   * @param {NodeJS.ProcessEnv} env - L'environnement.
   * @param {string} name - Le nom de la variable.
   * @param {number} min - La borne inférieure.
   * @param {number} max - La borne supérieure.
   * @returns {number | null} Le nombre, ou null si absent.
   * @throws Quand la valeur sort des bornes.
   */
  #optionalNumber(env: NodeJS.ProcessEnv, name: string, min: number, max: number): number | null {
    const raw = this.#optional(env, name, '');
    if (!raw) return null;

    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} doit être un nombre de ${min} à ${max} (reçu : ${raw}).`);
    }
    return value;
  }

  /**
   * Lit un entier positif optionnel.
   *
   * @method
   * @param {NodeJS.ProcessEnv} env - L'environnement.
   * @param {string} name - Le nom de la variable.
   * @returns {number | null} L'entier, ou null si absent.
   * @throws Quand la valeur n'est pas un entier positif.
   */
  #optionalPositiveInt(env: NodeJS.ProcessEnv, name: string): number | null {
    const raw = this.#optional(env, name, '');
    if (!raw) return null;

    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} doit être un entier positif (reçu : ${raw}).`);
    }
    return value;
  }

  /**
   * Lit un booléen optionnel.
   *
   * @method
   * @param {NodeJS.ProcessEnv} env - L'environnement.
   * @param {string} name - Le nom de la variable.
   * @param {boolean} fallback - Le repli.
   * @returns {boolean} Le booléen validé.
   * @throws Quand la valeur n'est ni « true » ni « false ».
   */
  #optionalBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
    const raw = this.#optional(env, name, String(fallback)).toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} doit valoir « true » ou « false » (reçu : ${raw}).`);
  }
}
