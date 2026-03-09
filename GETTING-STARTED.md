# Getting Started with vibemote

A step-by-step walkthrough. Follow each step in order.

---

## What you'll need

- Your Mac (the one with your projects)
- Your phone with Telegram installed
- Node.js 22+, ffmpeg, and Claude Code authenticated
- ~5 minutes

---

## Step 1: Install vibemote

```bash
npm install -g github:yourusername/vibemote
```

Verify it works:

```bash
vibemote --version
```

> **Building from source?** Clone the repo, run `npm install && npm run build && npm link`.

---

## Step 2: Run setup

```bash
vibemote setup
```

This checks prerequisites (Node.js, ffmpeg, Claude Code auth), then asks for:

- **Your Telegram user ID** — open Telegram, search @userinfobot, send /start, copy the number
- **Whisper model** — press Enter for `base` (recommended)

If any prerequisites fail, setup tells you exactly what to install.

---

## Step 3: Add a project

```bash
vibemote add ~/path/to/your/project
```

This asks for:

- **Project name** — press Enter to use the directory name
- **Bot token** — create a bot in Telegram via @BotFather (send /newbot, choose a name and username, copy the token)

The token is validated instantly — if it's wrong, you can re-paste. Once valid, the daemon starts automatically and confirms the bot is connected.

### Adding more projects

Repeat this step for each project. Each project gets its own bot. If the daemon is already running, new bots are added via hot-reload — no restart needed.

---

## Step 4: Open Telegram and start coding

1. Open Telegram on your phone
2. Search for your bot's username
3. Tap **Start**
4. Send a message like: "What does this project do?"
5. You'll see "Working..." then Claude's response

**That's it — you're up and running!**

---

## What you can do

### Text messages
Just type normally. Claude sees your full project and works on it.

### Voice notes
Hold the mic button in Telegram and speak. Your voice is transcribed locally on your Mac and sent to Claude.

### Images
Send a screenshot or photo. Claude can see and analyze it.

### Documents
Send a file. Claude can read and process it.

### Commands

| Command | What it does |
|---|---|
| `/help` | Show all commands |
| `/new` | Start a fresh Claude session |
| `/cancel` | Stop what Claude is doing |
| `/model opus` | Switch to a more powerful model |
| `/status` | See project info, tokens, and context usage |
| `/cost` | See session cost and token breakdown |
| `/undo` | Revert last file changes |
| `/diff` | Show uncommitted changes and recent commits |
| `/sessions` | List past sessions (tap any to resume) |
| `/handoff` | Get a CLI command to continue in Claude Code |

### Live feedback while Claude works

- **Thinking preview** — Claude's extended reasoning shown live with a brain icon
- **Streaming text** — response text appears as it's generated
- **Tool progress** — elapsed time shown during long-running operations
- **Subagent status** — notifications when Claude spawns and completes subagents

After each response, a usage footer shows tokens used and cost:
```
12.5k in · 3.2k out · 8.1k cached · $0.0234
```

### Permission approvals
When Claude wants to edit files, run commands, etc., you get buttons:

- **Allow** — approve once
- **Always** — approve this tool for the rest of the session
- **Deny** — reject

---

## Optional: Auto-start on login

So you don't have to manually run `vibemote start` every time:

```bash
vibemote install
```

To remove auto-start:

```bash
vibemote uninstall
```

---

## CLI reference

```bash
vibemote setup           # First-time setup
vibemote add <path>      # Register a project with a bot
vibemote remove <name>   # Remove a project
vibemote list            # See all your projects
vibemote status          # Daemon and bot status
vibemote start           # Start the daemon
vibemote stop            # Stop the daemon
vibemote restart         # Restart the daemon
vibemote logs [name]     # Tail logs (daemon or specific project)
vibemote doctor          # Health check
vibemote token-update <name>  # Update a project's bot token
vibemote install         # Auto-start on login
vibemote uninstall       # Remove auto-start
```

---

## Troubleshooting

**Bot doesn't respond?**
- Run `vibemote status` — check if daemon is running and bot token is valid
- Run `vibemote logs <project-name>` — look for errors
- Verify your Telegram user ID: `vibemote doctor`

**Voice notes not working?**
- Run `vibemote doctor` — checks ffmpeg and whisper model
- The whisper model downloads on first use — check logs for progress

**Need to change a bot token?**
```bash
vibemote token-update my-project
```

**Want to change other settings?**
Edit `~/.vibemote/config.json` directly, then `vibemote restart`.
