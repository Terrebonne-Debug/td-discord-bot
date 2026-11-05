import { ChannelType, Events } from 'discord.js';
import { defaultDeepSeek, DeepSeek } from '../deepseek/deepseek.ts';
import { GitHubIssues } from '../github/github-issues.ts';
import { LoggerFactory } from '../logging/logger-factory.ts';
import { Errors } from '../utils/errors.ts';
import { Commands } from './commands.ts';
import { CommandDispatcher } from './commands/command-dispatcher.ts';
import { FeatureRequestCommand } from './commands/feature-request-command.ts';
import { HelpCommand } from './commands/help-command.ts';
import { QuestionCommand } from './commands/question-command.ts';
import { VersionCommand } from './commands/version-command.ts';
import { ConversationService } from './conversation/conversation-service.ts';
import { MentionConversation } from './conversation/mention-conversation.ts';
import type { BotSettings } from '../models/bot/bot-settings.ts';
import type { BotClient } from '../models/discord/bot-client.ts';
import type { CommandClient } from '../models/discord/command-client.ts';
import type { InteractionLike } from '../models/discord/interaction-like.ts';
import type { MessageLike } from '../models/discord/message-like.ts';
import type { ModalSubmitLike } from '../models/discord/modal-submit-like.ts';
import type { TypingChannel } from '../models/discord/typing-channel.ts';
import type { BotLogger } from '../models/logging/bot-logger.ts';
import type { ConversationMemory } from '../models/memory/conversation-memory.ts';
import type { Turn } from '../models/memory/turn.ts';
import type { BuildInfo } from '../models/version/build-info.ts';

const DISCORD_MESSAGE_LIMIT = 2000;
const TYPING_INTERVAL_MS = 8_000;

/**
 * Façade du bot : branche les événements Discord sur le répartiteur de
 * commandes (patron Commande) et le service de conversation (patron
 * Stratégie). Les dépendances sont injectées pour que tout le flux puisse
 * être piloté en test sans Discord ni DeepSeek.
 *
 * @class
 */
export class Bot {
  /**
   * Découpe un texte en morceaux de la taille maximale de Discord.
   *
   * @static
   * @function
   * @param {string} text - Le texte à découper.
   * @param {number} [limit=2000] - La taille maximale d'un morceau.
   * @returns {string[]} Les morceaux, jamais vides.
   */
  static splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
    const normalized = text.trim();
    if (!normalized) return ['Le modèle a renvoyé une réponse vide.'];
    if (normalized.length <= limit) return [normalized];

    const chunks: string[] = [];
    let remaining = normalized;

    while (remaining.length > limit) {
      let splitAt = remaining.lastIndexOf('\n', limit);
      if (splitAt < limit * 0.6) splitAt = remaining.lastIndexOf(' ', limit);
      if (splitAt < limit * 0.6) splitAt = limit;

      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }

