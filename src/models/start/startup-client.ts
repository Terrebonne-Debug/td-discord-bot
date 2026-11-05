/**
 * La tranche du client Discord dont le flux de démarrage a besoin.
 *
 * @interface
 */
export interface StartupClient {
  once(event: string, listener: (...args: any[]) => void): unknown;
  login(token: string): Promise<unknown>;
  destroy(): void;
}
