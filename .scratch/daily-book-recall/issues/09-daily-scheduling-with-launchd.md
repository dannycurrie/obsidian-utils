# 09: Daily scheduling with launchd

**What to build:** A launchd user-agent template and install steps that run `book-recall` every day the laptop is opened. It runs at 07:00, catches up on wake if the laptop was asleep then, and also runs at login after a cold boot. A day the laptop isn't opened gets no block, and missed days are never filled in later. Output goes to a log file.

**Blocked by:** 05 — Safe re-runs and daily-note creation, 08 — Switch to the real Claude API

**Status:** awaiting manual check (install, then the last three criteria)

- [x] The repo has a plist template using `StartCalendarInterval` at 07:00 plus `RunAtLoad`, an absolute `node` path (24 or later) and stdout/stderr to `~/Library/Logs/book-recall.log`
- [x] Install and uninstall steps (`launchctl bootstrap` / `bootout`) are documented next to the template
- [ ] The scheduled job can read the API key from the Keychain without a prompt
- [ ] Manual check: after waking the laptop past 07:00, today's note has exactly one block, and later wake-ups or logins that day add nothing
- [ ] Manual check: a day the laptop stays closed has no block, and the next day's run writes only to the new day's note
