import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANNED_LEARNINGS } from '../../mock/claude.ts';
import { run } from '../../src/recall/cli.ts';
import { loadConfig } from '../../src/recall/config.ts';
import { currentRecall, formatDate, todayIn } from '../../src/recall/daily.ts';
import { snapshot } from '../harness.ts';
import { API_KEY, makeRecallVault, recallBlock, recallEnv, runRecall, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();

const NOW = new Date('2026-10-24T08:00:00Z');
const book = (status = 'Finished') => `---\ntype: book\nstatus: ${status}\n---\n## Notes\n\n- An idea worth keeping\n`;
const BOOKS = { Alpha: book(), Beta: book(), Gamma: book() };
/** The real vault's daily template. */
const TEMPLATE = [
  '---',
  'type: daily',
  'created: {{date:YYYY-MM-DD}}',
  'week: {{date:GGGG-[W]WW}}',
  '---',
  'Week plan: [[{{date:GGGG-[W]WW}}]]',
  '',
  '## Notes',
  '',
].join('\n');
const FRESH = ['Fresh one.', 'Fresh two.', 'Fresh three.', 'Fresh four.', 'Fresh five.'];

const existingBlock = (title: string) =>
  [
    '<!-- book-recall:start -->',
    `## Book recall — [[${title}]]`,
    '',
    ...CANNED_LEARNINGS.map((l) => `- ${l}`),
    '',
    '_Generated 2026-10-24 07:00 from 1 book note (6 words) by claude-sonnet-5-5. Re-runs overwrite this block._',
    '<!-- book-recall:end -->',
  ].join('\n');
// A recall note someone has written around (e.g. a reflection under the recall).
const BEFORE = '---\ntype: recall\ncreated: 2026-10-24\n---\n\n- Morning thought\n\n';
const AFTER = '\n\n## Evening\n\n- Written after the recall, no trailing newline';
const withBlock = (title: string) => `${BEFORE}${existingBlock(title)}${AFTER}`;

type Options = Parameters<typeof makeRecallVault>[0];
const vault = (options: Partial<Options> = {}) =>
  makeRecallVault({ baseUrl: stub.baseUrl, books: BOOKS, ...options, config: { minWords: 0, ...options.config } });

const runIn = (configPath: string, args: string[], random: () => number = () => 0, now = NOW) =>
  run([...args, '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, now, random);

/** Asserts the note is BEFORE + a block for `title` with `learnings` + AFTER, byte for byte outside the markers. */
function assertReplacedInPlace(note: string, title: string, learnings: string[]) {
  assert.ok(note.startsWith(BEFORE), 'text before the block is unchanged');
  assert.ok(note.endsWith(`<!-- book-recall:end -->${AFTER}`), 'text after the block is unchanged');
  const block = currentRecall(note)!;
  assert.equal(block.title, title);
  for (const learning of learnings) assert.ok(block.block.includes(`- ${learning}\n`));
  assert.equal(note.split('<!-- book-recall:start -->').length, 2, 'exactly one block');
}

// --- Plain re-runs ---

test('a second plain run on the same day makes no Claude call and leaves the vault byte-for-byte unchanged', async () => {
  const v = await vault({ daily: { '2026-10-24': '# Today\n' } });
  const first = await runIn(v.configPath, ['--date', '2026-10-24']);
  assert.equal(first.outcome, 'created');
  assert.equal(stub.requests.length, 1);
  const before = await snapshot(v.dir);

  stub.requests.length = 0;
  const second = await runIn(v.configPath, ['--date', '2026-10-24'], () => 0.99);
  assert.deepEqual(second, { date: '2026-10-24', title: first.title, notePath: v.recallPath('2026-10-24'), outcome: 'skipped' });
  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(v.dir), before);
});

test('the CLI prints the note path and a one-line "already has a recall" message, exits 0, and needs no API key', async () => {
  const v = await vault({ recall: { '2026-10-24': withBlock('Beta') } });
  const before = await snapshot(v.dir);
  const env = { ...recallEnv(v.configPath), BOOK_RECALL_API_KEY: '' };

  const { code, stdout, stderr } = await runRecall(['--date', '2026-10-24'], env);

  assert.equal(code, 0, stderr);
  assert.deepEqual(stdout.trim().split('\n'), [
    v.recallPath('2026-10-24'),
    '2026-10-24: already has a recall — Beta (nothing to do; --regenerate or --reroll replaces it)',
  ]);
  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(v.dir), before);
});

test('--book on a day that already has a block is also a no-op', async () => {
  const v = await vault({ recall: { '2026-10-24': withBlock('Beta') } });
  const before = await snapshot(v.dir);
  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--book', 'Alpha']);
  assert.equal(result.outcome, 'skipped');
  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(v.dir), before);
});

