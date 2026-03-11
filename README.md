<p align="center">
  <img src="assets/disclaw_logo.png" alt="disclaw mascot" width="200">
</p>

# disclaw

Remote Claude Code control via Discord. Run Claude as a daemon and interact with your projects from anywhere through Discord channels.

---

## Features

- **One channel per project** - each project gets its own Discord channel, with a single bot managing them all
- **Images and documents** - send screenshots, photos, or files for Claude to analyze
- **Permission approval via buttons** - approve, always-approve, or deny tool usage with Discord buttons
- **Slash commands** - Discord-native command interface with autocomplete
- **Model and effort switching** - change models (sonnet, opus, haiku) and effort levels mid-conversation
- **Auto-start** - install as a systemd service (Linux), macOS LaunchAgent, or Windows scheduled task
- **Multi-turn conversations** - send multiple messages that get batched intelligently before sending to Claude
- **Session management** - list past sessions with tappable resume buttons, or hand off to Claude Code CLI
- **Live response streaming** - see Claude's response as it types, updated every few seconds
- **Thinking preview** - watch Claude's extended reasoning live before the response streams in
- **Tool progress heartbeats** - see elapsed time during long-running tool operations
- **Subagent notifications** - get notified when Claude spawns and completes subagents
- **Token usage tracking** - per-turn token counts (input/output/cached) and cost shown after every response
- **Context window monitoring** - see context usage percentage, with warnings at 80%+ to suggest starting fresh
- **Rate limit warnings** - proactive alerts when approaching or hitting rate limits
- **Context compaction status** - notification when Claude compacts session history
- **Prompt suggestions** - tappable button with Claude's suggested follow-up after each response
- **Typing indicator** - Discord shows "typing..." while Claude is working
- **Pinned responses** - Claude's last response is automatically pinned for easy reference
- **Git status notifications** - periodic alerts when your project has uncommitted changes
- **`/undo` and `/diff`** - revert file changes or view git status from the chat

---

## How It Works

disclaw runs a single daemon process with one [discord.js](https://discord.js.org/) client connected to your Discord server. Each registered project is mapped to a Discord channel. Messages in a project's channel are forwarded to the [Claude Agent SDK](https://github.com/anthropic-ai/claude-agent-sdk), which spawns Claude Code subprocesses scoped to the project directory.

Images and documents are downloaded to a temporary media directory and passed to Claude as file references, with automatic cleanup after 24 hours.

```
Discord --> discord.js client --> Claude Agent SDK --> Claude Code subprocess
                                                           |
                                                    (project directory)
```

---

## Quick Start

See [GETTING-STARTED.md](GETTING-STARTED.md) for a complete step-by-step walkthrough.

---

## Configuration

After running `disclaw setup`, the config file lives at `~/.disclaw/config.json`:

```json
{
  "discordBotToken": "MTIzNDU2Nzg5...",
  "discordGuildId": "123456789012345678",
  "authorizedUsers": ["123456789012345678"],
  "defaults": {
    "model": "claude-opus-4-6",
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
      "channelId": "123456789012345678"
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
| `defaults.model` | `"claude-opus-4-6"` | Default Claude model (`claude-opus-4-6`, `sonnet`, `haiku`, or any model ID) |
| `defaults.effort` | (not set) | Reasoning effort level: `low`, `medium`, `high`, or `max` |
| `defaults.thinking` | (not set) | Thinking mode: `adaptive`, `enabled`, or `disabled` |
| `defaults.permissionMode` | `"default"` | How tool permissions are handled: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`, or `dontAsk` |
| `defaults.allowedTools` | `["Read", "Glob", "Grep", "WebSearch"]` | Tools auto-approved without prompting |
| `defaults.settingSources` | `["project"]` | Where to load project settings from |
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
  "model": "opus",
  "permissionMode": "auto",
  "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep"]
}
```

---

## CLI Commands

| Command | Description |
|---|---|
| `disclaw setup` | First-time setup, configures Discord bot and server |
| `disclaw add <path>` | Register a project (auto-creates a Discord channel or use existing) |
| `disclaw start` | Start the daemon |
| `disclaw stop` | Stop the daemon |
| `disclaw restart` | Restart the daemon |
| `disclaw status` | Show daemon status and project info |
| `disclaw list` | List all registered projects with their settings |
| `disclaw remove <name>` | Unregister a project |
| `disclaw token-update` | Update the Discord bot token |
| `disclaw logs [name]` | Tail logs (daemon by default, or a specific project) |
| `disclaw doctor` | Health check for Node.js, config, auth, and daemon |
| `disclaw install` | Install auto-start (systemd / LaunchAgent / Task Scheduler) |
| `disclaw uninstall` | Remove auto-start |

---

## Discord Slash Commands

These commands are available in any project channel:

| Command | Description |
|---|---|
| `/new` | Start a fresh Claude session |
| `/help` | Show all available commands |
| `/cancel` | Interrupt the current operation |
| `/model <name>` | Switch model (`sonnet`, `opus`, `haiku`) |
| `/mode <mode>` | Switch permission mode (`auto`, `plan`, `default`) |
| `/undo` | Revert last file changes (uncommitted modifications) |
| `/diff` | Show uncommitted changes and recent commits |
| `/sessions` | List past sessions with resume buttons |
| `/resume <id>` | Resume a previous session by ID |
| `/handoff` | Get a `claude --resume` command to continue the session in Claude Code |
| `/status` | Show project info, model, session, token usage, and context window |
| `/cost` | Show session cost, token breakdown, cache hits, and context usage |

---

## Requirements

- **Linux, macOS, or Windows** - auto-start via systemd, LaunchAgent, or Task Scheduler
- **Node.js 22+**
- **Claude Code** with a Max subscription (the Agent SDK authenticates via your existing Claude Code login, no API key needed)
- **A Discord server** where you can add a bot

---

## Architecture

```
src/
├── bot/              # Discord bot layer
│   ├── discord-client.ts   # Discord.js client, event routing
│   ├── project-handler.ts  # Per-project orchestrator
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
├── daemon.ts         # Background daemon entry point
├── index.ts          # CLI entry point
└── tray.ts           # System tray entry point
```

---

## License

MIT
