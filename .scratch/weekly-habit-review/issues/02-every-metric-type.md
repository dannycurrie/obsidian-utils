# 02: Every metric type in the table

**What to build:** The review table covers every metric the API returns, in the tracker's `display_order`, with the right figure per tracker type: cumulative and timed metrics show summed totals (timed in minutes, e.g. Meditation, AI learning), average metrics show the mean, and checklist metrics (e.g. Gym) are scored weekly with Days `—` and Total as items checked `n/m`. Metrics with no entries all week appear as `0/7` and are listed on a "No entries:" line.

**Blocked by:** 01 — Tracer bullet

**Status:** done

- [x] Fixtures include cumulative (KMs run, Early rising), timed (Meditation, AI learning), average, and checklist (Gym) metrics
- [x] Rows appear in `display_order`
- [x] Timed totals render in minutes; cumulative totals render in the metric's unit (or bare count when unitless)
- [x] Average metrics show the mean of logged values; a week with no entries shows `—` for Total, not 0
- [x] Checklist rows show `—` for Days and `checked/total` for Total
- [x] "No entries: <names>" lists metrics with zero entries for the week, or "No entries: none."
- [x] Optional `units` config (keyed by metric id) supplies display units the tracker omits, e.g. KMs run → km
