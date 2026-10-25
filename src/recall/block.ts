import { markersFor } from '../shared/note.ts';
import { formatGeneratedAt } from '../shared/time.ts';

export const MARKERS = markersFor('book-recall');

export function renderRecall(options: { title: string; learnings: string[]; words: number; linkedNotes?: number; model: string; now: Date; timeZone?: string }): string {
  return [
    MARKERS.start,
    `## Book recall — [[${options.title}]]`,
    '',
    ...options.learnings.map((learning) => `- ${learning}`),
    '',
    `_Generated ${formatGeneratedAt(options.now, options.timeZone)} from 1 book note${linkedNoteCount(options.linkedNotes ?? 0)} (${options.words.toLocaleString('en-GB')} words) by ${options.model}. Re-runs overwrite this block._`,
    MARKERS.end,
  ].join('\n');
}

const linkedNoteCount = (count: number) => (count === 0 ? '' : ` and ${count} linked note${count === 1 ? '' : 's'}`);
