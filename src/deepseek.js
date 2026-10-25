import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const client = new Anthropic({
  apiKey: config.deepseekApiKey,
  baseURL: config.deepseekBaseUrl,
  timeout: config.deepseekTimeoutMs,
  maxRetries: 2,
});

/**
 * Send a conversation to DeepSeek's Anthropic-compatible endpoint and return
 * the concatenated text blocks. Thinking blocks are deliberately not returned
 * or stored in history.
 */
export async function askDeepSeek(history, prompt) {
  const params = {
    model: config.deepseekModel,
    max_tokens: config.deepseekMaxTokens,
    system: config.systemPrompt,
    messages: [...history, { role: 'user', content: prompt }],
  };

  if (config.deepseekTemperature !== null) {
    params.temperature = config.deepseekTemperature;
  }

  if (config.deepseekThinking === 'enabled') {
    params.thinking = { type: 'enabled' };
    // DeepSeek supports output_config.effort on its Anthropic-compatible route.
    params.output_config = { effort: config.deepseekEffort };
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

export function describeDeepSeekError(error) {
  if (error?.name === 'APIConnectionTimeoutError') {
    return 'DeepSeek took too long to respond. Please try again.';
  }

  switch (error?.status) {
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
      if (error?.status >= 500) {
        return 'DeepSeek is temporarily unavailable. Try again shortly.';
      }
      return 'The DeepSeek request failed. Check the bot logs and try again.';
  }
}
