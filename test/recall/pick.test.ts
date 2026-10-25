import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/recall/cli.ts';
import { loadConfig } from '../../src/recall/config.ts';
import { isEligible, loadBookNotes, pickBook } from '../../src/recall/pick.ts';
import { snapshot } from '../harness.ts';
import { API_KEY, makeRecallVault, recallEnv, runRecall, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();
const NOW = new Date('2026-10-24T06:00:00Z');
const DATE = '2026-10-24';
const DAILY = '# Today\n';
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

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
const note = (frontmatter: Record<string, string>, bodyWords: number) =>
  `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n${words(bodyWords)}\n`;

const ELIGIBLE = {
  Mindset: note({ type: 'book', status: 'Finished', author: 'Carol Dweck' }, 300),
  'Fiction/Dune': note({ type: 'book', status: 'Reading' }, 200),
  'Fiction/Sci-Fi/Hyperion': note({ type: 'book', status: '"Finished"' }, 150),
};

const INELIGIBLE = {
  'Some Backlog Book': note({ type: 'book', status: 'Backlog' }, 400),
  'Fiction/Gave Up': note({ type: 'book', status: 'Abandoned' }, 400),
  Stub: '---\ntype: book\nstatus: Finished\n---\n',
  'Almost Long Enough': note({ type: 'book', status: 'Finished' }, 149),
  'An Article': note({ type: 'article', status: 'Finished' }, 400),
  'No Status': note({ type: 'book' }, 400),
  'No Frontmatter': `${words(400)}\n`,
  'Templates/Book template': note({ type: 'book', status: 'Finished' }, 400),
  'Fiction/Templates/Nested template': note({ type: 'book', status: 'Finished' }, 400),
};

const LIBRARY = { ...ELIGIBLE, ...INELIGIBLE };
const titleOf = (key: string) => key.split('/').at(-1);

test('the books folder is searched recursively, ignoring Templates/', async () => {
  const { vaultPath } = await makeRecallVault({ baseUrl: stub.baseUrl, books: LIBRARY });
  const notes = await loadBookNotes(vaultPath, 'Books');

  const paths = notes.map((n) => n.path);
  assert.ok(paths.includes(join('Books', 'Fiction', 'Sci-Fi', 'Hyperion.md')));
  assert.ok(!paths.some((p) => p.includes('Templates')), 'no note under Templates/ is read');
  assert.equal(notes.length, Object.keys(LIBRARY).length - 2);

  const hyperion = notes.find((n) => n.title === 'Hyperion');
  assert.deepEqual(
    { author: hyperion?.author, status: hyperion?.status, words: hyperion?.words },
    { author: null, status: 'Finished', words: 150 },
  );
  assert.deepEqual(
    notes.filter((n) => isEligible(n, DEFAULTS)).map((n) => n.title).sort(),
    Object.keys(ELIGIBLE).map(titleOf).sort(),
  );
});

test('over many seeds, every eligible book is picked and no ineligible one ever is', async () => {
  const { vaultPath } = await makeRecallVault({ baseUrl: stub.baseUrl, books: LIBRARY });
  const notes = await loadBookNotes(vaultPath, 'Books');

  const picked = new Set<string>();
  for (let seed = 0; seed < 300; seed++) picked.add(pickBook(notes, DEFAULTS, 'Books', seeded(seed)).title);

  assert.deepEqual([...picked].sort(), Object.keys(ELIGIBLE).map(titleOf).sort());
});

test('the pick is uniform over eligible books in path order, including the edges of [0, 1)', async () => {
  const { vaultPath } = await makeRecallVault({ baseUrl: stub.baseUrl, books: LIBRARY });
  const notes = await loadBookNotes(vaultPath, 'Books');
  const pickAt = (r: number) => pickBook(notes, DEFAULTS, 'Books', () => r).title;

  assert.deepEqual([0, 0.34, 0.67, 1 - Number.EPSILON].map(pickAt), ['Dune', 'Hyperion', 'Mindset', 'Mindset']);
});

test('with a fixed seed, the same vault always gives the same pick', async () => {
  const picks: string[][] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, books: LIBRARY, daily: { [DATE]: DAILY } });
    const titles: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const result = await run(['--date', DATE, '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, NOW, seeded(seed));
      titles.push(result.title);
    }
    picks.push(titles);
  }
  assert.deepEqual(picks[0], picks[1]);
  assert.ok(picks[0].every((title) => Object.keys(ELIGIBLE).map(titleOf).includes(title)));
});

