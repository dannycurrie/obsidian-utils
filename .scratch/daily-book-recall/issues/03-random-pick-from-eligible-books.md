# 03: Random pick from eligible books

**What to build:** Running `book-recall` without `--book` picks one book at random from the eligible notes in the books folder. A note is eligible when its frontmatter has `type: book`, its `status` is in the configured `statuses` (default Finished and Reading), and its body (not counting frontmatter) is at least `minWords` long (default 150). Backlog and Abandoned books and frontmatter-only stubs are never picked. `--book` still bypasses the pick.

**Blocked by:** 02 — Tracer bullet

**Status:** done

- [x] The books folder is searched recursively; `Templates/` is ignored
- [x] With a fixed seed, the same vault always gives the same pick (tests inject the random source, as `week-review` injects the clock)
- [x] Over many seeded runs, every eligible book can be picked and no ineligible one ever is
- [x] `statuses`, `minWords` and `booksFolder` come from config with the brief's defaults
- [x] `--book` with a title that doesn't match a note fails clearly without writing
- [x] If no note is eligible at all, the run fails non-zero without writing
