import type { Command } from './command.ts';
import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { ModalSubmitLike } from '../../models/discord/modal-submit-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Routes every incoming interaction to its command: chat inputs by name,
 * modal submissions through the handleSubmit hook of the owning command.
 * Unknown interactions are ignored; handler failures are logged without
 * ever crashing the event loop.
 */
export class CommandDispatcher {
  #commands: Command[];
  #logger: BotLogger;

  constructor({ commands, logger }: { commands: Command[]; logger: BotLogger }) {
    this.#commands = commands;
    this.#logger = logger;
  }

  async dispatch(interaction: InteractionLike | ModalSubmitLike): Promise<void> {
    if (interaction.isModalSubmit()) {
      try {
        for (const command of this.#commands) {
          if (command.handleSubmit && (await command.handleSubmit(interaction))) return;
        }
      } catch (error) {
        this.#logger.error(
          `Failed to handle ${interaction.customId} submit: ${messageOf(error)}`,
        );
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = this.#commands.find((candidate) =>
      candidate.names.includes(interaction.commandName),
    );
    if (!command) return;

    try {
      await command.handle(interaction);
    } catch (error) {
      this.#logger.error(
        `Failed to handle /${interaction.commandName}: ${messageOf(error)}`,
      );
    }
  }
}
