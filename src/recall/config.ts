import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertNoSecrets } from '../shared/secrets.ts';
import { assertTimeZone } from './daily.ts';

export type RecallConfig = {
  vaultPath: string;
  booksFolder: string;
  dailyFolder: string;
  /** Moment-style daily note filename, without `.md`. */
  dailyFormat: string;
  /** Vault-relative template for a missing daily note; '' creates the note with just the block. */
  dailyTemplate: string;
  /** IANA time zone that decides which date is "today". */
  timezone: string;
  model: string;
  /** Claude API base URL; only set to point at the local stub. */
  apiBaseUrl?: string;
  /** `status` values a book note may have to be picked. */
  statuses: string[];
  /** Minimum body length, in words, for a book note to be picked. */
  minWords: number;
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
  for (const key of ['booksFolder', 'dailyFolder', 'dailyFormat', 'dailyTemplate', 'timezone', 'model', 'apiBaseUrl'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`Config ${path} "${key}" must be a string`);
  }
  if (raw.statuses !== undefined && (!Array.isArray(raw.statuses) || raw.statuses.some((s) => typeof s !== 'string'))) {
    throw new Error(`Config ${path} "statuses" must be an array of strings`);
  }
  if (raw.minWords !== undefined && (!Number.isInteger(raw.minWords) || (raw.minWords as number) < 0)) {
    throw new Error(`Config ${path} "minWords" must be a whole number of 0 or more`);
  }
  if (raw.linkedNotes !== undefined && typeof raw.linkedNotes !== 'boolean') throw new Error(`Config ${path} "linkedNotes" must be true or false`);
  if (raw.maxLinkedWords !== undefined && !(Number.isInteger(raw.maxLinkedWords) && (raw.maxLinkedWords as number) >= 0)) {
    throw new Error(`Config ${path} "maxLinkedWords" must be a whole number of words`);
  }

  if (raw.dailyFormat === '') throw new Error(`Config ${path} "dailyFormat" must not be empty`);
  if (typeof raw.timezone === 'string') assertTimeZone(raw.timezone, `Config ${path}`);

  return {
    booksFolder: 'Books',
    dailyFolder: 'Daily',
    dailyFormat: 'YYYY-MM-DD',
    dailyTemplate: 'Templates/daily.md',
    timezone: 'Europe/London',
    ...(await vaultDailySettings(raw.vaultPath)),
    model: DEFAULT_MODEL,
    statuses: ['Finished', 'Reading'],
    minWords: 150,
    linkedNotes: true,
    maxLinkedWords: 4000,
    ...raw,
  } as RecallConfig;
}

/**
 * Daily-note settings from the vault's `.obsidian/daily-notes.json` (Obsidian's Daily notes plugin), used where the
 * config does not set them. A missing or unreadable file is ignored.
 */
async function vaultDailySettings(vaultPath: string): Promise<Partial<RecallConfig>> {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await readFile(join(vaultPath, '.obsidian', 'daily-notes.json'), 'utf8'));
  } catch {
    return {};
  }
  if (typeof settings !== 'object' || settings === null) return {};
  const result: Partial<RecallConfig> = {};
  if (typeof settings.folder === 'string') result.dailyFolder = settings.folder;
  if (typeof settings.format === 'string' && settings.format !== '') result.dailyFormat = settings.format;
  if (typeof settings.template === 'string') result.dailyTemplate = settings.template;
  return result;
}

export function loadApiKey(env: NodeJS.ProcessEnv): string {
  const key = env.BOOK_RECALL_API_KEY;
  if (!key) throw new Error('No Anthropic API key; set BOOK_RECALL_API_KEY');
  return key;
}
