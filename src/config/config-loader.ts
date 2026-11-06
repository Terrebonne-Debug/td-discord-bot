import 'dotenv/config';
import {
  configBoolean,
  configMissing,
  configNumberRange,
  configPlaceholder,
  configPositiveInt,
  Defaults,
  EnvVars,
  Values,
} from '../constants.ts';
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
  static #thinkingModes = new Set<string>([Values.enabled, Values.disabled]);
  /** @type {Set<string>} Les niveaux d'effort acceptés. */
  static #effortLevels = new Set<string>([
    Defaults.effort,
    Values.effortLow,
    Values.effortMedium,
    Values.effortHigh,
  ]);
  /** @type {Set<string>} Les niveaux de journalisation acceptés. */
  static #logLevels = new Set<string>([
    Defaults.logLevel,
    Values.logDebug,
    Values.logWarn,
    Values.logError,
  ]);

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
    const thinkingRaw = this.#optional(
      env,
      EnvVars.deepseekThinking,
      Defaults.thinking,
    ).toLowerCase();
    if (!ConfigLoader.#thinkingModes.has(thinkingRaw)) {
      throw new Error(
        `DEEPSEEK_THINKING doit valoir « enabled » ou « disabled » (reçu : ${thinkingRaw}).`,
      );
    }
    const thinking = thinkingRaw as ThinkingMode;

    const effortRaw = this.#optional(env, EnvVars.deepseekEffort, Defaults.effort).toLowerCase();
    if (!ConfigLoader.#effortLevels.has(effortRaw)) {
      throw new Error(
        `DEEPSEEK_EFFORT doit être l'un de ${[...ConfigLoader.#effortLevels].join(', ')} (reçu : ${effortRaw}).`,
      );
    }
    const effort = effortRaw as EffortLevel;

    const logLevelRaw = this.#optional(env, EnvVars.logLevel, Defaults.logLevel).toLowerCase();
    if (!ConfigLoader.#logLevels.has(logLevelRaw)) {
      throw new Error(
        `LOG_LEVEL doit être l'un de ${[...ConfigLoader.#logLevels].join(', ')} (reçu : ${logLevelRaw}).`,
      );
    }
    const logLevel = logLevelRaw as LogLevel;

    return Object.freeze({
      discordToken: this.#required(env, EnvVars.discordToken),
      discordGuildId: this.#optional(env, EnvVars.discordGuildId, '') || null,

      deepseekApiKey: this.#required(env, EnvVars.deepseekApiKey),
      deepseekBaseUrl: this.#optional(
        env,
        EnvVars.deepseekBaseUrl,
        Defaults.deepseekBaseUrl,
      ).replace(/\/+$/, ''),
      deepseekModel: this.#optional(env, EnvVars.deepseekModel, Defaults.deepseekModel),
      deepseekThinking: thinking,
      deepseekEffort: effort,
      deepseekMaxTokens: this.#positiveInt(env, EnvVars.deepseekMaxTokens, Defaults.maxTokens),
      deepseekTemperature: this.#optionalNumber(env, EnvVars.deepseekTemperature, 0, 2),
      deepseekTimeoutMs: this.#positiveInt(env, EnvVars.deepseekTimeoutMs, Defaults.timeoutMs),

      systemPrompt: this.#optional(env, EnvVars.systemPrompt, Defaults.systemPrompt),
      maxHistoryTurns: this.#positiveInt(env, EnvVars.maxHistoryTurns, Defaults.maxHistoryTurns),
      maxPromptChars: this.#positiveInt(env, EnvVars.maxPromptChars, Defaults.maxPromptChars),

      /**
       * Mémoire de conversation. Sans MongoDB joignable, le bot replie sur
       * une mémoire en RAM (perdue au redémarrage).
       */
      mongodbUri: this.#optional(env, EnvVars.mongodbUri, '') || null,
      mongodbDb: this.#optional(env, EnvVars.mongodbDb, Defaults.mongodbDb),
      mongodbTimeoutMs: this.#positiveInt(env, EnvVars.mongodbTimeoutMs, Defaults.mongodbTimeoutMs),
      /**
       * L'historique des canaux expire toujours : 30 jours après sa dernière
       * mise à jour par défaut, MEMORY_TTL_DAYS remplace.
       */
      memoryTtlDays:
        this.#optionalPositiveInt(env, EnvVars.memoryTtlDays) ?? Defaults.memoryTtlDays,
      /** Validée par MemoryCipher.parseKey au démarrage. */
      memoryEncryptionKey: this.#optional(env, EnvVars.memoryEncryptionKey, '') || null,

      logLevel,
      logDir: this.#optional(env, EnvVars.logDir, Defaults.logDir),
      logFileEnabled: this.#optionalBoolean(env, EnvVars.logFileEnabled, Defaults.logFileEnabled),
      logMaxSizeMb: this.#positiveInt(env, EnvVars.logMaxSizeMb, Defaults.logMaxSizeMb),
      logRetentionDays: this.#positiveInt(env, EnvVars.logRetentionDays, Defaults.logRetentionDays),

      /**
       * Création d'issues GitHub (/feature-request). Sans jeton, la commande
       * répond qu'elle n'est pas configurée.
       */
      githubToken: this.#optional(env, EnvVars.githubToken, '') || null,
      githubRepository: this.#optional(env, EnvVars.githubRepository, Defaults.githubRepository),
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
      throw new Error(configMissing(name));
    }
    if (value.startsWith('your_')) {
      throw new Error(configPlaceholder(name));
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
      throw new Error(configPositiveInt(name, raw));
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
      throw new Error(configNumberRange(name, min, max, raw));
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
      throw new Error(configPositiveInt(name, raw));
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
    throw new Error(configBoolean(name, raw));
  }
}
