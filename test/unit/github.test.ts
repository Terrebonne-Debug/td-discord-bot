import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitHubIssue } from '../../src/github.ts';

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

test('createGitHubIssue posts to the API and returns the issue URL', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = async (input: string | Request | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return fakeResponse(201, { html_url: 'https://github.com/owner/repo/issues/42' });
  };

  const url = await createGitHubIssue(
    {
      token: 'gh-token',
      repository: 'owner/repo',
      title: 'Ma suggestion',
      body: 'Le texte complet',
    },
    fetchFn,
  );

  assert.equal(url, 'https://github.com/owner/repo/issues/42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/issues');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    'Bearer gh-token',
  );
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    title: 'Ma suggestion',
    body: 'Le texte complet',
  });
});

test('createGitHubIssue throws when the API rejects the request', async () => {
  const fetchFn = async () => fakeResponse(422, { message: 'Validation Failed' });

  await assert.rejects(
    createGitHubIssue(
      { token: 'bad-token', repository: 'owner/repo', title: 'x', body: 'y' },
      fetchFn,
    ),
    /GitHub API error: 422/,
  );
});
