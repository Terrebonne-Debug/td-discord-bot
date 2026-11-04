import type { CreateIssueOptions } from './models/github/create-issue-options.ts';

/**
 * Creates an issue through the GitHub REST API and returns its URL. Throws
 * when the API rejects the request (bad token, missing permissions…).
 * `fetchFn` is injectable so tests never reach the network.
 */
export async function createGitHubIssue(
  options: CreateIssueOptions,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn(
    `https://api.github.com/repos/${options.repository}/issues`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: options.title, body: options.body }),
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const issue = (await response.json()) as { html_url: string };
  return issue.html_url;
}
