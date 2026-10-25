import type { Metric, MetricType, MetricsResponse } from './api.ts';
import { londonDate } from './isoWeek.ts';
import { formatGeneratedAt } from './shared/time.ts';

export type MetricSummary = {
  id: string;
  name: string;
  type: MetricType;
  entryCount: number;
  /** Days with ≥1 entry; null for checklists, which are scored weekly. */
  daysLogged: number | null;
  /** Sum, mean or items checked depending on type; null for an average with no entries. */
  total: number | null;
  /** Item count for checklists. */
  outOf: number | null;
  unit: string | null;
};

const UNIT_LABELS: Record<string, string> = { minutes: 'min' };

function weekTotal(metric: Metric): number | null {
  const periods = metric.periods;
  switch (metric.type) {
    case 'cumulative':
    case 'timed':
    case 'checklist':
      return periods.reduce((sum, period) => sum + (period.value ?? 0), 0);
    case 'average': {
      // Daily values are per-day means, so weight each by its entry count to get the week's mean.
      const entries = periods.reduce((sum, period) => sum + period.entryCount, 0);
      if (entries === 0) return null;
      return periods.reduce((sum, period) => sum + (period.value ?? 0) * period.entryCount, 0) / entries;
    }
  }
}

/** Distinct London calendar dates with ≥1 entry, whatever offset the period starts are written in. */
function daysLogged(metric: Metric): number {
  const dates = metric.periods
    .filter((period) => period.entryCount > 0)
    .map((period) => londonDate(new Date(period.start)).getTime());
  return new Set(dates).size;
}

export function summarise(response: MetricsResponse, units: Record<string, string> = {}): MetricSummary[] {
  return response.metrics.map((metric) => {
    const isChecklist = metric.type === 'checklist';
    return {
      id: metric.id,
      name: metric.name,
      type: metric.type,
      entryCount: metric.periods.reduce((sum, period) => sum + period.entryCount, 0),
      daysLogged: isChecklist ? null : daysLogged(metric),
      total: weekTotal(metric),
      outOf: isChecklist ? metric.periods.reduce((sum, period) => sum + (period.total ?? 0), 0) : null,
      unit: units[metric.id] ?? metric.unit,
    };
  });
}

// Avoid float noise such as 14.200000000000001.
const round = (n: number) => Math.round(n * 10) / 10;

function withUnit(n: number, { unit }: MetricSummary): string {
  return unit ? `${n} ${UNIT_LABELS[unit] ?? unit}` : String(n);
}

function formatTotal(summary: MetricSummary): string {
  if (summary.total === null) return '—';
  if (summary.outOf !== null) return `${round(summary.total)}/${summary.outOf}`;
  return withUnit(round(summary.total), summary);
}

/** Change in Total vs the previous week; checklists compare items checked. */
function formatDelta(current: MetricSummary, previous: MetricSummary | undefined): string {
  if (!previous || previous.entryCount === 0 || current.total === null || previous.total === null) return '—';
  const delta = round(current.total - previous.total);
  if (delta === 0) return '=';
  const sign = delta > 0 ? '+' : '−';
  return current.outOf !== null ? `${sign}${Math.abs(delta)}` : `${sign}${withUnit(Math.abs(delta), current)}`;
}

export function renderReview(options: {
  range: string;
  summaries: MetricSummary[];
  previous: MetricSummary[];
  now: Date;
}): string {
  const previousById = new Map(options.previous.map((s) => [s.id, s]));
  const rows = options.summaries.map((s) => {
    const days = s.daysLogged === null ? '—' : `${s.daysLogged}/7`;
    return `| ${s.name} | ${days} | ${formatTotal(s)} | ${formatDelta(s, previousById.get(s.id))} |`;
  });
  const missing = options.summaries.filter((s) => s.entryCount === 0).map((s) => s.name);
  return [
    '<!-- week-review:start -->',
    `## Habits — ${options.range}`,
    '',
    '| Habit | Days | Total | vs last week |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `No entries: ${missing.length ? missing.join(', ') : 'none'}.`,
    '',
    `_Generated ${formatGeneratedAt(options.now)} from tracker. Re-runs overwrite this block._`,
    '<!-- week-review:end -->',
  ].join('\n');
}
