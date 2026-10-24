import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { run } from '../src/cli.ts';
import { formatIsoWeek, formatWeekRange, lastCompleteIsoWeek, parseIsoWeek, weekWindow } from '../src/isoWeek.ts';
import { summarise } from '../src/review.ts';
import { day, makeVault, responseWith, reviewBlock, tokenEnv, useMockApi } from './harness.ts';

const mock = useMockApi();

test('--week rejects malformed or out-of-range weeks', () => {
  for (const input of ['2026-43', '2026-W4', '2026-W54', '2026-W00', '2025-W53']) {
    assert.throws(() => parseIsoWeek(input), /Invalid ISO week/, input);
  }
  assert.deepEqual(parseIsoWeek('2026-W53'), { year: 2026, week: 53 }, '2026 has 53 ISO weeks');
});

test('with no flag, any moment in W44 2026 resolves to W43', () => {
  const moments = [
    '2026-10-26T00:00:00Z', // Mon 26 Oct 00:00 GMT, the first instant of W44
    '2026-10-28T12:00:00Z',
    '2026-11-01T23:59:00Z', // Sun 1 Nov 23:59 GMT, the last minute of W44
  ];
  for (const moment of moments) {
    assert.equal(formatIsoWeek(lastCompleteIsoWeek(new Date(moment))), '2026-W43', moment);
  }
  // Sun 25 Oct 23:30 London (GMT after the clocks went back) is still inside W43.
  assert.equal(formatIsoWeek(lastCompleteIsoWeek(new Date('2026-10-25T23:30:00Z'))), '2026-W42');
});

test('window offsets follow London time on each side of a DST change', () => {
  assert.deepEqual(weekWindow(parseIsoWeek('2026-W43')), {
    from: '2026-10-19T00:00:00+01:00',
    to: '2026-10-26T00:00:00+00:00',
  });
  assert.deepEqual(weekWindow(parseIsoWeek('2026-W13')), {
    from: '2026-03-23T00:00:00+00:00',
    to: '2026-03-30T00:00:00+01:00',
  });
});

test('header range is derived from the ISO week, naming both months when it spans two', () => {
  assert.equal(formatWeekRange(parseIsoWeek('2026-W43')), '19–25 Oct');
  assert.equal(formatWeekRange(parseIsoWeek('2026-W40')), '28 Sep – 4 Oct');
  assert.equal(formatWeekRange(parseIsoWeek('2026-W53')), '28 Dec – 3 Jan');
});

test('days are counted by London date, whatever offset a period start is written in', () => {
  // 23:00Z on Sat 24 Oct is 00:00 BST on Sun 25 Oct, the same London date as the second period.
  const periods = [day(1, 1, '2026-10-24T23:00:00Z'), day(1, 1, '2026-10-25T00:00:00+01:00'), day(1, 1, '2026-10-24T22:59:00Z')];
  const [summary] = summarise(responseWith({ periods }));
  assert.equal(summary.daysLogged, 2, 'Sat 24 and Sun 25');
});

test('with no flag, the CLI reviews the last complete week, the DST week W43', async () => {
  const { notePath, configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W43', noteContent: '# Plan\n' });

  const result = await run(['--config', configPath], tokenEnv(), new Date('2026-10-27T08:00:00Z'));

  assert.equal(result.week, '2026-W43');
  assert.match(reviewBlock(await readFile(notePath, 'utf8')), /## Habits — 19–25 Oct\n[\s\S]*\| KMs run \| 2\/7 \| 15 \| \+0\.8 \|/);
});
