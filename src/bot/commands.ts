import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

/** Single source of truth for the slash commands: registration and help. */
const COMMANDS: Array<{ name: string; description: string; help: string }> = [
  {
    name: 'q',
    description: 'Pose une question',
    help: '`/q <question>` — pose une question au bot.',
  },
  {
    name: 'version',
    description: 'Affiche la version du bot',
    help: '`/version` — affiche le numéro de version et le dernier commit.',
  },
  {
    name: 'aide',
    description: 'Liste les commandes disponibles',
    help: '`/aide` (alias : `/help`) — affiche cette liste.',
  },
  {
    name: 'help',
    description: 'Liste les commandes disponibles (alias de /aide)',
    help: '`/help` (alias : `/aide`) — affiche cette liste.',
  },
  {
    name: 'feature-request',
    description: 'Crée une issue GitHub de suggestion',
    help: '`/feature-request` — ouvre un formulaire (titre + description) pour créer une issue GitHub.',
  },
];

/**
 * Builds the Discord payloads of every slash command, their help text and
 * the /feature-request modal, all derived from the same definitions.
 */
export class Commands {
  static build(settings: { maxPromptChars: number }) {
    return COMMANDS.map((command) => {
      const builder = new SlashCommandBuilder()
        .setName(command.name)
        .setDescription(command.description);

      if (command.name === 'q') {
        builder.addStringOption((option) =>
          option
            .setName('prompt')
            .setDescription('Ta question')
            .setRequired(true)
            .setMaxLength(Math.min(settings.maxPromptChars, 6000)),
        );
      }

      return builder.toJSON();
    });
  }

  /** Le texte de /aide et /help, dérivé des mêmes définitions. */
  static helpText(): string {
    const lines = COMMANDS.filter((command) => command.name !== 'help').map(
      (command) => `- ${command.help}`,
    );
    return ['**Commandes disponibles**', ...lines].join('\n');
  }

  /**
   * Le formulaire de /feature-request : un titre court et une description,
   * Discord n'offrant pas de saisie multi-champs dans une slash command.
   */
  static featureRequestModal(): ModalBuilder {
    return new ModalBuilder()
      .setCustomId('feature-request')
      .setTitle('Demande de fonctionnalité')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('titre')
            .setLabel('Titre')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Résumé court de la suggestion')
            .setRequired(true)
            .setMaxLength(200),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Décris la fonctionnalité souhaitée')
            .setRequired(true)
            .setMaxLength(4000),
        ),
      );
  }
}
