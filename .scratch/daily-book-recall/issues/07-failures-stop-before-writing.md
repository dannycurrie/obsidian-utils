# 07: Failures stop before writing

**What to build:** Every check happens before the write, so any failure leaves the daily note exactly as it was and exits non-zero with a clear message on stderr. A reply that isn't exactly 5 one-sentence bullets is retried once with the problem stated, then fails. An unreachable API, a rejected key, a rate limit or a timeout is retried once after a short wait, then fails. Broken markers, a missing vault and a missing daily folder fail without retrying.

**Blocked by:** 02 — Tracer bullet

**Status:** done

- [x] The stub can return 4 or 6 bullets, empty bullets or a preamble; each triggers one retry, then a failure if the retry is also bad
- [x] The stub can return 401, 429 and 5xx or hang; each is retried once, then fails with a message naming the cause
- [x] Unmatched or repeated `book-recall` markers in the daily note fail with a "fix by hand" message
- [x] A missing vault or daily folder fails before any LLM call
- [x] In every failure case the daily note is byte-for-byte unchanged and no temp file is left behind
- [x] After a successful write, the note is re-read to confirm the block is there
