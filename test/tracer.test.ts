import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { weekWindow } from '../src/isoWeek.ts';
import { TOKEN, makeVault, reviewBlock, runCli, useMockApi } from './harness.ts';

const mock = useMockApi();

test('writes a review of the mock week into the existing week note', async () => {
  const original = '---\ntype: plan\nperiod: 2026-W42\n---\n\n# Week plan\n\n- Gym x2 or more\n';
  const { notePath, configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: original });

  const { stdout } = await runCli(['--week', '2026-W42'], configPath);

  assert.match(stdout, /2026-W42\.md/);
  const note = await readFile(notePath, 'utf8');
  assert.ok(note.startsWith(`${original}\n<!-- week-review:start -->`), 'existing note content is untouched');
  assert.equal(
    reviewBlock(note),
    [
      '<!-- week-review:start -->',
      '## Habits — 12–18 Oct',
      '',
      '| Habit | Days | Total | vs last week |',
      '| --- | --- | --- | --- |',
      '| KMs run | 3/7 | 14.2 | = |',
      '',
      'No entries: none.',
      '',
      '_Generated <time> from tracker. Re-runs overwrite this block._',
      '<!-- week-review:end -->',
      '',
    ].join('\n'),
  );
});

test('mock rejects requests without the bearer token', async () => {
  const url = `${mock.baseUrl}/v1/metrics?from=2026-10-12T00:00:00%2B01:00&to=2026-10-19T00:00:00%2B01:00&granularity=day`;
  const missing = await fetch(url);
  assert.equal(missing.status, 401);
  const wrong = await fetch(url, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: { code: 'unauthorized', message: 'Missing or invalid API key' } });
  const right = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(right.status, 200);
});

test('week window is half-open London midnights', () => {
  assert.deepEqual(weekWindow({ year: 2026, week: 42 }), {
    from: '2026-10-12T00:00:00+01:00',
    to: '2026-10-19T00:00:00+01:00',
  });
});
