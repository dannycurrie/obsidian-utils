// Local stand-in for the Claude Messages API (POST /v1/messages), returning canned learnings as structured output.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const CANNED_LEARNINGS = [
  'Canned learning one.',
  'Canned learning two.',
  'Canned learning three.',
  'Canned learning four.',
  'Canned learning five.',
];

function sendError(res: ServerResponse, status: number, type: string, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}

/** `requests` collects every accepted request body, so tests can check what was sent. */
export function createClaudeStub(options: { apiKey: string; learnings?: string[] }): {
  server: Server;
  requests: Record<string, unknown>[];
} {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://localhost').pathname !== '/v1/messages') {
      return sendError(res, 404, 'not_found_error', 'Not found');
    }
    // The SDK sends the key as a bearer token; older clients use x-api-key.
    const key = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (key !== options.apiKey) {
      return sendError(res, 401, 'authentication_error', 'invalid x-api-key');
    }
    const body = await readJson(req);
    requests.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `msg_stub_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify({ learnings: options.learnings ?? CANNED_LEARNINGS }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );
  });
  return { server, requests };
}
