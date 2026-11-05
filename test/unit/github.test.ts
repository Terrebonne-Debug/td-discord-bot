import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubIssues } from '../../src/github/github-issues.ts';

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

test('GitHubIssues publie à l\'API et renvoie l\'URL de l\'issue', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = async (input: string | Request | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return fakeResponse(201, { html_url: 'https://github.com/owner/repo/issues/42' });
  };

  const issues = new GitHubIssues(
    {
      token: 'gh-token',
      repository: 'owner/repo',
      title: 'Ma suggestion',
      body: 'Le texte complet',
    },
    fetchFn,
  );
  const url = await issues.createIssue();

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

test('GitHubIssues lève une erreur quand l\'API rejette la requête', async () => {
  const fetchFn = async () => fakeResponse(422, { message: 'Validation Failed' });

  const issues = new GitHubIssues(
    { token: 'bad-token', repository: 'owner/repo', title: 'x', body: 'y' },
    fetchFn,
  );

  await assert.rejects(issues.createIssue(), /Erreur de l'API GitHub : 422/);
});
