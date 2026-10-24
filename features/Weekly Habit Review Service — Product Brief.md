# Weekly Habit Review Service — Product Brief

Oct 23, 2026 · @Danny · revised Oct 24, 2026

## Problem and goal

Run on demand from the laptop, the service pulls a week's metrics from the tracker's REST API, summarises them as a table, and writes the review into that week's plan note in Obsidian.

Today the weekly review means opening the tracker, reading the numbers, and retyping them into notes. The data already exists in the tracker (gym, meditation, AI learning, early rising, KMs run via Apple Health), so the manual step adds effort and no information.

Outcome: one command produces a review that is accurate to the source numbers and filed where the rest of the notes live.

## Scope (v1)

v1 is one command on the laptop, one data source, one write target, no generated prose, no UI. It reports metrics; it does not judge them against targets.

**In**

- Fetch every tracked metric, bucketed by day, for one ISO week (Mon–Sun, Europe/London) from the tracker REST API
- Compute per-metric days logged, weekly total, and change vs the prior week
- Write a review section into that week's plan note, creating the note if it does not exist
- Safe to re-run: a second run replaces its own section, never duplicates it
- A local mock of the tracker API, used until the real endpoint ships

**Out**

- Targets, goals or any "hit / missed" judgement
- Written narrative or any language-model step
- Scheduling; runs are triggered manually on the laptop
- Editing or back-filling tracker data
- Monthly or quarterly roll-ups
- Recommendations for next week
- A settings UI; configuration is a file
- Sources other than the tracker (no direct Supabase reads, no legacy `goal-tracker`)
- Error reporting services (Sentry etc.)
- Detecting stale Apple Health syncs
- Committing to the vault's git repo

## How it runs

Each run is one command on the laptop: pull, check, compute, write. An incomplete week stops the run before anything touches the vault.

&#91;embedded content: weekly run · 4 steps, 1 decision\]

The only branch is the completeness check. A week is incomplete if it has not ended (Sun 23:59 Europe/London has not passed) or has zero entries across all metrics. Every other failure (API down, auth rejected, vault not found) also exits non-zero without writing. Metrics or days with no entries are reported, never fatal.

## Functional requirements

All output is computed in code from the API response; nothing is generated.

1. **Trigger**
   1. CLI on the laptop: `week-review` reviews the last complete ISO week; `week-review --week 2026-W43` reviews any past week.
2. **Pull**
   1. `GET /v1/metrics?from=…&to=…&granularity=day` with `Authorization: Bearer <token>`. The window is half-open `[Mon 00:00, next Mon 00:00)` with explicit London offsets.
   2. Fetch the previous week the same way for comparison.
   3. Fail loudly if the API is unreachable, rejects the token, or returns an empty week; never write a review of zeros.
3. **Summarise** (per metric, every metric the API returns, in `display_order`)
   1. **Days**: distinct London calendar dates with ≥1 entry, as `n/7`. Days are bucketed by calendar date, not 24 h offsets (W43 2026 contains the clocks-back Sunday).
   2. **Total** in the tracker's unit: sum for cumulative and timed metrics, mean for average metrics.
   3. **vs last week**: change in Total — `=` for no change, `+n` / `−n` with unit, `—` when the prior week has no entries for that metric.
   4. Checklist metrics (e.g. Gym) are scored weekly: Days shows `—`, Total shows items checked, e.g. `3/3`, and vs last week is the change in items checked.
   5. List metrics with no entries at all (they also appear as `0/7` in the table).
4. **Write**
   1. Note path: `Plans/Week plans/GGGG-[W]WW.md` (e.g. `2026-W43.md`), from config. This is where daily notes' `[[GGGG-[W]WW]]` links already resolve.
   2. If the note does not exist, create it with the existing week-plan frontmatter stub (`type: plan`, `created`, `period: 2026-W43`, `status`).
   3. Insert the review between `<!-- week-review:start -->` and `<!-- week-review:end -->` markers at the end of the note; replace if present.
   4. Write atomically (temp file + rename) so a sync client never sees a half-written note.
5. **Operate**
   1. Prints the note path and a one-line result.
   2. On failure, prints the error to stderr and exits non-zero.

## Output format

The review is plain Markdown: a table and a footer line, inserted into the week-plan note. Figures below are placeholders.

