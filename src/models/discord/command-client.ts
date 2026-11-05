/**
 * La tranche du client Discord dont Bot.registerCommands a besoin.
 *
 * @interface
 */
export interface CommandClient {
  guilds: {
    fetch(
      id: string,
    ): Promise<{ name: string; commands: { set(commands: readonly unknown[]): Promise<unknown> } }>;
  };
  application: { commands: { set(commands: readonly unknown[]): Promise<unknown> } } | null;
}
