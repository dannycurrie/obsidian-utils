import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARKERS } from './block.ts';
import { type BookNote, type Eligibility, isEligible, pickBook } from './pick.ts';

/** The `[[Book]]` link in a recall block's heading, as written by `renderRecall`. Alias, heading and block parts are dropped. */
const RECALL_HEADING = /^##\s+Book recall\s+—\s+\[\[([^[\]|#^]+)(?:[#^][^[\]|]*)?(?:\|[^[\]]*)?\]\]/gm;

/**
 * How books are matched between recall headings and book notes: by note name (the basename `pickBook` and
 * `findBook` use as the title), case-insensitively like Obsidian links. A link written as a path keeps only its
 * last segment, so two books with the same name in different subfolders count as one for the window.
 */
export const titleKey = (title: string) => title.trim().replace(/\\/g, '/').split('/').at(-1)!.replace(/\.md$/i, '').toLowerCase();

/** The text inside each `book-recall` block. An unclosed block runs to the end of the note. */
function recallBlocks(text: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(MARKERS.start, from);
    if (start < 0) return blocks;
    const end = text.indexOf(MARKERS.end, start);
    blocks.push(text.slice(start + MARKERS.start.length, end < 0 ? undefined : end));
    if (end < 0) return blocks;
    from = end + MARKERS.end.length;
  }
}

/** The book titles shown in a daily note's recall blocks. Links outside the markers do not count. */
export function shownInNote(text: string): string[] {
  return recallBlocks(text).flatMap((block) => [...block.matchAll(RECALL_HEADING)].map((match) => match[1].trim()));
}

/** `YYYY-MM-DD` for `days` calendar days before `date`. */
export function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

/**
 * Books shown in the `days` daily notes before `date` (not counting `date` itself), keyed by `titleKey`,
 * each with how many days ago it was last shown (1 = the day before). Missing daily notes are skipped.
 */
export async function recentlyShown(dailyDir: string, date: string, days: number): Promise<Map<string, number>> {
  const shown = new Map<string, number>();
  for (let ago = 1; ago <= days; ago++) {
    let text: string;
    try {
      text = await readFile(join(dailyDir, `${daysBefore(date, ago)}.md`), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const title of shownInNote(text)) {
      const key = titleKey(title);
      if (!shown.has(key)) shown.set(key, ago);
    }
  }
  return shown;
}

/**
 * Picks uniformly from the eligible books not in `shown`. When every eligible book was shown, picks the one shown
 * longest ago instead; books tied on that day are picked between with `random`, like any other pick.
 * Fails (via `pickBook`) only when no book is eligible at all.
 */
export function pickUnshown(
  notes: BookNote[],
  rules: Eligibility,
  booksFolder: string,
  random: () => number,
  shown: Map<string, number>,
): BookNote {
  const eligible = notes.filter((note) => isEligible(note, rules));
  if (eligible.length === 0) return pickBook(notes, rules, booksFolder, random); // throws "No eligible books"
  const fresh = eligible.filter((note) => !shown.has(titleKey(note.title)));
  if (fresh.length > 0) return pickBook(fresh, rules, booksFolder, random);
  const oldest = Math.max(...eligible.map((note) => shown.get(titleKey(note.title))!));
  return pickBook(eligible.filter((note) => shown.get(titleKey(note.title)) === oldest), rules, booksFolder, random);
}
