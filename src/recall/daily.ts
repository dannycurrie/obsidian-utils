import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isoWeekOf } from '../isoWeek.ts';
import { upsertBlock } from '../shared/note.ts';
import { MARKERS } from './block.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Calendar date (`YYYY-MM-DD`) of an instant in a time zone. */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

/** Throws if `timeZone` is not an IANA zone the runtime knows. */
export function assertTimeZone(timeZone: string, source: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    throw new Error(`${source} "timezone" is not a known time zone: "${timeZone}"`);
  }
}

/**
 * Formats a `YYYY-MM-DD` date with Moment-style tokens: YYYY YY, MMMM MMM MM M, DD D, dddd ddd,
 * GGGG GG (ISO week year), WW W (ISO week) and `[literal]`. Other characters pass through; other letters throw.
 */
export function formatDate(format: string, date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const { year: isoYear, week } = isoWeekOf(day);
  const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    YYYY: String(y),
    YY: String(y).slice(-2),
    MMMM: MONTHS[m],
    MMM: MONTHS[m].slice(0, 3),
    MM: pad(m + 1),
    M: String(m + 1),
    DD: pad(d),
    D: String(d),
    dddd: WEEKDAYS[day.getUTCDay()],
    ddd: WEEKDAYS[day.getUTCDay()].slice(0, 3),
    GGGG: String(isoYear),
    GG: String(isoYear).slice(-2),
    WW: pad(week),
    W: String(week),
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|GGGG|GG|WW|W|[A-Za-z]+/g, (match, literal?: string) => {
    if (literal !== undefined) return literal;
    if (match in tokens) return tokens[match];
    throw new Error(`Unsupported date token "${match}" in "${format}"`);
  });
}

/**
 * Renders an Obsidian core template for a daily note: `{{date}}` (YYYY-MM-DD), `{{date:FORMAT}}` and `{{title}}`
 * (the note name). Any other `{{…}}` is left as written.
 */
export function renderTemplate(template: string, date: string, title: string): string {
  return template.replace(/\{\{\s*(date|title)\s*(?::([^}]*))?\}\}/g, (_, name: string, format?: string) =>
    name === 'title' ? title : formatDate(format?.trim() || 'YYYY-MM-DD', date),
  );
}

/** Vault-relative daily note path for a date, e.g. `Daily/2026-10-24.md`. */
export function dailyNoteName(dailyFolder: string, dailyFormat: string, date: string): string {
  return join(dailyFolder, `${formatDate(dailyFormat, date)}.md`);
}

/**
 * The text a missing daily note starts with: the rendered template, or '' when `dailyTemplate` is ''.
 * A configured template that does not exist is an error, so the tool never creates a note Obsidian would have templated.
 */
export async function newDailyNote(vaultPath: string, dailyTemplate: string, date: string, title: string): Promise<string> {
  if (dailyTemplate === '') return '';
  const path = join(vaultPath, dailyTemplate.endsWith('.md') ? dailyTemplate : `${dailyTemplate}.md`);
  let template: string;
  try {
    template = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`Daily template not found: ${path} (set "dailyTemplate" in the config, or "" for none)`);
  }
  return renderTemplate(template, date, title);
}

/** The note's current recall block and the book its heading links to, or null if it has none. Throws on broken markers. */
export function currentRecall(note: string): { block: string; title: string | null } | null {
  upsertBlock(note, '', MARKERS); // throws on unmatched or repeated markers
  const start = note.indexOf(MARKERS.start);
  if (start === -1) return null;
  const block = note.slice(start, note.indexOf(MARKERS.end) + MARKERS.end.length);
  const heading = /^## Book recall — \[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/m.exec(block);
  return { block, title: heading ? heading[1].trim() : null };
}
