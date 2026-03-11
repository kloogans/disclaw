# Getting Started with disclaw

A step-by-step walkthrough. Follow each step in order.

---

## What you'll need

- A machine with your projects (Linux, macOS, or Windows)
- A Discord account and a server you control
- Node.js 22+ and Claude Code authenticated
- ~10 minutes

---

## Step 1: Install disclaw

```bash
npm install -g disclaw
```

Verify it works:

```bash
disclaw --version
```

> **Building from source?** Clone the repo, run `npm install && npm run build && npm link`.

---

## Step 2: Run setup

```bash
disclaw setup
```

This checks prerequisites (Node.js, Claude Code auth), then walks you through:

1. **Discord bot token** - create a bot in the [Discord Developer Portal](https://discord.com/developers/applications):
   - New Application → Bot tab → Reset Token → copy it
   - Enable **Message Content Intent** under Privileged Gateway Intents
   - OAuth2 → URL Generator → select "bot" scope → select permissions (Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Use Slash Commands, Manage Channels)
   - Open the generated URL to invite the bot to your server

2. **Server (guild) ID** - enable Developer Mode (User Settings → Advanced), right-click your server name → Copy Server ID

3. **Your Discord user ID** - right-click your profile → Copy User ID

If any prerequisites fail, setup tells you exactly what to install.

---

## Step 3: Add a project

```bash
disclaw add ~/path/to/your/project
```

This asks for:

- **Project name** - press Enter to use the directory name
- **Channel setup** - choose to auto-create a new channel (recommended) or enter an existing channel ID

The daemon starts automatically and confirms the bot is connected to Discord.

### Adding more projects

Repeat this step for each project. Each project gets its own channel. If the daemon is already running, new projects are added via hot-reload, no restart needed.

---

## Step 4: Open Discord and start coding

1. Open Discord (desktop or mobile)
2. Go to the channel created for your project
3. Send a message like: "What does this project do?"
4. You'll see "Working..." then Claude's response

**That's it, you're up and running!**

---

## What you can do

### Text messages
Just type normally. Claude sees your full project and works on it.

### Images
Send a screenshot or photo. Claude can see and analyze it.

### Documents
Send a file. Claude can read and process it.

### Slash commands

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
| `/sessions` | List past sessions (click any to resume) |
| `/handoff` | Get a CLI command to continue in Claude Code |

### Live feedback while Claude works

- **Thinking preview** - Claude's extended reasoning shown live with a brain icon
- **Streaming text** - response text appears as it's generated
- **Tool progress** - elapsed time shown during long-running operations
- **Subagent status** - notifications when Claude spawns and completes subagents

After each response, a usage footer shows tokens used and cost:
```
12.5k in · 3.2k out · 8.1k cached · $0.0234
```

### Permission approvals
When Claude wants to edit files, run commands, etc., you get buttons:

- **Allow** - approve once
- **Always** - approve this tool for the rest of the session
- **Deny** - reject

---

## Optional: Auto-start on login

So you don't have to manually run `disclaw start` every time:

```bash
disclaw install
```

To remove auto-start:

```bash
disclaw uninstall
```

---

## CLI reference

```bash
disclaw setup           # First-time setup
disclaw add <path>      # Register a project with a channel
disclaw remove <name>   # Remove a project
disclaw list            # See all your projects
disclaw status          # Daemon and bot status
disclaw start           # Start the daemon
disclaw stop            # Stop the daemon
disclaw restart         # Restart the daemon
disclaw logs [name]     # Tail logs (daemon or specific project)
disclaw doctor          # Health check
disclaw token-update    # Update the Discord bot token
disclaw install         # Auto-start on login
disclaw uninstall       # Remove auto-start
```

---

## Troubleshooting

**Bot doesn't respond?**
- Run `disclaw status` to check if the daemon is running and the bot token is valid.
- Run `disclaw logs <project-name>` and look for errors.
- Make sure **Message Content Intent** is enabled in the Discord Developer Portal
- Verify your Discord user ID: `disclaw doctor`

**Slash commands not showing up?**
- Guild-scoped commands should appear instantly. Try restarting the daemon: `disclaw restart`
- Make sure the bot has "Use Slash Commands" permission in your server

**Need to update the bot token?**
```bash
disclaw token-update
```

**Want to change other settings?**
Edit `~/.disclaw/config.json` directly, then `disclaw restart`.
