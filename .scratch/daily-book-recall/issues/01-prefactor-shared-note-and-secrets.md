# 01: Prefactor: shared note-writing and secrets code

**What to build:** The marker-block upsert, atomic write, Keychain token loading and config secret-key check that `week-review` uses become shared code that a second CLI can call. Marker names (today hard-wired to `week-review`), the Keychain service/account and the env-var override name become parameters. `week-review` behaves exactly as before; this ticket adds no new user-facing behaviour.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Marker-block upsert takes the start/end marker names as input; `week-review` passes its existing markers
- [x] The "unmatched or repeated markers" error names the tool whose markers are broken
- [x] Keychain loading takes service, account and env-var name as input; `week-review` keeps `week-review` / `tracker-api` / `WEEK_REVIEW_TOKEN`
- [x] The secret-key check on config files is reusable by another tool's config loader
- [x] All existing `week-review` tests pass unchanged, and `npm run typecheck` is clean
