<p align="center">
  <img src="https://raw.githubusercontent.com/kloogans/disclaw/main/assets/disclaw_logo_full_circle.png" alt="disclaw" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/disclaw"><img src="https://img.shields.io/npm/v/disclaw" alt="npm version"></a>
  <a href="https://github.com/kloogans/disclaw/actions"><img src="https://img.shields.io/github/actions/workflow/status/kloogans/disclaw/ci.yml?branch=main" alt="build status"></a>
  <a href="https://www.npmjs.com/package/disclaw"><img src="https://img.shields.io/npm/dm/disclaw" alt="npm downloads"></a>
  <a href="https://github.com/kloogans/disclaw/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/disclaw" alt="license"></a>
</p>

Remote Claude Code control via Discord. Run Claude in the background and interact with your projects from anywhere through Discord channels.

---

## Features

- **One channel per project** - each project gets its own Discord channel (text or forum) with an independent Claude session
- **Thread support** - create Discord threads for parallel conversations, each with its own independent Claude session and context
- **Forum channels** - use forum channels where every conversation is a post/thread, great for organizing tasks, bugs, and features
- **Images and documents** - send screenshots, photos, or files for Claude to analyze
- **Permission approval via buttons** - approve, always-approve, or deny tool usage with Discord buttons
- **Slash commands** - Discord-native command interface with autocomplete
- **Model and effort switching** - change models (sonnet, opus, haiku) and effort levels mid-conversation
- **Auto-start** - install as a systemd service (Linux), macOS LaunchAgent, or Windows scheduled task
- **Multi-turn conversations** - send multiple messages that get batched intelligently before sending to Claude
- **Session management** - list past sessions with tappable resume buttons, hand off context, or continue in Claude Code CLI
- **Live response streaming** - see Claude's response as it types, updated every few seconds
- **Thinking preview** - watch Claude's extended reasoning live before the response streams in
- **Tool progress heartbeats** - see elapsed time during long-running tool operations
- **Subagent notifications** - get notified when Claude spawns and completes subagents
- **Context window tracking** - context window usage after every response, with warnings at 80%+
- **Rate limit warnings** - proactive alerts when approaching or hitting rate limits
- **Context compaction status** - notification when Claude compacts session history
- **Prompt suggestions** - tappable button with Claude's suggested follow-up after each response
- **Typing indicator** - Discord shows "typing..." while Claude is working
- **Session pinning** - session ID is pinned at the start of each session for easy reference
- **`/undo` and `/diff`** - revert file changes or view git status from the chat

---

## How It Works

