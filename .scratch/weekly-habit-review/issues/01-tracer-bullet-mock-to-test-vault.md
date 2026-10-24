# 01: Tracer bullet: one metric from the mock into a test vault

**What to build:** Running `week-review --week 2026-W42` against a local mock of the tracker API pulls one fixture week containing a single cumulative metric and writes a `Days | Total` review table between the `<!-- week-review:start -->` / `<!-- week-review:end -->` markers in an existing week-plan note in a test vault. The mock enforces Bearer auth. Base URL and vault path come from a config file; the token comes from an env var. This proves the full path: config → HTTP → compute → vault write.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] A local mock server serves `GET /v1/metrics?from&to&granularity=day` from a JSON fixture, using the agreed period shape `{start, end, partial, entryCount, value}` per London date
- [x] The mock rejects requests without the correct `Authorization: Bearer <token>`
- [x] `week-review --week 2026-W42` writes a block with a `## Habits — <range>` header, a `Habit | Days | Total` table row for the metric, and the generated footer line
- [x] Days = number of days with ≥1 entry, shown as `n/7`; Total = sum of values with the tracker's unit
- [x] The block is inserted at the end of an existing note; the rest of the note is untouched
- [x] An automated test runs the CLI end-to-end against the mock and a temp vault and checks the written note
