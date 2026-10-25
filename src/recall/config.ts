import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isLocalUrl, isSamePath } from '../shared/guard.ts';
import { type KeychainReader, type SecretSource, assertNoSecrets, keychainReader, loadSecret } from '../shared/secrets.ts';
import { assertTimeZone } from './daily.ts';

export type RecallConfig = {
  vaultPath: string;
  booksFolder: string;
  dailyFolder: string;
  /** Moment-style daily note filename, without `.md`. */
  dailyFormat: string;
  /** Vault-relative daily note template; only read to check it embeds the recall note. */
  dailyTemplate: string;
  /**
   * Vault-relative folder for the recall notes, one per day named like the daily notes (default `<dailyFolder>/Recall`).
   * The tool writes only here, never to a daily note: a note Obsidian Sync sees created on two devices keeps one side.
   */
  recallFolder: string;
  /** IANA time zone that decides which date is "today". */
  timezone: string;
  model: string;
  /** Claude API base URL; only set to point at the local stub. */
  apiBaseUrl?: string;
  /** The vault recalls are really read in; never written to while `apiBaseUrl` points at the local stub. */
  realVault?: string;
  /** `status` values a book note may have to be picked. */
  statuses: string[];
  /** Minimum body length, in words, for a book note to be picked. */
  minWords: number;
  /** Include outgoing linked notes and incoming link passages in the prompt. */
  linkedNotes: boolean;
  /** Total cap on linked context; the book note itself is never cut for it. */
  maxLinkedWords: number;
  /** A book shown in a recall block in the previous N daily notes is not picked; 0 turns the window off. */
  noRepeatDays: number;
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

  assertNoSecrets(raw, path, 'store the Anthropic API key in the Keychain');
  if (typeof raw.vaultPath !== 'string') throw new Error(`Config ${path} is missing "vaultPath"`);
  for (const key of ['booksFolder', 'dailyFolder', 'dailyFormat', 'dailyTemplate', 'recallFolder', 'timezone', 'model', 'apiBaseUrl', 'realVault'] as const) {
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
  if (raw.noRepeatDays !== undefined && !(Number.isInteger(raw.noRepeatDays) && (raw.noRepeatDays as number) >= 0)) {
    throw new Error(`Config ${path} "noRepeatDays" must be a whole number of 0 or more`);
  }

  if (raw.dailyFormat === '') throw new Error(`Config ${path} "dailyFormat" must not be empty`);
  if (typeof raw.timezone === 'string') assertTimeZone(raw.timezone, `Config ${path}`);

  const config = {
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
    noRepeatDays: 10,
    ...raw,
  } as RecallConfig;
  return { ...config, recallFolder: config.recallFolder ?? join(config.dailyFolder, 'Recall') };
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

const API_KEY: SecretSource = {
  label: 'Anthropic API key',
  envVar: 'BOOK_RECALL_API_KEY',
  service: 'book-recall',
  account: 'anthropic-api',
};

export const readKeychain: KeychainReader = keychainReader(API_KEY.service, API_KEY.account);

/** BOOK_RECALL_API_KEY wins; otherwise the macOS Keychain. */
export function loadApiKey(env: NodeJS.ProcessEnv, keychain: KeychainReader = readKeychain): Promise<string> {
  return loadSecret(env, API_KEY, keychain);
}

/** Canned learnings from the local stub must never land in the vault recalls are really read in. */
export async function assertSafeTarget(config: RecallConfig): Promise<void> {
  if (!config.apiBaseUrl || !config.realVault || !isLocalUrl(config.apiBaseUrl)) return;
  if (await isSamePath(config.vaultPath, config.realVault)) {
    throw new Error(
      `Refusing to write stub learnings into the real vault (${config.realVault}); point vaultPath at a test copy while apiBaseUrl is ${config.apiBaseUrl}`,
    );
  }
}