disclaw runs a single background process with one [discord.js](https://discord.js.org/) client connected to your Discord server. Each registered project is mapped to a Discord channel, either a **text channel** or a **forum channel**. Messages are forwarded to the [Claude Agent SDK](https://github.com/anthropic-ai/claude-agent-sdk), which spawns Claude Code subprocesses scoped to the project directory.

Threads and forum posts each get their own independent Claude session with separate context, so you can run multiple parallel conversations per project. Thread handlers are created on first message and automatically cleaned up when threads are archived or deleted.

Images and documents are downloaded to a temporary media directory and passed to Claude as file references, with automatic cleanup after 24 hours.

```
Discord channel/thread --> discord.js client --> Claude Agent SDK --> Claude Code subprocess
                                                                           |
                                                                    (project directory)
```

---

## Quick Start

```bash
# Install
npm install -g disclaw

# First-time setup (Discord bot token, server ID, user ID)
disclaw setup

# Add a project (creates a Discord channel automatically)
disclaw add ~/path/to/your/project
```

disclaw starts automatically after adding your first project. Open Discord, go to the project channel (or create a post in forum channels), and send a message.

See [GETTING-STARTED.md](GETTING-STARTED.md) for a detailed walkthrough including Discord bot creation.

---

## Configuration

After running `disclaw setup`, the config file lives at `~/.disclaw/config.json`:

```json
{
  "discordBotToken": "MTIzNDU2Nzg5...",
  "discordGuildId": "123456789012345678",
  "authorizedUsers": ["123456789012345678"],
  "defaults": {
    "model": "claude-sonnet-4-6",
    "effort": "high",
    "thinking": "adaptive",
    "permissionMode": "default",
    "allowedTools": ["Read", "Glob", "Grep", "WebSearch"],
    "settingSources": ["user", "project"],
    "maxTurns": null
  },
  "messageBatchDelayMs": 3000,
  "permissionTimeoutMs": 300000,
  "maxResponseChars": 50000,
  "projects": [
    {
      "name": "my-saas",
      "path": "/path/to/my-saas",
      "channelId": "123456789012345678",
      "channelType": "text"
    }
  ]
}
```

### Option Reference

| Option | Default | Description |
|---|---|---|
| `discordBotToken` | `""` | Discord bot token (from Developer Portal) |
| `discordGuildId` | `""` | Discord server (guild) ID |
| `authorizedUsers` | `[]` | Array of Discord user ID strings allowed to interact with the bot |
| `defaults.model` | `"claude-sonnet-4-6"` | Default Claude model (`sonnet`, `opus`, `haiku`, or any model ID) |
| `defaults.effort` | (not set) | Reasoning effort level: `low`, `medium`, `high`, or `max` |
| `defaults.thinking` | (not set) | Thinking mode: `adaptive`, `enabled`, or `disabled` |
| `defaults.permissionMode` | `"default"` | How tool permissions are handled: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`, or `dontAsk` |
| `defaults.allowedTools` | `["Read", "Glob", "Grep", "WebSearch"]` | Tools auto-approved without prompting |
| `defaults.settingSources` | `["user", "project"]` | Where to load project settings from |
| `defaults.maxTurns` | (not set) | Maximum number of conversation turns per request |
| `messageBatchDelayMs` | `3000` | Delay in ms to batch multiple messages before sending to Claude |
| `permissionTimeoutMs` | `300000` | Timeout in ms before a permission request is auto-denied (5 minutes) |
| `maxResponseChars` | `50000` | Maximum characters before response is sent as a file attachment |

### Per-Project Overrides

Any project entry can override `model`, `permissionMode`, and `allowedTools`:

```json
{
  "name": "my-saas",
  "path": "/path/to/my-saas",
  "channelId": "123456789012345678",
  "channelType": "forum",
  "model": "opus",
  "permissionMode": "acceptEdits",
  "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep"]
}
```

---

## CLI Commands

| Command | Description |
|---|---|
| `disclaw setup` | First-time setup, configures Discord bot and server |
| `disclaw add <path>` | Register a project (auto-creates a text or forum channel, or use existing) |
| `disclaw start` | Start disclaw |
| `disclaw stop` | Stop disclaw |
| `disclaw restart` | Restart disclaw |
| `disclaw status` | Show status and project info |
| `disclaw list` | List all registered projects with their settings |
| `disclaw remove <name>` | Unregister a project |
| `disclaw token-update` | Update the Discord bot token |
| `disclaw logs [name]` | Tail logs (main process by default, or a specific project) |
| `disclaw doctor` | Health check for Node.js, config, auth, and connectivity |
| `disclaw install` | Install auto-start (systemd / LaunchAgent / Task Scheduler) |
| `disclaw uninstall` | Remove auto-start |

---

## Discord Slash Commands

These commands are available in any project channel, thread, or forum post:

| Command | Description |
|---|---|
| `/new` | Start a fresh Claude session |
| `/cancel` | Interrupt the current operation |
| `/model <name>` | Switch model (`sonnet`, `opus`, `haiku`) |
| `/mode <mode>` | Switch permission mode (`default`, `acceptEdits`, `plan`, `dontAsk`) |
| `/simplify` | Review and simplify recently changed code |
| `/review` | Review recent changes for bugs and issues |
| `/commit [message]` | Commit current changes with a generated or custom message |
| `/skill <name> [args]` | Run any Claude Code skill (e.g. `/skill frontend-design build a hero section`) |
| `/undo` | Revert last file changes (uncommitted modifications) |
| `/diff` | Show uncommitted changes and recent commits |
| `/sessions` | List past sessions with resume buttons |
| `/resume <id>` | Resume a previous session by ID |
| `/handoff` | Save session summary and hand off to a fresh context |
| `/resume-cli` | Get a `claude --resume` command to continue in Claude Code |
| `/status` | Show project info, model, session, token usage, and context window |
| `/cost` | Show session cost, token breakdown, cache hits, and context usage |
| `/ping` | Check if the bot is alive |
| `/help` | Show all available commands |

---

## Requirements

- **Linux, macOS, or Windows** - auto-start via systemd, LaunchAgent, or Task Scheduler
- **Node.js 22+**
- **Claude Code** authenticated (the Agent SDK uses your existing Claude Code login or API key)
- **A Discord server** where you can add a bot

---

## Architecture

```
src/
├── bot/              # Discord bot layer
│   ├── discord-client.ts   # Discord.js client, event routing, thread lifecycle
│   ├── project-handler.ts  # Per-channel/thread orchestrator
│   ├── stream-manager.ts   # Typing indicators, stream previews
│   ├── git-helpers.ts      # Git operations (diff, undo, status)
│   ├── usage-tracker.ts    # Cost and token tracking
│   ├── commands.ts         # Slash command definitions
│   └── formatting.ts       # Markdown formatting for Discord
├── claude/           # Claude Agent SDK integration
│   ├── session-manager.ts  # SDK query lifecycle
│   ├── sdk-types.ts        # Type guards for SDK messages
│   └── system-prompt.ts    # System prompt builder
├── cli/              # CLI commands (setup, add, start, stop, etc.)
├── config/           # Configuration and state management
├── media/            # Image and document handling
├── utils/            # Shared utilities (chunker, secrets, throttle)
├── daemon.ts         # Background process entry point
├── index.ts          # CLI entry point
├── version.ts        # Shared version constant
└── tray.ts           # System tray entry point
```

---

## License

MIT
