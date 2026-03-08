# Getting Started with claude-control

A step-by-step walkthrough. Follow each step in order.

---

## What you'll need

- Your Mac (the one with your projects)
- Your phone with Telegram installed
- ~10 minutes

No accounts to create, no services to sign up for. BotFather is a built-in Telegram feature — you just message it like a regular contact.

---

## Part 1: Install dependencies

### Step 1: Check Node.js

Open Terminal and run:

```bash
node --version
```

You need v22 or higher. If you don't have it:

```bash
brew install node
```

### Step 2: Install ffmpeg

This is needed for voice note transcription:

```bash
brew install ffmpeg
```

### Step 3: Check Claude Code is logged in

```bash
claude auth status
```

If it says you're not authenticated:

```bash
claude auth login
```

This uses your Max subscription — no API key needed.

### Step 4: Build claude-control

```bash
cd /Users/tlabropoulos/Documents/git/claude-control
npm install
npm run build
npm link
```

After `npm link`, the `claude-control` command works from anywhere in your terminal.

Verify it works:

```bash
claude-control --version
```

Should print `0.1.0`.

---

## Part 2: Get your Telegram user ID

claude-control needs your Telegram user ID to know who's allowed to talk to the bots. This prevents random people from controlling your projects.

### Step 5: Message @userinfobot

1. Open **Telegram** on your phone
2. Tap the search icon at the top
3. Search for **userinfobot**
4. Tap on **@userinfobot** (it has a blue checkmark)
5. Tap **Start** or send `/start`
6. It replies with something like:

```
Id: 123456789
First: Your Name
Lang: en
```

7. **Copy the number after "Id:"** — you'll need it in the next step

---

## Part 3: Initialize claude-control

### Step 6: Run init

Back in your terminal:

```bash
claude-control init
```

It asks two things:

**"Your Telegram user ID:"**
Paste the number from step 5 (e.g., `123456789`)

**"Whisper model (base):"**
Just press Enter to accept `base`. This is the model for voice note transcription. It downloads automatically the first time you send a voice note (~150MB).

You should see:
```
Config saved to ~/.claude-control/config.json
```

---

## Part 4: Create a Telegram bot for your project

Each project gets its own Telegram bot. You create bots through **@BotFather** — Telegram's built-in bot for managing bots. It's free and instant.

### Step 7: Start a chat with BotFather

1. Open **Telegram** on your phone
2. Search for **BotFather**
3. Tap on **@BotFather** (it has a blue checkmark and says "official")
4. Tap **Start** (or send `/start` if you've used it before)

BotFather replies with a list of commands.

### Step 8: Create a new bot

Send this message to BotFather:

```
/newbot
```

BotFather asks: **"Alright, a new bot. How are we going to call it? Please choose a name for your bot."**

### Step 9: Choose a display name

Type a name like:

```
My SaaS - Claude
```

This is what shows up in your Telegram chat list. Use something that tells you which project it is. You can change this later.

### Step 10: Choose a username

BotFather asks: **"Good. Now let's choose a username for your bot. It must end in 'bot'."**

Type something like:

```
my_saas_claude_bot
```

Rules:
- Must end in `bot`
- Only letters, numbers, and underscores
- Must be unique across all of Telegram

If your first choice is taken, try adding numbers: `my_saas_claude_42_bot`

### Step 11: Copy the bot token

BotFather replies with something like:

```
Done! Congratulations on your new bot. You will find it at t.me/my_saas_claude_bot.

Use this token to access the HTTP API:
7123456789:AAHfGxKiLM8e7R3Q5p_xxxxxxxxxxx

Keep your token secure and store it safely.
```

**Copy that long token** (the line that looks like `7123456789:AAHf...`). You need it in the next step.

> Tip: On your phone, long-press the token to copy it. You can also message it to yourself ("Saved Messages" in Telegram) and copy it on your Mac.

---

## Part 5: Register your project

### Step 12: Add the project

```bash
claude-control add /path/to/your/project
```

Replace `/path/to/your/project` with the actual path. For example:

```bash
claude-control add ~/Documents/git/my-saas
```

It asks:

**"Project name (my-saas):"**
Press Enter to use the directory name, or type a custom name.

**"Bot token:"**
Paste the token from step 11.

You should see:
```
Project "my-saas" registered.
```

### Want to add more projects?

Repeat steps 7-12 for each project. Each project gets its own bot — your Telegram chat list becomes a project dashboard.

---

## Part 6: Start it up

### Step 13: Run the health check

```bash
claude-control doctor
```

You should see mostly green checkmarks. The whisper model might show as missing — that's fine, it downloads automatically on first voice note.

### Step 14: Start the daemon

```bash
claude-control start
```

You should see:
```
Daemon started (PID: 12345)
1 project bot(s) launching...
```

### Step 15: Test it in Telegram

1. Open **Telegram** on your phone
2. Search for your bot's username (e.g., `my_saas_claude_bot`)
3. Tap **Start**
4. You should see: **"My SaaS - Claude Control. Send me a message and I'll pass it to Claude."**
5. Send a message like: **"What does this project do?"**
6. You'll see "Working..." then Claude's response

**That's it — you're up and running!**

---

## What you can do now

### Text messages
Just type normally. Claude sees your full project and works on it.

### Voice notes
Hold the mic button in Telegram and speak. Your voice is transcribed locally on your Mac and sent to Claude.

### Images
Send a screenshot or photo. Claude can see and analyze it.

### Documents
Send a file. Claude can read and process it.

### Commands
Type these in the chat:

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

### Live feedback while Claude works

While Claude processes your message, you'll see real-time updates:

- **Thinking preview** -- Claude's extended reasoning shown live with a brain icon
- **Streaming text** -- response text appears as it's generated
- **Tool progress** -- elapsed time shown during long-running operations (e.g., "Bash running... 12s")
- **Subagent status** -- notifications when Claude spawns and completes subagents

After each response, a usage footer shows tokens used and cost:
```
12.5k in · 3.2k out · 8.1k cached · $0.0234
```

When the context window fills up, you'll see a warning:
```
Context 82% full — consider /new
```

Claude also suggests a follow-up action as a tappable button you can tap to send instantly.

### Permission approvals
When Claude wants to edit files, run commands, etc., you get a popup with buttons:

- **Allow** -- approve once
- **Always** -- approve this tool for the rest of the session
- **Deny** -- reject

---

## Optional: Auto-start on login

So you don't have to manually run `claude-control start` every time:

```bash
claude-control install
```

This makes claude-control start automatically when you log into your Mac and restart if it crashes.

To remove auto-start:

```bash
claude-control uninstall
```

---

## Quick reference

```bash
claude-control list        # See all your projects
claude-control status      # Is the daemon running?
claude-control logs        # See what's happening (Ctrl+C to stop)
claude-control logs my-saas  # Logs for a specific project
claude-control stop        # Stop the daemon
claude-control restart     # Restart after config changes
claude-control remove my-saas  # Remove a project
claude-control doctor      # Health check
```

---

## Troubleshooting

**Bot doesn't respond?**
- Check daemon is running: `claude-control status`
- Check logs: `claude-control logs`
- Make sure your Telegram user ID is correct in `~/.claude-control/config.json`

**Voice notes not working?**
- Check ffmpeg: `ffmpeg -version`
- The whisper model downloads on first use — check `claude-control logs` for progress

**Want to change settings?**
Edit `~/.claude-control/config.json` directly, then `claude-control restart`.

For the full reference, see [SETUP.md](SETUP.md).
