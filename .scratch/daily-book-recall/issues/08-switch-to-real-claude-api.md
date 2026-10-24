# 08: Switch to the real Claude API

**What to build:** The CLI calls the real Claude Messages API with the configured model (default `claude-sonnet-5-5`), asking for exactly 5 strings through structured output or a single tool call so the count is checked in code. The prompt follows the brief: use only what's in the notes, one sentence per bullet, no preamble, keep your own wording and examples, and ignore old Tana checklist scaffolding. The API key comes from the macOS Keychain (service `book-recall`, account `anthropic-api`), with `BOOK_RECALL_API_KEY` as an override. A guard refuses to write to the configured real vault while the Claude base URL points at the local stub.

**Blocked by:** 02 — Tracer bullet, 07 — Failures stop before writing

**Status:** awaiting manual check (last criterion)

- [x] With no env var set, the key is read from the Keychain; with neither, the error tells you the exact `security add-generic-password` command to run
- [x] The request asks for structured output of exactly 5 strings; a reply of the wrong shape goes through ticket 07's retry path
- [x] The prompt includes the brief's rules and labels each part of the context with its source path
- [x] With a localhost Claude base URL, writing to `realVault` is refused before any call
- [x] A safety refusal (`stop_reason: "refusal"`) gives a clear error instead of a JSON parse failure; consider the API's server-side `fallbacks: "default"` option so a refused request is re-run on a fallback model
- [ ] `book-recall --dry-run --book "<title>"` against the real API on 3 real books gives bullets you recognise from your notes (manual check)
