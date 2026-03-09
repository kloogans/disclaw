# Onboarding Improvements Design

**Date:** 2026-03-09
**Status:** Draft

## Problem

Getting from zero to first message takes 15 steps across 3 CLI commands, with no validation along the way. Bad tokens, missing dependencies, and broken Claude auth all fail silently — users only discover problems after completing the entire setup. Adding subsequent projects tells users to run `vibemote start` when the daemon is already running, requiring them to figure out `vibemote restart` on their own.

## Goals

1. Reduce first-time setup friction
2. Validate everything upfront — fail fast with clear instructions
3. Make adding projects seamless, even when the daemon is already running
4. Consolidate documentation into a single source of truth
5. Make vibemote installable from GitHub in one command

## Scope

**In scope:**
- `vibemote setup` command (replaces `init`)
- `vibemote add` improvements (token validation, auto start/hot-reload, connectivity confirmation)
- Hot-reload via SIGHUP (daemon re-reads config without restart)
- `vibemote start` feedback (per-bot connectivity confirmation)
- `vibemote status` improvements (real per-bot state)
- `vibemote token-update <project>` command
- Doc consolidation (merge SETUP.md into GETTING-STARTED.md)
- GitHub-installable package.json

**Out of scope:**
- Manager bot / token pool
- Single-bot architecture change
- npm registry publish
- `vibemote tray` documentation
- Non-interactive mode (`--yes` flag)

---

## Design

### 1. `vibemote setup` — One-Time Global Setup

Replaces `vibemote init`. Run from anywhere, creates `~/.vibemote/config.json`.

**Flow:**

```
$ vibemote setup

=== vibemote Setup ===

Checking prerequisites...
  ✓ Node.js v22.5.0
  ✓ ffmpeg found
  ✓ Claude Code authenticated

Step 1: Telegram User ID
  Open Telegram → @userinfobot → send /start → copy your ID

  Your Telegram user ID: 12345678
  ✓ Valid user ID

Step 2: Voice transcription model
  tiny (~75MB) | base (~150MB) ← recommended | small (~500MB)

  Whisper model (base): [enter]

✅ Setup complete. Config saved to ~/.vibemote/

Next: vibemote add <path-to-project>
```

**Prerequisite checks (all blocking):**

| Check | How | Failure message |
|---|---|---|
| Node.js >= 22 | `process.version` | `Node.js 22+ required. Current: v18.x. Install: brew install node` |
| ffmpeg | `execSync("ffmpeg -version")` | `ffmpeg not found. Install: brew install ffmpeg` |
| Claude Code auth | `execSync("claude auth status")` | `Claude Code not authenticated. Run: claude auth login` |

