/** The slice of process installShutdownHandlers needs. */
export interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  exit(code: number): void;
}
