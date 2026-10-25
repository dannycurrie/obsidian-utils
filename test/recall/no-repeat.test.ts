import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderRecall } from '../../src/recall/block.ts';
import { run } from '../../src/recall/cli.ts';
import { loadConfig } from '../../src/recall/config.ts';
import { daysBefore, pickUnshown, recentlyShown, shownInNote } from '../../src/recall/history.ts';
import { loadBookNotes } from '../../src/recall/pick.ts';
import { API_KEY, makeRecallVault, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();
const DATE = '2026-10-24';
const NOW = new Date(`${DATE}T06:00:00Z`);
const ENV = { BOOK_RECALL_API_KEY: API_KEY };
const DEFAULTS = { statuses: ['Finished', 'Reading'], minWords: 150 };

/** Small seeded PRNG (mulberry32) standing in for `Math.random`. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOK = `---\ntype: book\nstatus: Finished\n---\n${Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ')}\n`;
const library = (titles: string[]) => Object.fromEntries(titles.map((title) => [title, BOOK]));
const TITLES = ['Atomic Habits', 'Deep Work', 'Dune', 'Hyperion', 'Mindset', 'Range', 'Sapiens', 'Scale', 'Stoner', 'Thinking Fast', 'Ulysses'];

/** A daily note holding a recall block for `title`, as a previous run would have written it. */
const dailyWith = (title: string, before = '# Day\n') =>
  `${before}\n${renderRecall({ title, learnings: ['a', 'b', 'c', 'd', 'e'], words: 200, model: 'm', now: NOW })}\n`;

/** Daily notes for the `count` days before DATE, showing `titles[0]` yesterday, `titles[1]` the day before, and so on. */
const history = (titles: string[]) => Object.fromEntries(titles.map((title, i) => [daysBefore(DATE, i + 1), dailyWith(title)]));

/** The book a run would pick. `--dry-run` writes nothing, so repeated picks on one day stay independent. */
const pickFor = async (vault: { configPath: string }, seed: number, date = DATE, extra: string[] = []) =>
  (await run(['--date', date, '--config', vault.configPath, '--dry-run', ...extra], ENV, NOW, seeded(seed))).title;

test('noRepeatDays defaults to 10 and must be a whole number of 0 or more', async () => {
  const defaults = await makeRecallVault({ baseUrl: stub.baseUrl });
  assert.equal((await loadConfig(defaults.configPath)).noRepeatDays, 10);
  const zero = await makeRecallVault({ baseUrl: stub.baseUrl, config: { noRepeatDays: 0 } });
  assert.equal((await loadConfig(zero.configPath)).noRepeatDays, 0);

  for (const noRepeatDays of ['10', -1, 2.5, null, true]) {
    const { configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, config: { noRepeatDays } });
    await assert.rejects(loadConfig(configPath), /"noRepeatDays" must be a whole number of 0 or more/);
  }
});

test('the window counts back calendar days across month and year ends', () => {
  assert.equal(daysBefore('2026-03-01', 1), '2026-02-28');
  assert.equal(daysBefore('2027-01-03', 10), '2026-12-24');
});

test('only the heading link inside book-recall markers counts as shown', () => {
  const text = [
    '# Day',
    'Thinking about [[Dune]] today.',
    '## Book recall — [[Hyperion]]', // outside the markers
    dailyWith('Mindset|Carol Dweck', ''),
    '- also [[Range]] after the block',
  ].join('\n');
  assert.deepEqual(shownInNote(text), ['Mindset']);
  // Links inside the block but not in its heading do not count either.
  assert.deepEqual(shownInNote('<!-- book-recall:start -->\n## Book recall — [[Books/Sub/Dune]]\n- see [[Range]]\n<!-- book-recall:end -->'), ['Books/Sub/Dune']);
});

