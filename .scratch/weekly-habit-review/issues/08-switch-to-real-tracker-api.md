# 08: Switch to the real tracker API

**What to build:** Once the tracker's metrics API serves `granularity=day` and is deployed, the CLI is pointed at it by changing the base URL. Before switching, a contract check confirms the real response for a week matches the shape the mock serves. Then the "v1 done" criteria are tracked over four real weeks.

**Blocked by:** 02, 03, 04, 05, 06, 07 — plus external: tracker tickets 03/04 (`granularity=day`) and the Vercel deploy

**Status:** in progress — contract OK for W39–W43 (2026-10-24); 4-week run pending

**Note (2026-10-24):** the tracker's Metrics API is deployed at `https://tracker-metrics-api.vercel.app` (tickets 02–04 done), but it has no `granularity=day`: the parameter is ignored and each metric comes back with one weekly period. Tracker ticket 05 (`granularity=day`) has since shipped; `npm run contract` passes for W39–W43. The CLI now refuses non-daily periods (except checklists), so pointing it at the API early fails loudly instead of writing `1/7` for every habit.

- [x] A contract check compares a real API response against the mock's fixture shape and reports any field differences
- [x] Base URL switched in config; no code change needed
- [ ] 4 of 4 weeks reviewed with the default command within 3 days of their Sunday, no manual table fixes
- [ ] 0 numeric mismatches between review tables and the tracker
- [ ] 0 duplicate blocks or notes after a forced re-run on the real vault
