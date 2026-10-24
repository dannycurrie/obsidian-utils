# 06: Failures stop before writing

**What to build:** Every failure exits non-zero with a clear stderr message and leaves the vault untouched. A week is incomplete — and fatal — if it has not ended (Sun 23:59 Europe/London not yet passed) or has zero entries across all metrics. Per-metric gaps are never fatal. On success the CLI prints the note path and a one-line result.

**Blocked by:** 01 — Tracer bullet

**Status:** done

- [x] Reviewing a week that has not ended fails without calling the vault
- [x] A fully empty week fixture fails; "never write a review of zeros"
- [x] A 401 from the mock fails with an auth-specific message
- [x] An unreachable server fails with a connection-specific message
- [x] A missing vault path fails before any write
- [x] In every failure case, the test vault is byte-identical before and after
- [x] Success prints the note path and a one-line summary and exits 0
