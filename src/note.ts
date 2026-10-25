import { type IsoWeek } from './isoWeek.ts';
import { type WriteOutcome, markersFor, writeBlock } from './shared/note.ts';

export type { WriteOutcome };

const MARKERS = markersFor('week-review');
export const START_MARKER = MARKERS.start;
export const END_MARKER = MARKERS.end;

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

export function writeReview(options: { notePath: string; block: string; newNote: string }): Promise<WriteOutcome> {
  return writeBlock({ ...options, markers: MARKERS });
}
