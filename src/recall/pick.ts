import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type Book, countWords, splitFrontmatter } from './book.ts';

/** A note in the books folder with the frontmatter fields that decide eligibility. */
export type BookNote = Book & { type: string | null; status: string | null };

export type Eligibility = { statuses: string[]; minWords: number };

const IGNORED_FOLDER = 'Templates';

/** Vault-relative paths of every `.md` under `booksFolder`, recursively, skipping `Templates/` and hidden folders. Sorted so picks are reproducible. */
async function listNotes(vaultPath: string, folder: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(vaultPath, folder), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`Books folder not found: ${join(vaultPath, folder)}`);
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== IGNORED_FOLDER) paths.push(...(await listNotes(vaultPath, path)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(path);
    }
  }
  return paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Reads every note in the books folder, whether or not it is eligible. */
export async function loadBookNotes(vaultPath: string, booksFolder: string): Promise<BookNote[]> {
  const notes: BookNote[] = [];
  for (const path of await listNotes(vaultPath, booksFolder)) {
    const { frontmatter, body } = splitFrontmatter(await readFile(join(vaultPath, path), 'utf8'));
    notes.push({
      title: basename(path, '.md'),
      author: frontmatter.author || null,
      path,
      body: body.trim(),
      words: countWords(body),
      type: frontmatter.type ?? null,
      status: frontmatter.status ?? null,
    });
  }
  return notes;
}

export function isEligible(note: BookNote, { statuses, minWords }: Eligibility): boolean {
  return note.type === 'book' && note.status !== null && statuses.includes(note.status) && note.words >= minWords;
}

/** The note named by `--book`; eligibility rules do not apply. */
export function findBook(notes: BookNote[], title: string, booksFolder: string): BookNote {
  const note = notes.find((n) => n.title === title);
  if (!note) throw new Error(`No book note "${title}" in ${booksFolder}/`);
  return note;
}

/** Picks uniformly from the eligible notes. `random` returns a number in [0, 1), like `Math.random`. */
export function pickBook(notes: BookNote[], rules: Eligibility, booksFolder: string, random: () => number): BookNote {
  const eligible = notes.filter((note) => isEligible(note, rules));
  if (eligible.length === 0) {
    throw new Error(
      `No eligible books in ${booksFolder}/ (need type: book, status ${rules.statuses.join(' or ')}, at least ${rules.minWords} words)`,
    );
  }
  return eligible[Math.min(Math.floor(random() * eligible.length), eligible.length - 1)];
}
