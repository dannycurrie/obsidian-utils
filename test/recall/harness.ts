import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach } from 'node:test';
import { createClaudeStub } from '../../mock/claude.ts';

export const API_KEY = 'sk-ant-test-0123456789abcdef';
const CLI = join(import.meta.dirname, '..', '..', 'src', 'recall', 'cli.ts');

/**
 * Starts the Claude stub for the calling test file; read `stub.baseUrl` inside tests.
 * `stub.requests` holds the bodies the current test sent, and `stub.headers` their headers.
 */
export function useClaudeStub(options: { learnings?: string[] } = {}) {
  const { server, requests, headers, script } = createClaudeStub({ apiKey: API_KEY, ...options });
  // `stub.script` queues per-request behaviours (errors, hangs, bad replies) for the current test.
  const stub = { baseUrl: '', requests, headers, script };
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    stub.baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    requests.length = 0;
    headers.length = 0;
    script.length = 0;
  });
  after(() => {
    server.closeAllConnections(); // drops requests a `hang` left open
    server.close();
  });
  return stub;
}

/**
 * Temp vault with `Books/`, `Daily/` and `Daily/Recall/` notes plus a config file pointing at it and the stub.
 * Book keys may include subfolders; `recall` seeds recall notes by date; `files` adds any other vault file,
 * keyed by vault-relative path.
 */
export async function makeRecallVault(options: {
  baseUrl: string;
  books?: Record<string, string>;
  daily?: Record<string, string>;
  recall?: Record<string, string>;
  files?: Record<string, string>;
  config?: Record<string, unknown>;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'book-recall-'));
  const vaultPath = join(dir, 'vault');
  await mkdir(join(vaultPath, 'Books'), { recursive: true });
  await mkdir(join(vaultPath, 'Daily'), { recursive: true });
  for (const [title, content] of Object.entries(options.books ?? {})) {
    const path = join(vaultPath, 'Books', `${title}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  for (const [date, content] of Object.entries(options.daily ?? {})) {
    await writeFile(join(vaultPath, 'Daily', `${date}.md`), content);
  }
  for (const [date, content] of Object.entries(options.recall ?? {})) {
    await mkdir(join(vaultPath, 'Daily', 'Recall'), { recursive: true });
    await writeFile(join(vaultPath, 'Daily', 'Recall', `${date}.md`), content);
  }
  for (const [path, content] of Object.entries(options.files ?? {})) {
    await mkdir(dirname(join(vaultPath, path)), { recursive: true });
    await writeFile(join(vaultPath, path), content);
  }
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify({ vaultPath, apiBaseUrl: options.baseUrl, ...options.config }));
  return {
    dir,
    vaultPath,
    configPath,
    dailyPath: (date: string) => join(vaultPath, 'Daily', `${date}.md`),
    recallPath: (date: string) => join(vaultPath, 'Daily', 'Recall', `${date}.md`),
  };
}

export function recallEnv(configPath: string): NodeJS.ProcessEnv {
  return { ...process.env, BOOK_RECALL_API_KEY: API_KEY, BOOK_RECALL_CONFIG: configPath };
}

/** Runs the CLI as a subprocess without throwing on a non-zero exit. */
export function runRecall(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** The recall block with the run-dependent "Generated" timestamp normalised. */
export function recallBlock(note: string): string {
  const start = note.indexOf('<!-- book-recall:start -->');
  return note.slice(start).replace(/_Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} /, '_Generated <time> ');
}
