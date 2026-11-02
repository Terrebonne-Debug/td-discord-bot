import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

type Json = Record<string, any>;

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status = 204): void {
  res.writeHead(status);
  res.end();
}

function user(id: string, username: string, bot = false): Json {
  return {
    id,
    username,
    discriminator: bot ? '0001' : '0002',
    global_name: username,
    avatar: null,
    bot,
    public_flags: 0,
  };
}

export interface FakeDiscord {
  url: string;
  guildId: string;
  guildChannelId: string;
  applicationId: string;
  botUser: Json;
  humanUser: Json;
  requests: Json[];
  waitForRequest(predicate: (item: Json) => boolean, timeoutMs?: number): Promise<Json>;
  dispatch(type: string, data: unknown): void;
  dispatchMessage(data: Json): void;
  dispatchCommand(data: {
    interactionId: string;
    commandName: string;
    options?: unknown[];
    subcommand?: string | null;
    dm?: boolean;
  }): void;
  messageData(options: {
    id: string;
    content: string;
    authorId?: string;
    channelId?: string;
    guildIdForMessage?: string | null;
    channelType?: number;
    mentionBot?: boolean;
  }): Json;
  close(): Promise<void>;
}

/**
 * Minimal Discord REST + gateway used to drive the real discord.js client.
 *
 * REST is served under /v10 (discord.js uses version 10 by default) and the
 * WebSocket gateway performs the real HELLO / IDENTIFY / READY / GUILD_CREATE
 * handshake, then lets the test dispatch gateway events.
 */
