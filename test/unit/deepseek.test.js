import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askDeepSeek,
  createDeepSeekClient,
  describeDeepSeekError,
} from '../../src/deepseek.js';

function fakeClient(content) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content };
      },
    },
  };
}

const enabledSettings = {
  deepseekModel: 'deepseek-v4-flash',
  deepseekMaxTokens: 123,
  deepseekEffort: 'max',
  deepseekThinking: 'enabled',
  deepseekTemperature: null,
  systemPrompt: 'System prompt',
};

const disabledSettings = {
  ...enabledSettings,
  deepseekThinking: 'disabled',
  deepseekTemperature: 0.5,
};

test('askDeepSeek sends thinking options and concatenates text blocks', async () => {
  const client = fakeClient([
    { type: 'thinking', thinking: 'hidden' },
    { type: 'text', text: '  hello ' },
    { type: 'text', text: 'world  ' },
  ]);

  const reply = await askDeepSeek(
    [{ role: 'user', content: 'earlier' }],
    'prompt',
    client,
    enabledSettings,
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

test('askDeepSeek sends temperature and disabled thinking when configured', async () => {
  const client = fakeClient([{ type: 'text', text: 'ok' }]);

  await askDeepSeek([], 'prompt', client, disabledSettings);

  const params = client.calls[0];
  assert.equal(params.temperature, 0.5);
  assert.deepEqual(params.thinking, { type: 'disabled' });
  assert.equal('output_config' in params, false);
});

test('askDeepSeek falls back when the model returns no text', async () => {
  const client = fakeClient([{ type: 'thinking', thinking: 'only thoughts' }]);

  const reply = await askDeepSeek([], 'prompt', client, enabledSettings);

  assert.equal(reply, 'The model returned an empty response.');
});

test('createDeepSeekClient builds an Anthropic client from settings', () => {
  const client = createDeepSeekClient({
    deepseekApiKey: 'test-key',
    deepseekBaseUrl: 'http://127.0.0.1:9999',
    deepseekTimeoutMs: 500,
  });

  assert.equal(client.baseURL, 'http://127.0.0.1:9999');
  assert.equal(typeof client.messages.create, 'function');
});

test('describeDeepSeekError maps timeouts, statuses and unknown failures', () => {
  assert.match(
    describeDeepSeekError({ name: 'APIConnectionTimeoutError' }),
    /took too long/,
  );
  assert.match(describeDeepSeekError({ status: 400 }), /rejected the request/);
  assert.match(describeDeepSeekError({ status: 401 }), /rejected the API key/);
  assert.match(describeDeepSeekError({ status: 402 }), /insufficient balance/);
  assert.match(describeDeepSeekError({ status: 403 }), /refused the request/);
  assert.match(describeDeepSeekError({ status: 404 }), /endpoint or model was not found/);
  assert.match(describeDeepSeekError({ status: 429 }), /rate limiting/);
  assert.match(describeDeepSeekError({ status: 503 }), /temporarily unavailable/);
  assert.match(describeDeepSeekError({ status: 418 }), /request failed/);
  assert.match(describeDeepSeekError(undefined), /request failed/);
});
