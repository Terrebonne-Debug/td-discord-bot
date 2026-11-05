import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/config-loader.ts';
import type { DeepSeekClient } from '../models/deepseek/deepseek-client.ts';
import type { DeepSeekClientSettings } from '../models/deepseek/deepseek-client-settings.ts';
import type { DeepSeekSettings } from '../models/deepseek/deepseek-settings.ts';
import type { Turn } from '../models/memory/turn.ts';

/**
 * Envoie les conversations au point d'accès compatible Anthropic de DeepSeek
 * et renvoie les blocs de texte concaténés. Les blocs de réflexion ne sont
 * volontairement ni renvoyés ni conservés dans l'historique.
 *
 * @class
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
  static createClient(settings: DeepSeekClientSettings = config): DeepSeekClient {
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
      return 'DeepSeek a mis trop de temps à répondre. Réessaie bientôt.';
    }

    switch (apiError?.status) {
      case 400:
        return 'DeepSeek a rejeté la requête. Vérifie DEEPSEEK_MODEL et les autres réglages DeepSeek.';
      case 401:
        return 'DeepSeek a rejeté la clé API. Vérifie DEEPSEEK_API_KEY dans .env.';
      case 402:
        return 'Le compte DeepSeek a un solde insuffisant.';
      case 403:
        return 'DeepSeek a refusé la requête. Vérifie les permissions de la clé API.';
      case 404:
        return "Le point d'accès ou le modèle DeepSeek configuré est introuvable.";
      case 429:
        return 'DeepSeek limite le débit des requêtes. Réessaie bientôt.';
      default:
        if ((apiError?.status ?? 0) >= 500) {
          return 'DeepSeek est momentanément indisponible. Réessaie bientôt.';
        }
        return 'La requête DeepSeek a échoué. Consulte les journaux du bot et réessaie.';
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
    settings = config,
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

    if (this.#settings.deepseekThinking === 'enabled') {
      params.thinking = { type: 'enabled' };
      /** DeepSeek prend en charge output_config.effort sur sa route compatible Anthropic. */
      params.output_config = { effort: this.#settings.deepseekEffort };
    } else {
      params.thinking = { type: 'disabled' };
    }

    const response = await this.#client.messages.create(params);
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return text || 'Le modèle a renvoyé une réponse vide.';
  }
}

/** L'instance partagée utilisée comme modèle par défaut du bot. */
export const defaultDeepSeek = new DeepSeek();
