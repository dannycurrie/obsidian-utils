# 04: Week resolution and London-date bucketing

**What to build:** `week-review` with no flag reviews the last complete ISO week; `--week GGGG-Www` reviews any past week and rejects malformed input. The request window is half-open `[Mon 00:00, next Mon 00:00)` with explicit Europe/London offsets, days are counted by London calendar date, and the header range is derived from the ISO week.

**Blocked by:** 01 — Tracer bullet

**Status:** done

- [x] No flag on any day of W44 2026 resolves to W43 2026
- [x] `--week` rejects malformed values (e.g. `2026-43`, `2026-W54`) with a clear error and non-zero exit
- [x] Window bounds carry the correct London offset on each side of a DST change
- [x] W43 2026 (clocks go back Sun 25 Oct) fixture: entries late on the Sunday count as Sunday, and Days is correct
- [x] Header for W43 2026 reads `19–25 Oct`; a week spanning months renders both months