    chunks.push(remaining);
    return chunks;
  }

  /**
   * Affiche l'indicateur de frappe, immédiatement puis par intervalles.
   *
   * @static
   * @function
   * @param {TypingChannel | null | undefined} channel - Le canal qui frappe.
   * @param {number} [intervalMs=8000] - L'intervalle de répétition.
   * @returns {() => void} La fonction qui arrête l'indicateur.
   */
  static startTyping(
    channel: TypingChannel | null | undefined,
    intervalMs = TYPING_INTERVAL_MS,
  ): () => void {
    /** Lié pour que l'indicateur survive au rappel d'intervalle. */
    const sendTyping = channel?.sendTyping?.bind(channel);
    if (!sendTyping) return () => {};

    void sendTyping().catch(() => {});
    const timer = setInterval(() => {
      void sendTyping().catch(() => {});
    }, intervalMs);
    timer.unref();

    return () => clearInterval(timer);
  }

  /**
   * Retire la mention du bot d'un message et nettoie les espaces.
   *
   * @static
   * @function
   * @param {string} content - Le contenu brut du message.
   * @param {string | null | undefined} botId - L'identifiant du bot.
   * @returns {string} Le prompt nettoyé.
   */
  static stripBotMention(content: string, botId: string | null | undefined): string {
    if (!botId) return content.trim();
    return content.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ').trim();
  }

  /**
   * Décrit une erreur de requête pour l'utilisateur.
   *
   * @static
   * @function
   * @param {unknown} error - L'erreur à décrire.
   * @returns {string} Le message destiné à l'utilisateur.
   */
  static describeRequestError(error: unknown): string {
    if ((error as { memoryUnavailable?: boolean } | null | undefined)?.memoryUnavailable) {
      return 'La mémoire de conversation est momentanément indisponible. Réessaie bientôt.';
    }
    return DeepSeek.describeError(error);
  }

  /**
   * Le créateur d'issue de production de `/feature-request` : publie via
   * l'API GitHub avec le jeton et le dépôt configurés. Exposé comme fabrique
   * pour que ses branches soient testables avec un fetch injecté.
   *
   * @static
   * @function
   * @param {BotSettings} settings - Les réglages du bot.
   * @param {typeof fetch} [fetchFn=fetch] - La fonction fetch à utiliser.
   * @returns {(title: string, body: string) => Promise<string>} Le créateur d'issue.
   */
  static createIssueFor(
    settings: BotSettings,
    fetchFn: typeof fetch = fetch,
  ): (title: string, body: string) => Promise<string> {
    return (title, body) => {
      if (!settings.githubToken) throw new Error("GITHUB_TOKEN n'est pas défini.");
      const issues = new GitHubIssues(
        {
          token: settings.githubToken,
          repository: settings.githubRepository,
          title,
          body,
        },
        fetchFn,
      );
      return issues.createIssue();
    };
  }

  /**
   * Enregistre les commandes slash auprès de la guilde ou globalement.
   *
   * @static
   * @function
   * @param {CommandClient} client - Le client Discord.
   * @param {{ discordGuildId: string | null; maxPromptChars: number }} settings - Les réglages.
   * @param {BotLogger} [logger] - Le journal du bot.
   * @returns {Promise<void>}
   */
  static async registerCommands(
    client: CommandClient,
    settings: { discordGuildId: string | null; maxPromptChars: number },
    logger: BotLogger = new LoggerFactory().consoleLogger(),
  ): Promise<void> {
    const commands = Commands.build(settings);

    try {
      if (settings.discordGuildId) {
        const guild = await client.guilds.fetch(settings.discordGuildId);
        await guild.commands.set(commands);
        logger.info(`${commands.length} commandes slash enregistrées dans ${guild.name}.`);
      } else {
        /** Après la connexion, l'application existe toujours. */
        await client.application!.commands.set(commands);
        logger.info(
          `${commands.length} commandes slash globales enregistrées (elles peuvent mettre jusqu'à une heure à apparaître).`,
        );
      }
    } catch (error) {
      logger.error(`Impossible d'enregistrer les commandes slash : ${Errors.messageOf(error)}`);
    }
  }

  /** @type {BotClient} Le client Discord. */
  #client: BotClient;
  /** @type {BotSettings} Les réglages du bot. */
  #settings: BotSettings;
  /** @type {BotLogger} Le journal du bot. */
  #logger: BotLogger;
  /** @type {ConversationService} L'algorithme de conversation partagé. */
  #conversations: ConversationService;
  /** @type {CommandDispatcher} Le répartiteur de commandes. */
  #dispatcher: CommandDispatcher;

  /**
   * @constructor
   * @param {BotClient} client - Le client Discord.
   * @param {ConversationMemory} memory - La mémoire des canaux.
   * @param {BotSettings} settings - Les réglages du bot.
   * @param {(history: Turn[], prompt: string) => Promise<string>} [ask] - Le modèle.
   * @param {BuildInfo} [buildInfo] - La version et le commit.
   * @param {(title: string, body: string) => Promise<string>} [createIssue] - Le créateur d'issue.
   * @param {BotLogger} [logger] - Le journal du bot.
   */
  constructor({
    client,
    memory,
    settings,
    ask = defaultDeepSeek.ask.bind(defaultDeepSeek),
    buildInfo = { version: 'inconnue', commit: 'inconnu' },
    createIssue = Bot.createIssueFor(settings),
    logger = new LoggerFactory().consoleLogger(),
  }: {
    client: BotClient;
    memory: ConversationMemory;
    settings: BotSettings;
    ask?: (history: Turn[], prompt: string) => Promise<string>;
    buildInfo?: BuildInfo;
    createIssue?: (title: string, body: string) => Promise<string>;
    logger?: BotLogger;
  }) {
    this.#client = client;
    this.#settings = settings;
    this.#logger = logger;
    this.#conversations = new ConversationService({ memory, ask, logger });
    this.#dispatcher = new CommandDispatcher({
      commands: [
        new QuestionCommand({ conversations: this.#conversations, settings, logger }),
        new VersionCommand(buildInfo),
        new HelpCommand(),
        new FeatureRequestCommand({ settings, createIssue, logger }),
      ],
      logger,
    });

    client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction);
    });
    client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });
    client.on(Events.Error, (error: Error) => {
      this.#logger.error(`Erreur du client Discord : ${Errors.messageOf(error)}`);
    });
  }

  /**
   * Achemine une interaction vers sa commande.
   *
   * @method
   * @param {InteractionLike | ModalSubmitLike} interaction - L'interaction reçue.
   * @returns {Promise<void>}
   */
  async handleInteraction(interaction: InteractionLike | ModalSubmitLike): Promise<void> {
    await this.#dispatcher.dispatch(interaction);
  }

  /**
   * Traite un message mentionnant le bot via la variante mention de
   * l'algorithme de conversation.
   *
   * @method
   * @param {MessageLike} message - Le message reçu.
   * @returns {Promise<void>}
   */
  async handleMessage(message: MessageLike): Promise<void> {
    if (message.author.bot || message.system) return;

    const isDM = message.channel.type === ChannelType.DM;
    const mentioned = this.#client.user ? message.mentions.users.has(this.#client.user.id) : false;
    if (!isDM && !mentioned) return;

    await this.#conversations.handle(
      new MentionConversation(
        message,
        this.#client.user ? this.#client.user.id : null,
        this.#settings,
        this.#logger,
      ),
    );
  }
}
