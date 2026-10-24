// Installs or removes the book-recall launchd user agent from the template in launchd/.
// Usage: node scripts/launchd.ts install|uninstall|print [--hour 7] [--minute 0]
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';

export const LABEL = 'com.danny.book-recall';
const REPO = join(import.meta.dirname, '..');
const TEMPLATE = join(REPO, 'launchd', `${LABEL}.plist`);

export type AgentSettings = {
  label: string;
  /** Absolute path to node 24 or later; launchd has no shell PATH. */
  node: string;
  cli: string;
  repo: string;
  log: string;
  hour: number;
  minute: number;
};

const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderPlist(template: string, settings: AgentSettings): string {
  const values: Record<string, string> = {
    LABEL: settings.label,
    NODE: settings.node,
    CLI: settings.cli,
    REPO: settings.repo,
    LOG: settings.log,
    HOUR: String(settings.hour),
    MINUTE: String(settings.minute),
  };
  return template.replace(/\{\{([A-Z]+)\}\}/g, (match, name: string) => {
    if (!(name in values)) throw new Error(`Unknown placeholder ${match} in ${TEMPLATE}`);
    return escapeXml(values[name]);
  });
}

export function defaultSettings(home: string, node: string): AgentSettings {
  return {
    label: LABEL,
    node,
    cli: join(REPO, 'src', 'recall', 'cli.ts'),
    repo: REPO,
    log: join(home, 'Library', 'Logs', 'book-recall.log'),
    hour: 7,
    minute: 0,
  };
}

function parseClock(value: string | undefined, fallback: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`--${name} must be a whole number from 0 to ${max}`);
  return n;
}

async function launchctl(...args: string[]): Promise<void> {
  await promisify(execFile)('launchctl', args);
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { hour: { type: 'string' }, minute: { type: 'string' } },
    });
    const command = positionals[0];
    const home = homedir();
    const settings = {
      ...defaultSettings(home, process.execPath),
      hour: parseClock(values.hour, 7, 23, 'hour'),
      minute: parseClock(values.minute, 0, 59, 'minute'),
    };
    const plistPath = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const domain = `gui/${process.getuid?.()}`;

    if (command === 'print') {
      console.log(renderPlist(await readFile(TEMPLATE, 'utf8'), settings));
    } else if (command === 'install') {
      const [major] = process.versions.node.split('.').map(Number);
      if (major < 24) throw new Error(`book-recall needs node 24 or later; ${process.execPath} is ${process.version}`);
      await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true });
      await writeFile(plistPath, renderPlist(await readFile(TEMPLATE, 'utf8'), settings));
      await launchctl('bootout', `${domain}/${LABEL}`).catch(() => {}); // not loaded yet is fine
      await launchctl('bootstrap', domain, plistPath);
      const time = `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`;
      console.log(`Installed ${plistPath}: daily at ${time} and at login, using ${process.execPath}`);
      console.log(`It runs once now (RunAtLoad). Log: ${settings.log}`);
    } else if (command === 'uninstall') {
      await launchctl('bootout', `${domain}/${LABEL}`).catch(() => {});
      await rm(plistPath, { force: true });
      console.log(`Removed ${plistPath}`);
    } else {
      throw new Error('Usage: node scripts/launchd.ts install|uninstall|print [--hour 7] [--minute 0]');
    }
  } catch (error) {
    console.error(`launchd: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
