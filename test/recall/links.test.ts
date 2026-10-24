import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderRecall } from '../../src/recall/block.ts';
import { loadConfig } from '../../src/recall/config.ts';
import { gatherLinkedNotes, passagesLinkingTo, stripRecallBlocks, truncateWords } from '../../src/recall/links.ts';
import { makeRecallVault, recallBlock, recallEnv, runRecall, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();

const book = (body: string) => `---\ntype: book\nstatus: Finished\nauthor: Carol Dweck\n---\n${body}`;
const words = (n: number, word = 'word') => Array.from({ length: n }, () => word).join(' ');
const MINDSET_PATH = 'Books/Mindset.md';

/** Gathers linked notes for `Books/Mindset.md` in a vault built from `files`. */
async function gather(files: Record<string, string>, maxLinkedWords = 4000) {
  const { vaultPath } = await makeRecallVault({ baseUrl: '', files });
  const body = (await readFile(`${vaultPath}/${MINDSET_PATH}`, 'utf8')).replace(/^---[\s\S]*?\n---\n/, '').trim();
  const parts = await gatherLinkedNotes({ vaultPath, book: { path: MINDSET_PATH, body }, maxLinkedWords });
  return parts.map(({ path, direction, text, words }) => ({ path, direction, text, words }));
}

async function lastPrompt(): Promise<string> {
  const request = stub.requests.at(-1) as { messages: { content: string }[] };
  return request.messages[0].content;
}

test('a book with no links has no linked context', async () => {
  assert.deepEqual(await gather({ [MINDSET_PATH]: book('## Notes\n\n- Effort is the path to mastery\n'), 'Other.md': 'No links here.\n' }), []);
});

test('outgoing links resolve by name, alias, heading, embed or path; unresolved, non-markdown and self links are skipped', async () => {
  const parts = await gather({
    [MINDSET_PATH]: book(
      [
        '- See [[Growth Project|my project]] and [[Coaching#Week 2]]',
        '- Again [[growth project]], [[Missing Note]], ![[diagram.png]], [[Mindset]], [[#Notes]]',
        '- By path: [[Areas/Teaching]] and an embed ![[Quotes]]',
      ].join('\n'),
    ),
    'Projects/Growth Project.md': '---\ntype: project\n---\n# Growth Project\n\nPilot the growth mindset sessions.\n',
    'Coaching.md': '# Coaching\n\n## Week 2\n\nPraise the process, not talent.\n',
    'Areas/Teaching.md': 'Teaching notes.\n',
    'Archive/Teaching.md': 'Wrong teaching note.\n',
    'Quotes.md': '"Becoming is better than being."\n',
    'diagram.png': 'not really a png',
  });
  assert.deepEqual(parts, [
    { path: 'Projects/Growth Project.md', direction: 'outgoing', text: '# Growth Project\n\nPilot the growth mindset sessions.', words: 8 },
    { path: 'Coaching.md', direction: 'outgoing', text: '# Coaching\n\n## Week 2\n\nPraise the process, not talent.', words: 10 },
    { path: 'Areas/Teaching.md', direction: 'outgoing', text: 'Teaching notes.', words: 2 },
    { path: 'Quotes.md', direction: 'outgoing', text: '"Becoming is better than being."', words: 5 },
  ]);
});

test('an outgoing note is capped at 1,500 words and frontmatter-only stubs are skipped', async () => {
  const parts = await gather({
    [MINDSET_PATH]: book('Links: [[Long]] and [[Stub]]\n'),
    'Long.md': `---\ntype: note\n---\n${words(2000)}\n`,
    'Stub.md': '---\ntype: note\ntags: [x]\n---\n',
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].path, 'Long.md');
  assert.equal(parts[0].words, 1500);
});

test('a hub note sends only the list item linking to the book, with its children', async () => {
  const hub = [
    '# Books Read',
    '',
    'Everything I finished, by year.',
    '',
    '## 2025',
    '',
    '- [[The Phoenix Project]] — loved it',
    '- [[Mindset|Mindset (Dweck)]] — changed how I give feedback',
    '  - Use "not yet" with the team',
    '    - Tried it in the retro',
    '  Still thinking about praise.',
    '- [[4000 Weeks]]',
    '  - Finitude',
    '',
    '## 2026',
    '',
    '- [[Deep Work]]',
    '',
  ].join('\n');
  const parts = await gather({
    [MINDSET_PATH]: book('No links.\n'),
    'Books Read.md': hub,
    '2026 Plan.md': '## Reading\n\nRe-read [[Mindset]] and\nthe [[Deep Work]] notes before Q2.\n\nUnrelated paragraph about [[Deep Work]].\n',
  });
  assert.deepEqual(parts, [
    {
      path: '2026 Plan.md',
      direction: 'incoming',
      text: 'Re-read [[Mindset]] and\nthe [[Deep Work]] notes before Q2.',
      words: 9,
    },
    {
      path: 'Books Read.md',
      direction: 'incoming',
      text: [
        '- [[Mindset|Mindset (Dweck)]] — changed how I give feedback',
        '  - Use "not yet" with the team',
        '    - Tried it in the retro',
        '  Still thinking about praise.',
      ].join('\n'),
      words: 26,
    },
  ]);
});

test('passages are list items, nested items with their children, or paragraphs, each sent once', () => {
  const body = [
    'Intro mentioning [[Mindset]] once',
    'and [[Mindset]] again in the same paragraph.',
    '',
    '- Parent',
    '  - Child about [[Mindset]]',
    '    - Grandchild',
    '  - Sibling',
    '',
    '1. Numbered [[Mindset]]',
    '',
    '   Continued after a blank line',
    '2. Next',
    '',
    '## Heading with [[Mindset]]',
    'Body under heading.',
  ].join('\n');
  assert.deepEqual(
    passagesLinkingTo(body, (line) => line.includes('[[Mindset]]')),
    [
      'Intro mentioning [[Mindset]] once\nand [[Mindset]] again in the same paragraph.',
      '- Child about [[Mindset]]\n  - Grandchild',
      '1. Numbered [[Mindset]]\n\n   Continued after a blank line',
      '## Heading with [[Mindset]]',
    ],
  );
});

test('daily notes: a past recall block is ignored but a hand-written mention is sent', async () => {
  const daily = [
    '---',
    'type: daily',
    '---',
    '## Notes',
    '',
    '- Talked to Sam about [[Mindset]]: praise effort, not results',
    '',
    '<!-- book-recall:start -->',
    '## Book recall — [[Mindset]]',
    '',
    '- A past learning that must not feed back in',
    '<!-- book-recall:end -->',
    '',
  ].join('\n');
  const recallOnly = '<!-- book-recall:start -->\n## Book recall — [[Mindset]]\n\n- Old learning\n<!-- book-recall:end -->\n';
  const parts = await gather({
    [MINDSET_PATH]: book('No links.\n'),
    'Daily/2026-10-20.md': daily,
    'Daily/2026-10-21.md': recallOnly,
  });
  assert.deepEqual(parts, [
    {
      path: 'Daily/2026-10-20.md',
      direction: 'incoming',
      text: '- Talked to Sam about [[Mindset]]: praise effort, not results',
      words: 10,
    },
  ]);
});

test('Templates/, Archive/tana/, hidden folders and frontmatter links are never used', async () => {
  const parts = await gather({
    [MINDSET_PATH]: book('See [[Book template]] and [[Tana export]] and [[Kept]].\n'),
    'Templates/Book template.md': 'Template mentioning [[Mindset]].\n',
    'Templates/Nested/Other.md': 'Also [[Mindset]].\n',
    'Archive/tana/Tana export.md': 'Old [[Mindset]] export.\n',
    '.obsidian/notes.md': 'Plugin [[Mindset]] data.\n',
    'Stub.md': '---\nbook: "[[Mindset]]"\n---\n',
    'Archive/Kept.md': 'Archive outside tana is fine.\n',
  });
  assert.deepEqual(
    parts.map((p) => [p.path, p.direction]),
    [['Archive/Kept.md', 'outgoing']],
  );
});

test('a note linked both ways is sent once, in full, as outgoing', async () => {
  const parts = await gather({
    [MINDSET_PATH]: book('Part of [[Growth Project]].\n'),
    'Growth Project.md': 'Reading list:\n\n- [[Mindset]]\n\nPlan the sessions.\n',
  });
  assert.deepEqual(
    parts.map((p) => [p.path, p.direction, p.words]),
    [['Growth Project.md', 'outgoing', 7]],
  );
});

test('maxLinkedWords trims linked context in prompt order: the crossing part is cut and later parts dropped', async () => {
  const files = {
    [MINDSET_PATH]: book('[[A]] then [[B]]\n'),
    'A.md': words(30, 'alpha'),
    'B.md': words(30, 'beta'),
    'Hub.md': `- [[Mindset]] ${words(10, 'gamma')}\n`,
  };
  const all = await gather(files);
  assert.deepEqual(all.map((p) => [p.path, p.words]), [['A.md', 30], ['B.md', 30], ['Hub.md', 12]]);

  const trimmed = await gather(files, 45);
  assert.deepEqual(trimmed.map((p) => [p.path, p.words]), [['A.md', 30], ['B.md', 15]]);
  assert.equal(trimmed[1].text, words(15, 'beta'));

  assert.deepEqual(await gather(files, 0), []);
});

test('helpers: recall blocks are stripped (unclosed ones to the end) and word truncation keeps formatting', () => {
  assert.equal(stripRecallBlocks('a <!-- book-recall:start -->x<!-- book-recall:end --> b'), 'a  b');
  assert.equal(stripRecallBlocks('a <!-- book-recall:start --> never closed'), 'a ');
  assert.equal(truncateWords('one\n\n- two  three four', 3), 'one\n\n- two');
  assert.equal(truncateWords('short', 10), 'short');
});

test('linkedNotes and maxLinkedWords come from config with defaults true and 4000', async () => {
  const { configPath } = await makeRecallVault({ baseUrl: '' });
  const config = await loadConfig(configPath);
  assert.equal(config.linkedNotes, true);
  assert.equal(config.maxLinkedWords, 4000);
  const bad = await makeRecallVault({ baseUrl: '', config: { maxLinkedWords: '4000' } });
  await assert.rejects(loadConfig(bad.configPath), /"maxLinkedWords" must be a whole number/);
  const badFlag = await makeRecallVault({ baseUrl: '', config: { linkedNotes: 'no' } });
  await assert.rejects(loadConfig(badFlag.configPath), /"linkedNotes" must be true or false/);
});

test('the footer counts linked notes and total words', () => {
  const footer = (linkedNotes: number | undefined, words: number) =>
    renderRecall({ title: 'X', learnings: [], words, linkedNotes, model: 'm', now: new Date() }).match(/from .*? by m/)?.[0];
  assert.equal(footer(undefined, 23), 'from 1 book note (23 words) by m');
  assert.equal(footer(0, 23), 'from 1 book note (23 words) by m');
  assert.equal(footer(1, 500), 'from 1 book note and 1 linked note (500 words) by m');
  assert.equal(footer(2, 3104), 'from 1 book note and 2 linked notes (3,104 words) by m');
});

const E2E_FILES = {
  [MINDSET_PATH]: book('## Notes\n\n- Growth beats fixed; see [[Growth Project|the project]]\n'),
  'Growth Project.md': '---\ntype: project\n---\nRun four sessions on feedback.\n',
  'Books Read.md': '- [[Deep Work]]\n- [[Mindset]] — re-read yearly\n  - Lent to Sam\n- [[4000 Weeks]]\n',
  'Daily/2026-10-24.md': '## Notes\n',
};

test('the request labels the book note first, then each linked part, and the footer counts them', async () => {
  const { configPath, dailyPath } = await makeRecallVault({ baseUrl: stub.baseUrl, files: E2E_FILES });

  const { code, stderr } = await runRecall(['--book', 'Mindset', '--date', '2026-10-24'], recallEnv(configPath));

  assert.equal(code, 0, stderr);
  assert.equal(
    await lastPrompt(),
    [
      'Book: Mindset by Carol Dweck',
      '',
      '<notes path="Books/Mindset.md">',
      '## Notes',
      '',
      '- Growth beats fixed; see [[Growth Project|the project]]',
      '</notes>',
      '',
      '<notes path="Growth Project.md">',
      'Run four sessions on feedback.',
      '</notes>',
      '',
      '<notes path="Books Read.md">',
      '- [[Mindset]] — re-read yearly',
      '  - Lent to Sam',
      '</notes>',
    ].join('\n'),
  );
  // 10 book words + 5 outgoing + 9 incoming (bullets and dashes count as words, as for the book note).
  assert.match(
    recallBlock(await readFile(dailyPath('2026-10-24'), 'utf8')),
    /_Generated <time> from 1 book note and 2 linked notes \(24 words\) by claude-sonnet-5-5\./,
  );
});

test('linkedNotes: false sends only the book note', async () => {
  const { configPath, dailyPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    files: E2E_FILES,
    config: { linkedNotes: false },
  });

  const { code, stderr } = await runRecall(['--book', 'Mindset', '--date', '2026-10-24'], recallEnv(configPath));

  assert.equal(code, 0, stderr);
  const prompt = await lastPrompt();
  assert.equal(prompt.match(/<notes path=/g)?.length, 1);
  assert.doesNotMatch(prompt, /Growth Project\.md|Books Read\.md/);
  assert.match(recallBlock(await readFile(dailyPath('2026-10-24'), 'utf8')), /from 1 book note \(10 words\)/);
});
