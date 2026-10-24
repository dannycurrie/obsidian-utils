import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANNED_LEARNINGS, type StubBehaviour } from '../../mock/claude.ts';
import { run } from '../../src/recall/cli.ts';
import { confirmBlock, markersFor } from '../../src/shared/note.ts';
import { snapshot } from '../harness.ts';
import { makeRecallVault, recallEnv, runRecall, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();

const BOOK = '---\nauthor: Gene Kim\n---\n## Notes\n\n- Brent is the constraint\n';
const DAILY = '---\ntype: daily\n---\n## Notes\n\n- Wrote by hand\n';
const ARGS = ['--book', 'The Phoenix Project', '--date', '2026-10-24'];
const NOW = new Date('2026-10-24T08:00:00Z');
/** Short wait and timeout so retries and hangs keep the suite fast. */
const FAST = { retryDelayMs: 10, timeoutMs: 300 };

type Vault = Awaited<ReturnType<typeof makeRecallVault>>;

async function vault(options: { daily?: string; baseUrl?: string } = {}): Promise<Vault> {
  return makeRecallVault({
    baseUrl: options.baseUrl ?? stub.baseUrl,
    books: { 'The Phoenix Project': BOOK },
    daily: { '2026-10-24': options.daily ?? DAILY },
  });
}

/** Runs in-process with fast retries and asserts the error, the request count and an untouched vault. */
async function assertFailsCleanly(v: Vault, error: RegExp, requests: number) {
  const before = await snapshot(v.dir);
  await assert.rejects(run(ARGS, recallEnv(v.configPath), NOW, FAST), error);
  assert.equal(stub.requests.length, requests, 'request count');
  assert.deepEqual(await snapshot(v.dir), before, 'vault is byte-identical and has no temp file');
}

async function assertSucceeds(v: Vault, requests: number) {
  const result = await run(ARGS, recallEnv(v.configPath), NOW, FAST);
  assert.equal(result.outcome, 'appended');
  assert.equal(stub.requests.length, requests, 'request count');
  const note = await readFile(v.dailyPath('2026-10-24'), 'utf8');
  for (const learning of CANNED_LEARNINGS) assert.ok(note.includes(`- ${learning}\n`));
}

const BAD_REPLIES: [string, StubBehaviour, RegExp][] = [
  ['4 bullets', { learnings: CANNED_LEARNINGS.slice(0, 4) }, /returned 4 learnings, expected 5/],
  ['6 bullets', { learnings: [...CANNED_LEARNINGS, 'One too many.'] }, /returned 6 learnings, expected 5/],
  ['an empty bullet', { learnings: [...CANNED_LEARNINGS.slice(0, 4), '  '] }, /empty learning/],
  ['a preamble instead of JSON', { text: 'Here are the learnings:\n- One' }, /did not return JSON learnings/],
  ['a multi-line bullet', { learnings: [...CANNED_LEARNINGS.slice(0, 4), 'Line one.\nLine two.'] }, /several lines/],
  ['a reply cut off at max_tokens', { text: '{"learnings": ["Cut', stop_reason: 'max_tokens' }, /cut off at max_tokens/],
];

for (const [name, bad, error] of BAD_REPLIES) {
  test(`a reply with ${name} is retried once, then fails`, async () => {
    stub.script.push(bad, bad);
    await assertFailsCleanly(await vault(), new RegExp(`${error.source}.*after retrying once`), 2);
  });

  test(`a reply with ${name} succeeds if the retry is good`, async () => {
    stub.script.push(bad);
    await assertSucceeds(await vault(), 2);
  });
}

test('the retry sends the bad reply and the problem back to the model', async () => {
  stub.script.push({ text: 'Sure! Here you go.' });
  await assertSucceeds(await vault(), 2);
  const [first, retry] = stub.requests as { messages: { role: string; content: string }[] }[];
  assert.equal(first.messages.length, 1);
  assert.deepEqual(retry.messages.slice(0, 2), first.messages.concat({ role: 'assistant', content: 'Sure! Here you go.' }));
  assert.equal(retry.messages[2].role, 'user');
  assert.match(retry.messages[2].content, /^That reply was invalid: Claude did not return JSON learnings.*exactly 5 learnings/);
});

const REQUEST_FAILURES: [string, StubBehaviour, RegExp][] = [
  ['a rejected key (401)', { status: 401 }, /Claude API rejected the key \(401\)/],
  ['a rate limit (429)', { status: 429 }, /Claude API rate limit hit \(429\)/],
  ['a server error (500)', { status: 500 }, /Claude API returned 500/],
  ['an overloaded API (529)', { status: 529 }, /Claude API returned 529/],
  ['a hang', { hang: true }, /Claude API timed out after 0\.3s/],
];

for (const [name, failure, error] of REQUEST_FAILURES) {
  test(`${name} is retried once, then fails naming the cause`, async () => {
    stub.script.push(failure, failure);
    await assertFailsCleanly(await vault(), new RegExp(`${error.source}.*after retrying once`), 2);
  });

  test(`${name} succeeds if the retry gets through`, async () => {
    stub.script.push(failure);
    await assertSucceeds(await vault(), 2);
  });
}

test('a request error and a bad reply each get their own retry', async () => {
  stub.script.push({ status: 500 }, { learnings: [] });
  await assertSucceeds(await vault(), 3);
});

test('a client error that retrying cannot fix (400) fails without a retry', async () => {
  stub.script.push({ status: 400, type: 'invalid_request_error', message: 'bad model' });
  await assertFailsCleanly(await vault(), /Claude API returned 400: .*bad model/, 1);
});

test('an unreachable API is retried, then fails naming the cause', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  await assertFailsCleanly(
    await vault({ baseUrl: `http://localhost:${port}` }),
    /Could not reach the Claude API at .*ECONNREFUSED.*after retrying once/,
    0,
  );
});

