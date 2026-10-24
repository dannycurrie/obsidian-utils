import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MARKERS } from './block.ts';
import { type Book, countWords, splitFrontmatter } from './book.ts';

/** Each outgoing note is cut to this many words before the total cap applies. */
export const MAX_WORDS_PER_NOTE = 1500;

/** Vault folders whose notes are never read, linked to or linked from. */
const EXCLUDED_FOLDERS = ['Templates/', 'Archive/tana/'];

/**
 * One labelled piece of linked context: an outgoing note in full (capped), or every passage of one
 * incoming note that links to the book. Each part counts as one "linked note" in the footer.
 */
export type LinkedPart = { path: string; direction: 'outgoing' | 'incoming'; text: string; words: number };

/** `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]`, `[[Target^block]]`, and the same as `![[…]]` embeds. */
const WIKILINK = /!?\[\[([^[\]|#^]*)(?:[#^][^[\]|]*)?(?:\|[^[\]]*)?\]\]/g;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^\s*#{1,6}\s/;

/** Every markdown note in the vault as a `/`-separated vault-relative path, sorted, minus hidden and excluded folders. */
async function listNotes(vaultPath: string): Promise<string[]> {
  const notes: string[] = [];
  for (const entry of await readdir(vaultPath, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = relative(vaultPath, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (path.split('/').some((segment) => segment.startsWith('.'))) continue;
    if (EXCLUDED_FOLDERS.some((folder) => path.startsWith(folder))) continue;
    notes.push(path);
  }
  return notes.sort();
}

/**
 * Resolves a link target the way Obsidian does: case-insensitively by note name anywhere in the vault, or by
 * path when it contains `/`. Ties go to the shortest path, then alphabetical. Non-markdown targets never resolve.
 */
function makeResolver(notes: string[]): (target: string) => string | undefined {
  const byName = new Map<string, string[]>();
  const byPath = new Map<string, string>();
  for (const note of [...notes].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const key = note.slice(0, -3).toLowerCase();
    byPath.set(key, note);
    const name = key.slice(key.lastIndexOf('/') + 1);
    byName.set(name, [...(byName.get(name) ?? []), note]);
  }
  return (target) => {
    let key = target.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    if (key.endsWith('.md')) key = key.slice(0, -3);
    if (!key) return undefined;
    if (!key.includes('/')) return byName.get(key)?.[0];
    const name = key.slice(key.lastIndexOf('/') + 1);
    return byPath.get(key) ?? byName.get(name)?.find((note) => note.toLowerCase().endsWith(`/${key}.md`));
  };
}

/** Removes every `book-recall` block, so past recalls never feed back into a new one. An unclosed block runs to the end. */
export function stripRecallBlocks(text: string): string {
  let kept = '';
  let rest = text;
  for (;;) {
    const start = rest.indexOf(MARKERS.start);
    if (start < 0) return kept + rest;
    kept += rest.slice(0, start);
    const end = rest.indexOf(MARKERS.end, start);
    if (end < 0) return kept;
    rest = rest.slice(end + MARKERS.end.length);
  }
}

/** Keeps the first `max` words, preserving the original formatting up to the cut. */
export function truncateWords(text: string, max: number): string {
  if (max <= 0) return '';
  let seen = 0;
  for (const match of text.matchAll(/\S+/g)) {
    if (++seen === max) return text.slice(0, match.index + match[0].length);
  }
  return text;
}

const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;

/** The list item that line `i` belongs to: the item itself, or the nearest item above whose content it continues. */
function ownerItem(lines: string[], i: number): number {
  if (LIST_ITEM.test(lines[i])) return i;
  const indent = indentOf(lines[i]);
  let sawBlank = false;
  for (let j = i - 1; j >= 0; j--) {
    const line = lines[j];
    if (!line.trim()) {
      if (indent === 0) return -1;
      sawBlank = true;
      continue;
    }
    if (HEADING.test(line)) return -1;
    if (LIST_ITEM.test(line)) return !sawBlank || indentOf(line) < indent ? j : -1;
    if (sawBlank && indentOf(line) < indent) return -1;
  }
  return -1;
}

/** A list item plus its nested children and continuation lines. */
function itemRange(lines: string[], item: number): [number, number] {
  const indent = indentOf(lines[item]);
  let end = item;
  let sawBlank = false;
  for (let k = item + 1; k < lines.length; k++) {
    const line = lines[k];
    if (!line.trim()) {
      sawBlank = true;
      continue;
    }
    const lazyContinuation = !sawBlank && !LIST_ITEM.test(line) && !HEADING.test(line);
    if (indentOf(line) <= indent && !lazyContinuation) break;
    end = k;
    sawBlank = false;
  }
  return [item, end];
}

/** The paragraph around line `i`, bounded by blank lines, headings and list items. */
function paragraphRange(lines: string[], i: number): [number, number] {
  const inParagraph = (line: string | undefined) =>
    line !== undefined && line.trim() !== '' && !HEADING.test(line) && !LIST_ITEM.test(line);
  let start = i;
  let end = i;
  while (inParagraph(lines[start - 1])) start--;
  while (inParagraph(lines[end + 1])) end++;
  return [start, end];
}

function blockAround(lines: string[], i: number): [number, number] {
  if (HEADING.test(lines[i])) return [i, i];
  const item = ownerItem(lines, i);
  return item >= 0 ? itemRange(lines, item) : paragraphRange(lines, i);
}

function dedent(lines: string[]): string {
  const indent = Math.min(...lines.filter((line) => line.trim()).map(indentOf));
  return lines.map((line) => line.replace(/\t/g, '    ').slice(indent)).join('\n').trimEnd();
}

/** Each paragraph or list item (with its children) holding a line for which `linksHere` is true, in note order. */
export function passagesLinkingTo(body: string, linksHere: (line: string) => boolean): string[] {
  const lines = body.split(/\r?\n/);
  const ranges: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!linksHere(lines[i])) continue;
    const [start, end] = blockAround(lines, i);
    if (ranges.some(([s, e]) => start >= s && end <= e)) continue;
    ranges.push([start, end]);
  }
  return ranges.map(([start, end]) => dedent(lines.slice(start, end + 1)));
}

const linkTargets = (text: string) => [...text.matchAll(WIKILINK)].map((match) => match[1]);

async function readBody(vaultPath: string, path: string): Promise<string> {
  const { body } = splitFrontmatter(await readFile(join(vaultPath, path), 'utf8'));
  return stripRecallBlocks(body).trim();
}

/**
 * Notes one link away from the book, in prompt order: outgoing notes in the order the book first links to them,
 * then incoming passages by source path. Outgoing notes are capped at MAX_WORDS_PER_NOTE each; a note linked in
 * both directions is sent once, in full, as outgoing. The whole is then capped at `maxLinkedWords` by keeping
 * parts in that order, cutting the part that crosses the cap and dropping everything after it.
 */
export async function gatherLinkedNotes(options: {
  vaultPath: string;
  book: Pick<Book, 'path' | 'body'>;
  maxLinkedWords: number;
}): Promise<LinkedPart[]> {
  const notes = await listNotes(options.vaultPath);
  const resolve = makeResolver(notes);
  const bookPath = options.book.path.split(sep).join('/');

  const outgoing = new Set<string>();
  for (const target of linkTargets(stripRecallBlocks(options.book.body))) {
    const path = resolve(target);
    if (path && path !== bookPath) outgoing.add(path);
  }

  const parts: Omit<LinkedPart, 'words'>[] = [];
  for (const path of outgoing) {
    const text = truncateWords(await readBody(options.vaultPath, path), MAX_WORDS_PER_NOTE);
    if (text) parts.push({ path, direction: 'outgoing', text });
  }
  const linksToBook = (line: string) => linkTargets(line).some((target) => resolve(target) === bookPath);
  for (const path of notes) {
    if (path === bookPath || outgoing.has(path)) continue;
    const body = await readBody(options.vaultPath, path);
    if (!body.includes('[[')) continue;
    const passages = passagesLinkingTo(body, linksToBook);
    if (passages.length) parts.push({ path, direction: 'incoming', text: passages.join('\n\n') });
  }

  const capped: LinkedPart[] = [];
  let left = options.maxLinkedWords;
  for (const part of parts) {
    if (left <= 0) break;
    const text = truncateWords(part.text, left);
    const words = countWords(text);
    capped.push({ ...part, text, words });
    left -= words;
  }
  return capped;
}
