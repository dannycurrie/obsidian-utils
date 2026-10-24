import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Book = {
  title: string;
  author: string | null;
  /** Vault-relative path, used to label the notes for the model. */
  path: string;
  /** The note without its frontmatter. */
  body: string;
  words: number;
};

/** Splits a note into its flat `key: value` frontmatter and body. Nested YAML is not needed for book notes. */
export function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (field) frontmatter[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { frontmatter, body: text.slice(match[0].length) };
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

export async function readBook(vaultPath: string, booksFolder: string, title: string): Promise<Book> {
  const path = join(booksFolder, `${title}.md`);
  let text: string;
  try {
    text = await readFile(join(vaultPath, path), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`No book note "${title}" in ${booksFolder}/`);
  }
  const { frontmatter, body } = splitFrontmatter(text);
  return { title, author: frontmatter.author || null, path, body: body.trim(), words: countWords(body) };
}
