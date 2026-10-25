// Local stand-in for the Claude Messages API (POST /v1/messages), returning canned learnings as structured output.
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const CANNED_LEARNINGS = [
  'Canned learning one.',
  'Canned learning two.',
  'Canned learning three.',
  'Canned learning four.',
  'Canned learning five.',
];

/**
 * What the stub does for one request. Queue these in `script`; each request takes the next one,
 * and an empty queue falls back to the canned success.
 * - `status`: an API error response (401, 429, 500, ...)
 * - `hang`: accept the request and never answer, so the client times out
 * - `learnings`: a reply whose JSON holds this value (any shape, e.g. 4 items or empty strings)
 * - `text`: a reply with this raw text (e.g. a preamble that isn't JSON)
 * - `refusal`: a safety refusal (`stop_reason: "refusal"`) with this `stop_details.category`
 * `model` on a reply stands in for the model that answered, e.g. after a refusal fallback.
 */
export type StubBehaviour =
  | { status: number; type?: string; message?: string }
  | { hang: true }
  | { learnings: unknown; stop_reason?: string; model?: string }
  | { text: string; stop_reason?: string; model?: string }
  | { refusal: string | null };

const ERROR_TYPES: Record<number, string> = {
  401: 'authentication_error',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error',
};

function sendError(res: ServerResponse, status: number, type: string, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}

/**
 * `requests` collects every request body sent with the right key (scripted failures included),
 * so its length is the number of requests made; `headers` holds each one's headers, in the same order.
 */
export function createClaudeStub(options: { apiKey: string; learnings?: string[] }): {
  server: Server;
  requests: Record<string, unknown>[];
  headers: IncomingHttpHeaders[];
  script: StubBehaviour[];
} {
  const requests: Record<string, unknown>[] = [];
  const headers: IncomingHttpHeaders[] = [];
  const script: StubBehaviour[] = [];
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
    headers.push(req.headers);
    const behaviour: StubBehaviour = script.shift() ?? { learnings: options.learnings ?? CANNED_LEARNINGS };
    if ('hang' in behaviour) return;
    if ('status' in behaviour) {
      const type = behaviour.type ?? ERROR_TYPES[behaviour.status] ?? 'api_error';
      return sendError(res, behaviour.status, type, behaviour.message ?? `stub ${type}`);
    }
    const refusal = 'refusal' in behaviour;
    const text = refusal ? '' : 'text' in behaviour ? behaviour.text : JSON.stringify({ learnings: behaviour.learnings });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `msg_stub_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: (!refusal && behaviour.model) || body.model,
        content: refusal ? [] : [{ type: 'text', text }],
        stop_reason: refusal ? 'refusal' : (behaviour.stop_reason ?? 'end_turn'),
        stop_details: refusal
          ? { type: 'refusal', category: behaviour.refusal, explanation: 'stub refusal' }
          : null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );
  });
  return { server, requests, headers, script };
}
