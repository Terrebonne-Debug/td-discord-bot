/**
 * Entrées de GitHubIssues : où et quoi publier.
 *
 * @interface
 */
export interface CreateIssueOptions {
  token: string;
  repository: string;
  title: string;
  body: string;
}
