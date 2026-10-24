#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { londonDate } from '../isoWeek.ts';
import { confirmBlock, upsertBlock, type WriteOutcome, writeBlock } from '../shared/note.ts';
import { MARKERS, renderRecall } from './block.ts';
import { type RetryOptions, summarise } from './claude.ts';
import { defaultConfigPath, loadApiKey, loadConfig } from './config.ts';
import { gatherLinkedNotes } from './links.ts';
import { findBook, loadBookNotes, pickBook } from './pick.ts';

export type RunResult = {
  date: string;
  title: string;
  notePath: string;
  outcome: WriteOutcome;
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
    options: { book: { type: 'string' }, date: { type: 'string' }, config: { type: 'string' } },
  });

  const date = values.date ?? londonDate(now).toISOString().slice(0, 10);
  if (!DATE_PATTERN.test(date)) throw new Error(`--date must be YYYY-MM-DD, got "${date}"`);

  const config = await loadConfig(values.config ?? defaultConfigPath(env));
  // Everything that can fail without Claude is checked before the call, so such a failure costs no request.
  if (!(await isDirectory(config.vaultPath))) throw new Error(`Vault not found: ${config.vaultPath}`);
  const dailyDir = join(config.vaultPath, config.dailyFolder);
  if (!(await isDirectory(dailyDir))) throw new Error(`Daily folder not found: ${dailyDir}`);
  const notePath = join(dailyDir, `${date}.md`);
  const noteExists = await stat(notePath).then((s) => s.isFile(), () => false);
  if (!noteExists) throw new Error(`Daily note not found: ${notePath}`);
  upsertBlock(await readFile(notePath, 'utf8'), '', MARKERS); // throws on broken markers
  const apiKey = loadApiKey(env);

  const notes = await loadBookNotes(config.vaultPath, config.booksFolder);
  const book = values.book ? findBook(notes, values.book, config.booksFolder) : pickBook(notes, config, config.booksFolder, random);
  const linked = config.linkedNotes
    ? await gatherLinkedNotes({ vaultPath: config.vaultPath, book, maxLinkedWords: config.maxLinkedWords })
    : [];
  const learnings = await summarise({ apiKey, baseUrl: config.apiBaseUrl, model: config.model, book, linked, ...retry });
  const words = linked.reduce((total, part) => total + part.words, book.words);
  const block = renderRecall({ title: book.title, learnings, words, linkedNotes: linked.length, model: config.model, now });
  const outcome = await writeBlock({ notePath, block, newNote: '', markers: MARKERS });
  await confirmBlock(notePath, block, MARKERS);

  return { date, title: book.title, notePath, outcome };
}

const OUTCOME_TEXT: Record<WriteOutcome, string> = {
  created: 'added recall',
  appended: 'added recall',
  replaced: 'updated recall',
};

if (import.meta.main) {
  try {
    const result = await run(process.argv.slice(2), process.env, new Date());
    console.log(result.notePath);
    console.log(`${result.date}: ${OUTCOME_TEXT[result.outcome]} — ${result.title}`);
  } catch (error) {
    console.error(`book-recall: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
