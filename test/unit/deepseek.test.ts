import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepSeek } from '../../src/deepseek/deepseek.ts';
import type { DeepSeekClient } from '../../src/models/deepseek/deepseek-client.ts';
import type { DeepSeekSettings } from '../../src/models/deepseek/deepseek-settings.ts';

function fakeClient(
  content: Array<{ type: string; text?: string; thinking?: string }>,
): DeepSeekClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    baseURL: 'https://api.deepseek.com/anthropic',
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content };
      },
    },
  };
}

const enabledSettings: DeepSeekSettings = {
  deepseekModel: 'deepseek-v4-flash',
  deepseekMaxTokens: 123,
  deepseekEffort: 'max',
  deepseekThinking: 'enabled',
  deepseekTemperature: null,
  systemPrompt: 'System prompt',
};

const disabledSettings: DeepSeekSettings = {
  ...enabledSettings,
  deepseekThinking: 'disabled',
  deepseekTemperature: 0.5,
};

test('DeepSeek sends thinking options and concatenates text blocks', async () => {
  const client = fakeClient([
    { type: 'thinking', thinking: 'hidden' },
    { type: 'text', text: '  hello ' },
    { type: 'text', text: 'world  ' },
  ]);
  const deepseek = new DeepSeek({ settings: enabledSettings, client });

  const reply = await deepseek.ask(
    [{ role: 'user', content: 'earlier' }],
    'prompt',
  );

  assert.equal(reply, 'hello \nworld');
  assert.equal(client.calls.length, 1);
  const params = client.calls[0];
  assert.equal(params.model, 'deepseek-v4-flash');
  assert.equal(params.max_tokens, 123);
  assert.equal(params.system, 'System prompt');
  assert.deepEqual(params.messages, [
    { role: 'user', content: 'earlier' },
    { role: 'user', content: 'prompt' },
  ]);
  assert.deepEqual(params.thinking, { type: 'enabled' });
  assert.deepEqual(params.output_config, { effort: 'max' });
  assert.equal('temperature' in params, false);
});

test('DeepSeek sends temperature and disabled thinking when configured', async () => {
  const client = fakeClient([{ type: 'text', text: 'ok' }]);
  const deepseek = new DeepSeek({ settings: disabledSettings, client });

  await deepseek.ask([], 'prompt');

  const params = client.calls[0];
  assert.equal(params.temperature, 0.5);
  assert.deepEqual(params.thinking, { type: 'disabled' });
  assert.equal('output_config' in params, false);
});

test('DeepSeek falls back when the model returns no text', async () => {
  const client = fakeClient([{ type: 'thinking', thinking: 'only thoughts' }]);
  const deepseek = new DeepSeek({ settings: enabledSettings, client });

  const reply = await deepseek.ask([], 'prompt');

  assert.equal(reply, 'The model returned an empty response.');
});

test('DeepSeek.createClient builds an Anthropic client from settings', () => {
  const client = DeepSeek.createClient({
    deepseekApiKey: 'test-key',
    deepseekBaseUrl: 'http://127.0.0.1:9999',
    deepseekTimeoutMs: 500,
  });

  assert.equal(client.baseURL, 'http://127.0.0.1:9999');
  assert.equal(typeof client.messages.create, 'function');
});

test('DeepSeek.describeError maps timeouts, statuses and unknown failures', () => {
  assert.match(
    DeepSeek.describeError({ name: 'APIConnectionTimeoutError' }),
    /took too long/,
  );
  assert.match(DeepSeek.describeError({ status: 400 }), /rejected the request/);
  assert.match(DeepSeek.describeError({ status: 401 }), /rejected the API key/);
  assert.match(DeepSeek.describeError({ status: 402 }), /insufficient balance/);
  assert.match(DeepSeek.describeError({ status: 403 }), /refused the request/);
  assert.match(DeepSeek.describeError({ status: 404 }), /endpoint or model was not found/);
  assert.match(DeepSeek.describeError({ status: 429 }), /rate limiting/);
  assert.match(DeepSeek.describeError({ status: 503 }), /temporarily unavailable/);
  assert.match(DeepSeek.describeError({ status: 418 }), /request failed/);
  assert.match(DeepSeek.describeError(undefined), /request failed/);
});