```markdown
<!-- week-review:start -->
## Habits — 19–25 Oct

| Habit | Days | Total | vs last week |
| --- | --- | --- | --- |
| Gym | — | 3/3 | +1 |
| Meditation | 5/7 | 62 min | −14 min |
| AI learning | 4/7 | 150 min | +40 min |
| Early rising | 2/7 | 2 | −2 |
| KMs run | 3/7 | 14.2 km | +3.1 km |

No entries: none.

_Generated 2026-10-26 08:05 from tracker. Re-runs overwrite this block._
<!-- week-review:end -->
```

The header date range is derived from the ISO week.

## Approach

A TypeScript CLI on the laptop that holds the vault: it calls the tracker REST API, computes the table, and writes the note file directly. No Obsidian plugin, no running app, no scheduler.

**Data source.** The tracker is `~/dev/tracker/tracker`. Its metrics API (`008-metrics-api` branch) currently returns per-period totals only, with `periods` still empty. Daily buckets are added there as part of tickets 03/04: `granularity=day` returns one period per London date in the existing `{start, end, partial, entryCount, value}` shape, with checklist metrics staying weekly.

**Mock API.** Until that ships and is deployed, the CLI runs against a small local HTTP server in this repo that implements the contract above (including Bearer auth) and serves hand-written JSON fixtures. Switching to the real API is a base-URL change in config. The fixtures double as the written contract for tickets 03/04 and cover:

- the DST week (W43 2026)
- a metric with no entries
- a metric with no prior-week data
- a checklist metric (Gym), timed metrics (Meditation, AI learning) and an average metric
- a fully empty week (must be fatal)
- a 401 and an unreachable server

**Config** lives at `~/.config/week-review/config.json`, outside the vault, and holds no secrets: API base URL, vault path, note folder, filename format, frontmatter stub, `realVault`, and optional display units per metric id (the tracker sends `unit: null` for cumulative metrics, so e.g. KMs run → `km`). The API token comes from the macOS Keychain (`security find-generic-password`), with an env var override.

**Vault guard.** While pointed at the mock, the vault path must be a test copy. The CLI refuses to write to the path configured as `realVault` when the base URL is localhost.

## Assumptions and risks

**Resolved assumptions**

- **Obsidian is the system of record for weekly reviews.** The vault at `~/Documents/Obsidian Vault` is in daily use.
- **The vault is a local folder on the laptop**, so direct file writes work regardless of sync. Sync (local git with no remote; Obsidian Sync enabled but unconfirmed) only affects reading on other devices.

**Dependencies**

- **v1 "done" is blocked on tracker tickets 03/04 and the Vercel deploy.** v1 can be built and tested end-to-end on the mock before then.

**Design risks**

- **Manual trigger means missed weeks.** No run, no review. Acceptable for v1; a launchd job can be added later without changing the design (revisit error reporting then).
- **Filename or folder drift creates duplicate notes.** No plugin defines weekly notes; the format comes from config, never hard-coded. `AGENTS.md` currently says `Plans/YYYY-Www.md` but the files live in `Plans/Week plans/` — fix `AGENTS.md`.
- **Re-runs overwrite edits.** Anything typed inside the markers is lost on the next run; reflections go outside the markers.
- **A missing entry is ambiguous.** The tracker rejects zero values, so a day with no entry means "not logged" — which may be a skipped habit, a forgotten log, or an Apple Health sync that did not run. The review reports it as not logged and does not guess.
- **Mock drift.** If tickets 03/04 diverge from the mock's contract, the CLI breaks on switch-over. The fixtures are the contract; change them together.

## Success criteria and open questions

**v1 built** (on the mock)

- All fixture edge cases pass, including the DST week and the fatal empty week
- 0 duplicate review blocks or duplicate notes after a forced re-run
- Writes are atomic, and the vault guard blocks writes to the real vault while on the mock

**v1 done** (on the real API, after tickets 03/04 and deploy)

- 4 of 4 weeks reviewed by a single command, no manual fixes to the table. A week counts only if it was run with the default command (no `--week`) within 3 days of its Sunday.
- 0 numeric mismatches between the review table and the tracker
- 0 duplicate review blocks or duplicate notes after a forced re-run
- The review is used as the starting point of the weekly review (self-reported after 4 weeks)

**Open questions**

None. Gym is a checklist metric; AI learning is a timed metric.
