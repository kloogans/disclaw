# vibemote

Remote Claude Code control via Telegram. Run Claude as a daemon on your Mac and interact with your projects from anywhere through dedicated Telegram bots.

---

## Features

- **One bot per project** -- each project gets its own Telegram bot, turning your chat list into a project dashboard
- **Voice notes** -- speak into Telegram and your voice is transcribed locally via whisper.cpp (no cloud transcription)
- **Images and documents** -- send screenshots, photos, or files for Claude to analyze
- **Permission approval via inline keyboards** -- approve, always-approve, or deny tool usage with tap-friendly buttons
- **Model and effort switching** -- change models (sonnet, opus, haiku) and effort levels mid-conversation
- **Auto-start** -- install as a macOS LaunchAgent, Linux systemd service, or Windows scheduled task that starts on login and auto-restarts on crash
- **Multi-turn conversations** -- send multiple messages that get batched intelligently before sending to Claude
- **Session management** -- list past sessions with tappable resume buttons, or hand off to Claude Code CLI
- **Live response streaming** -- see Claude's response as it types, updated every few seconds
- **Thinking preview** -- watch Claude's extended reasoning live (brain icon) before the response streams in
- **Tool progress heartbeats** -- see elapsed time during long-running tool operations
- **Subagent notifications** -- get notified when Claude spawns and completes subagents
- **Token usage tracking** -- per-turn token counts (input/output/cached) and cost shown after every response
- **Context window monitoring** -- see context usage percentage, with warnings at 80%+ to suggest starting fresh
- **Rate limit warnings** -- proactive alerts when approaching or hitting rate limits
- **Context compaction status** -- notification when Claude compacts session history
- **Prompt suggestions** -- tappable inline button with Claude's suggested follow-up after each response
- **Typing indicator** -- Telegram shows "typing..." while Claude is working
- **Pinned responses** -- Claude's last response is automatically pinned for easy reference
- **Git status notifications** -- periodic alerts when your project has uncommitted changes
- **`/undo` and `/diff`** -- revert file changes or view git status from the chat

---

## How It Works

vibemote runs a single daemon process that manages multiple [grammy](https://grammy.dev/) bot instances, one per registered project. Each bot listens for Telegram messages and forwards them to the [Claude Agent SDK](https://github.com/anthropic-ai/claude-agent-sdk), which spawns Claude Code subprocesses scoped to the project directory.

Voice notes are transcribed locally using [whisper.cpp](https://github.com/nicholasgcoles/smart-whisper) (via the smart-whisper package) -- audio never leaves your machine. Images and documents are downloaded to a temporary media directory and passed to Claude as file references, with automatic cleanup after 24 hours.

```
Telegram --> grammy bot --> Claude Agent SDK --> Claude Code subprocess
                                                     |
                                              (project directory)
```

---

## Quick Start

See [GETTING-STARTED.md](GETTING-STARTED.md) for a complete step-by-step walkthrough.

---

## Configuration

After running `vibemote setup`, the config file lives at `~/.vibemote/config.json`:

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
    "effort": "high",
    "thinking": "adaptive",
    "permissionMode": "default",
    "allowedTools": ["Read", "Glob", "Grep", "WebSearch"],
    "settingSources": ["project"],
    "maxTurns": null
  },
  "messageBatchDelayMs": 3000,
  "permissionTimeoutMs": 300000,
  "maxResponseChars": 50000,
  "projects": [
    {
      "name": "my-saas",
      "path": "/path/to/my-saas",
      "botToken": "7123456789:AAHf..."
    }
  ]
}
```

### Option Reference

| Option | Default | Description |
|---|---|---|
| `authorizedUsers` | `[]` | Array of Telegram user IDs allowed to interact with bots |
| `defaults.model` | `"sonnet"` | Default Claude model (`sonnet`, `opus`, `haiku`) |
| `defaults.effort` | (not set) | Reasoning effort level: `low`, `medium`, `high`, or `max` |
| `defaults.thinking` | (not set) | Thinking mode: `adaptive`, `enabled`, or `disabled` |
| `defaults.permissionMode` | `"default"` | How tool permissions are handled: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`, or `dontAsk` |
| `defaults.allowedTools` | `["Read", "Glob", "Grep", "WebSearch"]` | Tools auto-approved without prompting |
| `defaults.settingSources` | `["project"]` | Where to load project settings from |
| `defaults.maxTurns` | (not set) | Maximum number of conversation turns per request |
| `whisper.model` | `"base"` | Whisper model size: `tiny`, `base`, `small`, `medium`, `large` |
| `whisper.gpu` | `true` | Use GPU acceleration for transcription |
| `whisper.language` | `"auto"` | Language for transcription, or `"auto"` for detection |
| `messageBatchDelayMs` | `3000` | Delay in ms to batch multiple messages before sending to Claude |
| `permissionTimeoutMs` | `300000` | Timeout in ms before a permission request is auto-denied (5 minutes) |
| `maxResponseChars` | `50000` | Maximum characters in a single Telegram response |

### Per-Project Overrides

Any project entry can override `model`, `permissionMode`, and `allowedTools`:

```json
{
  "name": "my-saas",
  "path": "/path/to/my-saas",
  "botToken": "7123456789:AAHf...",
  "model": "opus",
  "permissionMode": "auto",
  "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep"]
}
```

---

## CLI Commands

| Command | Description |
|---|---|
| `vibemote setup` | First-time setup — check prerequisites, configure user ID and whisper model |
| `vibemote add <path>` | Register a project with a new Telegram bot |
| `vibemote start` | Start the daemon (launches all project bots) |
| `vibemote stop` | Stop the daemon |
| `vibemote restart` | Restart the daemon |
| `vibemote status` | Show daemon PID and running state |
| `vibemote list` | List all registered projects with their settings |
| `vibemote remove <name>` | Unregister a project |
| `vibemote token-update <name>` | Update a project's Telegram bot token |
| `vibemote logs [name]` | Tail logs (daemon by default, or a specific project) |
| `vibemote doctor` | Health check -- verify Node.js, config, ffmpeg, whisper, auth, daemon |
| `vibemote install` | Install auto-start (LaunchAgent / systemd / Task Scheduler) |
| `vibemote uninstall` | Remove auto-start |

---

## Telegram Commands

These commands are available inside each project's Telegram bot chat:

| Command | Description |
|---|---|
| `/start` | Initialize the bot and show welcome message |
| `/new` | Start a fresh Claude session |
| `/help` | Show all available commands |
| `/cancel` | Interrupt the current operation |
| `/model <name>` | Switch model (`sonnet`, `opus`, `haiku`) |
| `/mode <mode>` | Switch permission mode (`auto`, `plan`, `default`) |
| `/undo` | Revert last file changes (uncommitted modifications) |
| `/diff` | Show uncommitted changes and recent commits |
| `/sessions` | List past sessions with tappable resume buttons |
| `/resume <id>` | Resume a previous session by ID |
| `/handoff` | Get a `claude --resume` command to continue the session in Claude Code |
| `/status` | Show project info, model, session, token usage, and context window |
| `/cost` | Show session cost, token breakdown, cache hits, and context usage |

---

## Requirements

- **macOS, Linux, or Windows** -- auto-start via LaunchAgent (macOS), systemd (Linux), or Task Scheduler (Windows)
- **Node.js 22+** -- required for the runtime
- **Claude Code** with a Max subscription -- the Agent SDK authenticates via your existing Claude Code login (no API key needed)
- **ffmpeg** -- required for voice note transcription (`brew install ffmpeg`)

---

## License

MIT
