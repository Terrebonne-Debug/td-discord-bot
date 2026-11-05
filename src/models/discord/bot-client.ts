/**
 * La tranche du client Discord dont les gestionnaires du bot ont besoin.
 *
 * @interface
 */
export interface BotClient {
  user: { id: string } | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
}
