// Checks the deployed tracker API against the contract the mock serves, for one week, without touching the vault.
// Usage: node scripts/contract-check.ts [--week 2026-W43] [--config path]
import { parseArgs } from 'node:util';
import { type Metric, type MetricsResponse, fetchMetrics } from '../src/api.ts';
import { defaultConfigPath, loadConfig, loadToken, readKeychain } from '../src/config.ts';
import { formatIsoWeek, lastCompleteIsoWeek, parseIsoWeek, weekWindow } from '../src/isoWeek.ts';

const TYPES = new Set(['cumulative', 'timed', 'average', 'checklist']);
const problems: string[] = [];
const check = (ok: boolean, message: string) => ok || problems.push(message);

function checkShape(response: MetricsResponse) {
  check(response.granularity === 'day', `granularity is ${response.granularity}, expected "day"`);
  check(typeof response.timezone === 'string', 'timezone missing');
  for (const m of response.metrics) {
    const where = `"${m.name}" (${m.id})`;
    check(typeof m.id === 'string' && typeof m.name === 'string', `${where}: id/name not strings`);
    check(TYPES.has(m.type), `${where}: unknown type ${m.type}`);
    check(m.unit === null || typeof m.unit === 'string', `${where}: unit not string|null`);
    for (const p of m.periods) {
      const ok =
        typeof p.start === 'string' &&
        typeof p.end === 'string' &&
        typeof p.partial === 'boolean' &&
        typeof p.entryCount === 'number' &&
        (typeof p.value === 'number' || (p.value === null && m.type === 'average'));
      check(ok, `${where}: malformed period ${JSON.stringify(p)}`);
      if (m.type === 'checklist') {
        check(typeof p.total === 'number' && Array.isArray(p.items), `${where}: checklist period lacks total/items`);
      }
    }
    if (m.type !== 'checklist') check(m.periods.length <= 7, `${where}: ${m.periods.length} day periods in one week`);
  }
}

/** Day buckets must add up to the weekly bucket for weekly-timeframe metrics. */
function checkDaysMatchWeek(daily: Metric, weekly: Metric) {
  if (daily.type === 'checklist' || weekly.timeframe !== 'weekly' || weekly.periods.length !== 1) return;
  const week = weekly.periods[0];
  const where = `"${daily.name}"`;
  const entries = daily.periods.reduce((n, p) => n + p.entryCount, 0);
  check(entries === week.entryCount, `${where}: day entryCount ${entries} ≠ week ${week.entryCount}`);
  if (daily.type === 'average') {
    if (entries === 0 || week.value === null) return;
    const mean = daily.periods.reduce((n, p) => n + (p.value ?? 0) * p.entryCount, 0) / entries;
    // Daily means are rounded to 1 dp before re-weighting, so allow a small drift.
    check(Math.abs(mean - week.value) <= 0.1, `${where}: day mean ${mean.toFixed(2)} ≠ week ${week.value}`);
  } else {
    const sum = daily.periods.reduce((n, p) => n + (p.value ?? 0), 0);
    check(Math.abs(sum - (week.value ?? 0)) < 1e-9, `${where}: day sum ${sum} ≠ week ${week.value}`);
  }
}

const { values } = parseArgs({ options: { week: { type: 'string' }, config: { type: 'string' } } });
const week = values.week ? parseIsoWeek(values.week) : lastCompleteIsoWeek(new Date());
const config = await loadConfig(values.config ?? defaultConfigPath(process.env));
const token = await loadToken(process.env, readKeychain);
const request = { baseUrl: config.baseUrl, token, ...weekWindow(week) };

const [daily, weekly] = await Promise.all([
  fetchMetrics(request),
  fetchMetrics({ ...request, granularity: 'period' }),
]);
checkShape(daily);
const weeklyById = new Map(weekly.metrics.map((m) => [m.id, m]));
for (const metric of daily.metrics) {
  const match = weeklyById.get(metric.id);
  check(match !== undefined, `"${metric.name}" missing from the period response`);
  if (match) checkDaysMatchWeek(metric, match);
}

console.log(`${formatIsoWeek(week)} from ${config.baseUrl}`);
for (const m of daily.metrics) {
  const entries = m.periods.reduce((n, p) => n + p.entryCount, 0);
  console.log(`  ${m.id}  ${m.name}  [${m.type}, unit ${m.unit ?? 'null'}]  ${entries} entries`);
}
if (problems.length) {
  console.error(`\n${problems.length} contract problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nContract OK: shape matches the mock, and day buckets add up to the weekly buckets.');
}
