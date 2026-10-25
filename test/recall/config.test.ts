import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { parseLearnings } from '../../src/recall/claude.ts';
import { run } from '../../src/recall/cli.ts';
import { defaultConfigPath } from '../../src/recall/config.ts';
import { snapshot } from '../harness.ts';
import { API_KEY, makeRecallVault, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();
const NOW = new Date('2026-10-24T06:00:00Z');
const noKeychain = async () => null;
const BOOK = '---\ntype: book\nstatus: Finished\n---\n## Notes\n\n- One idea\n';

test('config defaults to ~/.config/book-recall/config.json, overridable by env', () => {
  assert.equal(defaultConfigPath({}), join(homedir(), '.config', 'book-recall', 'config.json'));
  assert.equal(defaultConfigPath({ BOOK_RECALL_CONFIG: '/tmp/other.json' }), '/tmp/other.json');
});

test('a config holding an API key is rejected', async () => {
  const { configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, config: { anthropicApiKey: API_KEY } });
  await assert.rejects(
    run(['--book', 'X', '--date', '2026-10-24', '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, NOW),
    /must not contain secrets \(found "anthropicApiKey"\)/,
  );
});

test('a config without vaultPath is rejected', async () => {
  const { configPath } = await makeRecallVault({ baseUrl: stub.baseUrl, config: { vaultPath: undefined } });
  await assert.rejects(
    run(['--book', 'X', '--date', '2026-10-24', '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, NOW),
    /missing "vaultPath"/,
  );
});

test('a missing API key or book, or a bad date, fails before calling Claude or writing', async () => {
  const { dir, configPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { Mindset: BOOK },
    daily: { '2026-10-24': '# Today\n' },
  });
  const before = await snapshot(dir);
  const args = (book: string, date: string) => ['--book', book, '--date', date, '--config', configPath];

  await assert.rejects(
    run(args('Mindset', '2026-10-24'), {}, NOW, Math.random, { keychain: noKeychain }),
    /No Anthropic API key\. Add it to the Keychain with: security add-generic-password -s book-recall -a anthropic-api -w <token>/,
  );
  await assert.rejects(run(args('Nope', '2026-10-24'), { BOOK_RECALL_API_KEY: API_KEY }, NOW), /No book note "Nope" in Books\//);
  await assert.rejects(run(args('Mindset', '24/10/2026'), { BOOK_RECALL_API_KEY: API_KEY }, NOW), /--date must be YYYY-MM-DD/);

  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(dir), before);
});

test('without --date it writes to today in London', async () => {
  const { configPath, recallPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { Mindset: BOOK },
    daily: { '2026-10-25': '# Today\n' },
  });
  // 23:30 UTC on 24 Oct is 00:30 on 25 Oct in London (BST).
  const result = await run(['--book', 'Mindset', '--config', configPath], { BOOK_RECALL_API_KEY: API_KEY }, new Date('2026-10-24T23:30:00Z'));
  assert.equal(result.notePath, recallPath('2026-10-25'));
});

test('a reply without exactly 5 learnings is refused', () => {
  const reply = (learnings: unknown) =>
    ({ content: [{ type: 'text', text: JSON.stringify({ learnings }) }], stop_reason: 'end_turn' }) as unknown as Anthropic.Message;
  assert.equal(parseLearnings(reply(['a', 'b', 'c', 'd', 'e'])).length, 5);
  assert.throws(() => parseLearnings(reply(['a', 'b', 'c', 'd'])), /returned 4 learnings, expected 5/);
  assert.throws(() => parseLearnings(reply(['a', 'b', 'c', 'd', ' '])), /expected 5/);
  assert.throws(
    () => parseLearnings({ content: [{ type: 'text', text: 'Sure! Here are' }], stop_reason: 'end_turn' } as unknown as Anthropic.Message),
    /did not return JSON learnings/,
  );
});
