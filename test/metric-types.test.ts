import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderReview, summarise } from '../src/review.ts';
import { day, makeVault, responseWith, reviewBlock, runCli, useMockApi } from './harness.ts';

const mock = useMockApi();

test('every metric type renders in display order, with units, deltas and the no-entries line', async () => {
  const { notePath, configPath } = await makeVault({
    baseUrl: mock.baseUrl,
    week: '2026-W41',
    noteContent: '# Week plan\n',
    config: { units: { 'metric-kms-run': 'km' } },
  });

  await runCli(['--week', '2026-W41'], configPath);

  assert.equal(
    reviewBlock(await readFile(notePath, 'utf8')),
    [
      '<!-- week-review:start -->',
      '## Habits — 5–11 Oct',
      '',
      '| Habit | Days | Total | vs last week |',
      '| --- | --- | --- | --- |',
      '| Gym | — | 2/3 | +1 |',
      '| Meditation | 5/7 | 62 min | −10 min |',
      '| AI learning | 4/7 | 150 min | +40 min |',
      '| Early rising | 2/7 | 2 | −2 |',
      '| KMs run | 3/7 | 14.2 km | — |',
      '| Mood | 3/7 | 7 | = |',
      '| Reading | 0/7 | 0 min | — |',
      '',
      'No entries: Reading.',
      '',
      '_Generated <time> from tracker. Re-runs overwrite this block._',
      '<!-- week-review:end -->',
      '',
    ].join('\n'),
  );
});

test('an average with no entries shows — rather than 0, and is listed as having no entries', () => {
  const block = renderReview({
    range: '5–11 Oct',
    previous: [],
    now: new Date(),
    summaries: summarise(responseWith({ name: 'Mood', type: 'average', periods: [day(null, 0), day(null, 0)] })),
  });
  assert.match(block, /^\| Mood \| 0\/7 \| — \| — \|$/m);
  assert.match(block, /^No entries: Mood\.$/m);
});

test('an average is the mean of entries, not of daily means', () => {
  // Day 1: one entry of 9. Day 2: three entries averaging 5. Entry mean = (9 + 15) / 4 = 6.
  const [summary] = summarise(responseWith({ type: 'average', periods: [day(9, 1), day(5, 3)] }));
  assert.equal(summary.total, 6);
});

test('a checklist with nothing checked is listed as having no entries', () => {
  const periods = [{ ...day(0, 0), total: 3, items: [] }];
  const block = renderReview({
    range: '5–11 Oct',
    previous: [],
    now: new Date(),
    summaries: summarise(responseWith({ name: 'Gym', type: 'checklist', periods })),
  });
  assert.match(block, /^\| Gym \| — \| 0\/3 \| — \|$/m);
  assert.match(block, /^No entries: Gym\.$/m);
});
