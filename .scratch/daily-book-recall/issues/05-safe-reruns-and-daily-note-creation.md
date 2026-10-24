# 05: Safe re-runs and daily-note creation

**What to build:** Running `book-recall` when the day's note already has a recall block does nothing and exits 0, so a scheduled run, a wake-up catch-up and a manual run on the same day can't change the book or cost a second LLM call. `--regenerate` replaces the block with a fresh summary of the same book; `--reroll` replaces it with a different book. `--dry-run` prints the block and writes nothing. If the day's note doesn't exist, it's created from the configured daily template with its `{{date:…}}` tokens rendered for that date, then the block is appended. "Today" is the current date in the configured timezone (default Europe/London).

**Blocked by:** 03 — Random pick from eligible books

**Status:** ready-for-agent

- [ ] A second plain run on the same day makes no LLM call, leaves the note byte-for-byte unchanged and exits 0 with a one-line "already done" message
- [ ] `--regenerate` keeps the same book; `--reroll` never picks today's current book
- [ ] Both replace the block in place; text before and after the markers is preserved byte-for-byte
- [ ] `--dry-run` prints the block to stdout, makes the LLM call, and writes nothing
- [ ] A missing daily note is created from the template with `{{date:YYYY-MM-DD}}` and `{{date:GGGG-[W]WW}}` rendered correctly, followed by the block
- [ ] Daily folder, filename format and template path come from config, defaulting to the vault's daily-notes settings
- [ ] Near midnight in London (including a DST change), the run writes to the London date
- [ ] A forced re-run produces 0 duplicate blocks and 0 duplicate daily notes
