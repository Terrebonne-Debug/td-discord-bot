/**
 * Les réglages que Bot lit ; la Config complète les satisfait.
 *
 * @interface
 */
export interface BotSettings {
  maxPromptChars: number;
  githubToken: string | null;
  githubRepository: string;
}
