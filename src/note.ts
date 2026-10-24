import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type IsoWeek } from './isoWeek.ts';

export const START_MARKER = '<!-- week-review:start -->';
export const END_MARKER = '<!-- week-review:end -->';

export type WriteOutcome = 'created' | 'replaced' | 'appended';

/** Note filename from a Moment-style format: GGGG (ISO year), WW / W (ISO week), [literal]. */
export function formatNoteName(format: string, { year, week }: IsoWeek): string {
  const tokens: Record<string, string> = { GGGG: String(year), WW: String(week).padStart(2, '0'), W: String(week) };
  const name = format.replace(/\[([^\]]*)\]|GGGG|WW|W|[A-Za-z]+/g, (match, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    if (match in tokens) return tokens[match];
    throw new Error(`Unsupported token "${match}" in filenameFormat "${format}"`);
  });
  return `${name}.md`;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Replaces the review block if the note has one, otherwise appends it. Text outside the markers is kept as-is. */
export function upsertBlock(existing: string, block: string): { content: string; outcome: 'replaced' | 'appended' } {
  const starts = count(existing, START_MARKER);
  const ends = count(existing, END_MARKER);
  if (starts === 0 && ends === 0) {
    const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return { content: `${existing}${separator}${block}\n`, outcome: 'appended' };
  }
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new Error('Note has unmatched or repeated week-review markers; fix them by hand before re-running');
  }
  return {
    content: existing.slice(0, start) + block + existing.slice(end + END_MARKER.length),
    outcome: 'replaced',
  };
}

/** Temp file in the same folder, then rename, so a sync client never sees a half-written note. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.week-review.tmp`);
  try {
    await writeFile(temp, content);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function writeReview(options: { notePath: string; block: string; newNote: string }): Promise<WriteOutcome> {
  let existing: string;
  try {
    existing = await readFile(options.notePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeAtomic(options.notePath, `${options.newNote.trimEnd()}\n\n${options.block}\n`);
    return 'created';
  }
  const { content, outcome } = upsertBlock(existing, options.block);
  await writeAtomic(options.notePath, content);
  return outcome;
}
