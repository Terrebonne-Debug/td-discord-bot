import { EventEmitter } from 'node:events';
import { ChannelType, Events } from 'discord.js';
import type { BotClient } from '../../src/models/discord/bot-client.ts';
import type { InteractionLike } from '../../src/models/discord/interaction-like.ts';
import type { MessageChannelLike } from '../../src/models/discord/message-channel-like.ts';
import type { MessageLike } from '../../src/models/discord/message-like.ts';
import type { ModalSubmitLike } from '../../src/models/discord/modal-submit-like.ts';
import type { ReplyPayload } from '../../src/models/discord/reply-payload.ts';
import type { TypingChannel } from '../../src/models/discord/typing-channel.ts';
import type { BotLogger } from '../../src/models/logging/bot-logger.ts';
import type { ConversationMemory } from '../../src/models/memory/conversation-memory.ts';
import type { Turn } from '../../src/models/memory/turn.ts';
import type { StartupClient } from '../../src/models/start/startup-client.ts';

export const BOT_USER_ID = 'bot-user';

export type FakeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FakeLogEntry {
  level: FakeLogLevel;
  message: string;
  fields?: Record<string, unknown>;
}

export interface Logger extends BotLogger {
  entries: FakeLogEntry[];
  /**
   * Les messages enregistrés au niveau donné, dans l'ordre.
   *
   * @method
   * @param {FakeLogLevel} level - Le niveau demandé.
   * @returns {string[]} Les messages de ce niveau.
   */
  messages(level: FakeLogLevel): string[];
}

export function createLogger(): Logger {
  const entries: FakeLogEntry[] = [];
  const record =
    (level: FakeLogLevel) =>
    (message: string, fields?: Record<string, unknown>): void => {
      entries.push(fields === undefined ? { level, message } : { level, message, fields });
    };

  const logger: Logger = {
    entries,
    messages: (level) =>
      entries.filter((entry) => entry.level === level).map((entry) => entry.message),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
    flush: async () => {},
  };
  return logger;
}

export interface FakeGuild {
  name: string;
  commands: { set(commands: readonly unknown[]): Promise<void> };
}

export interface FakeClient extends BotClient, StartupClient {
  user: { id: string; tag: string };
  destroyed: boolean;
  emit(event: string, ...args: any[]): boolean;
  application: { commands: { set(commands: readonly unknown[]): Promise<void> } };
  guilds: { fetch(id: string): Promise<FakeGuild> };
  globalCommands: Array<Record<string, any>>;
  guildCommands: Array<Record<string, any>>;
  fetchedGuildId: string | undefined;
}

export function createFakeClient({
  userId = BOT_USER_ID,
  tag = 'TestBot#0001',
}: { userId?: string; tag?: string } = {}): FakeClient {
  const client = new EventEmitter();
  const fake = Object.assign(client, {
    user: { id: userId, tag },
    destroyed: false,
    globalCommands: [] as Array<Record<string, any>>,
    guildCommands: [] as Array<Record<string, any>>,
    fetchedGuildId: undefined as string | undefined,
    destroy: () => {
      fake.destroyed = true;
    },
    login: async () => {
      fake.emit(Events.ClientReady, fake);
    },
    application: {
      commands: {
        set: async (commands: readonly unknown[]) => {
          fake.globalCommands = commands as Array<Record<string, any>>;
        },
      },
    },
    guilds: {
      fetch: async (id: string): Promise<FakeGuild> => {
        fake.fetchedGuildId = id;
        return {
          name: 'Guild Name',
          commands: {
            set: async (commands: readonly unknown[]) => {
              fake.guildCommands = commands as Array<Record<string, any>>;
            },
          },
        };
      },
    },
  }) as EventEmitter & FakeClient;
  return fake;
}

export interface FakeCall {
  method: string;
  payload?: ReplyPayload;
}

function makeFailureCounter(failures: Record<string, number>) {
  const remaining: Record<string, number> = {
    reply: 0,
    deferReply: 0,
    editReply: 0,
    followUp: 0,
    send: 0,
    typing: 0,
    ...failures,
  };

  return (method: string) => {
    if (remaining[method] > 0) {
      remaining[method] -= 1;
      throw new Error(`${method} a échoué`);
    }
  };
}

export interface FakeInteraction extends InteractionLike {
  calls: FakeCall[];
  modals: unknown[];
}

