import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/config-loader.ts';
import type { DeepSeekClient } from '../models/deepseek/deepseek-client.ts';
import type { DeepSeekClientSettings } from '../models/deepseek/deepseek-client-settings.ts';
import type { DeepSeekSettings } from '../models/deepseek/deepseek-settings.ts';
import type { Turn } from '../models/memory/turn.ts';

/**
 * Sends conversations to DeepSeek's Anthropic-compatible endpoint and returns
 * the concatenated text blocks. Thinking blocks are deliberately not returned
 * or stored in history.
 */
export class DeepSeek {
  /** Builds the underlying Anthropic SDK client from the connection settings. */
  static createClient(settings: DeepSeekClientSettings = config): DeepSeekClient {
    // The real client exposes `messages.create` as overloads, which TypeScript
    // cannot narrow to the single signature the bot calls; the cast is safe
    // because ask always calls the non-streaming form.
    return new Anthropic({
      apiKey: settings.deepseekApiKey,
      baseURL: settings.deepseekBaseUrl,
      timeout: settings.deepseekTimeoutMs,
      maxRetries: 2,
    }) as unknown as DeepSeekClient;
  }

  /** Maps API failures to messages the bot can show on Discord. */
  static describeError(error: unknown): string {
    const apiError = error as { name?: string; status?: number } | null | undefined;

    if (apiError?.name === 'APIConnectionTimeoutError') {
      return 'DeepSeek took too long to respond. Please try again.';
    }

    switch (apiError?.status) {
      case 400:
        return 'DeepSeek rejected the request. Check DEEPSEEK_MODEL and the other DeepSeek settings.';
      case 401:
        return 'DeepSeek rejected the API key. Check DEEPSEEK_API_KEY in .env.';
      case 402:
        return 'The DeepSeek account has insufficient balance.';
      case 403:
        return 'DeepSeek refused the request. Check the API key permissions.';
      case 404:
        return 'The configured DeepSeek endpoint or model was not found.';
      case 429:
        return 'DeepSeek is rate limiting requests. Try again shortly.';
      default:
        if ((apiError?.status ?? 0) >= 500) {
          return 'DeepSeek is temporarily unavailable. Try again shortly.';
        }
        return 'The DeepSeek request failed. Check the bot logs and try again.';
    }
  }

  #client: DeepSeekClient;
  #settings: DeepSeekSettings;

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
      // DeepSeek supports output_config.effort on its Anthropic-compatible route.
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

    return text || 'The model returned an empty response.';
  }
}

/** The shared instance used as the bot's default model. */
export const defaultDeepSeek = new DeepSeek();
