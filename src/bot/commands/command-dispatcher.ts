import type { InteractionLike } from '../../models/discord/interaction-like.ts';
import type { ModalSubmitLike } from '../../models/discord/modal-submit-like.ts';
import type { BotLogger } from '../../models/logging/bot-logger.ts';
import { Errors } from '../../utils/errors.ts';
import type { Command } from './command.ts';

/**
 * Achemine chaque interaction entrante vers sa commande : les entrées de
 * discussion par nom, les soumissions de modal par le hook handleSubmit de la
 * commande propriétaire. Les interactions inconnues sont ignorées ; les
 * échecs de traitement sont journalisés sans jamais faire tomber la boucle
 * d'événements.
 *
 * @class CommandDispatcher
 */
export class CommandDispatcher {
  /** @type {Command[]} Les commandes enregistrées, dans l'ordre de routage. */
  #commands: Command[];
  /** @type {BotLogger} Le journal du bot. */
  #logger: BotLogger;

  /**
   * @constructor
   * @param {Command[]} commands - Les commandes à router.
   * @param {BotLogger} logger - Le journal du bot.
   */
  constructor({ commands, logger }: { commands: Command[]; logger: BotLogger }) {
    this.#commands = commands;
    this.#logger = logger;
  }

  /**
   * Achemine une interaction.
   *
   * @method
   * @param {InteractionLike | ModalSubmitLike} interaction - L'interaction reçue.
   * @returns {Promise<void>}
   */
  async dispatch(interaction: InteractionLike | ModalSubmitLike): Promise<void> {
    if (interaction.isModalSubmit()) {
      try {
        for (const command of this.#commands) {
          if (command.handleSubmit && (await command.handleSubmit(interaction))) return;
        }
      } catch (error) {
        this.#logger.error(
          `Échec du traitement de la soumission ${interaction.customId} : ${Errors.messageOf(error)}`,
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
        `Échec du traitement de /${interaction.commandName} : ${Errors.messageOf(error)}`,
      );
    }
  }
}
