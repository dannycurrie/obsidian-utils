import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CANNED_LEARNINGS } from '../../mock/claude.ts';
import { snapshot } from '../harness.ts';
import { API_KEY, makeRecallVault, recallBlock, recallEnv, runRecall, useClaudeStub } from './harness.ts';

const stub = useClaudeStub();

const PHOENIX = [
  '---',
  'type: book',
  'created: 2025-03-02',
  'status: Finished',
  'author: "Gene Kim"',
  'tana_id: abc123',
  '---',
  '## Notes',
  '',
  '- The four types of work: business projects, internal projects, changes, unplanned work',
  '- Brent is the constraint; protect his time',
  '',
].join('\n');

const DAILY = '---\ntype: daily\ncreated: 2026-10-24\n---\n## Actions\n\n## Notes\n\n- Wrote by hand before the run\n';

test('writes a recall of the named book to the end of the existing daily note', async () => {
  const { configPath, dailyPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { 'The Phoenix Project': PHOENIX },
    daily: { '2026-10-24': DAILY },
  });

  const { code, stdout, stderr } = await runRecall(
    ['--book', 'The Phoenix Project', '--date', '2026-10-24'],
    recallEnv(configPath),
  );

  assert.equal(code, 0, stderr);
  assert.deepEqual(stdout.trim().split('\n'), [dailyPath('2026-10-24'), '2026-10-24: added recall — The Phoenix Project']);
  const note = await readFile(dailyPath('2026-10-24'), 'utf8');
  assert.ok(note.startsWith(`${DAILY}\n<!-- book-recall:start -->`), 'existing note content is untouched');
  assert.equal(
    recallBlock(note),
    [
      '<!-- book-recall:start -->',
      '## Book recall — [[The Phoenix Project]]',
      '',
      ...CANNED_LEARNINGS.map((l) => `- ${l}`),
      '',
      '_Generated <time> from 1 book note (23 words) by claude-sonnet-5-5. Re-runs overwrite this block._',
      '<!-- book-recall:end -->',
      '',
    ].join('\n'),
  );
});

test('sends the book body without frontmatter, with title, author and path, asking for structured output', async () => {
  const { configPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { 'The Phoenix Project': PHOENIX },
    daily: { '2026-10-24': DAILY },
    config: { model: 'claude-test-model' },
  });

  const { code, stderr } = await runRecall(['--book', 'The Phoenix Project', '--date', '2026-10-24'], recallEnv(configPath));

  assert.equal(code, 0, stderr);
  assert.equal(stub.requests.length, 1);
  const [request] = stub.requests as [
    { model: string; system: string; messages: { role: string; content: string }[]; output_config: unknown },
  ];
  assert.equal(request.model, 'claude-test-model');
  assert.match(request.system, /Use only what is in the notes/);
  assert.match(request.system, /exactly 5 learnings/);
  const prompt = request.messages[0].content;
  assert.equal(request.messages[0].role, 'user');
  assert.match(prompt, /^Book: The Phoenix Project by Gene Kim\n/);
  assert.match(prompt, /<notes path="Books\/The Phoenix Project\.md">\n## Notes\n/);
  assert.match(prompt, /Brent is the constraint/);
  assert.doesNotMatch(prompt, /tana_id|status: Finished|^---/m);
  assert.deepEqual(request.output_config, {
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { learnings: { type: 'array', items: { type: 'string' } } },
        required: ['learnings'],
        additionalProperties: false,
      },
    },
  });
});

test('a rejected API key fails without touching the vault', async () => {
  const { dir, configPath } = await makeRecallVault({
    baseUrl: stub.baseUrl,
    books: { 'The Phoenix Project': PHOENIX },
    daily: { '2026-10-24': DAILY },
  });
  const before = await snapshot(dir);

  const { code, stderr } = await runRecall(['--book', 'The Phoenix Project', '--date', '2026-10-24'], {
    ...recallEnv(configPath),
    BOOK_RECALL_API_KEY: 'sk-ant-wrong',
  });

  assert.equal(code, 1);
  assert.match(stderr, /book-recall: Claude API rejected the key \(401\)/);
  assert.deepEqual(await snapshot(dir), before);
});

test('the stub rejects requests without the expected API key', async () => {
  const body = JSON.stringify({ model: 'x', max_tokens: 1, messages: [] });
  const missing = await fetch(`${stub.baseUrl}/v1/messages`, { method: 'POST', body });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), {
    type: 'error',
    error: { type: 'authentication_error', message: 'invalid x-api-key' },
  });
  const right = await fetch(`${stub.baseUrl}/v1/messages`, { method: 'POST', body, headers: { 'x-api-key': API_KEY } });
  assert.equal(right.status, 200);
});