test('books in recall blocks of the previous noRepeatDays daily notes are never picked', async () => {
  // Shown yesterday ... 10 days ago, so only Ulysses is left.
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(TITLES),
    daily: { ...history(TITLES.slice(0, 10)), [DATE]: dailyWith('Ulysses') },
  });
  // The run date's own note does not count (it matters for --reroll, which replaces that block).
  const shown = await recentlyShown(join(vault.vaultPath, 'Daily'), DATE, 10);
  assert.equal(shown.size, 10);
  assert.equal(shown.has('ulysses'), false);

  // A plain run on a day that already has a block is a no-op (ticket 05), so pick from an empty note.
  await writeFile(vault.dailyPath(DATE), '# Today\n');
  for (let seed = 0; seed < 5; seed++) assert.equal(await pickFor(vault, seed), 'Ulysses');
});

test('a book shown just outside the window can be picked again', async () => {
  const notes = await loadBookNotes((await makeRecallVault({ baseUrl: stub.baseUrl, books: library(['Dune', 'Mindset']) })).vaultPath, 'Books');
  const vault = await makeRecallVault({ baseUrl: stub.baseUrl, daily: { [daysBefore(DATE, 3)]: dailyWith('Dune') } });
  const dailyDir = join(vault.vaultPath, 'Daily');

  assert.deepEqual([...(await recentlyShown(dailyDir, DATE, 3))], [['dune', 3]]);
  assert.equal((await recentlyShown(dailyDir, DATE, 2)).size, 0);
  assert.equal((await recentlyShown(dailyDir, DATE, 0)).size, 0, '0 turns the window off');

  const picks = new Set<string>();
  for (let seed = 0; seed < 50; seed++) picks.add(pickUnshown(notes, DEFAULTS, 'Books', seeded(seed), await recentlyShown(dailyDir, DATE, 2)).title);
  assert.deepEqual([...picks].sort(), ['Dune', 'Mindset']);
});

test('noRepeatDays: 0 disables the window', async () => {
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(['Dune', 'Mindset']),
    daily: { ...history(['Dune']), [DATE]: '# Today\n' },
    config: { noRepeatDays: 0 },
  });
  const picks = new Set<string>();
  for (let seed = 0; seed < 20; seed++) picks.add(await pickFor(vault, seed));
  assert.deepEqual([...picks].sort(), ['Dune', 'Mindset']);
});

test('links outside the markers do not count as shown', async () => {
  const yesterday = daysBefore(DATE, 1);
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(['Dune', 'Mindset']),
    daily: { [yesterday]: '# Day\nRe-read [[Dune]] and [[Mindset]].\n## Book recall — [[Dune]]\n', [DATE]: '# Today\n' },
  });
  const picks = new Set<string>();
  for (let seed = 0; seed < 20; seed++) picks.add(await pickFor(vault, seed));
  assert.deepEqual([...picks].sort(), ['Dune', 'Mindset']);
});

test('missing daily notes in the window are skipped', async () => {
  // Only 2 of the previous 10 days have a note; the gaps are not errors.
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(['Dune', 'Mindset', 'Range']),
    daily: { [daysBefore(DATE, 2)]: dailyWith('Dune'), [daysBefore(DATE, 7)]: dailyWith('Range'), [DATE]: '# Today\n' },
  });
  for (let seed = 0; seed < 5; seed++) assert.equal(await pickFor(vault, seed), 'Mindset');
});

test('shown titles match book notes by name, case-insensitively, wherever the note lives', async () => {
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { 'Fiction/Dune': BOOK, Mindset: BOOK },
    daily: { [daysBefore(DATE, 1)]: dailyWith('dune'), [DATE]: '# Today\n' },
  });
  for (let seed = 0; seed < 5; seed++) assert.equal(await pickFor(vault, seed), 'Mindset');
});

test('when every eligible book is inside the window, the least recently shown one is picked', async () => {
  // Ineligible notes shown longer ago are ignored: only eligible books are candidates.
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { ...library(['Dune', 'Mindset', 'Range']), Backlog: BOOK.replace('Finished', 'Backlog') },
    daily: { ...history(['Mindset', 'Dune', 'Range', 'Mindset', 'Backlog']), [DATE]: '# Today\n' },
  });
  for (let seed = 0; seed < 5; seed++) assert.equal(await pickFor(vault, seed), 'Range');
});

