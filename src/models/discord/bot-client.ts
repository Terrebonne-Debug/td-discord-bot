/** The slice of the Discord client the bot's event handlers need. */
export interface BotClient {
  user: { id: string } | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
}
