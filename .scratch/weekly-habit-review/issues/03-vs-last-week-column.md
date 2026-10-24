# 03: "vs last week" column

**What to build:** The table gains a `vs last week` column. The CLI fetches the previous ISO week the same way as the reviewed week and shows the change in Total per metric.

**Blocked by:** 02 — Every metric type in the table

**Status:** done

- [x] The previous week is fetched with the same window rules as the reviewed week
- [x] No change renders as `=`; changes render as `+n` / `−n` (true minus sign) with the metric's unit
- [x] Checklist deltas are the change in items checked
- [x] If the previous week has no entries for a metric, the column shows `—`
- [x] Fixture tests cover increase, decrease, no change, and missing prior week
