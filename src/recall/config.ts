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
  /** Include outgoing linked notes and incoming link passages in the prompt. */
  linkedNotes: boolean;
  /** Total cap on linked context; the book note itself is never cut for it. */
  maxLinkedWords: number;
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
  if (raw.linkedNotes !== undefined && typeof raw.linkedNotes !== 'boolean') throw new Error(`Config ${path} "linkedNotes" must be true or false`);
  if (raw.maxLinkedWords !== undefined && !(Number.isInteger(raw.maxLinkedWords) && (raw.maxLinkedWords as number) >= 0)) {
    throw new Error(`Config ${path} "maxLinkedWords" must be a whole number of words`);
  }

  return {
    booksFolder: 'Books',
    dailyFolder: 'Daily',
    model: DEFAULT_MODEL,
    linkedNotes: true,
    maxLinkedWords: 4000,
    ...raw,
  } as RecallConfig;
}

export function loadApiKey(env: NodeJS.ProcessEnv): string {
  const key = env.BOOK_RECALL_API_KEY;
  if (!key) throw new Error('No Anthropic API key; set BOOK_RECALL_API_KEY');
  return key;
}
