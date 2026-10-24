# 07: Keychain token and real-vault guard

**What to build:** Config lives at `~/.config/week-review/config.json` (outside the vault) and holds no secrets. The API token is read from the macOS Keychain, with an env var override. While the base URL points at localhost (the mock), the CLI refuses to write to the vault configured as `realVault`, so placeholder numbers never land in real notes.

**Blocked by:** 01 — Tracer bullet

**Status:** done

- [x] Default config path is `~/.config/week-review/config.json`; a flag or env var can override it for tests
- [x] Token is read via `security find-generic-password`; the env var takes precedence when set
- [x] A missing token fails with instructions for adding it to the Keychain
- [x] Config containing a token field is rejected
- [x] With a localhost base URL and vault path equal to `realVault`, the CLI refuses to write and exits non-zero
