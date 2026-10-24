# 04: No-repeat window

**What to build:** A book shown in a recall block in any of the last `noRepeatDays` daily notes (default 10) is not picked. The history is read from the vault itself: the `[[Book]]` link in the heading of each past `book-recall` block. There is no separate state file. If every eligible book was shown inside the window, the tool picks the one shown longest ago instead of failing.

**Blocked by:** 03 — Random pick from eligible books

**Status:** ready-for-agent

- [ ] Books linked from `book-recall` blocks in the previous `noRepeatDays` daily notes are excluded from the pick
- [ ] Links elsewhere in a daily note (outside the markers) do not count as "shown"
- [ ] Missing daily notes in the window are skipped, not treated as errors
- [ ] When every eligible book is inside the window, the least recently shown book is picked
- [ ] Over 10 consecutive seeded test days with 11+ eligible books, no book repeats
