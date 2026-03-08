# claude-control Design Document

**Date:** 2026-03-08
**Status:** Approved

## Overview

A TypeScript daemon that gives each project its own Telegram bot for remote Claude Code control from mobile. Messages flow from Telegram through the Claude Agent SDK to Claude, which works on the codebase autonomously. Voice notes transcribed locally via whisper.cpp, images handled natively, permissions routed to the phone as interactive buttons.

## Architecture

```
┌──────────────┐
│   Your Phone │
│  (Telegram)  │
└──────┬───────┘
       │ Telegram Bot API (Long Polling)
       │
┌──────▼──────────────────────────────────┐
│         Your MacBook                     │
│                                          │
│  ┌─────────────┐   claude-control CLI    │
│  │ Main Daemon │──── add / remove / list │
│  └──────┬──────┘    start / stop         │
│         │ manages instances              │
│   ┌─────┼──────────────┐                 │
│   │     │              │                 │
│  ┌▼──┐ ┌▼──┐       ┌──▼┐                │
│  │Bot│ │Bot│  ...  │Bot│  grammY bots    │
│  │ A │ │ B │       │ N │  (one per proj) │
│  └─┬─┘ └─┬─┘       └──┬┘                │
│    │     │             │                 │
│  ┌─▼─┐ ┌─▼─┐       ┌──▼┐                │
│  │SDK│ │SDK│       │SDK│  Claude Agent   │
│  │   │ │   │       │   │  SDK sessions   │
│  └───┘ └───┘       └───┘                 │
│                                          │
│  ┌──────────┐                            │
│  │ Whisper  │  smart-whisper (shared)     │
│  │ (Metal)  │  loaded once in memory     │
│  └──────────┘                            │
└──────────────────────────────────────────┘
```

**Key decisions:**
- One Telegram bot per project (true isolation, Telegram chat list = project dashboard)
- Single daemon process (shared whisper model, single LaunchAgent to supervise)
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) not raw CLI subprocess
- Long polling (no public URL needed, works behind NAT)
- Local whisper.cpp via `smart-whisper` (zero cost, Metal GPU on Apple Silicon)

## Tech Stack

| Component | Choice | Version |
|---|---|---|
| Runtime | Node.js LTS | 24.x ("Krypton") |
| Language | TypeScript | 5.7+ |
| Telegram | grammY | 1.41+ |
| Claude integration | @anthropic-ai/claude-agent-sdk | latest |
| Voice transcription | smart-whisper (whisper.cpp) | 0.8+ |
| CLI framework | commander | 13+ |
| Logging | pino + pino-roll | 9+ |
| Build | tsup | latest |

## Claude Agent SDK Integration

### Core Pattern

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const session = query({
  prompt: userMessage,
  options: {
    cwd: project.path,
    model: project.model ?? "sonnet",
    permissionMode: project.permissionMode ?? "default",
    allowedTools: project.allowedTools ?? ["Read", "Glob", "Grep"],
    settingSources: ["project"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: "The user is communicating via Telegram on mobile. Keep responses concise. Telegram is not end-to-end encrypted — avoid outputting full secrets, API keys, or credentials. Mask sensitive values."
    },
    canUseTool: permissionHandler, // Routes to Telegram inline keyboards
  }
});