// --- --regenerate and --reroll ---

test('--regenerate re-summarises the same book and replaces the block in place', async () => {
  // Beta is no longer eligible: --regenerate still uses it, as --book would.
  const v = await vault({ books: { ...BOOKS, Beta: book('Abandoned') }, recall: { '2026-10-24': withBlock('Beta') } });
  stub.script.push({ learnings: FRESH });

  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--regenerate'], () => 0);

  assert.equal(result.outcome, 'replaced');
  assert.equal(result.title, 'Beta');
  assert.equal(stub.requests.length, 1);
  assert.match((stub.requests[0] as { messages: { content: string }[] }).messages[0].content, /^Book: Beta\n/);
  assertReplacedInPlace(await readFile(v.recallPath('2026-10-24'), 'utf8'), 'Beta', FRESH);
});

test('--regenerate also understands an aliased heading link', async () => {
  const v = await vault({ recall: { '2026-10-24': withBlock('Gamma|The G book') } });
  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--regenerate']);
  assert.equal(result.title, 'Gamma');
});

for (const random of [0, 0.34, 0.5, 0.67, 0.99]) {
  test(`--reroll never picks today's book (random ${random}) and replaces the block in place`, async () => {
    const v = await vault({ recall: { '2026-10-24': withBlock('Alpha') } });
    stub.script.push({ learnings: FRESH });

    const result = await runIn(v.configPath, ['--date', '2026-10-24', '--reroll'], () => random);

    assert.equal(result.outcome, 'replaced');
    assert.notEqual(result.title, 'Alpha');
    assert.equal(result.title, random < 0.5 ? 'Beta' : 'Gamma');
    assert.equal(stub.requests.length, 1);
    assertReplacedInPlace(await readFile(v.recallPath('2026-10-24'), 'utf8'), result.title, FRESH);
  });
}

