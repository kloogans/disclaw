# Contributing to Vibemote

Thanks for your interest in contributing! Here's how to get started.

## Setup

1. **Prerequisites:** Node.js 22+, a Discord bot token, and Claude API access.
2. **Clone and install:**
   ```bash
   git clone https://github.com/james/vibemote.git
   cd vibemote
   npm install
   ```
3. **Build:**
   ```bash
   npm run build
   ```
4. **Run setup:**
   ```bash
   node dist/index.js setup
   ```

## Development workflow

```bash
npm run dev        # watch mode (rebuilds on change)
npm run build      # production build
npm run typecheck  # TypeScript type checking
npm run lint       # ESLint
npm run format     # Prettier auto-format
npm run test       # Vitest unit tests
```

## Pull request guidelines

- **One concern per PR.** Bug fixes, features, and refactors should be separate.
- **Write tests** for new pure functions (utils, formatting, config logic).
- **Run the full check suite** before submitting:
  ```bash
  npm run build && npm run typecheck && npm run lint && npm run test
  ```
- **Keep commits focused.** Use conventional commit messages (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- **Don't introduce new `as any` casts** without justification. Use type guards from `src/claude/sdk-types.ts` for SDK interop.

## Code style

- TypeScript strict mode
- ESM imports (`.js` extensions in import paths)
- Prettier handles formatting (120 char line width)
- No default exports — use named exports

## Architecture overview

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

## Reporting issues

Use [GitHub Issues](https://github.com/james/vibemote/issues). Include:
- Node.js version (`node --version`)
- Vibemote version (`vibemote --version` or check package.json)
- Steps to reproduce
- Relevant log output (`vibemote logs <project>`)
