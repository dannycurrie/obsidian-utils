import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { run } from '../../src/recall/cli.ts';
import { loadApiKey } from '../../src/recall/config.ts';
import { snapshot } from '../harness.ts';
import { API_KEY, makeRecallVault, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();
const DATE = '2026-10-24';
const NOW = new Date(`${DATE}T06:00:00Z`);
const FAST = { retryDelayMs: 10, timeoutMs: 2000 };
const BOOK = `---\ntype: book\nstatus: Finished\nauthor: Carol Dweck\n---\n## Notes\n\n- Effort is the path to mastery\n`;

const vaultWith = (config: Record<string, unknown> = {}) =>
  makeRecallVault({ baseUrl: stub.baseUrl, books: { Mindset: BOOK }, daily: { [DATE]: '# Today\n' }, config });
const args = (configPath: string, extra: string[] = []) => ['--book', 'Mindset', '--date', DATE, '--config', configPath, ...extra];

test('with no env var the API key comes from the Keychain, and the env var wins over it', async () => {
  assert.equal(await loadApiKey({}, async () => 'from-keychain'), 'from-keychain');
  assert.equal(await loadApiKey({ BOOK_RECALL_API_KEY: 'from-env' }, async () => 'from-keychain'), 'from-env');

  const { configPath, recallPath } = await vaultWith();
  const result = await run(args(configPath), {}, NOW, Math.random, { ...FAST, keychain: async () => API_KEY });
  assert.equal(result.outcome, 'created');
  assert.match(await readFile(recallPath(DATE), 'utf8'), /## Book recall — \[\[Mindset\]\]/);
});

test('a missing key names the exact Keychain command, before any request', async () => {
  const { configPath } = await vaultWith();
  await assert.rejects(
    run(args(configPath), {}, NOW, Math.random, { keychain: async () => null }),
    /security add-generic-password -s book-recall -a anthropic-api -w <token>/,
  );
  assert.equal(stub.requests.length, 0);
});

test('models with a server-side refusal fallback ask for it; others do not', async () => {
  const sonnet = await vaultWith();
  await run(args(sonnet.configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST);
  assert.equal(stub.requests[0].fallbacks, 'default');
  assert.match(String(stub.headers[0]['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(stub.requests[0].model, 'claude-sonnet-5-5');

  const haiku = await vaultWith({ model: 'claude-haiku-5-5' });
  await run(args(haiku.configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST);
  assert.equal(stub.requests[1].fallbacks, undefined);
  assert.doesNotMatch(String(stub.headers[1]['anthropic-beta'] ?? ''), /server-side-fallback/);
});

test("the prompt carries the brief's rules", async () => {
  const { configPath } = await vaultWith();
  await run(args(configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST);
  const system = String(stub.requests[0].system);
  for (const rule of [
    /Use only what is in the notes/,
    /exactly 5 learnings, each a single sentence, with no preamble/,
    /Keep the reader's own wording and examples/,
    /Ignore leftover checklist scaffolding/,
  ]) {
    assert.match(system, rule);
  }
});

test('a safety refusal fails clearly, without a retry, leaving the vault unchanged', async () => {
  const { dir, configPath } = await vaultWith();
  const before = await snapshot(dir);
  stub.script.push({ refusal: 'cyber' });

  await assert.rejects(
    run(args(configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST),
    /Claude declined to summarise "Mindset" \(safety refusal, category cyber\); try --reroll or another --book/,
  );
  assert.equal(stub.requests.length, 1);
  assert.deepEqual(await snapshot(dir), before);

  stub.script.push({ refusal: null });
  await assert.rejects(
    run(args(configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST),
    /declined to summarise "Mindset" \(safety refusal\)/,
  );
});

test('the footer names the model that answered, e.g. after a refusal fallback', async () => {
  const { configPath, recallPath } = await vaultWith();
  stub.script.push({ learnings: ['a.', 'b.', 'c.', 'd.', 'e.'], model: 'claude-opus-4-8' });
  await run(args(configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST);
  assert.match(await readFile(recallPath(DATE), 'utf8'), /words\) by claude-opus-4-8\./);
});

test('while apiBaseUrl is the local stub, writing to realVault is refused before any request', async () => {
  const target = await vaultWith();
  // Point realVault at the vault being written, with a trailing slash to check paths are compared canonically.
  const { configPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    config: { vaultPath: target.vaultPath, realVault: `${target.vaultPath}/` },
  });
  const before = await snapshot(target.dir);

  await assert.rejects(
    run(args(configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST),
    /Refusing to write stub learnings into the real vault/,
  );
  assert.equal(stub.requests.length, 0);
  assert.deepEqual(await snapshot(target.dir), before);

  // --dry-run writes nothing, but the guard still stops it: the stub's learnings are never presented as real.
  await assert.rejects(
    run(args(configPath, ['--dry-run']), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST),
    /Refusing to write stub learnings/,
  );
});

test('the guard lets the real vault through once apiBaseUrl is not localhost', async () => {
  const target = await vaultWith();
  const { configPath } = await makeRecallVault({
    baseUrl: 'http://claude.example.invalid',
    config: { vaultPath: target.vaultPath, realVault: target.vaultPath },
  });
  // Gets past the guard and fails later, at the network.
  await assert.rejects(
    run(args(configPath), { BOOK_RECALL_API_KEY: API_KEY }, NOW, Math.random, FAST),
    /Could not reach the Claude API/,
  );
});