test('ties for least recently shown are broken by the injected random', async () => {
  const notes = await loadBookNotes((await makeRecallVault({ baseUrl: stub.baseUrl, books: library(['Dune', 'Mindset', 'Range']) })).vaultPath, 'Books');
  const shown = new Map([['dune', 4], ['mindset', 4], ['range', 1]]);
  assert.equal(pickUnshown(notes, DEFAULTS, 'Books', () => 0, shown).title, 'Dune');
  assert.equal(pickUnshown(notes, DEFAULTS, 'Books', () => 0.99, shown).title, 'Mindset');
});

test('with no eligible book at all, the usual error is still raised', async () => {
  const notes = await loadBookNotes((await makeRecallVault({ baseUrl: stub.baseUrl, books: { Backlog: BOOK.replace('Finished', 'Backlog') } })).vaultPath, 'Books');
  assert.throws(() => pickUnshown(notes, DEFAULTS, 'Books', Math.random, new Map()), /No eligible books in Books\//);
});

test('--book ignores the window', async () => {
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(['Dune', 'Mindset']),
    daily: { ...history(['Dune']), [DATE]: '# Today\n' },
  });
  assert.equal(await pickFor(vault, 1, DATE, ['--book', 'Dune']), 'Dune');
});

test('over consecutive seeded days with 11 eligible books, no book repeats within the window', async () => {
  const days = Array.from({ length: 12 }, (_, i) => daysBefore('2026-11-12', 11 - i)); // 2026-11-01 … 2026-11-12
  for (const seed of [1, 2, 3]) {
    const vault = await makeRecallVault({
      baseUrl: stub.baseUrl,
      books: library(TITLES),
      daily: Object.fromEntries(days.map((day) => [day, `# ${day}\n`])),
    });
    const random = seeded(seed);
    const picks: string[] = [];
    for (const day of days) {
      // Each run writes its block, which is the history the next day reads back.
      picks.push((await run(['--date', day, '--config', vault.configPath], ENV, NOW, random)).title);
      assert.match(await readFile(vault.dailyPath(day), 'utf8'), /## Book recall — \[\[/);
    }
    assert.equal(new Set(picks.slice(0, 11)).size, 11, `seed ${seed}: ${picks.join(', ')}`);
    // Day 12: day 1's book is the only one outside the 10-day window.
    assert.equal(picks[11], picks[0]);
  }
});

test('a past note with an unclosed block still counts its heading and does not fail the run', async () => {
  const vault = await makeRecallVault({ baseUrl: stub.baseUrl, books: library(['Dune', 'Mindset']), daily: { [DATE]: '# Today\n' } });
  await writeFile(vault.dailyPath(daysBefore(DATE, 1)), '<!-- book-recall:start -->\n## Book recall — [[Dune]]\n- a\n');
  assert.equal(await pickFor(vault, 1), 'Mindset');
});

test('the window reads past daily notes named by dailyFormat', async () => {
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(['Dune', 'Mindset']),
    files: { 'Daily/2026/10-23.md': dailyWith('Dune'), 'Daily/2026/10-24.md': '# Today\n' },
    config: { dailyFormat: 'YYYY/MM-DD' },
  });
  for (let seed = 0; seed < 5; seed++) assert.equal(await pickFor(vault, seed), 'Mindset');
});

test('--reroll also skips books inside the window', async () => {
  const vault = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: library(['Dune', 'Mindset', 'Range']),
    daily: { ...history(['Dune']), [DATE]: dailyWith('Mindset') },
  });
  // Mindset is today's book and Dune was shown yesterday, so Range is the only choice.
  for (let seed = 0; seed < 5; seed++) assert.equal(await pickFor(vault, seed, DATE, ['--reroll']), 'Range');
});
