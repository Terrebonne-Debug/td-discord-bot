import { once } from 'node:events';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export interface FakeDeepSeekServer {
  url: string;
  calls: Array<Record<string, any>>;
  close(): Promise<void>;
}

/**
 * Minimal DeepSeek (Anthropic-compatible) endpoint. It records every request
 * and answers with scripted text so the real Anthropic SDK can be exercised.
 */
export async function startFakeDeepSeek({
  replies,
}: {
  replies?: ((body: Record<string, any>, callIndex: number) => string) | string[];
} = {}): Promise<FakeDeepSeekServer> {
  const calls: Array<Record<string, any>> = [];
  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    let body: Record<string, any>;
    try {
      body = await readJson(req);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid json' } }));
      return;
    }

    calls.push(body);
    const text =
      typeof replies === 'function'
        ? replies(body, calls.length)
        : (replies?.[calls.length - 1] ?? 'fake response');

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `msg-${calls.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model ?? 'deepseek-v4-flash',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    close() {
      server.closeAllConnections?.();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
