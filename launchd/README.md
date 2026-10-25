# Scheduling book-recall with launchd

`com.danny.book-recall.plist` is a launchd user agent that runs `book-recall` every day the laptop is opened:

- at 07:00 (`StartCalendarInterval`); if the laptop is asleep then, launchd runs it once when it wakes
- at login after a cold boot (`RunAtLoad`)

A day the laptop isn't opened gets no recall, and missed days are never filled in: each run writes to the note for the day it actually runs. Waking, logging in and the 07:00 timer can all fire on one day; only the first run writes, and later runs find the block and exit without calling Claude.

One gap: a day the laptop is only open before 07:00 is skipped. Install with an earlier `--hour` if that matters.

## Before installing

1. Config at `~/.config/book-recall/config.json`, at least `{ "vaultPath": "/Users/<you>/Documents/Obsidian Vault" }`.
2. The Anthropic API key in the Keychain. Run this in Terminal and paste the key at both prompts:

   ```sh
   security add-generic-password -U -s book-recall -a anthropic-api -w
   ```

   The job reads it with the same `security` tool that stored it, so there is no Keychain prompt.

3. Check a run by hand: `node src/recall/cli.ts --dry-run`.

## Install

From the repo, with the node you want the job to use (24 or later) first on your PATH:

```sh
npm run launchd:install                       # daily at 07:00
node scripts/launchd.ts install --hour 6      # or another time
```

This fills in the template with absolute paths (that `node`, this repo, your home folder), writes `~/Library/LaunchAgents/com.danny.book-recall.plist` and loads it with `launchctl bootstrap gui/$(id -u) …`. Because of `RunAtLoad` it also runs once straight away, so today's recall is written on install.

The plist points at the absolute `node` path from install time. Re-run the install after removing or upgrading that node (e.g. with nvm), or after moving this repo.

To see the rendered plist without installing: `node scripts/launchd.ts print`.

## Logs

Each run appends a `--- <timestamp>` line, then the note path and a one-line result (or a `book-recall: …` error) to `~/Library/Logs/book-recall.log`:

```sh
tail -n 20 ~/Library/Logs/book-recall.log
```

## Run now, or check it's loaded

```sh
launchctl kickstart gui/$(id -u)/com.danny.book-recall
launchctl print gui/$(id -u)/com.danny.book-recall | head -n 20
```

## Uninstall

```sh
npm run launchd:uninstall
```

This runs `launchctl bootout gui/$(id -u)/com.danny.book-recall` and deletes the plist from `~/Library/LaunchAgents`.
