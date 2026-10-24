import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertNoSecrets } from '../shared/secrets.ts';

export type RecallConfig = {
  vaultPath: string;
  booksFolder: string;
  dailyFolder: string;
  model: string;
  /** Claude API base URL; only set to point at the local stub. */
  apiBaseUrl?: string;
};

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function defaultConfigPath(env: NodeJS.ProcessEnv): string {
  return env.BOOK_RECALL_CONFIG ?? join(homedir(), '.config', 'book-recall', 'config.json');
}

export async function loadConfig(path: string): Promise<RecallConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`No config at ${path}`);
  }
  const raw = JSON.parse(text) as Record<string, unknown>;

  assertNoSecrets(raw, path, 'set the Anthropic API key in BOOK_RECALL_API_KEY');
  if (typeof raw.vaultPath !== 'string') throw new Error(`Config ${path} is missing "vaultPath"`);
  for (const key of ['booksFolder', 'dailyFolder', 'model', 'apiBaseUrl'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`Config ${path} "${key}" must be a string`);
  }

  return {
    booksFolder: 'Books',
    dailyFolder: 'Daily',
    model: DEFAULT_MODEL,
    ...raw,
  } as RecallConfig;
}

export function loadApiKey(env: NodeJS.ProcessEnv): string {
  const key = env.BOOK_RECALL_API_KEY;
  if (!key) throw new Error('No Anthropic API key; set BOOK_RECALL_API_KEY');
  return key;
}
