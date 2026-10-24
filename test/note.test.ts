import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.ts';
import { formatNoteName } from '../src/note.ts';
import { makeVault, snapshot, tokenEnv, useMockApi } from './harness.ts';

const mock = useMockApi();
const W42_DONE = new Date('2026-10-20T08:00:00Z');

test('a re-run replaces its own block and keeps text either side byte-for-byte', async () => {
  const before = '---\ntype: plan\n---\n\n# Plan\n\nReflections  \twith odd   spacing\n';
  const { notePath, configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: before });

  assert.equal((await run(['--week', '2026-W42', '--config', configPath], tokenEnv(), W42_DONE)).outcome, 'appended');
  const after = '\n## After the review\n\nWritten by hand, below the block.\n';
  await writeFile(notePath, (await readFile(notePath, 'utf8')) + after);

  const rerun = await run(['--week', '2026-W42', '--config', configPath], tokenEnv(), new Date('2026-10-21T09:30:00Z'));

  assert.equal(rerun.outcome, 'replaced');
  const note = await readFile(notePath, 'utf8');
  assert.equal(note.split('<!-- week-review:start -->').length - 1, 1, 'exactly one block');
  assert.ok(note.startsWith(`${before}\n<!-- week-review:start -->`), 'text before the block is unchanged');
  assert.ok(note.endsWith(`<!-- week-review:end -->\n${after}`), 'text after the block is unchanged');
  assert.match(note, /_Generated 2026-10-21 10:30 /, 'block content is updated');
});

test('a missing note is created with the week-plan frontmatter stub, and re-runs never duplicate it', async () => {
  const { noteDir, notePath, configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42' });

  const first = await run(['--week', '2026-W42', '--config', configPath], tokenEnv(), W42_DONE);
  const second = await run(['--week', '2026-W42', '--config', configPath], tokenEnv(), W42_DONE);

  assert.deepEqual([first.outcome, second.outcome], ['created', 'replaced']);
  const note = await readFile(notePath, 'utf8');
  assert.ok(
    note.startsWith('---\ntype: plan\ncreated: 2026-10-20\nperiod: 2026-W42\nstatus: Draft\n---\n\n<!-- week-review:start -->'),
  );
  assert.equal(note.split('<!-- week-review:start -->').length - 1, 1);
  assert.deepEqual(await readdir(noteDir), ['2026-W42.md']);
});

test('folder, filename format and new-note template come from config', async () => {
  const { vaultPath, configPath } = await makeVault({
    baseUrl: mock.baseUrl,
    week: '2026-W42',
    config: { noteFolder: '.', filenameFormat: '[Week ]W[, ]GGGG', newNoteTemplate: '# {{period}}\n' },
  });

  const result = await run(['--week', '2026-W42', '--config', configPath], tokenEnv(), W42_DONE);

  assert.equal(result.notePath, join(vaultPath, 'Week 42, 2026.md'));
  assert.match(await readFile(result.notePath, 'utf8'), /^# 2026-W42\n\n<!-- week-review:start -->/);
  assert.throws(() => formatNoteName('YYYY-WW', { year: 2026, week: 42 }), /Unsupported token "YYYY"/);
});

test('writes go through a temp file renamed into place, leaving nothing behind', async () => {
  const { noteDir, notePath, configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: '# Plan\n' });
  const inodeBefore = (await stat(notePath)).ino;

  await run(['--week', '2026-W42', '--config', configPath], tokenEnv(), W42_DONE);

  assert.notEqual((await stat(notePath)).ino, inodeBefore, 'rename swaps in a new file rather than writing in place');
  assert.deepEqual(await readdir(noteDir), ['2026-W42.md']);
});

test('a note with broken markers is left untouched', async () => {
  const broken = '# Plan\n\n<!-- week-review:start -->\nhalf a block\n';
  const { dir, configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: broken });
  const before = await snapshot(dir);

  await assert.rejects(run(['--week', '2026-W42', '--config', configPath], tokenEnv(), W42_DONE), /unmatched or repeated/);
  assert.deepEqual(await snapshot(dir), before);
});
