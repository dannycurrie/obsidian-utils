import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export type Config = {
  baseUrl: string;
  vaultPath: string;
  /** The vault reviews are really read in; never written to while pointed at the mock. */
  realVault: string;
  noteFolder: string;
  /** Moment-style tokens: GGGG (ISO year), WW / W (ISO week), [literal]. */
  filenameFormat: string;
  /** Body of a newly created note, before the review block. Placeholders: {{created}}, {{period}}. */
  newNoteTemplate: string;
  /** Display units keyed by metric id, for metrics the tracker sends without one (e.g. KMs run → "km"). */
  units?: Record<string, string>;
};

// Matches the frontmatter of the hand-made week plans in Plans/Week plans/.
const DEFAULT_NEW_NOTE_TEMPLATE = '---\ntype: plan\ncreated: {{created}}\nperiod: {{period}}\nstatus: Draft\n---\n';

const SECRET_KEY = /token|secret|password|api_?key/i;

export const KEYCHAIN_SERVICE = 'week-review';
export const KEYCHAIN_ACCOUNT = 'tracker-api';

export function defaultConfigPath(env: NodeJS.ProcessEnv): string {
  return env.WEEK_REVIEW_CONFIG ?? join(homedir(), '.config', 'week-review', 'config.json');
}

export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`No config at ${path}`);
  }
  const raw = JSON.parse(text) as Record<string, unknown>;

  const secrets = Object.keys(raw).filter((key) => SECRET_KEY.test(key));
  if (secrets.length) {
    throw new Error(
      `Config ${path} must not contain secrets (found "${secrets.join('", "')}"); store the API token in the Keychain`,
    );
  }
  for (const key of ['baseUrl', 'vaultPath', 'realVault', 'noteFolder'] as const) {
    if (typeof raw[key] !== 'string') throw new Error(`Config ${path} is missing "${key}"`);
  }
  for (const key of ['filenameFormat', 'newNoteTemplate'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`Config ${path} "${key}" must be a string`);
  }
  const units = raw.units;
  if (
    units !== undefined &&
    (typeof units !== 'object' || units === null || Object.values(units).some((u) => typeof u !== 'string'))
  ) {
    throw new Error(`Config ${path} "units" must map metric ids to strings`);
  }

  return {
    filenameFormat: 'GGGG-[W]WW',
    newNoteTemplate: DEFAULT_NEW_NOTE_TEMPLATE,
    ...raw,
  } as Config;
}

export type KeychainReader = () => Promise<string | null>;

export const readKeychain: KeychainReader = async () => {
  try {
    const { stdout } = await promisify(execFile)('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      KEYCHAIN_ACCOUNT,
      '-w',
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

/** WEEK_REVIEW_TOKEN wins; otherwise the macOS Keychain. */
export async function loadToken(env: NodeJS.ProcessEnv, keychain: KeychainReader): Promise<string> {
  const token = env.WEEK_REVIEW_TOKEN || (await keychain());
  if (!token) {
    throw new Error(
      `No API token. Add it to the Keychain with: security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w <token>`,
    );
  }
  return token;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/** Placeholder numbers from the mock must never land in the vault reviews are really read in. */
export async function assertSafeTarget(config: Config): Promise<void> {
  if (!LOCAL_HOSTS.has(new URL(config.baseUrl).hostname)) return;
  if ((await canonicalPath(config.vaultPath)) === (await canonicalPath(config.realVault))) {
    throw new Error(
      `Refusing to write mock data into the real vault (${config.realVault}); point vaultPath at a test copy while baseUrl is ${config.baseUrl}`,
    );
  }
}
