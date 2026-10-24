#!/usr/bin/env node
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { confirmBlock, type WriteOutcome, writeBlock } from '../shared/note.ts';
import { MARKERS, renderRecall } from './block.ts';
import { type RetryOptions, summarise } from './claude.ts';
import { defaultConfigPath, loadApiKey, loadConfig, type RecallConfig } from './config.ts';
import { currentRecall, dailyNoteName, newDailyNote, todayIn } from './daily.ts';
import { gatherLinkedNotes } from './links.ts';
import { type BookNote, findBook, isEligible, loadBookNotes, pickBook } from './pick.ts';

/** `skipped`: the note already had a block and no replace flag was given. `dry-run`: nothing was written. */
export type RunOutcome = WriteOutcome | 'skipped' | 'dry-run';

export type RunResult = {
  date: string;
  /** The recalled book; for `skipped`, the book already in the note ('unknown book' if its heading can't be read). */
  title: string;
  notePath: string;
  outcome: RunOutcome;
  /** The rendered block, for every outcome but `skipped`. */
  block?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isDirectory = (path: string) => stat(path).then((s) => s.isDirectory(), () => false);

/** `random` and `retry` are test seams (the pick, and the Claude retry wait and timeout), not user-facing options. */
export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  now: Date,
  random: () => number = Math.random,
  retry: RetryOptions = {},
): Promise<RunResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      book: { type: 'string' },
      date: { type: 'string' },
      config: { type: 'string' },
      regenerate: { type: 'boolean' },
      reroll: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
  });
  if (values.regenerate && values.reroll) throw new Error('Use either --regenerate or --reroll, not both');
  if (values.regenerate && values.book) throw new Error('--regenerate keeps the current book; use --reroll --book to change it');
  if (values.date !== undefined && !DATE_PATTERN.test(values.date)) throw new Error(`--date must be YYYY-MM-DD, got "${values.date}"`);

  const config = await loadConfig(values.config ?? defaultConfigPath(env));
  const date = values.date ?? todayIn(config.timezone, now);
  // Everything that can fail without Claude is checked before the call, so such a failure costs no request.
  if (!(await isDirectory(config.vaultPath))) throw new Error(`Vault not found: ${config.vaultPath}`);
  const dailyDir = join(config.vaultPath, config.dailyFolder);
  if (!(await isDirectory(dailyDir))) throw new Error(`Daily folder not found: ${dailyDir}`);
  const notePath = join(config.vaultPath, dailyNoteName(config.dailyFolder, config.dailyFormat, date));
  const existing = await readFile(notePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const current = existing === null ? null : currentRecall(existing); // throws on broken markers
  const replacing = values.regenerate ? 'regenerate' : values.reroll ? 'reroll' : null;
  // A day that already has a block stops here: no pick, no Claude call, nothing written.
  if (current && !replacing) return { date, title: current.title ?? 'unknown book', notePath, outcome: 'skipped' };
  if (!current && replacing) throw new Error(`No book-recall block in ${notePath} to ${replacing}`);
  if (replacing === 'regenerate' && !current?.title) throw new Error(`Can't read the book from the book-recall block in ${notePath}`);
  const newNote = existing === null ? await newDailyNote(config.vaultPath, config.dailyTemplate, date, basename(notePath, '.md')) : '';
  const apiKey = loadApiKey(env);

  const notes = await loadBookNotes(config.vaultPath, config.booksFolder);
  const book = chooseBook(notes, config, random, values.book ?? (replacing === 'regenerate' ? current!.title! : undefined), replacing === 'reroll' ? current!.title : null);
  const linked = config.linkedNotes
    ? await gatherLinkedNotes({ vaultPath: config.vaultPath, book, maxLinkedWords: config.maxLinkedWords })
    : [];
  const learnings = await summarise({ apiKey, baseUrl: config.apiBaseUrl, model: config.model, book, linked, ...retry });
  const words = linked.reduce((total, part) => total + part.words, book.words);
  const block = renderRecall({ title: book.title, learnings, words, linkedNotes: linked.length, model: config.model, now, timeZone: config.timezone });
  if (values['dry-run']) return { date, title: book.title, notePath, outcome: 'dry-run', block };
  if (existing === null) await mkdir(dirname(notePath), { recursive: true }); // dailyFormat may contain subfolders
  const outcome = await writeBlock({ notePath, block, newNote, markers: MARKERS });
  await confirmBlock(notePath, block, MARKERS);

  return { date, title: book.title, notePath, outcome, block };
}

/** `named` (from --book, or the current book for --regenerate) skips the pick; `exclude` is the book --reroll moves away from. */
function chooseBook(notes: BookNote[], config: RecallConfig, random: () => number, named: string | undefined, exclude: string | null): BookNote {
  if (named !== undefined) {
    if (named === exclude) throw new Error(`"${named}" is already the book in today's recall`);
    return findBook(notes, named, config.booksFolder);
  }
  if (exclude === null) return pickBook(notes, config, config.booksFolder, random);
  const others = notes.filter((note) => note.title !== exclude);
  if (!others.some((note) => isEligible(note, config))) throw new Error(`No eligible book other than "${exclude}" to reroll to`);
  return pickBook(others, config, config.booksFolder, random);
}

const OUTCOME_TEXT: Record<WriteOutcome, string> = {
  created: 'added recall',
  appended: 'added recall',
  replaced: 'updated recall',
};

if (import.meta.main) {
  try {
    const result = await run(process.argv.slice(2), process.env, new Date());
    if (result.outcome === 'dry-run') {
      console.log(result.block); // the block alone, so it can be piped; nothing was written
    } else if (result.outcome === 'skipped') {
      console.log(result.notePath);
      console.log(`${result.date}: already has a recall — ${result.title} (nothing to do; --regenerate or --reroll replaces it)`);
    } else {
      console.log(result.notePath);
      console.log(`${result.date}: ${OUTCOME_TEXT[result.outcome]} — ${result.title}`);
    }
  } catch (error) {
    console.error(`book-recall: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
