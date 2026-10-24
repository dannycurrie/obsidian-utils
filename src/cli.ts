#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type MetricsResponse, fetchMetrics } from './api.ts';
import { type KeychainReader, assertSafeTarget, defaultConfigPath, loadConfig, loadToken, readKeychain } from './config.ts';
import {
  type IsoWeek,
  formatIsoWeek,
  formatWeekRange,
  lastCompleteIsoWeek,
  londonDate,
  parseIsoWeek,
  previousIsoWeek,
  weekEnd,
  weekWindow,
} from './isoWeek.ts';
import { type WriteOutcome, formatNoteName, writeReview } from './note.ts';
import { renderReview, summarise } from './review.ts';

export type RunResult = {
  week: string;
  notePath: string;
  outcome: WriteOutcome;
  metricCount: number;
  noEntryCount: number;
};

async function assertDirectory(path: string, label: string): Promise<void> {
  const isDir = await stat(path).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new Error(`${label} not found: ${path}`);
}

const isEmptyWeek = (response: MetricsResponse) =>
  response.metrics.every((metric) => metric.periods.every((period) => period.entryCount === 0));

export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  now: Date,
  keychain: KeychainReader = readKeychain,
): Promise<RunResult> {
  const { values } = parseArgs({ args: argv, options: { week: { type: 'string' }, config: { type: 'string' } } });

  const week = values.week ? parseIsoWeek(values.week) : lastCompleteIsoWeek(now);
  const label = formatIsoWeek(week);
  if (weekEnd(week) > now) {
    throw new Error(`${label} has not ended yet (it ends ${weekWindow(week).to}); nothing written`);
  }

  const config = await loadConfig(values.config ?? defaultConfigPath(env));
  await assertSafeTarget(config);
  const noteDir = join(config.vaultPath, config.noteFolder);
  await assertDirectory(config.vaultPath, 'Vault');
  await assertDirectory(noteDir, 'Note folder');
  const token = await loadToken(env, keychain);

  const fetchWeek = (w: IsoWeek) => fetchMetrics({ baseUrl: config.baseUrl, token, ...weekWindow(w) });
  const current = await fetchWeek(week);
  if (isEmptyWeek(current)) {
    throw new Error(`${label} has no tracker entries at all; not writing a review of zeros`);
  }
  const previous = await fetchWeek(previousIsoWeek(week));

  const summaries = summarise(current, config.units);
  const block = renderReview({
    range: formatWeekRange(week),
    summaries,
    previous: summarise(previous, config.units),
    now,
  });

  const notePath = join(noteDir, formatNoteName(config.filenameFormat, week));
  const newNote = config.newNoteTemplate
    .replaceAll('{{created}}', londonDate(now).toISOString().slice(0, 10))
    .replaceAll('{{period}}', label);
  const outcome = await writeReview({ notePath, block, newNote });

  return {
    week: label,
    notePath,
    outcome,
    metricCount: summaries.length,
    noEntryCount: summaries.filter((s) => s.entryCount === 0).length,
  };
}

const OUTCOME_TEXT: Record<WriteOutcome, string> = {
  created: 'created week note with review',
  replaced: 'updated review',
  appended: 'added review',
};

if (import.meta.main) {
  try {
    const result = await run(process.argv.slice(2), process.env, new Date());
    console.log(result.notePath);
    console.log(
      `${result.week}: ${OUTCOME_TEXT[result.outcome]} — ${result.metricCount} metrics, ${result.noEntryCount} with no entries`,
    );
  } catch (error) {
    console.error(`week-review: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
