# 02: Tracer bullet: one named book to a test daily note

**What to build:** Running `book-recall --book "<title>" --date <YYYY-MM-DD>` against a local stub of the Claude Messages API reads that book note from a test vault, sends its body (frontmatter removed) with title and author, and appends a recall block to the end of that date's existing daily note. Config comes from a file outside the vault (`BOOK_RECALL_CONFIG` overrides the default path); the API key comes from `BOOK_RECALL_API_KEY`. The Claude base URL comes from config so tests can point it at the stub. This proves the full path: config → book note → LLM → daily note write.

The block format, from the brief:

```markdown
<!-- book-recall:start -->
## Book recall — [[<Book title>]]

- <learning 1>
- … (exactly 5)

_Generated <YYYY-MM-DD HH:mm> from 1 book note (<n> words) by <model>. Re-runs overwrite this block._
<!-- book-recall:end -->
```

**Blocked by:** 01 — Prefactor

**Status:** done

- [x] A second `bin` entry, `book-recall`, runs from the repo like `week-review`
- [x] A local stub of the Messages API returns 5 canned learnings and rejects requests without the expected API key
- [x] The request sent to the stub contains the book note body without its frontmatter, plus title and author
- [x] The block is appended at the very end of the existing daily note; everything before it is untouched
- [x] Config is validated (required `vaultPath`, no secret-looking keys) with the same error style as `week-review`
- [x] On success the CLI prints the note path and one line, e.g. `2026-10-24: added recall — The Phoenix Project`
- [x] An automated test runs the CLI end-to-end against the stub and a temp vault and checks the written note