for await (const message of session) {
  // Route SDK messages to Telegram
}
```

### Multi-turn Conversations

Use `streamInput()` on the Query object for follow-up messages without restarting the session.

### Session Lifecycle

| Action | Implementation |
|---|---|
| `/new` | `session.close()`, create fresh `query()` |
| New message | `session.streamInput()` on existing query |
| `/resume <id>` | New `query()` with `options: { resume: sessionId }` |
| `/cancel` | `session.interrupt()` |
| `/model opus` | `session.setModel("opus")` |
| `/mode plan` | `session.setPermissionMode("plan")` |
| Process crash | Auto-restart with `query({ options: { resume: lastSessionId } })` |

### Permission Routing

The `canUseTool` callback intercepts permission requests and routes them to Telegram inline keyboards:

```
🔧 Claude wants to use: Bash
📝 Command: npm run test
┈┈┈┈┈┈┈┈┈┈
[✅ Allow]  [✅ Always]  [❌ Deny]
```

- "Always" adds a rule for the rest of the session
- Timeout: 5 minutes, then auto-deny
- Batch 3+ rapid requests into single approval message
- Stale button taps handled with "This request has expired"

## Telegram Bot Design

### Message Types

| Input | Processing |
|---|---|
| Text | Send directly to Claude via `streamInput()` |
| Voice note | Download .ogg → smart-whisper transcribe → send text with "(Transcribed from voice)" prefix |
| Image | Download → save to `.claude-control/media/` → reference path in prompt → Claude reads natively |
| Document | Download → save to `.claude-control/media/` → reference path in prompt |
| Other media | "I can handle text, voice notes, images, and documents." |

### Commands

| Command | Behavior | Timing |
|---|---|---|
| `/new` | Start fresh Claude session | Immediate (interrupts) |
| `/model <name>` | Switch model (sonnet, opus, haiku) | Queued |
| `/mode <mode>` | Switch permission mode (auto, plan, default) | Queued |
| `/cancel` | Interrupt current operation | Immediate |
| `/sessions` | List past sessions for this project | Immediate |
| `/resume <id>` | Resume a specific session | Immediate |
| `/status` | Git branch, session info, last cost | Immediate |
| `/cost` | Running cost total for this session | Immediate |
| `/help` | Show available commands | Immediate |

### Response Handling

- "Working..." placeholder sent immediately
- Tool use activity shown via message edits (throttled to 1 edit/3s)
- Under 4096 chars → single Telegram message (HTML parse mode)
- 4096-50000 chars → chunked at natural boundaries (paragraphs, code blocks)
- Over 50000 chars → sent as `.md` document attachment

### Message Batching

3-second batching window for rapid mobile input. Messages arriving while Claude is processing are queued and combined when the current turn completes.

## Process Management

### Single Daemon Architecture

- One Node.js process manages all project bots
- Whisper model loaded once, shared across bots
- PID file at `~/.claude-control/daemon.pid` prevents duplicates
- Last session IDs persisted at `~/.claude-control/state.json` for crash recovery

### CLI Commands

| Command | Action |
|---|---|
| `claude-control init` | First-time setup (user ID, whisper model download) |
| `claude-control add <path>` | Register project (BotFather walkthrough) |
| `claude-control remove <name>` | Unregister project |
| `claude-control list` | Show all registered projects |
| `claude-control start` | Start daemon (all bots) |
| `claude-control stop` | Stop daemon |
| `claude-control restart` | Stop + start |
| `claude-control status` | Show bot statuses, uptime |
| `claude-control logs [name]` | Tail logs (all or specific project) |
| `claude-control install` | Create macOS LaunchAgent (auto-start on login) |
| `claude-control uninstall` | Remove LaunchAgent |
| `claude-control doctor` | Health check (node, API key, whisper model) |

### macOS LaunchAgent

Generated by `claude-control install`:
- `~/Library/LaunchAgents/com.claude-control.daemon.plist`
- `RunAtLoad: true` — starts on login
- `KeepAlive: true` — restarts on crash
- Logs to `~/.claude-control/logs/`

## Security

### Authentication

- Telegram user ID whitelist in config
- Unauthorized messages silently dropped
- Group chats rejected (private only)

### Permission Tiers

1. **Auto-approved** — Tools in `allowedTools` run silently
2. **Routed to Telegram** — Everything else shows inline keyboard
3. **Blocked** — Tools in `disallowedTools` denied without prompt

### Credential Safety

- Config file chmod 600 (owner-only)
- Bot tokens never logged or sent to Claude
- System prompt warns Claude to mask secrets in responses
- Regex scanner on responses for common secret patterns (sk-, AKIA, ghp_, etc.)

## Configuration

### Config File: `~/.claude-control/config.json`

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
      "botToken": "123:ABC...",
      "model": "sonnet",
      "permissionMode": "auto",
      "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep"]
    }
  ]
}
```

### Per-Project Overrides

Each project can override `model`, `permissionMode`, and `allowedTools` from defaults.

## Edge Cases & Resilience

