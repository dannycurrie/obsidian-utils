import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** The HTML comments that fence one tool's generated block inside a note. */
export type Markers = { tool: string; start: string; end: string };

export function markersFor(tool: string): Markers {
  return { tool, start: `<!-- ${tool}:start -->`, end: `<!-- ${tool}:end -->` };
}

export type WriteOutcome = 'created' | 'replaced' | 'appended';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Replaces the block if the note has one, otherwise appends it. Text outside the markers is kept as-is. */
export function upsertBlock(
  existing: string,
  block: string,
  markers: Markers,
): { content: string; outcome: 'replaced' | 'appended' } {
  const starts = count(existing, markers.start);
  const ends = count(existing, markers.end);
  if (starts === 0 && ends === 0) {
    const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return { content: `${existing}${separator}${block}\n`, outcome: 'appended' };
  }
  const start = existing.indexOf(markers.start);
  const end = existing.indexOf(markers.end);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new Error(`Note has unmatched or repeated ${markers.tool} markers; fix them by hand before re-running`);
  }
  return {
    content: existing.slice(0, start) + block + existing.slice(end + markers.end.length),
    outcome: 'replaced',
  };
}

/** Temp file in the same folder, then rename, so a sync client never sees a half-written note. */
export async function writeAtomic(path: string, content: string, tool: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${tool}.tmp`);
  try {
    await writeFile(temp, content);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** Re-reads the note after a write and fails loudly if the block is not in it exactly once (e.g. Sync overwrote it). */
export async function confirmBlock(notePath: string, block: string, markers: Markers): Promise<void> {
  const content = await readFile(notePath, 'utf8').catch(() => '');
  if (content.split(block).length - 1 !== 1 || count(content, markers.start) !== 1 || count(content, markers.end) !== 1) {
    throw new Error(`Wrote ${notePath} but the ${markers.tool} block is not there on re-read; another app may have changed the note`);
  }
}

/** Writes the block into the note, creating the note from `newNote` if it does not exist. */
export async function writeBlock(options: {
  notePath: string;
  block: string;
  newNote: string;
  markers: Markers;
}): Promise<WriteOutcome> {
  const { notePath, block, markers } = options;
  let existing: string;
  try {
    existing = await readFile(notePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const head = options.newNote.trimEnd();
    await writeAtomic(notePath, head === '' ? `${block}\n` : `${head}\n\n${block}\n`, markers.tool);
    return 'created';
  }
  const { content, outcome } = upsertBlock(existing, block, markers);
  await writeAtomic(notePath, content, markers.tool);
  return outcome;
}
