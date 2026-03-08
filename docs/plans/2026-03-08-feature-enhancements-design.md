# Feature Enhancements Design

**Goal:** Add 8 UX enhancements to claude-control's Telegram bot experience.

**Architecture:** All changes are in existing modules. No new dependencies needed.

---

## Features

### 1. Typing Indicator
Send `typing` chat action every 4s while Claude is processing. Telegram auto-cancels after 5s, so we resend on interval. Clear on result/error.

### 2. Markdown Rendering Fixes
Add missing conversions to `markdownToTelegramHtml`: headings -> `<b>`, blockquotes -> `<blockquote>`, links -> `<a>`, lists (preserve), horizontal rules -> line separator.

### 3. /undo
Enable `enableFileCheckpointing` in SDK query options. Track last user message UUID from stream events. `/undo` calls `rewindFiles()` on a new query with `resume` to revert files.

Simpler fallback: run `git diff --name-only` after each interaction, store changed files, `/undo` runs `git checkout` on those files.

### 4. Conversation Starters
Register bot commands via `bot.api.setMyCommands()` on start so Telegram shows a command menu. Include all existing commands.

### 5. Progress Streaming
Enable `includePartialMessages` in SDK query. Accumulate text from `stream_event` content deltas. Throttle-edit the status message every 4 seconds with accumulated partial response. On result, delete streaming message and send final clean version.

### 6. Git Status Notifications
Run `git status --porcelain` and `git log --oneline -3` every 30 minutes per project. If uncommitted changes exist, send a notification. Track last-notified state to avoid spam.

### 7. Pin Messages
After sending Claude's final response, pin the last message. Use `bot.api.pinChatMessage()` with `disable_notification: true` to avoid noise.

### 8. /diff
Run `git diff --stat` in the project directory. Format output as a code block and send. Add `git log --oneline -5` for context.

---

## Files Modified

- `src/bot/formatting.ts` — markdown fixes
- `src/bot/commands.ts` — /diff, /undo, conversation starters
- `src/bot/project-bot.ts` — typing, streaming, pin, git notifications
- `src/claude/session-manager.ts` — streaming events, file checkpointing
