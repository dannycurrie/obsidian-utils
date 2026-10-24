import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before } from 'node:test';
import { promisify } from 'node:util';
import { createMockServer } from '../mock/server.ts';
import type { Metric, MetricsResponse } from '../src/api.ts';

export const TOKEN = 'test-token-0123456789abcdef0123456789';
const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');

/** Starts the mock tracker API for the calling test file; read `mock.baseUrl` inside tests. */
export function useMockApi() {
  const server = createMockServer({ token: TOKEN });
  const mock = { baseUrl: '' };
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    mock.baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  return mock;
}

/**
 * Temp vault with a `Plans/Week plans` folder and a config file pointing at it.
 * Pass `noteContent` to create the week's note up front.
 */
export async function makeVault(options: {
  baseUrl: string;
  week: string;
  noteContent?: string;
  config?: Record<string, unknown>;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'week-review-'));
  const vaultPath = join(dir, 'vault');
  const noteDir = join(vaultPath, 'Plans', 'Week plans');
  await mkdir(noteDir, { recursive: true });
  const notePath = join(noteDir, `${options.week}.md`);
  if (options.noteContent !== undefined) await writeFile(notePath, options.noteContent);
  const configPath = join(dir, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      baseUrl: options.baseUrl,
      vaultPath,
      realVault: join(dir, 'real-vault'),
      noteFolder: 'Plans/Week plans',
      ...options.config,
    }),
  );
  return { dir, vaultPath, noteDir, notePath, configPath };
}

export function tokenEnv(): NodeJS.ProcessEnv {
  return { ...process.env, WEEK_REVIEW_TOKEN: TOKEN };
}

export function runCli(args: string[], configPath: string) {
  return promisify(execFile)(process.execPath, [CLI, ...args], {
    env: { ...tokenEnv(), WEEK_REVIEW_CONFIG: configPath },
  });
}

/** Runs the CLI as a subprocess without throwing on a non-zero exit. */
export function runCliResult(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** Every file under `dir` with its contents, for byte-identical before/after checks. */
export async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[path] = await readFile(path, 'utf8');
    }
  }
  return files;
}

/** The review block with the run-dependent "Generated" timestamp normalised. */
export function reviewBlock(note: string): string {
  const start = note.indexOf('<!-- week-review:start -->');
  return note.slice(start).replace(/_Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} /, '_Generated <time> ');
}

/** Builds an API response from partial metrics, for unit tests that skip the mock. */
export function responseWith(...metrics: Partial<Metric>[]): MetricsResponse {
  return {
    from: '2026-10-05T00:00:00+01:00',
    to: '2026-10-12T00:00:00+01:00',
    timezone: 'Europe/London',
    metrics: metrics.map((m, i) => ({
      id: `m${i}`,
      name: `Metric ${i}`,
      type: 'cumulative',
      timeframe: 'weekly',
      source: 'user',
      unit: null,
      periods: [],
      ...m,
    })),
  };
}

export const day = (value: number | null, entryCount: number, start = '2026-10-05T00:00:00+01:00') => ({
  start,
  end: start,
  partial: false,
  entryCount,
  value,
});
