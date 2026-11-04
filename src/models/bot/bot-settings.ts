/** The settings createBot reads; the full Config satisfies this. */
export interface BotSettings {
  maxPromptChars: number;
  githubToken: string | null;
  githubRepository: string;
}
