import { Github } from '../constants.ts';
import type { CreateIssueOptions } from '../models/github/create-issue-options.ts';

/**
 * Crée des issues via l'API REST de GitHub et renvoie l'URL de l'issue.
 * Lève une erreur quand l'API rejette la requête (jeton invalide,
 * permissions manquantes…).
 *
 * @class GitHubIssues
 */
export class GitHubIssues {
  #options: CreateIssueOptions;
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
      `${Github.apiBaseUrl}/repos/${this.#options.repository}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `${Github.authorizationPrefix}${this.#options.token}`,
          Accept: Github.acceptHeader,
          [Github.contentHeader]: Github.jsonContentType,
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