### Concurrency

- Messages during processing → queued, combined on turn completion
- `/cancel` in queue → fires `interrupt()` immediately, not queued
- Batched permission prompts for 3+ rapid requests
- Permission prompt timeout: 5 min default → auto-deny

### Process Recovery

- LaunchAgent restarts daemon on crash/wake
- Each bot resumes last session from `state.json`
- grammY long polling auto-reconnects
- `@grammyjs/auto-retry` handles Telegram rate limits

### Resource Management

- Whisper model shared (~150MB for base)
- Temp media cleaned up (voice: after transcription, images: after 24h)
- Log rotation: daily, keep 7 days
- Status update edits throttled to 1/3s

### Telegram Limits

- Message: 4096 chars → chunking
- File download: 20MB, URLs expire in 60min → download immediately
- Bot rate: 30 msg/s global, 1 msg/s per chat → auto-retry handles
- Edit rate: 20/s → throttled to 1/3s anyway

### Claude SDK

- Context compaction → notify user
- Model overload → fallback model support
- Budget limits → `maxBudgetUsd` per session
- API errors → clear Telegram messages with action items

## Project Structure

```
claude-control/
├── package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── index.ts                  # CLI entry (commander)
│   ├── daemon.ts                 # Main daemon
│   ├── cli/
│   │   ├── init.ts
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   ├── start.ts
│   │   ├── stop.ts
│   │   ├── restart.ts
│   │   ├── status.ts
│   │   ├── list.ts
│   │   ├── logs.ts
│   │   ├── install.ts
│   │   └── doctor.ts
│   ├── bot/
│   │   ├── project-bot.ts        # Core bot class (one per project)
│   │   ├── commands.ts           # Command handlers
│   │   ├── handlers.ts           # Message/media routing
│   │   ├── permissions.ts        # canUseTool → inline keyboard
│   │   ├── ask-user.ts           # AskUserQuestion → inline keyboard
│   │   └── formatting.ts        # Response → Telegram HTML + chunking
│   ├── claude/
│   │   ├── session-manager.ts    # query() lifecycle
│   │   ├── message-router.ts     # SDKMessage → Telegram action
│   │   └── system-prompt.ts      # Telegram-aware prompt additions
│   ├── media/
│   │   ├── transcriber.ts        # smart-whisper integration
│   │   ├── images.ts
│   │   ├── documents.ts
│   │   └── cleanup.ts
│   ├── config/
│   │   ├── store.ts
│   │   ├── state.ts
│   │   └── types.ts
│   └── utils/
│       ├── logger.ts
│       ├── chunker.ts
│       ├── throttle.ts
│       ├── batcher.ts
│       └── secrets.ts
└── templates/
    └── com.claude-control.daemon.plist
```

## Build Order (MVP)

| # | Feature | Description |
|---|---|---|
| 1 | Config + CLI foundation | `init`, `add`, `start`, `stop`, config store |
| 2 | Single project bot + text | Core loop: Telegram ↔ Claude Agent SDK |
| 3 | Session management | `/new`, `/sessions`, `/resume`, crash recovery |
| 4 | Permission routing | `canUseTool` → inline keyboards |
| 5 | Voice transcription | smart-whisper integration |
| 6 | Image + document support | Download, save, reference in prompt |
| 7 | Model/mode switching | `/model`, `/mode` commands |
| 8 | Response formatting | Chunking, status throttling, HTML |
| 9 | Message batching | 3s window, queue during processing |
| 10 | Multi-project | Daemon manages N bots |
| 11 | Operational CLI | `list`, `status`, `logs`, `remove`, `restart` |
| 12 | LaunchAgent | `install`/`uninstall`, auto-start |

## Future (v1.5+)

- AskUserQuestion → inline keyboards
- `/diff`, `/log`, `/commit` shortcuts
- Send files as Telegram documents
- Session summarization to memory
- Hot-reload config (SIGHUP)
- Budget tracking + `/cost`
- Fallback model auto-switching
- Secret detection warnings
- Scheduled tasks
- CI/CD webhook integration
- Multiple authorized users per project
- VPS deployment mode (webhooks)
