import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReview, summarise } from '../src/review.ts';
import { day, responseWith } from './harness.ts';

function deltaFor(current: Parameters<typeof responseWith>[0], previous?: Parameters<typeof responseWith>[0]) {
  const block = renderReview({
    range: '5–11 Oct',
    now: new Date(),
    summaries: summarise(responseWith(current)),
    previous: previous ? summarise(responseWith(previous)) : [],
  });
  const row = block.split('\n').find((line) => line.startsWith('| Metric 0 '))!;
  return row.split('|')[4].trim();
}

test('a metric absent from the previous week shows —', () => {
  assert.equal(deltaFor({ periods: [day(5, 1)] }), '—');
});

test('a sum delta uses a true minus sign and the unit', () => {
  assert.equal(deltaFor({ unit: 'km', periods: [day(10.1, 1)] }, { unit: 'km', periods: [day(14.2, 1)] }), '−4.1 km');
});

test('a sum delta to zero this week is still a change, not —', () => {
  assert.equal(
    deltaFor({ unit: 'minutes', periods: [day(0, 0)] }, { unit: 'minutes', periods: [day(30, 1)] }),
    '−30 min',
  );
});

test('a checklist delta is the change in items checked, without a unit', () => {
  const week = (checked: number) => [{ ...day(checked, checked), total: 3, items: [] }];
  assert.equal(deltaFor({ type: 'checklist', periods: week(3) }, { type: 'checklist', periods: week(1) }), '+2');
});

test('an average with no entries this week shows —', () => {
  assert.equal(deltaFor({ type: 'average', periods: [day(null, 0)] }, { type: 'average', periods: [day(7, 1)] }), '—');
});

test('rounding hides float noise, so equal totals read as =', () => {
  assert.equal(deltaFor({ periods: [day(0.1, 1), day(0.2, 1)] }, { periods: [day(0.3, 1)] }), '=');
});