test('--reroll --book replaces the block with the named book, but not with today\'s book', async () => {
  const v = await vault({ recall: { '2026-10-24': withBlock('Alpha') } });
  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--reroll', '--book', 'Gamma']);
  assert.equal(result.title, 'Gamma');
  assertReplacedInPlace(await readFile(v.recallPath('2026-10-24'), 'utf8'), 'Gamma', CANNED_LEARNINGS);

  stub.requests.length = 0;
  await assert.rejects(runIn(v.configPath, ['--date', '2026-10-24', '--reroll', '--book', 'Gamma']), /"Gamma" is already the book in today's recall/);
  assert.equal(stub.requests.length, 0);
});

test('replace flags fail before calling Claude when there is nothing to replace or nothing to switch to', async () => {
  const v = await vault({
    books: { Alpha: book(), Beta: book('Backlog') },
    recall: { '2026-10-24': '# Today\n', '2026-10-25': withBlock('Alpha'), '2026-10-26': withBlock('Alpha').replace('[[Alpha]]', 'Alpha') },
  });
  const before = await snapshot(v.dir);
  const at = (date: string, ...flags: string[]) => runIn(v.configPath, ['--date', date, ...flags]);

  await assert.rejects(at('2026-10-24', '--regenerate'), /No book-recall block in .*2026-10-24\.md to regenerate/);
  await assert.rejects(at('2026-10-24', '--reroll'), /No book-recall block in .*2026-10-24\.md to reroll/);
  await assert.rejects(at('2026-10-23', '--regenerate'), /No book-recall block in .*2026-10-23\.md to regenerate/);
  await assert.rejects(at('2026-10-25', '--reroll'), /No eligible book other than "Alpha" to reroll to/);
  await assert.rejects(at('2026-10-26', '--regenerate'), /Can't read the book from the book-recall block/);
  await assert.rejects(at('2026-10-25', '--regenerate', '--reroll'), /either --regenerate or --reroll, not both/);
  await assert.rejects(at('2026-10-25', '--regenerate', '--book', 'Alpha'), /--regenerate keeps the current book/);

  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(v.dir), before);
});

// --- --dry-run ---

test('--dry-run calls Claude and prints only the block to stdout, writing nothing', async () => {
  const v = await vault({ daily: { '2026-10-24': '# Today\n' } });
  const before = await snapshot(v.dir);

  const { code, stdout, stderr } = await runRecall(['--date', '2026-10-24', '--book', 'Alpha', '--dry-run'], recallEnv(v.configPath));

  assert.equal(code, 0, stderr);
  assert.equal(stub.requests.length, 1);
  assert.equal(
    recallBlock(stdout),
    [
      '<!-- book-recall:start -->',
      '## Book recall — [[Alpha]]',
      '',
      ...CANNED_LEARNINGS.map((l) => `- ${l}`),
      '',
      '_Generated <time> from 1 book note (7 words) by claude-sonnet-5-5. Re-runs overwrite this block._',
      '<!-- book-recall:end -->',
      '',
    ].join('\n'),
  );
  assert.ok(stdout.startsWith('<!-- book-recall:start -->'));
  assert.deepEqual(await snapshot(v.dir), before);
});

test('--dry-run creates neither the recall note nor a daily note', async () => {
  const v = await vault({ files: { 'Templates/daily.md': TEMPLATE } });
  const before = await snapshot(v.dir);
  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--dry-run']);
  assert.equal(result.outcome, 'dry-run');
  assert.match(result.block!, /^<!-- book-recall:start -->\n## Book recall — \[\[Alpha\]\]/);
  assert.equal(stub.requests.length, 1);
  assert.deepEqual(await snapshot(v.dir), before);
  assert.deepEqual(await readdir(join(v.vaultPath, 'Daily')), []);
});

test('--dry-run previews a --reroll without writing; on its own it follows the plain no-op', async () => {
  const v = await vault({ recall: { '2026-10-24': withBlock('Alpha') } });
  const before = await snapshot(v.dir);

  assert.equal((await runIn(v.configPath, ['--date', '2026-10-24', '--dry-run'])).outcome, 'skipped');
  assert.equal(stub.requests.length, 0);

  const preview = await runIn(v.configPath, ['--date', '2026-10-24', '--dry-run', '--reroll']);
  assert.equal(preview.outcome, 'dry-run');
  assert.equal(preview.title, 'Beta');
  assert.equal(stub.requests.length, 1);
  assert.deepEqual(await snapshot(v.dir), before);
});

// --- Recall notes ---

for (const date of ['2026-10-24', '2026-12-31', '2027-01-01']) {
  test(`the recall note for ${date} is created with recall frontmatter; no daily note is created`, async () => {
    const v = await vault({ files: { 'Templates/daily.md': TEMPLATE } });

    const result = await runIn(v.configPath, ['--date', date, '--book', 'Alpha']);

    assert.equal(result.outcome, 'created');
    assert.equal(result.notePath, v.recallPath(date));
    assert.equal(await readFile(v.recallPath(date), 'utf8'), `---\ntype: recall\ncreated: ${date}\n---\n\n${result.block}\n`);
    assert.deepEqual(await readdir(join(v.vaultPath, 'Daily')), ['Recall']);
  });
}

test('the daily note template is only read for the embed hint: a missing one is not an error', async () => {
  const v = await vault({ config: { dailyTemplate: 'Templates/Missing.md' } });
  const result = await runIn(v.configPath, ['--date', '2026-10-24']);
  assert.equal(result.outcome, 'created');
  assert.equal(result.hint, undefined);
});

test('date formats render Moment-style tokens, ISO week years and literals', () => {
  assert.equal(formatDate('YYYY-MM-DD', '2026-03-05'), '2026-03-05');
  assert.equal(formatDate('GGGG-[W]WW', '2026-12-31'), '2026-W53');
  assert.equal(formatDate('GGGG-[W]WW', '2027-01-01'), '2026-W53');
  assert.equal(formatDate('GGGG-[W]WW', '2021-01-03'), '2020-W53');
  assert.equal(formatDate('GGGG-[W]WW', '2024-12-30'), '2025-W01');
  assert.equal(formatDate('YYYY [W]W', '2024-12-30'), '2024 W1');
  assert.equal(formatDate('dddd D MMMM YY (ddd, MMM, M)', '2026-03-05'), 'Thursday 5 March 26 (Thu, Mar, 3)');
  assert.equal(formatDate('YYYY/MM/[Daily] DD', '2026-10-24'), '2026/10/Daily 24');
  assert.throws(() => formatDate('YYYY-MM-Do', '2026-10-24'), /Unsupported date token "o" in "YYYY-MM-Do"/);
});

// --- Config ---

test('recall notes go in <dailyFolder>/Recall by default, named by dailyFormat, or in recallFolder', async () => {
  const v = await vault({
    files: { 'Journal/.keep': '' },
    config: { dailyFolder: 'Journal', dailyFormat: 'YYYY/MM/YYYY-MM-DD ddd' },
  });
  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--book', 'Alpha']);
  const path = join(v.vaultPath, 'Journal', 'Recall', '2026', '10', '2026-10-24 Sat.md');
  assert.equal(result.notePath, path);
  assert.match(await readFile(path, 'utf8'), /^---\ntype: recall\ncreated: 2026-10-24\n---\n\n<!-- book-recall:start -->/);

  // The next run finds that note: no second note, no second block.
  assert.equal((await runIn(v.configPath, ['--date', '2026-10-24'])).outcome, 'skipped');

  const elsewhere = await vault({ config: { recallFolder: 'Reading/Recalls' } });
  const moved = await runIn(elsewhere.configPath, ['--date', '2026-10-24', '--book', 'Alpha']);
  assert.equal(moved.notePath, join(elsewhere.vaultPath, 'Reading', 'Recalls', '2026-10-24.md'));
});

test('without those keys, config falls back to the vault\'s .obsidian/daily-notes.json, then to Daily, YYYY-MM-DD, Templates/daily.md', async () => {
  const plain = await vault();
  const defaults = await loadConfig(plain.configPath);
  assert.deepEqual(
    [defaults.dailyFolder, defaults.dailyFormat, defaults.dailyTemplate, defaults.timezone],
    ['Daily', 'YYYY-MM-DD', 'Templates/daily.md', 'Europe/London'],
  );

  // Obsidian stores the template without its extension.
  const settings = JSON.stringify({ folder: 'Journal', format: 'DD-MM-YYYY', template: 'Tpl/Day' });
  const v = await vault({ files: { '.obsidian/daily-notes.json': settings, 'Journal/.keep': '', 'Tpl/Day.md': '# {{title}}\n' } });
  const fromVault = await loadConfig(v.configPath);
  assert.deepEqual([fromVault.dailyFolder, fromVault.dailyFormat, fromVault.dailyTemplate], ['Journal', 'DD-MM-YYYY', 'Tpl/Day']);
  const result = await runIn(v.configPath, ['--date', '2026-10-24', '--book', 'Alpha']);
  assert.equal(result.notePath, join(v.vaultPath, 'Journal', 'Recall', '24-10-2026.md'));

  // Config keys win over the vault's settings.
  await writeFile(v.configPath, JSON.stringify({ vaultPath: v.vaultPath, dailyFolder: 'Daily', dailyFormat: 'YYYY-MM-DD' }));
  const overridden = await loadConfig(v.configPath);
  assert.deepEqual([overridden.dailyFolder, overridden.dailyFormat, overridden.dailyTemplate], ['Daily', 'YYYY-MM-DD', 'Tpl/Day']);
});

test('config rejects an unknown time zone, an empty dailyFormat and non-string daily keys', async () => {
  for (const [config, error] of [
    [{ timezone: 'Mars/Olympus' }, /"timezone" is not a known time zone: "Mars\/Olympus"/],
    [{ dailyFormat: '' }, /"dailyFormat" must not be empty/],
    [{ dailyTemplate: 3 }, /"dailyTemplate" must be a string/],
    [{ recallFolder: false }, /"recallFolder" must be a string/],
  ] as const) {
    const v = await vault({ config });
    await assert.rejects(loadConfig(v.configPath), error);
  }
});

// --- Today in the configured time zone ---

const MIDNIGHT_CASES: [string, string, string][] = [
  ['2026-10-24T22:59:00Z', '2026-10-24', '23:59 BST on the Saturday'],
  ['2026-10-24T23:30:00Z', '2026-10-25', '00:30 BST on the night clocks go back'],
  ['2026-10-25T00:30:00Z', '2026-10-25', '01:30 BST, half an hour before the change'],
  ['2026-10-25T01:30:00Z', '2026-10-25', '01:30 GMT, the repeated hour'],
  ['2026-10-25T23:30:00Z', '2026-10-25', '23:30 GMT, the first evening after the change'],
  ['2026-10-26T00:00:00Z', '2026-10-26', '00:00 GMT'],
  ['2026-03-28T23:30:00Z', '2026-03-28', '23:30 GMT before clocks go forward'],
  ['2026-03-29T00:59:00Z', '2026-03-29', '00:59 GMT, just before the change'],
  ['2026-03-29T22:59:00Z', '2026-03-29', '23:59 BST after the change'],
  ['2026-03-29T23:00:00Z', '2026-03-30', '00:00 BST'],
];

for (const [instant, date, label] of MIDNIGHT_CASES) {
  test(`at ${instant} (${label}) the run writes to the London date ${date}`, async () => {
    const v = await vault();
    const result = await runIn(v.configPath, ['--book', 'Alpha'], () => 0, new Date(instant));
    assert.equal(result.date, date);
    assert.equal(result.notePath, v.recallPath(date));
    assert.deepEqual(await readdir(join(v.vaultPath, 'Daily', 'Recall')), [`${date}.md`]);
  });
}

test('the timezone key decides "today" and the Generated time', async () => {
  assert.equal(todayIn('Europe/London', new Date('2026-10-25T02:00:00Z')), '2026-10-25');
  assert.equal(todayIn('America/New_York', new Date('2026-10-25T02:00:00Z')), '2026-10-24');
  const v = await vault({ config: { timezone: 'America/New_York' } });
  const result = await runIn(v.configPath, ['--book', 'Alpha'], () => 0, new Date('2026-10-25T02:00:00Z'));
  assert.equal(result.notePath, v.recallPath('2026-10-24'));
  assert.match(result.block!, /_Generated 2026-10-24 22:00 /);
});

// --- Forced re-runs ---

test('repeated plain and forced re-runs leave one recall note with one block, and no daily note', async () => {
  const v = await vault({ files: { 'Templates/daily.md': TEMPLATE } });
  const runs: [string[], string][] = [
    [[], 'created'],
    [[], 'skipped'],
    [['--regenerate'], 'replaced'],
    [['--regenerate'], 'replaced'],
    [['--reroll'], 'replaced'],
    [['--reroll'], 'replaced'],
    [[], 'skipped'],
  ];
  for (const [flags, outcome] of runs) {
    const result = await runIn(v.configPath, ['--date', '2026-10-24', ...flags], () => 0.5);
    assert.equal(result.outcome, outcome, flags.join(' '));
  }
  assert.equal(stub.requests.length, 5);
  assert.deepEqual(await readdir(join(v.vaultPath, 'Daily')), ['Recall']);
  assert.deepEqual(await readdir(join(v.vaultPath, 'Daily', 'Recall')), ['2026-10-24.md']);
  const note = await readFile(v.recallPath('2026-10-24'), 'utf8');
  assert.equal(note.split('<!-- book-recall:start -->').length - 1, 1);
  assert.equal(note.split('<!-- book-recall:end -->').length - 1, 1);
  assert.ok(note.startsWith('---\ntype: recall\ncreated: 2026-10-24\n---\n'), 'frontmatter is kept');
});