test('statuses and minWords default to the brief and can be overridden in config', async () => {
  const defaults = await makeRecallVault({ baseUrl: stub.baseUrl });
  const config = await loadConfig(defaults.configPath);
  assert.deepEqual(
    { booksFolder: config.booksFolder, statuses: config.statuses, minWords: config.minWords },
    { booksFolder: 'Books', statuses: ['Finished', 'Reading'], minWords: 150 },
  );

  const { configPath, recallPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: LIBRARY,
    daily: { [DATE]: DAILY },
    config: { statuses: ['Backlog'], minWords: 10 },
  });
  for (const seed of [1, 2, 3]) {
    const result = await run(['--date', DATE, '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, NOW, seeded(seed));
    assert.equal(result.title, 'Some Backlog Book');
  }
  assert.match(await readFile(recallPath(DATE), 'utf8'), /\[\[Some Backlog Book\]\]/);
});

test('booksFolder comes from config', async () => {
  const { configPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { 'Library/Mindset': ELIGIBLE.Mindset, Other: ELIGIBLE['Fiction/Dune'] },
    daily: { [DATE]: DAILY },
    config: { booksFolder: 'Books/Library' },
  });
  const result = await run(['--date', DATE, '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, NOW, seeded(9));
  assert.equal(result.title, 'Mindset');
});

test('bad statuses or minWords in config are rejected', async () => {
  for (const [config, message] of [
    [{ statuses: 'Finished' }, /"statuses" must be an array of strings/],
    [{ statuses: ['Finished', 3] }, /"statuses" must be an array of strings/],
    [{ minWords: '150' }, /"minWords" must be a whole number/],
    [{ minWords: -1 }, /"minWords" must be a whole number/],
    [{ minWords: 1.5 }, /"minWords" must be a whole number/],
  ] as const) {
    const { configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, config });
    await assert.rejects(loadConfig(configPath), message);
  }
});

test('the CLI without --book recalls the eligible book, sending its nested path', async () => {
  const { configPath, recallPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { 'Fiction/Dune': ELIGIBLE['Fiction/Dune'], ...INELIGIBLE },
    daily: { [DATE]: DAILY },
  });

  const { code, stdout, stderr } = await runRecall(['--date', DATE], recallEnv(configPath));

  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim().split('\n')[1], `${DATE}: added recall — Dune`);
  assert.match(await readFile(recallPath(DATE), 'utf8'), /## Book recall — \[\[Dune\]\]/);
  const [request] = stub.requests as [{ messages: { content: string }[] }];
  assert.match(request.messages[0].content, /<notes path="Books\/Fiction\/Dune\.md">/);
});

test('--book bypasses the pick, finding nested and ineligible notes by title', async () => {
  const { configPath, recallPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: LIBRARY,
    daily: { [DATE]: DAILY },
  });
  const nested = await runRecall(['--book', 'Gave Up', '--date', DATE], recallEnv(configPath));
  assert.equal(nested.code, 0, nested.stderr);
  assert.match(await readFile(recallPath(DATE), 'utf8'), /\[\[Gave Up\]\]/);
});

test('--book with an unknown title fails clearly without calling Claude or writing', async () => {
  const { dir, configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, books: LIBRARY, daily: { [DATE]: DAILY } });
  const before = await snapshot(dir);

  for (const title of ['Nope', 'Book template']) {
    const { code, stderr } = await runRecall(['--book', title, '--date', DATE], recallEnv(configPath));
    assert.equal(code, 1);
    assert.equal(stderr.trim(), `book-recall: No book note "${title}" in Books/`);
  }

  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(dir), before);
});

test('with no eligible book, the run fails non-zero without calling Claude or writing', async () => {
  const { dir, configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, books: INELIGIBLE, daily: { [DATE]: DAILY } });
  const before = await snapshot(dir);

  const { code, stderr } = await runRecall(['--date', DATE], recallEnv(configPath));

  assert.equal(code, 1);
  assert.equal(
    stderr.trim(),
    'book-recall: No eligible books in Books/ (need type: book, status Finished or Reading, at least 150 words)',
  );
  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(dir), before);
});

test('a missing books folder fails without calling Claude or writing', async () => {
  const { dir, configPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    daily: { [DATE]: DAILY },
    config: { booksFolder: 'Missing' },
  });
  const before = await snapshot(dir);

  const { code, stderr } = await runRecall(['--date', DATE], recallEnv(configPath));

  assert.equal(code, 1);
  assert.match(stderr, /book-recall: Books folder not found: .*Missing/);
  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(dir), before);
});
