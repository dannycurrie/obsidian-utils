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
/** Vault-relative note path for a date in a folder, named like the daily notes, e.g. `Daily/Recall/2026-10-24.md`. */
export function datedNoteName(folder: string, dailyFormat: string, date: string): string {
  return join(folder, `${formatDate(dailyFormat, date)}.md`);
}

/** What a new recall note starts with: the frontmatter every note in the vault carries. */
export const newRecallNote = (date: string) => `---\ntype: recall\ncreated: ${date}\n---\n`;

/** The embed that shows a day's recall note inside its daily note, in Obsidian's template syntax. */
export const recallEmbed = (recallFolder: string, dailyFormat: string) => `![[${recallFolder}/{{date:${dailyFormat}}}]]`;

/**
 * A one-line tip when the daily note template exists but does not embed the recall notes, so recalls would not show
 * in daily notes. Null when it does, or when there is no template to check.
 */
export async function embedHint(vaultPath: string, dailyTemplate: string, recallFolder: string, dailyFormat: string): Promise<string | null> {
  if (dailyTemplate === '') return null;
  const path = dailyTemplate.endsWith('.md') ? dailyTemplate : `${dailyTemplate}.md`;
  const template = await readFile(join(vaultPath, path), 'utf8').catch(() => null);
  if (template === null || template.includes(`[[${recallFolder}/`)) return null;
  return `Tip: add ${recallEmbed(recallFolder, dailyFormat)} to ${path} to show recalls in your daily notes`;
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
