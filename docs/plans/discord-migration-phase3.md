# Phase 3: CLI Updates

## Status: COMPLETE

Zero typecheck errors. Build succeeds.

## Changes

### checks.ts ✅
- Replaced `validateBotToken` (Telegram API) with `validateDiscordToken` (Discord REST API `GET /users/@me`)
- `BotInfo.id` changed from `number` to `string` (Discord snowflakes)
- Updated ffmpeg install hint for Linux (pacman)

### setup.ts ✅
- 4-step setup flow: Discord bot token → guild ID → user ID → whisper model
- Includes full Discord Developer Portal instructions
- Validates token via Discord API
- Validates guild/user IDs are numeric snowflakes
- `authorizedUsers` stored as `string[]`

### add.ts ✅
- Auto-creates Discord channel via REST API (option 1)
- Falls back to manual channel ID entry (option 2)
- Validates channel ID is numeric snowflake
- Checks for duplicate channel assignments
- No more bot token per project

### token-update.ts ✅
- Now updates the global `discordBotToken` (no project argument)
- Uses `validateDiscordToken` for validation
- SIGHUP triggers full daemon restart (token changed)

### doctor.ts ✅
- Single Discord bot token check (not per-project)
- Guild ID presence check
- Per-project channel ID check
- No more Telegram API calls

### log-poller.ts ✅
- Changed event filter from `bot_connected` to `handler_ready` / `client_ready`

### index.ts ✅
- All descriptions updated (Telegram → Discord)
- `status` command validates single Discord token, shows channel IDs
- `token-update` no longer takes a project name argument
- `install`/`uninstall` descriptions genericized (systemd/launchd)
- `list` shows channel ID instead of bot info
