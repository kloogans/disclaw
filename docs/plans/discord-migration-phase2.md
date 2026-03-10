# Phase 2: Core Bot Architecture Rewrite

## Status: COMPLETE

All Phase 2 files typecheck clean. Remaining 6 errors are in CLI files (Phase 3).

## Steps

### Step 1: discord-client.ts (NEW) ✅
- [x] Single Discord.js Client managing all projects
- [x] Message routing by channelId → ProjectHandler
- [x] Interaction routing (slash commands, buttons, select menus)
- [x] Guild-scoped slash command registration via REST API
- [x] Lifecycle: start/stop, addProject/removeProject
- [x] Channel resolution on client ready + late additions

### Step 2: project-handler.ts (NEW, replaces project-bot.ts) ✅
- [x] Extracted all session logic from old ProjectBot
- [x] Message sending via Discord TextChannel API
- [x] Permission buttons → Discord ButtonBuilder + ActionRowBuilder
- [x] Typing indicator (channel.sendTyping, 9s interval vs Telegram's 4s)
- [x] Stream updates via message.edit()
- [x] Media: voice (audio attachments), photos (image attachments), documents
- [x] Prompt suggestion as Discord Button
- [x] Session resume as Buttons (≤5) or StringSelectMenu (>5)
- [x] /undo, /diff output as Markdown (code blocks) instead of HTML
- [x] Long responses sent as AttachmentBuilder file

### Step 3: commands.ts (REWRITE) ✅
- [x] 12 SlashCommandBuilder definitions with typed options
- [x] handleSlashCommand dispatcher with ChatInputCommandInteraction
- [x] isAuthorized checks Discord user ID (string) against config
- [x] /sessions uses deferReply for async work
- [x] /undo, /diff use deferReply for async git operations

### Step 4: daemon.ts (REWRITE) ✅
- [x] Single DiscordBot instead of N ProjectBot instances
- [x] Hot-reload: diff channelIds, add/remove handlers
- [x] Full restart if discordBotToken or discordGuildId changes
- [x] Recovery with exponential backoff wraps single client
- [x] Validates discordBotToken exists before starting

### Step 5: Supporting changes ✅
- [x] system-prompt.ts: "Telegram on mobile" → "Discord, possibly on mobile"
- [x] secrets.ts: "Telegram is not E2E encrypted" → "Discord is not E2E encrypted"
- [x] Deleted project-bot.ts

## Architecture

```
daemon.ts
  └── DiscordBot (discord-client.ts)
        ├── Discord.js Client (single, with intents: Guilds, GuildMessages, MessageContent)
        ├── Slash command registration (guild-scoped via REST API)
        ├── Event routing: MessageCreate → handler by channelId
        ├── Event routing: InteractionCreate → handler by channelId
        └── ProjectHandler[] (project-handler.ts)
              ├── SessionManager (unchanged from Telegram version)
              ├── MessageBatcher (unchanged)
              ├── Permission callbacks (Discord Buttons in ActionRows)
              ├── Stream/thinking preview (message editing)
              └── All session state (cost, tokens, git tracking, etc.)
```

## Remaining errors (Phase 3: CLI)
```
src/cli/add.ts        — botToken → channelId
src/cli/doctor.ts     — botToken → Discord token validation
src/cli/setup.ts      — authorizedUsers: number[] → string[]
src/cli/token-update.ts — per-project botToken → global discordBotToken
src/index.ts          — botToken references in status command
```
