// Local stand-in for the tracker's GET /v1/metrics?granularity=day, serving one JSON fixture per ISO week.
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { formatIsoWeek, isoWeekOf } from '../src/isoWeek.ts';

const DEFAULT_FIXTURES = join(import.meta.dirname, 'fixtures');

function sendError(res: import('node:http').ServerResponse, status: number, code: string, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: { code, message } }));
}

export function createMockServer(options: { token: string; fixturesDir?: string }): Server {
  const fixturesDir = options.fixturesDir ?? DEFAULT_FIXTURES;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/v1/metrics') {
      return sendError(res, 404, 'not_found', 'Not found');
    }
    if (req.headers.authorization !== `Bearer ${options.token}`) {
      return sendError(res, 401, 'unauthorized', 'Missing or invalid API key');
    }

    const from = url.searchParams.get('from');
    if (!from || !url.searchParams.get('to') || url.searchParams.get('granularity') !== 'day') {
      return sendError(res, 400, 'bad_request', 'from, to and granularity=day are required');
    }

    // `from` is a London midnight, so its date part is the Monday of the requested week.
    const week = formatIsoWeek(isoWeekOf(new Date(`${from.slice(0, 10)}T00:00:00Z`)));
    try {
      const body = await readFile(join(fixturesDir, `${week}.json`), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      sendError(res, 404, 'no_fixture', `No fixture for ${week}`);
    }
  });
}

if (import.meta.main) {
  const token = process.env.MOCK_TOKEN ?? 'mock-token-0123456789abcdef0123456789';
  const port = Number(process.env.PORT ?? 4010);
  createMockServer({ token }).listen(port, () => {
    console.log(`Mock tracker API on http://localhost:${port} (token: ${token})`);
  });
}
