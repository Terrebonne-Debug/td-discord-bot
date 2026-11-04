import type { CreateIssueOptions } from '../models/github/create-issue-options.ts';

/**
 * Creates issues through the GitHub REST API and returns the issue URL.
 * Throws when the API rejects the request (bad token, missing permissions…).
 */
export class GitHubIssues {
  #options: CreateIssueOptions;
  #fetchFn: typeof fetch;

  constructor(options: CreateIssueOptions, fetchFn: typeof fetch = fetch) {
    this.#options = options;
    this.#fetchFn = fetchFn;
  }

  async createIssue(): Promise<string> {
    const response = await this.#fetchFn(
      `https://api.github.com/repos/${this.#options.repository}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#options.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: this.#options.title, body: this.#options.body }),
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const issue = (await response.json()) as { html_url: string };
    return issue.html_url;
  }
}
