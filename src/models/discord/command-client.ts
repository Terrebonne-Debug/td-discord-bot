/** The slice of the Discord client registerCommands needs. */
export interface CommandClient {
  guilds: {
    fetch(
      id: string,
    ): Promise<{ name: string; commands: { set(commands: readonly unknown[]): Promise<unknown> } }>;
  };
  application: { commands: { set(commands: readonly unknown[]): Promise<unknown> } } | null;
}
