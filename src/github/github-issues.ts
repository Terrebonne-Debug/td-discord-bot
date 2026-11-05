import type { CreateIssueOptions } from '../models/github/create-issue-options.ts';

/**
 * Crée des issues via l'API REST de GitHub et renvoie l'URL de l'issue.
 * Lève une erreur quand l'API rejette la requête (jeton invalide,
 * permissions manquantes…).
 *
 * @class
 */
export class GitHubIssues {
  /** @type {CreateIssueOptions} Les options de création. */
  #options: CreateIssueOptions;
  /** @type {typeof fetch} La fonction fetch à utiliser. */
  #fetchFn: typeof fetch;

  /**
   * @constructor
   * @param {CreateIssueOptions} options - Jeton, dépôt, titre et corps.
   * @param {typeof fetch} [fetchFn=fetch] - La fonction fetch injectée en test.
   */
  constructor(options: CreateIssueOptions, fetchFn: typeof fetch = fetch) {
    this.#options = options;
    this.#fetchFn = fetchFn;
  }

  /**
   * Publie l'issue et renvoie son URL.
   *
   * @method
   * @returns {Promise<string>} L'URL de l'issue créée.
   * @throws Quand l'API rejette la requête.
   */
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
      throw new Error(`Erreur de l'API GitHub : ${response.status}`);
    }

    const issue = (await response.json()) as { html_url: string };
    return issue.html_url;
  }
}
