import Anthropic from '@anthropic-ai/sdk';
import type { Turn } from './types.ts';
import { config } from './config.ts';

/** The DeepSeek settings read by askDeepSeek. */
export interface DeepSeekSettings {
  deepseekModel: string;
  deepseekMaxTokens: number;
  deepseekTemperature: number | null;
  deepseekThinking: 'enabled' | 'disabled';
  deepseekEffort: string;
  systemPrompt: string;
}

/** The DeepSeek settings read by createDeepSeekClient. */
export interface DeepSeekClientSettings {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekTimeoutMs: number;
}

/**
 * The slice of the Anthropic SDK the bot uses. Kept minimal so tests can
 * inject a fake client without constructing a full Anthropic instance.
 */
export interface DeepSeekClient {
  baseURL: string;
  messages: {
    create(
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export function createDeepSeekClient(settings: DeepSeekClientSettings = config): DeepSeekClient {
  // The real client exposes `messages.create` as overloads, which TypeScript
  // cannot narrow to the single signature the bot calls; the cast is safe
  // because askDeepSeek always calls the non-streaming form.
  return new Anthropic({
    apiKey: settings.deepseekApiKey,
    baseURL: settings.deepseekBaseUrl,
    timeout: settings.deepseekTimeoutMs,
    maxRetries: 2,
  }) as unknown as DeepSeekClient;
}

const defaultClient = createDeepSeekClient();

/**
 * Send a conversation to DeepSeek's Anthropic-compatible endpoint and return
 * the concatenated text blocks. Thinking blocks are deliberately not returned
 * or stored in history.
 *
 * `client` and `settings` are injectable so tests never reach the network.
 */
export async function askDeepSeek(
  history: Turn[],
  prompt: string,
  client: DeepSeekClient = defaultClient,
  settings: DeepSeekSettings = config,
): Promise<string> {
  const params: Record<string, unknown> = {
    model: settings.deepseekModel,
    max_tokens: settings.deepseekMaxTokens,
    system: settings.systemPrompt,
    messages: [...history, { role: 'user', content: prompt }],
  };

  if (settings.deepseekTemperature !== null) {
    params.temperature = settings.deepseekTemperature;
  }

  if (settings.deepseekThinking === 'enabled') {
    params.thinking = { type: 'enabled' };
    // DeepSeek supports output_config.effort on its Anthropic-compatible route.
    params.output_config = { effort: settings.deepseekEffort };
  } else {
    params.thinking = { type: 'disabled' };
  }

  const response = await client.messages.create(params);
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return text || 'The model returned an empty response.';
}

export function describeDeepSeekError(error: unknown): string {
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
