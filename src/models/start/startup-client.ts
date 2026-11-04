/** The slice of the Discord client the startup flow needs. */
export interface StartupClient {
  once(event: string, listener: (...args: any[]) => void): unknown;
  login(token: string): Promise<unknown>;
  destroy(): void;
}
