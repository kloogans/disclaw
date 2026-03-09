# vibemote Setup Guide

Complete guide to get vibemote running on your Mac.

## Prerequisites

Before starting, make sure you have:

### 1. Node.js 22+

```bash
node --version  # Should be v22.x or higher
```

If not installed, get it from [nodejs.org](https://nodejs.org) or via nvm:
```bash
nvm install 22
nvm use 22
```

### 2. Claude Code authenticated

The Agent SDK uses your existing Claude Code login. Make sure you're logged in:

```bash
claude auth login
```

If you have a Claude Max subscription, you're already covered — no API key needed.

### 3. ffmpeg (for voice transcription)

```bash
brew install ffmpeg
```

Verify: `ffmpeg -version`

### 4. Telegram Account

You need the Telegram app on your phone (and optionally desktop).

---

## Installation

### Step 1: Build the project

```bash
cd /Users/tlabropoulos/Documents/git/vibemote
npm install
npm run build
```

### Step 2: Make the CLI globally accessible

Option A — npm link (recommended):
```bash
npm link
```
Now `vibemote` works from anywhere.

Option B — use directly:
```bash
node dist/index.js <command>
```

---

## Configuration

### Step 3: Get your Telegram user ID

1. Open Telegram on your phone
2. Search for **@userinfobot**
3. Send `/start`
4. It replies with your numeric user ID (e.g., `123456789`)
5. Copy this number

### Step 4: Run init

```bash
vibemote init
```

It will ask for:
- **Your Telegram user ID** — paste the number from step 3
- **Whisper model** — press Enter for `base` (recommended), or choose `tiny` (faster) or `small` (more accurate)

This creates `~/.vibemote/config.json`.

> The whisper model downloads automatically the first time you send a voice note.

---

## Adding a Project

Each project gets its own Telegram bot. You'll create one via BotFather.

### Step 5: Create a Telegram bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. BotFather asks for a **display name** — enter something like: `My SaaS - Claude`
4. BotFather asks for a **username** — enter something like: `my_saas_claude_bot` (must end in `bot`)
5. BotFather gives you a **bot token** like: `7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
6. **Copy the token** — you'll need it next

### Step 6: Register the project

```bash
vibemote add /path/to/your/project
```

It will ask for:
- **Project name** — press Enter for the directory name, or type a custom name
- **Bot token** — paste the token from BotFather

Repeat steps 5-6 for each project you want to control remotely.

### Verify your projects

```bash
vibemote list
```

---

## Running

### Step 7: Start the daemon

```bash
vibemote start
```

This launches a background process that runs all your project bots.

### Step 8: Open Telegram and test

1. Open Telegram on your phone
2. Search for the bot username you created (e.g., `my_saas_claude_bot`)
3. Send `/start` — you should see a welcome message
4. Send a message like: "What files are in this project?" — Claude will respond

### Verify everything is healthy

```bash
vibemote doctor
```

This checks Node.js, config, ffmpeg, whisper model, API key, and daemon status.

---

## Daily Usage

### Telegram Commands

| Command | What it does |
|---|---|
| `/help` | Show all commands |
| `/new` | Start a fresh Claude session |
| `/cancel` | Stop current operation |
| `/model opus` | Switch to Opus (or `sonnet`, `haiku`) |
| `/mode auto` | Switch permission mode (or `plan`, `default`) |
| `/sessions` | List past sessions |
| `/resume <id>` | Resume a past session |
| `/status` | Show project info, model, cost |
| `/cost` | Show session cost |

### Message Types

- **Text** — sent directly to Claude
- **Voice notes** — transcribed locally via whisper, then sent to Claude
- **Images** — downloaded and analyzed by Claude
- **Documents** — downloaded and processed by Claude

### Permission Prompts

When Claude wants to use a tool that isn't auto-approved, you'll see an inline keyboard:

```
Permission Request
Editing src/index.ts

[Allow]  [Always]  [Deny]
```

- **Allow** — approve this one time
- **Always** — approve this tool for the rest of the session
- **Deny** — reject (5-minute timeout auto-denies)

---

## CLI Reference

| Command | Description |
|---|---|
| `vibemote init` | First-time setup |
| `vibemote add <path>` | Register a project with a new bot |
| `vibemote remove <name>` | Unregister a project |
| `vibemote list` | Show all registered projects |
| `vibemote start` | Start the daemon |
| `vibemote stop` | Stop the daemon |
| `vibemote restart` | Restart the daemon |
| `vibemote status` | Show daemon PID and status |
| `vibemote logs [name]` | Tail logs (`daemon` by default, or a project name) |
| `vibemote doctor` | Health check |
| `vibemote install` | Auto-start on login (macOS LaunchAgent) |
| `vibemote uninstall` | Remove auto-start |

---

## Auto-Start on Login (Optional)

To have vibemote start automatically when you log into your Mac:

```bash
vibemote install
```

This creates a LaunchAgent at `~/Library/LaunchAgents/com.vibemote.daemon.plist` with:
- **RunAtLoad** — starts when you log in
- **KeepAlive** — auto-restarts if it crashes

To remove:
```bash
vibemote uninstall
```

---

## Troubleshooting

### "Daemon not running"

```bash
vibemote start
vibemote status  # Should show PID
```

### Check logs

```bash
vibemote logs           # Daemon logs
vibemote logs my-saas   # Specific project logs
```

### Bot not responding in Telegram

1. Make sure the daemon is running: `vibemote status`
2. Make sure your user ID matches: check `~/.vibemote/config.json` → `authorizedUsers`
3. Make sure you're messaging the right bot (search its username in Telegram)
4. Check logs: `vibemote logs`

### Voice transcription not working

1. Check ffmpeg: `ffmpeg -version`
2. The whisper model downloads on first use — check logs for download progress
3. Run `vibemote doctor` to verify

### Claude authentication issues

Make sure you're logged into Claude Code:
```bash
claude auth login
```
Then restart the daemon: `vibemote restart`

### Reset everything

```bash
vibemote stop
rm -rf ~/.vibemote
vibemote init
```

---

## File Locations

| What | Where |
|---|---|
| Config | `~/.vibemote/config.json` |
| State (sessions, PID) | `~/.vibemote/state.json` |
| Logs | `~/.vibemote/logs/` |
| Whisper models | `~/.vibemote/models/` or `~/.smart-whisper/models/` |
| Media (per project) | `<project>/.vibemote/media/` (auto-cleaned after 24h) |
| LaunchAgent | `~/Library/LaunchAgents/com.vibemote.daemon.plist` |

---

## Configuration Reference

The config at `~/.vibemote/config.json`:

```json
{
  "authorizedUsers": [123456789],
  "whisper": {
    "model": "base",
    "gpu": true,
    "language": "auto"
  },
  "defaults": {
    "model": "sonnet",
    "permissionMode": "default",
    "allowedTools": ["Read", "Glob", "Grep", "WebSearch"],
    "settingSources": ["project"]
  },
  "messageBatchDelayMs": 3000,
  "permissionTimeoutMs": 300000,
  "maxResponseChars": 50000,
  "projects": [
    {
      "name": "my-saas",
      "path": "/path/to/my-saas",
      "botToken": "123:ABC..."
    }
  ]
}
```

### Per-project overrides

You can add `model`, `permissionMode`, and `allowedTools` to any project entry to override the defaults:

```json
{
  "name": "my-saas",
  "path": "/path/to/my-saas",
  "botToken": "123:ABC...",
  "model": "opus",
  "permissionMode": "auto",
  "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep"]
}
```