export async function startFakeDiscord({
  applicationId = 'app-1',
  guildId = 'guild-1',
  guildChannelId = 'guild-channel-1',
  botUserId = 'bot-user',
  humanUserId = 'user-1',
}: {
  applicationId?: string;
  guildId?: string;
  guildChannelId?: string;
  botUserId?: string;
  humanUserId?: string;
} = {}): Promise<FakeDiscord> {
  const botUser = user(botUserId, 'TestBot', true);
  const humanUser = user(humanUserId, 'Alice');

  const guildChannel: Json = {
    id: guildChannelId,
    type: 0,
    guild_id: guildId,
    name: 'general',
    position: 0,
    permission_overwrites: [],
    parent_id: null,
    topic: null,
    nsfw: false,
    rate_limit_per_user: 0,
  };

  const guild: Json = {
    id: guildId,
    name: 'Test Guild',
    icon: null,
    splash: null,
    discovery_splash: null,
    owner_id: humanUserId,
    channels: [guildChannel],
    roles: [
      {
        id: guildId,
        name: '@everyone',
        color: 0,
        hoist: false,
        position: 0,
        permissions: '0',
        managed: false,
        mentionable: false,
        flags: 0,
      },
    ],
    members: [],
    emojis: [],
  };

  const person = (userId: string): Json => (userId === botUserId ? botUser : humanUser);
  const requests: Json[] = [];
  const events = new EventEmitter();
  let nextMessageId = 0;

  function record(entry: Json): Json {
    const item = { ...entry, at: Date.now() };
    requests.push(item);
    events.emit('request', item);
    return item;
  }

  function waitForRequest(
    predicate: (item: Json) => boolean,
    timeoutMs = 5_000,
  ): Promise<Json> {
    const existing = requests.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting for a Discord request. Received: ${
              requests.map((item) => `${item.method} ${item.path}`).join(', ') || 'none'
            }`,
          ),
        );
      }, timeoutMs);

      const onRequest = (item: Json) => {
        if (!predicate(item)) return;
        cleanup();
        resolve(item);
      };

      const cleanup = () => {
        clearTimeout(timer);
        events.off('request', onRequest);
      };

      events.on('request', onRequest);
    });
  }

  function outgoingMessage(
    channelId: string,
    body: Json,
    guildIdForMessage: string | null = null,
  ): Json {
    nextMessageId += 1;
    return {
      id: `sent-${nextMessageId}`,
      channel_id: channelId,
      guild_id: guildIdForMessage,
      author: botUser,
      content: body.content ?? '',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      components: [],
      pinned: false,
      type: 0,
      flags: 0,
    };
  }

  function channelById(channelId: string): Json | null {
    if (channelId === guildChannelId) return guildChannel;
    if (channelId.startsWith('dm-')) {
      return { id: channelId, type: 1, recipients: [humanUser], last_message_id: null };
    }
    return null;
  }

  function commandsResponse(commands: readonly unknown[], guildIdForCommand: string | null = null): Json[] {
    return commands.map((command, index) => ({
      id: `cmd-${guildIdForCommand ?? 'global'}-${index}`,
      application_id: applicationId,
      ...(guildIdForCommand ? { guild_id: guildIdForCommand } : {}),
      ...(command as Json),
      version: '1',
    }));
  }

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    const method = req.method;
    let body: Json = {};

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      body = await readJson(req);
    }

    if (method === 'GET' && pathname === '/v10/gateway/bot') {
      sendJson(res, 200, {
        url: wsUrl,
        shards: 1,
        session_start_limit: {
          total: 1000,
          remaining: 999,
          reset_after: 60_000,
          max_concurrency: 1,
        },
      });
      return;
    }

    let match = pathname.match(/^\/v10\/applications\/([^/]+)\/commands$/);
    if (method === 'PUT' && match) {
      record({ kind: 'globalCommands', method, path: pathname, body });
      sendJson(res, 200, commandsResponse(Array.isArray(body) ? body : []));
      return;
    }

    match = pathname.match(/^\/v10\/applications\/([^/]+)\/guilds\/([^/]+)\/commands$/);
    if (method === 'PUT' && match) {
      record({ kind: 'guildCommands', method, path: pathname, body, guildId: match[2] });
      sendJson(
        res,
        200,
        commandsResponse(Array.isArray(body) ? body : [], match[2]),
      );
      return;
    }

    match = pathname.match(/^\/v10\/guilds\/([^/]+)$/);
    if (method === 'GET' && match) {
      record({ kind: 'guildFetch', method, path: pathname, guildId: match[1] });
      sendJson(res, 200, guild);
      return;
    }

    match = pathname.match(/^\/v10\/channels\/([^/]+)\/messages$/);
    if (method === 'POST' && match) {
      const channelId = match[1];
      record({ kind: 'message', method, path: pathname, channelId, body });
      const channel = channelById(channelId);
      sendJson(
        res,
        200,
        outgoingMessage(channelId, body, channel?.guild_id ?? null),
      );
      return;
    }

    match = pathname.match(/^\/v10\/channels\/([^/]+)\/typing$/);
    if (method === 'POST' && match) {
      record({ kind: 'typing', method, path: pathname, channelId: match[1] });
      sendEmpty(res);
      return;
    }

    match = pathname.match(/^\/v10\/channels\/([^/]+)$/);
    if (method === 'GET' && match) {
      const channel = channelById(match[1]);
      if (!channel) {
        sendJson(res, 404, { message: 'Unknown Channel', code: 10003 });
        return;
      }
      record({ kind: 'channelFetch', method, path: pathname, channelId: match[1] });
      sendJson(res, 200, channel);
      return;
    }

    match = pathname.match(/^\/v10\/interactions\/([^/]+)\/([^/]+)\/callback$/);
    if (method === 'POST' && match) {
      record({
        kind: 'interactionCallback',
        method,
        path: pathname,
        interactionId: match[1],
        token: match[2],
        body,
      });
      sendEmpty(res);
      return;
    }

    match = pathname.match(/^\/v10\/webhooks\/([^/]+)\/([^/]+)\/messages\/@original$/);
    if (method === 'PATCH' && match) {
      record({
        kind: 'editReply',
        method,
        path: pathname,
        applicationId: match[1],
        token: match[2],
        body,
      });
      sendJson(res, 200, outgoingMessage('guild-channel-1', body));
      return;
    }

    match = pathname.match(/^\/v10\/webhooks\/([^/]+)\/([^/]+)$/);
    if (method === 'POST' && match) {
      record({
        kind: 'followUp',
        method,
        path: pathname,
        applicationId: match[1],
        token: match[2],
        body,
      });
      sendJson(res, 200, outgoingMessage('guild-channel-1', body));
      return;
    }

    record({ kind: 'unknown', method, path: pathname, body });
    sendJson(res, 404, { message: 'Not Found', code: 0 });
  });

  const wss = new WebSocketServer({ server });
  let socket: WebSocket | null = null;
  let sequence = 0;

  function send(payload: unknown): void {
    if (socket?.readyState === 1) socket.send(JSON.stringify(payload));
  }

  function dispatch(type: string, data: unknown): void {
    sequence += 1;
    send({ op: 0, s: sequence, t: type, d: data });
  }

  wss.on('connection', (ws: WebSocket) => {
    socket = ws;

    ws.on('message', (raw) => {
      const packet = JSON.parse(raw.toString());
      if (packet.op === 1) {
        send({ op: 11, d: null });
        return;
      }
      if (packet.op === 2) {
        events.emit('identified');
        dispatch('READY', {
          v: 10,
          user: botUser,
          guilds: [{ id: guildId }],
          session_id: 'session-1',
          resume_gateway_url: wsUrl,
          application: { id: applicationId, flags: 0 },
          shard: [0, 1],
        });
        dispatch('GUILD_CREATE', guild);
      }
    });

    send({ op: 10, d: { heartbeat_interval: 45_000 } });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;

  function messageData({
    id,
    content,
    authorId = humanUserId,
    channelId = guildChannelId,
    guildIdForMessage = guildId,
    channelType = 0,
    mentionBot = true,
  }: {
    id: string;
    content: string;
    authorId?: string;
    channelId?: string;
    guildIdForMessage?: string | null;
    channelType?: number;
    mentionBot?: boolean;
  }): Json {
    return {
      id,
      channel_id: channelId,
      channel_type: channelType,
      ...(guildIdForMessage ? { guild_id: guildIdForMessage } : {}),
      author: person(authorId),
      content,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: mentionBot ? [botUser] : [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      components: [],
      pinned: false,
      type: 0,
      flags: 0,
    };
  }

  function commandData({
    interactionId,
    commandName,
    options = [],
    subcommand = null,
    dm = false,
  }: {
    interactionId: string;
    commandName: string;
    options?: unknown[];
    subcommand?: string | null;
    dm?: boolean;
  }): Json {
    return {
      id: interactionId,
      application_id: applicationId,
      type: 2,
      token: `token-${interactionId}`,
      ...(dm
        ? {
            user: humanUser,
            channel_id: 'dm-1',
            channel: { id: 'dm-1', type: 1, recipients: [humanUser] },
          }
        : {
            guild_id: guildId,
            channel_id: guildChannelId,
            channel: guildChannel,
            member: {
              user: humanUser,
              roles: [],
              permissions: '0',
              joined_at: new Date(0).toISOString(),
              deaf: false,
              mute: false,
              flags: 0,
              pending: false,
            },
            app_permissions: '0',
            guild_locale: 'en-US',
          }),
      data: {
        id: `cmd-${commandName}`,
        name: commandName,
        type: 1,
        options: subcommand
          ? [{ name: subcommand, type: 1 }]
          : options,
      },
      authorizing_integration_owners: dm
        ? { 1: humanUserId }
        : { 0: guildId },
      entitlements: [],
      version: 1,
      locale: 'en-US',
    };
  }

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    guildId,
    guildChannelId,
    applicationId,
    botUser,
    humanUser,
    requests,
    waitForRequest,
    dispatch,
    dispatchMessage(data) {
      dispatch('MESSAGE_CREATE', data);
    },
    dispatchCommand(data) {
      dispatch('INTERACTION_CREATE', commandData(data));
    },
    messageData,
    close() {
      for (const client of wss.clients) client.terminate();
      server.closeAllConnections?.();
      return new Promise<void>((resolve) =>
        wss.close(() => server.close(() => resolve())),
      );
    },
  };
}
