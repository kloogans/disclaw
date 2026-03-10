# Phase 1: Discord Migration Foundation

## Status: COMPLETE

All Phase 1 files typecheck clean. Remaining errors are in Phase 2+ files
that still reference grammy/botToken/escapeHtml (expected).

## Steps

### Step 1: Dependencies ✅
- [x] Remove `grammy`, `@grammyjs/auto-retry` from package.json
- [x] Add `discord.js` ^14.18.0
- [x] Update description text
- Note: `smart-whisper` native build fails on this system (node-gyp / node 24). Pre-existing issue, not caused by our changes.

### Step 2: Config/Types ✅
- [x] `types.ts`: Add `discordBotToken`, `discordGuildId` to AppConfig
- [x] `types.ts`: Change `authorizedUsers` from `number[]` to `string[]`
- [x] `types.ts`: Replace `botToken` with `channelId` in ProjectConfig
- [x] `types.ts`: Update DEFAULT_CONFIG with new fields
- [x] `store.ts`: No changes needed (spread merge handles new fields automatically)

### Step 3: Formatting ✅
- [x] Replace `escapeHtml` with `escapeMarkdown` (escapes Markdown special chars)
- [x] Replace `markdownToTelegramHtml` with `formatForDiscord` (near pass-through — Discord renders MD natively)
- [x] Update `formatToolUse` to use Markdown backticks instead of HTML `<code>` tags

### Step 4: Chunker ✅
- [x] Change limit from 4096 → 2000 (Discord's limit)
- [x] Remove HTML tag balancing (`balanceHtmlTags`)
- [x] Add Markdown code-block-aware splitting (`balanceCodeBlocks`) — closes/reopens triple-backtick fences across chunk boundaries

### Step 5: Media ✅
- [x] `images.ts`: Replace grammy `Context` param with `ImageAttachment` interface (`{ url, name?, contentType? }`) — uses direct `fetch()` instead of Telegram's two-step file API
- [x] `documents.ts`: Replace grammy `Context` param with `DocumentAttachment` interface (`{ url, name? }`) — same direct `fetch()` pattern
- [x] `transcriber.ts`: Updated comment only — core logic unchanged (audio buffer in, text out)

## Exported API Changes (for Phase 2 consumers)

| File | Old export | New export |
|------|-----------|------------|
| `formatting.ts` | `escapeHtml(text)` | `escapeMarkdown(text)` |
| `formatting.ts` | `markdownToTelegramHtml(text)` | `formatForDiscord(text)` |
| `formatting.ts` | `formatToolUse(name, input)` → HTML | `formatToolUse(name, input)` → Markdown |
| `chunker.ts` | `chunkMessage(text, max=4046)` | `chunkMessage(text, max=1950)` |
| `images.ts` | `downloadImage(ctx: Context, path)` | `downloadImage(attachment: ImageAttachment, path)` |
| `documents.ts` | `downloadDocument(ctx: Context, path)` | `downloadDocument(attachment: DocumentAttachment, path)` |
| `types.ts` | `ProjectConfig.botToken` | `ProjectConfig.channelId` |
| `types.ts` | `AppConfig.authorizedUsers: number[]` | `AppConfig.authorizedUsers: string[]` |
| `types.ts` | (none) | `AppConfig.discordBotToken`, `AppConfig.discordGuildId` |

## Known Ripple Effects (Phase 2+ files that need updating)
- `src/bot/project-bot.ts` — imports grammy, old formatting exports, old chunker, botToken
- `src/bot/commands.ts` — imports grammy, escapeHtml, authorizedUsers as number
- `src/daemon.ts` — references botToken for hot-reload comparison
- `src/cli/add.ts` — sets botToken in ProjectConfig
- `src/cli/setup.ts` — sets authorizedUsers as number[]
- `src/cli/doctor.ts` — validates botToken per project
- `src/cli/token-update.ts` — updates botToken
- `src/index.ts` — reads botToken for status display
