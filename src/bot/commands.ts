import type { Context } from "grammy";
import type { ProjectConfig, AppConfig } from "../config/types.js";

export function registerCommands(
  bot: import("grammy").Bot,
  project: ProjectConfig,
  config: AppConfig,
  callbacks: {
    onNew: () => void;
    onCancel: () => void;
    onModelChange: (model: string) => void;
    onModeChange: (mode: string) => void;
    onSessionsList: () => Promise<string>;
    onResume: (sessionId: string) => void;
    onStatus: () => string;
    onCost: () => string;
  },
): void {
  bot.command("start", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(
      `\uD83D\uDE80 <b>${project.name}</b> \u2014 Claude Control\n\n` +
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
        `/sessions \u2014 List past sessions\n` +
        `/resume &lt;id&gt; \u2014 Resume a session\n` +
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
    await ctx.reply(`\uD83E\uDDE0 Model switched to <b>${model}</b>`, { parse_mode: "HTML" });
  });

  bot.command("mode", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const mode = ctx.match?.trim();
    if (!mode) {
      await ctx.reply("Usage: /mode <mode>\nOptions: auto, plan, default");
      return;
    }
    callbacks.onModeChange(mode);
    await ctx.reply(`\uD83D\uDD12 Permission mode: <b>${mode}</b>`, { parse_mode: "HTML" });
  });

  bot.command("sessions", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const list = await callbacks.onSessionsList();
    await ctx.reply(list, { parse_mode: "HTML" });
  });

  bot.command("resume", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const sessionId = ctx.match?.trim();
    if (!sessionId) {
      await ctx.reply("Usage: /resume <session-id>");
      return;
    }
    callbacks.onResume(sessionId);
    await ctx.reply(`\u23EA Resuming session...`);
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
  const userId = ctx.from?.id;
  if (!userId || !config.authorizedUsers.includes(userId)) {
    return false; // Silent drop — don't reveal the bot exists
  }
  return true;
}
