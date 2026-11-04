/** Inputs of createGitHubIssue: where and what to post. */
export interface CreateIssueOptions {
  token: string;
  repository: string;
  title: string;
  body: string;
}
