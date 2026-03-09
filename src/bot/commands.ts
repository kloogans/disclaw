import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { ProjectConfig, AppConfig } from "../config/types.js";
import { escapeHtml } from "./formatting.js";

const BOT_COMMANDS = [
  { command: "new", description: "Start a fresh session" },
  { command: "cancel", description: "Interrupt current operation" },
  { command: "model", description: "Switch model (sonnet, opus, haiku)" },
  { command: "mode", description: "Switch permission mode" },
  { command: "undo", description: "Revert last file changes" },
  { command: "diff", description: "Show recent git changes" },
  { command: "sessions", description: "List past sessions (tap to resume)" },
  { command: "resume", description: "Resume a session" },
  { command: "handoff", description: "Get CLI command to continue in Claude Code" },
  { command: "status", description: "Project and session info" },
  { command: "cost", description: "Session cost" },
  { command: "help", description: "Show all commands" },
];

export function registerCommands(
  bot: import("grammy").Bot,
  project: ProjectConfig,
  config: AppConfig,
  callbacks: {
    onNew: () => void;
    onCancel: () => void;
    onModelChange: (model: string) => void;
    onModeChange: (mode: string) => void;
    onSessionsList: () => Promise<{ text: string; sessions: { sessionId: string; summary: string }[] }>;
    onResume: (sessionId: string) => void;
    onHandoff: () => string | null;
    onUndo: () => Promise<string>;
    onDiff: () => Promise<string>;
    onStatus: () => string;
    onCost: () => string;
  },
): void {
  // Register command menu in Telegram
  bot.api.setMyCommands(BOT_COMMANDS).catch(() => {});

  bot.command("start", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(
      `\uD83D\uDE80 <b>${escapeHtml(project.name)}</b> \u2014 Vibemote\n\n` +
        `Send me a message and I'll pass it to Claude.\n` +
        `Use /help for available commands.`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("help", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(
      `<b>Commands:</b>\n\n` +
        `/new \u2014 Start a fresh session\n` +
        `/model &lt;name&gt; \u2014 Switch model (sonnet, opus, haiku)\n` +
        `/mode &lt;mode&gt; \u2014 Switch permission mode (auto, plan, default)\n` +
        `/cancel \u2014 Interrupt current operation\n` +
        `/undo \u2014 Revert last file changes\n` +
        `/diff \u2014 Show recent git changes\n` +
        `/sessions \u2014 List past sessions (tap to resume)\n` +
        `/resume &lt;id&gt; \u2014 Resume a session\n` +
        `/handoff \u2014 Get CLI command to continue in Claude Code\n` +
        `/status \u2014 Show project & session info\n` +
        `/cost \u2014 Show session cost\n` +
        `/help \u2014 This message`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("new", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    callbacks.onNew();
    await ctx.reply("\uD83C\uDD95 Starting fresh session...");
  });

  bot.command("cancel", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    callbacks.onCancel();
    await ctx.reply("\u274C Operation cancelled.");
  });

  bot.command("model", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const model = ctx.match?.trim();
    if (!model) {
      await ctx.reply("Usage: /model <name>\nOptions: sonnet, opus, haiku");
      return;
    }
    callbacks.onModelChange(model);
    await ctx.reply(`\uD83E\uDDE0 Model switched to <b>${escapeHtml(model)}</b>`, { parse_mode: "HTML" });
  });

  bot.command("mode", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const mode = ctx.match?.trim();
    if (!mode) {
      await ctx.reply("Usage: /mode <mode>\nOptions: auto, plan, default");
      return;
    }
    callbacks.onModeChange(mode);
    await ctx.reply(`\uD83D\uDD12 Permission mode: <b>${escapeHtml(mode)}</b>`, { parse_mode: "HTML" });
  });

  bot.command("undo", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const result = await callbacks.onUndo();
    await ctx.reply(result, { parse_mode: "HTML" });
  });

  bot.command("diff", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const result = await callbacks.onDiff();
    await ctx.reply(result, { parse_mode: "HTML" });
  });

  bot.command("sessions", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const { text, sessions } = await callbacks.onSessionsList();
    if (sessions.length === 0) {
      await ctx.reply(text, { parse_mode: "HTML" });
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const s of sessions) {
      const label = s.summary.length > 40 ? s.summary.slice(0, 37) + "..." : s.summary;
      keyboard.text(label, `resume:${s.sessionId}`).row();
    }
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.command("resume", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const sessionId = ctx.match?.trim();
    if (!sessionId) {
      await ctx.reply("Usage: /resume <session-id>\n\nTip: Use /sessions to get tappable resume buttons.");
      return;
    }
    callbacks.onResume(sessionId);
    await ctx.reply(`\u23EA Resuming session...`);
  });

  bot.command("handoff", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const sessionId = callbacks.onHandoff();
    if (!sessionId) {
      await ctx.reply("No active session to hand off.");
      return;
    }
    await ctx.reply(
      `\uD83D\uDCBB <b>Continue in Claude Code:</b>\n\n` +
        `<pre>cd ${escapeHtml(project.path)} &amp;&amp; claude --resume ${escapeHtml(sessionId)}</pre>\n\n` +
        `Copy and paste this into your terminal.`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("status", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(callbacks.onStatus(), { parse_mode: "HTML" });
  });

  bot.command("cost", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(callbacks.onCost(), { parse_mode: "HTML" });
  });
}

export function isAuthorized(ctx: Context, config: AppConfig): boolean {
  if (ctx.chat?.type !== 'private') return false;
  const userId = ctx.from?.id;
  if (!userId || !config.authorizedUsers.includes(userId)) {
    return false;
  }
  return true;
}
