# 05: Safe re-runs and note creation

**What to build:** Running the CLI twice for the same week replaces its own block instead of adding another. If the week's note does not exist, it is created at the configured path (`Plans/Week plans/GGGG-[W]WW.md`) with the week-plan frontmatter stub (`type: plan`, `created`, `period`, `status`). All writes are atomic so a sync client never sees a half-written note.

**Blocked by:** 01 — Tracer bullet

**Status:** done

- [x] A second run for the same week leaves exactly one marker block, with updated content
- [x] Text outside the markers (before and after) is preserved byte-for-byte across re-runs
- [x] A missing note is created with the frontmatter stub followed by the block
- [x] Note folder and filename format come from config, not hard-coded
- [x] Writes go to a temp file in the same directory and are renamed into place
- [x] A forced re-run produces 0 duplicate blocks and 0 duplicate notes