for (const [name, daily] of [
  ['an unmatched start marker', `${DAILY}\n<!-- book-recall:start -->\nold\n`],
  ['an end marker before the start', `${DAILY}\n<!-- book-recall:end -->\n<!-- book-recall:start -->\n`],
  ['repeated markers', `${DAILY}\n<!-- book-recall:start -->\na\n<!-- book-recall:end -->\n<!-- book-recall:start -->\nb\n<!-- book-recall:end -->\n`],
]) {
  test(`${name} fails with a fix-by-hand message before calling Claude`, async () => {
    await assertFailsCleanly(await vault({ daily }), /unmatched or repeated book-recall markers; fix them by hand/, 0);
  });
}

test('a missing vault fails before calling Claude', async () => {
  const v = await vault();
  await writeFile(v.configPath, JSON.stringify({ vaultPath: join(v.dir, 'nope'), apiBaseUrl: stub.baseUrl }));
  await assertFailsCleanly(v, /Vault not found: .*nope/, 0);
});

test('a missing daily folder fails before calling Claude', async () => {
  const v = await vault();
  await rm(join(v.vaultPath, 'Daily'), { recursive: true });
  await assertFailsCleanly(v, /Daily folder not found: .*Daily/, 0);
});

test('the CLI reports a failure on stderr, exits non-zero and leaves the vault untouched', async () => {
  const v = await vault();
  stub.script.push({ learnings: ['Only one.'] }, { learnings: ['Only one.'] });
  const before = await snapshot(v.dir);
  const { code, stdout, stderr } = await runRecall(ARGS, recallEnv(v.configPath));
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /^book-recall: Claude returned 1 learnings, expected 5 \(after retrying once\)\n$/);
  assert.deepEqual(await snapshot(v.dir), before);
});

test('confirmBlock passes when the written block is in the note', async () => {
  const v = await vault();
  const markers = markersFor('book-recall');
  const block = `${markers.start}\nhello\n${markers.end}`;
  await writeFile(v.dailyPath('2026-10-24'), `${DAILY}\n${block}\n`);
  await confirmBlock(v.dailyPath('2026-10-24'), block, markers);
});

test('confirmBlock fails loudly when the note lost the block after the write', async () => {
  const v = await vault();
  const markers = markersFor('book-recall');
  const block = `${markers.start}\nhello\n${markers.end}`;
  // e.g. Sync put back an older copy, or another app rewrote the block
  for (const content of [DAILY, `${DAILY}\n${markers.start}\nother\n${markers.end}\n`, `${block}\n${block}\n`]) {
    await writeFile(v.dailyPath('2026-10-24'), content);
    await assert.rejects(
      confirmBlock(v.dailyPath('2026-10-24'), block, markers),
      /but the book-recall block is not there on re-read/,
    );
  }
});