export function createFakeInteraction({
  commandName = 'q',
  prompt = 'hello',
  guildId = null,
  channelId = 'channel-1',
  userId = 'user-1',
  username = 'alice',
  channel = null,
  chatInput = true,
  failures = {},
}: {
  commandName?: string;
  prompt?: string;
  guildId?: string | null;
  channelId?: string | null;
  userId?: string;
  username?: string;
  channel?: TypingChannel | null;
  chatInput?: boolean;
  failures?: Record<string, number>;
} = {}): FakeInteraction {
  const calls: FakeCall[] = [];
  const modals: unknown[] = [];
  const fail = makeFailureCounter(failures);

  const interaction: FakeInteraction = {
    commandName,
    channelId,
    channel,
    user: { id: userId, username },
    deferred: false,
    replied: false,
    calls,
    modals,
    inGuild: () => Boolean(guildId),
    isChatInputCommand(): this is InteractionLike {
      return chatInput;
    },
    isModalSubmit(): this is ModalSubmitLike {
      return false;
    },
    options: {
      getString: () => {
        fail('getString');
        return prompt;
      },
    },
    async showModal(modal) {
      calls.push({ method: 'showModal' });
      modals.push(modal);
      fail('showModal');
    },
    async reply(payload) {
      calls.push({ method: 'reply', payload });
      fail('reply');
      interaction.replied = true;
    },
    async deferReply() {
      calls.push({ method: 'deferReply' });
      fail('deferReply');
      interaction.deferred = true;
    },
    async editReply(payload) {
      calls.push({ method: 'editReply', payload });
      fail('editReply');
      interaction.replied = true;
    },
    async followUp(payload) {
      calls.push({ method: 'followUp', payload });
      fail('followUp');
      interaction.replied = true;
    },
  };

  return interaction;
}

export interface FakeModalSubmit extends ModalSubmitLike {
  calls: FakeCall[];
}

export function createFakeModalSubmit({
  customId = 'feature-request',
  title = 'Un titre',
  description = 'Une description',
  userId = 'user-1',
  username = 'alice',
  failures = {},
}: {
  customId?: string;
  title?: string;
  description?: string;
  userId?: string;
  username?: string;
  failures?: Record<string, number>;
} = {}): FakeModalSubmit {
  const calls: FakeCall[] = [];
  const fail = makeFailureCounter(failures);

  const modal: FakeModalSubmit = {
    customId,
    user: { id: userId, username },
    deferred: false,
    replied: false,
    calls,
    isChatInputCommand(): this is InteractionLike {
      return false;
    },
    isModalSubmit(): this is ModalSubmitLike {
      return true;
    },
    fields: {
      getTextInputValue: (name) => {
        fail('getTextInputValue');
        return name === 'titre' ? title : description;
      },
    },
    async reply(payload) {
      calls.push({ method: 'reply', payload });
      fail('reply');
      modal.replied = true;
    },
    async deferReply() {
      calls.push({ method: 'deferReply' });
      fail('deferReply');
      modal.deferred = true;
    },
    async editReply(payload) {
      calls.push({ method: 'editReply', payload });
      fail('editReply');
      modal.replied = true;
    },
    async followUp(payload) {
      calls.push({ method: 'followUp', payload });
      fail('followUp');
      modal.replied = true;
    },
  };

  return modal;
}

export interface FakeMessage extends MessageLike {
  calls: FakeCall[];
}

export function createFakeMessage({
  content = `<@${BOT_USER_ID}> hello`,
  author = { id: 'user-1', bot: false },
  system = false,
  channelType = ChannelType.GuildText,
  channelId = 'channel-1',
  mentionsBot = true,
  botUserId = BOT_USER_ID,
  withoutTyping = false,
  failures = {},
}: {
  content?: string;
  author?: { id: string; bot: boolean };
  system?: boolean;
  channelType?: ChannelType;
  channelId?: string;
  mentionsBot?: boolean;
  botUserId?: string;
  withoutTyping?: boolean;
  failures?: Record<string, number>;
} = {}): FakeMessage {
  const calls: FakeCall[] = [];
  const fail = makeFailureCounter(failures);

  const channel: MessageChannelLike = {
    type: channelType,
    send: async (payload) => {
      calls.push({ method: 'send', payload });
      fail('send');
      return {};
    },
  };

  if (!withoutTyping) {
    channel.sendTyping = async () => {
      calls.push({ method: 'sendTyping' });
      fail('typing');
    };
  }

  const message: FakeMessage = {
    author,
    system,
    channel,
    channelId,
    content,
    calls,
    mentions: {
      users: new Map(mentionsBot ? [[botUserId, {}]] : []),
    },
    async reply(payload) {
      calls.push({ method: 'reply', payload });
      fail('reply');
      return {};
    },
  };

  return message;
}

export interface FakeMemoryCall {
  method: string;
  [key: string]: unknown;
}

export interface FakeMemory extends ConversationMemory {
  calls: FakeMemoryCall[];
}

export function createFakeMemory({
  mode = 'mongo',
  histories = {},
  failures = {},
}: {
  mode?: 'mongo' | 'memory';
  histories?: Record<string, Turn[]>;
  failures?: Record<string, number>;
} = {}): FakeMemory {
  const calls: FakeMemoryCall[] = [];
  const remaining = { ...failures };
  const fail = (method: string) => {
    if (remaining[method] > 0) {
      remaining[method] -= 1;
      throw new Error(`${method} a échoué`);
    }
  };

  return {
    mode,
    calls,
    async getHistory(key: string): Promise<Turn[]> {
      calls.push({ method: 'getHistory', key });
      fail('getHistory');
      return histories[key] ?? [];
    },
    async appendTurn(key: string, prompt: string, reply: string): Promise<boolean> {
      calls.push({ method: 'appendTurn', key, prompt, reply });
      fail('appendTurn');
      return true;
    },
    async close() {
      calls.push({ method: 'close' });
      fail('close');
    },
  };
}
