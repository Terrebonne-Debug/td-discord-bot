import Anthropic from '@anthropic-ai/sdk';
import { ConfigLoader } from '../config/config-loader.ts';
import { DeepSeekErrors, Messages, Values } from '../constants.ts';
import type { DeepSeekClient } from '../models/deepseek/deepseek-client.ts';
import type { DeepSeekClientSettings } from '../models/deepseek/deepseek-client-settings.ts';
import type { DeepSeekSettings } from '../models/deepseek/deepseek-settings.ts';
import type { Turn } from '../models/memory/turn.ts';

/**
 * Envoie les conversations au point d'accès compatible Anthropic de DeepSeek
 * et renvoie les blocs de texte concaténés. Les blocs de réflexion ne sont
 * volontairement ni renvoyés ni conservés dans l'historique.
 *
 * @class DeepSeek
 */
export class DeepSeek {
  /**
   * Construit le client SDK Anthropic sous-jacent depuis les réglages de
   * connexion.
   *
   * @static
   * @param {DeepSeekClientSettings} settings - Clé, URL de base et délai.
   * @returns {DeepSeekClient} Le client prêt à l'emploi.
   */
  static createClient(
    settings: DeepSeekClientSettings = ConfigLoader.load(process.env),
  ): DeepSeekClient {
    /**
     * Le vrai client expose `messages.create` sous forme de surcharges que
     * TypeScript ne peut pas réduire à la seule signature appelée par le bot ;
     * la conversion est sûre car ask appelle toujours la forme non streamée.
     */
    return new Anthropic({
      apiKey: settings.deepseekApiKey,
      baseURL: settings.deepseekBaseUrl,
      timeout: settings.deepseekTimeoutMs,
      maxRetries: 2,
    }) as unknown as DeepSeekClient;
  }

  /**
   * Traduit les échecs de l'API en messages affichables sur Discord.
   *
   * @static
   * @param {unknown} error - Le rejet brut de l'API ou du SDK.
   * @returns {string} Le message destiné à l'utilisateur.
   */
  static describeError(error: unknown): string {
    const apiError = error as { name?: string; status?: number } | null | undefined;

    if (apiError?.name === 'APIConnectionTimeoutError') {
      return DeepSeekErrors.timeout;
    }

    switch (apiError?.status) {
      case 400:
        return DeepSeekErrors.badRequest;
      case 401:
        return DeepSeekErrors.unauthorized;
      case 402:
        return DeepSeekErrors.insufficientBalance;
      case 403:
        return DeepSeekErrors.forbidden;
      case 404:
        return DeepSeekErrors.notFound;
      case 429:
        return DeepSeekErrors.rateLimited;
      default:
        if ((apiError?.status ?? 0) >= 500) {
          return DeepSeekErrors.unavailable;
        }
        return DeepSeekErrors.generic;
    }
  }

  /** @type {DeepSeekClient} Le client SDK sous-jacent. */
  #client: DeepSeekClient;
  /** @type {DeepSeekSettings} Les réglages de génération. */
  #settings: DeepSeekSettings;

  /**
   * @constructor
   * @param {DeepSeekSettings} [settings=config] - Réglages de génération.
   * @param {DeepSeekClient} [client=DeepSeek.createClient()] - Client SDK.
   */
  constructor({
    settings = ConfigLoader.load(process.env),
    client = DeepSeek.createClient(),
  }: {
    settings?: DeepSeekSettings;
    client?: DeepSeekClient;
  } = {}) {
    this.#settings = settings;
    this.#client = client;
  }

  /**
   * Interroge le modèle avec un historique et une question.
   *
   * @method
   * @param {Turn[]} history - Les tours précédents de la conversation.
   * @param {string} prompt - La question de l'utilisateur.
   * @returns {Promise<string>} Le texte de la réponse, jamais vide.
   */
  async ask(history: Turn[], prompt: string): Promise<string> {
    const params: Record<string, unknown> = {
      model: this.#settings.deepseekModel,
      max_tokens: this.#settings.deepseekMaxTokens,
      system: this.#settings.systemPrompt,
      messages: [...history, { role: 'user', content: prompt }],
    };

    if (this.#settings.deepseekTemperature !== null) {
      params.temperature = this.#settings.deepseekTemperature;
    }

    if (this.#settings.deepseekThinking === Values.enabled) {
      params.thinking = { type: Values.enabled };
      /** DeepSeek prend en charge output_config.effort sur sa route compatible Anthropic. */
      params.output_config = { effort: this.#settings.deepseekEffort };
    } else {
      params.thinking = { type: Values.disabled };
    }

    const response = await this.#client.messages.create(params);
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return text || Messages.modelReturnedEmpty;
  }
}

/** L'instance partagée utilisée comme modèle par défaut du bot. */
export const defaultDeepSeek = new DeepSeek();