All prerequisites must pass before any prompts are shown. If any fail, print all failures at once (don't stop at the first one) so the user can fix everything in one pass.

**Backward compatibility:**
- `vibemote init` becomes a hidden alias for `vibemote setup` (not shown in `--help`)
- If config already exists, prompt to overwrite (same as current `init` behavior)

**Implementation:** New file `src/cli/setup.ts`. Reuses prerequisite check logic from `doctor.ts` (extract shared helpers into `src/cli/checks.ts`).

---

### 2. `vibemote add` Improvements

**Current problems:**
- Token validation is just a `:` character check — bad tokens fail silently at runtime
- Always says "Start with: vibemote start" even when daemon is already running
- No connectivity confirmation

**New flow:**

```
$ vibemote add ~/git/my-project

Project name (my-project): [enter]

Create a Telegram bot:
  Open Telegram → @BotFather → /newbot → copy the token

Bot token: 7123456789:AAHf...
  ✓ Token valid — @my_project_claude_bot

✅ Project "my-project" registered.
  Starting bot... ✓ connected

Open Telegram and message @my_project_claude_bot
```

**Token validation:**
- Call Telegram Bot API `getMe` with the provided token
- On success: display the bot's username so user can confirm it's the right bot
- On failure: show "Invalid token — check and try again" and re-prompt (don't exit, let them re-paste)
- Implementation: simple `fetch(`https://api.telegram.org/bot${token}/getMe`)` — no new dependencies needed

**Post-add behavior (replaces static "Start with: vibemote start" message):**

```
if daemon is not running:
  start the daemon
  poll logs for ~5 seconds to confirm bot connected
  show: "Starting bot... ✓ connected"
else:
  send SIGHUP to daemon
  poll logs for ~5 seconds to confirm new bot connected
  show: "Starting bot... ✓ connected"

show: "Open Telegram and message @bot_username"
```

If connectivity confirmation fails within 5 seconds:
```
⚠ Bot registered but not yet connected. Check: vibemote logs my-project
```

**Re-prompt on bad token:** Instead of exiting on invalid token, loop and let the user try again (up to 3 attempts). Common failure mode is a truncated paste on mobile-to-desktop transfer.

---

### 3. Hot-Reload via SIGHUP

**Purpose:** When `vibemote add` or `vibemote remove` modifies config while the daemon is running, the daemon should pick up the changes without restarting. This avoids killing active Claude sessions for other projects.

**Mechanism:**

1. CLI command (`add` / `remove`) saves config to `~/.vibemote/config.json`
2. CLI sends `SIGHUP` to the daemon process (PID from `~/.vibemote/daemon.pid`)
3. Daemon's `SIGHUP` handler:
   a. Waits 500ms (ensures config file write is flushed)
   b. Re-reads config via `loadConfig()`
   c. Diffs `config.projects` against currently running bots
   d. Starts new `ProjectBot` instances for added projects (using `startBotWithRecovery`)
   e. Stops `ProjectBot` instances for removed projects (calls `bot.stop()`)
   f. Logs the changes: `"Hot-reload: started 1 bot, stopped 0 bots"`

**Daemon changes (`src/daemon.ts`):**

```typescript
// Track running bots by project name
const runningBots = new Map<string, ProjectBot>();

process.on("SIGHUP", async () => {
  logger.info("SIGHUP received, reloading config");

  // Wait for config file write to complete
  await new Promise((r) => setTimeout(r, 500));

  const newConfig = loadConfig();
  const currentNames = new Set(runningBots.keys());
  const newNames = new Set(newConfig.projects.map((p) => p.name));

  // Start new projects
  for (const project of newConfig.projects) {
    if (!currentNames.has(project.name)) {
      const botLogger = createLogger(project.name);
      startBotWithRecovery(newConfig, project, botLogger, runningBots, shuttingDown);
    }
  }

  // Stop removed projects
  for (const [name, bot] of runningBots) {
    if (!newNames.has(name)) {
      await bot.stop().catch(() => {});
      runningBots.delete(name);
    }
  }
});
```

**Refactor needed:** `daemon.ts` currently uses a flat `bots: ProjectBot[]` array. Change to `Map<string, ProjectBot>` for name-based lookup. The `startBotWithRecovery` function needs to register bots in this map instead of pushing to an array.

**`vibemote remove` update:** After saving config, send SIGHUP instead of telling user to restart:
```
Project "my-project" removed.
Bot stopped.  // (if daemon was running)
```

---

### 4. `vibemote start` Feedback

**Current:** Exits immediately with "launching..." — no confirmation that bots actually connected.

**New behavior:**

```
$ vibemote start

Daemon started (PID: 12345)

  ✓ my-project — @my_project_bot connected
  ✓ backend — @backend_claude_bot connected

2 bot(s) ready. Open Telegram to start.
```

**Implementation:**
- After spawning the daemon, poll the daemon's log file for bot connection messages
- Each `ProjectBot.start()` already logs when grammy's `bot.start()` resolves — look for these entries
- Timeout after 5 seconds per bot
- On timeout: `⚠ my-project — not yet connected (check: vibemote logs my-project)`

**Daemon-side change:** Add a structured log entry when each bot successfully connects:
```typescript
// In ProjectBot.start(), after bot.start() resolves:
this.logger.info({ event: "bot_connected", username: botInfo.username }, "Bot connected");
```

The CLI polls for `"bot_connected"` events in the log file. This avoids any IPC mechanism — just tail the log.

---

### 5. `vibemote status` Improvements

**Current:** Only shows daemon PID.

**New output:**

```
$ vibemote status

Daemon running (PID: 12345)

Projects:
  ✓ my-project — @my_project_bot (sonnet, default mode)
  ✓ backend — @backend_bot (opus, auto mode)

2 project(s) active
```

**Implementation:**
- Read config to get project list with settings
- For each project, call `getMe` with the stored bot token to verify the token is still valid
- Show model and permission mode from config (with per-project overrides resolved)
- If `getMe` fails for a bot: `✗ my-project — token invalid or bot unreachable`
- If daemon not running: show current behavior ("Daemon not running. Run: vibemote start")

---

### 6. `vibemote token-update <project>`

**Purpose:** Update a project's bot token without manually editing JSON.

**Flow:**

```
$ vibemote token-update my-project

Current bot: @my_project_bot

New bot token: 7123456789:AAHf...
  ✓ Token valid — @my_project_bot_v2

✅ Token updated.
  Reloading... ✓ connected
```

**Implementation:** New file `src/cli/token-update.ts`.
- Load config, find project by name
- Show current bot username via `getMe` (or "unknown" if current token is broken)
- Prompt for new token, validate via `getMe`
- Update the project's `botToken` in config, save
- If daemon running: send SIGHUP (the hot-reload will stop the old bot and start with the new token — requires the reload logic to detect token changes, not just added/removed projects)

**Hot-reload enhancement for token changes:** The SIGHUP handler should also detect when a project's `botToken` has changed (compare against running bot's token). If changed, stop the old bot and start a new one with the updated token.

---

### 7. Doc Consolidation

**Current state:** Three overlapping documents:
- `README.md` — project overview + config reference + CLI reference
- `GETTING-STARTED.md` — step-by-step walkthrough (the best one)
- `SETUP.md` — setup guide that overlaps heavily with GETTING-STARTED.md

**Target state:**
- `README.md` — project overview, features, architecture, config reference, CLI/Telegram command reference. Links to GETTING-STARTED.md for setup.
- `GETTING-STARTED.md` — the single setup walkthrough, updated to reflect new `setup`/`add` flow. No more references to SETUP.md.
- `SETUP.md` — deleted.

**GETTING-STARTED.md changes:**
- Replace `vibemote init` with `vibemote setup`
- Remove manual prerequisite check steps (1-3) — `setup` handles these
- Remove hardcoded path `/Users/tlabropoulos/Documents/git/vibemote`
- Replace clone/build/link steps with `npm install -g github:user/vibemote`
- Update `add` section to show token validation and auto-start behavior
- Remove separate "run doctor" and "start daemon" steps — `add` handles both
- Remove "For the full reference, see SETUP.md" link

**Step count reduction:** 15 steps → ~7 steps:
1. `npm install -g github:user/vibemote`
2. `vibemote setup` (handles prerequisites + user ID + whisper)
3. Open Telegram → @BotFather → create bot → copy token
4. `vibemote add ~/git/my-project` (paste token, bot starts automatically)
5. Open Telegram → message the bot

Steps 3-5 repeat for each additional project. Step 1-2 are one-time.

---

### 8. GitHub-Installable Package

**Goal:** `npm install -g github:username/vibemote` works out of the box — clones, builds, and links in one command.

**package.json changes:**

```json
{
  "name": "vibemote",
  "version": "0.1.0",
  "files": ["dist", "package.json", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup src/index.ts src/daemon.ts src/tray.ts --format esm --clean --external systray2",
    "prepare": "npm run build"
  }
}
```

**Key addition:** The `prepare` script runs automatically during `npm install` from git. It triggers the build so the user gets a working `dist/` directory without manually running `npm run build`.

**Verify:** `files` field ensures only necessary files are included. `bin` field already points to `./dist/index.js`. The `engines` field already specifies `node >= 22`.

**Note:** The `postinstall` script for systray2 chmod should remain — it's needed for the tray binary.

---

## Implementation Order

1. **Extract shared checks** — `src/cli/checks.ts` with `checkNodeVersion()`, `checkFfmpeg()`, `checkClaudeAuth()`, `validateBotToken(token)`
2. **`vibemote setup`** — `src/cli/setup.ts`, register in `index.ts`, alias `init`
3. **Bot token validation** — `validateBotToken()` using Telegram `getMe` API
4. **Hot-reload** — SIGHUP handler in `daemon.ts`, refactor bots array to Map
5. **`vibemote add` improvements** — token validation, auto start/hot-reload, connectivity poll
6. **`vibemote start` feedback** — log polling for bot_connected events
7. **`vibemote status` improvements** — per-bot state via getMe + config
8. **`vibemote token-update`** — new command, hot-reload with token change detection
9. **`vibemote remove` update** — SIGHUP instead of "restart" message
10. **Doc consolidation** — update GETTING-STARTED.md, delete SETUP.md, update README.md
11. **GitHub-installable** — add `prepare` script and `files` field to package.json

## Risk / Open Questions

- **Log polling reliability:** Tailing the log file for "bot_connected" events is simple but fragile (race conditions, log format changes). Alternative: write a small status file (`~/.vibemote/status.json`) that the daemon updates and the CLI reads. Decision: start with log polling, migrate to status file if it proves flaky.
- **SIGHUP on non-Unix:** Windows doesn't support SIGHUP. The hot-reload mechanism needs a fallback for Windows — likely a file-based signal (write a reload marker file that the daemon polls). Defer to a future Windows-support pass since current users are on macOS.
- **`prepare` script and CI:** The `prepare` script runs `npm run build` on every `npm install`, including in CI. This is standard behavior but adds build time. Acceptable tradeoff for the install UX improvement.
