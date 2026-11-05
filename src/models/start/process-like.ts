/**
 * La tranche de process dont Launcher.installShutdownHandlers a besoin.
 *
 * @interface
 */
export interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  exit(code: number): void;
}
