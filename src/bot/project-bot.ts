import { Bot, InlineKeyboard, InputFile } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { registerCommands, isAuthorized } from "./commands.js";
import { markdownToTelegramHtml, formatToolUse, escapeHtml } from "./formatting.js";
import { chunkMessage } from "../utils/chunker.js";
import { createThrottle } from "../utils/throttle.js";
import { MessageBatcher } from "../utils/batcher.js";
import { scanForSecrets } from "../utils/secrets.js";
import { SessionManager } from "../claude/session-manager.js";
import type pino from "pino";

export class ProjectBot {
  private bot: Bot;
  private config: AppConfig;
  private project: ProjectConfig;
  private logger: pino.Logger;
  private sessionManager: SessionManager;
  private statusMessageId: number | null = null;
  private statusChatId: number | null = null;
  private batcher: MessageBatcher;
  private isProcessing = false;
  private pendingQueue: string[] = [];
  private totalCostUsd = 0;

  constructor(config: AppConfig, project: ProjectConfig, logger: pino.Logger) {
    this.config = config;
    this.project = project;
    this.logger = logger;

    this.bot = new Bot(project.botToken);
    this.bot.api.config.use(autoRetry());

    this.sessionManager = new SessionManager(project, config, logger, {
      onAssistantMessage: (text: string) => this.handleAssistantMessage(text),
      onToolUse: (toolName: string, input: Record<string, unknown>) => this.handleToolUse(toolName, input),
      onResult: (result: string, costUsd: number) => this.handleResult(result, costUsd),
      onError: (error: string) => this.handleError(error),
      onSessionId: (sessionId: string) => this.handleSessionId(sessionId),
      onPermissionRequest: (
        toolName: string,
        input: Record<string, unknown>,
        respond: (result: { behavior: string; message?: string; updatedInput?: Record<string, unknown> }) => void,
      ) => this.handlePermissionRequest(toolName, input, respond),
    });

    this.batcher = new MessageBatcher(
      (combined) => this.processMessage(combined),
      config.messageBatchDelayMs,
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Register command handlers
    registerCommands(this.bot, this.project, this.config, {
      onNew: () => this.sessionManager.newSession(),
      onCancel: () => this.sessionManager.interrupt(),
      onModelChange: (model) => this.sessionManager.setModel(model),
      onModeChange: (mode) => this.sessionManager.setPermissionMode(mode),
      onSessionsList: () => this.sessionManager.listSessions(),
      onResume: (id) => this.sessionManager.resumeSession(id),
      onStatus: () => this.getStatus(),
      onCost: () => this.getCost(),
    });

    // Text messages
    this.bot.on("message:text", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      if (ctx.message.text.startsWith("/")) return; // Already handled by command handlers
      this.statusChatId = ctx.chat.id;
      this.batcher.add(ctx.message.text);
    });

    // Voice messages
    this.bot.on("message:voice", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      this.statusChatId = ctx.chat.id;
      await this.handleVoice(ctx);
    });

    // Photos
    this.bot.on("message:photo", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      this.statusChatId = ctx.chat.id;
      await this.handlePhoto(ctx);
    });

    // Documents
    this.bot.on("message:document", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      this.statusChatId = ctx.chat.id;
      await this.handleDocument(ctx);
    });

    // Callback queries (permission buttons)
    this.bot.on("callback_query:data", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      await this.handleCallbackQuery(ctx);
    });

    // Unsupported media
    this.bot.on("message", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      if (ctx.message.sticker || ctx.message.animation || ctx.message.location || ctx.message.contact) {
        await ctx.reply("I can handle text, voice notes, images, and documents. This media type isn't supported yet.");
      }
    });
  }

  private async processMessage(text: string): Promise<void> {
    if (this.isProcessing) {
      this.pendingQueue.push(text);
      return;
    }

    this.isProcessing = true;

    try {
      // Send "Working..." message
      if (this.statusChatId) {
        const msg = await this.bot.api.sendMessage(this.statusChatId, "\u23F3 Working...");
        this.statusMessageId = msg.message_id;
      }

      await this.sessionManager.sendMessage(text);
    } catch (err) {
      this.logger.error({ err }, "Error processing message");
      if (this.statusChatId) {
        await this.bot.api.sendMessage(this.statusChatId, `\u274C Error: ${String(err)}`);
      }
      this.isProcessing = false;
      this.processNextInQueue();
    }
  }

  private processNextInQueue(): void {
    if (this.pendingQueue.length > 0) {
      const combined = this.pendingQueue.join("\n\n");
      this.pendingQueue = [];
      this.processMessage(combined);
    }
  }

  private updateStatusThrottled = createThrottle(async (text: string) => {
    if (this.statusChatId && this.statusMessageId) {
      try {
        await this.bot.api.editMessageText(this.statusChatId, this.statusMessageId, text, {
          parse_mode: "HTML",
        });
      } catch {
        // Edit might fail if message hasn't changed — ignore
      }
    }
  }, 3000);

  private async handleAssistantMessage(_text: string): Promise<void> {
    // Accumulate — final response sent in handleResult
  }

  private handleToolUse(toolName: string, input: Record<string, unknown>): void {
    const status = formatToolUse(toolName, input);
    this.updateStatusThrottled(status);
  }

  private async handleResult(result: string, costUsd: number): Promise<void> {
    this.totalCostUsd += costUsd;
    this.isProcessing = false;

    if (!this.statusChatId) return;

    // Delete the "Working..." message
    if (this.statusMessageId) {
      try {
        await this.bot.api.deleteMessage(this.statusChatId, this.statusMessageId);
      } catch {
        // Ignore
      }
      this.statusMessageId = null;
    }

    // Check for secrets
    const secretWarning = scanForSecrets(result);

    // Format and send response
    const formatted = markdownToTelegramHtml(result);
    const chunks = chunkMessage(formatted);

    if (result.length > this.config.maxResponseChars) {
      // Send as document for very long responses
      const buffer = Buffer.from(result, "utf-8");
      await this.bot.api.sendDocument(this.statusChatId, new InputFile(buffer, "response.md"), {
        caption: `Response too long for chat (${result.length} chars). Sent as file.`,
      });
    } else {
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.statusChatId, chunk, { parse_mode: "HTML" });
      }
    }

    if (secretWarning) {
      await this.bot.api.sendMessage(this.statusChatId, secretWarning);
    }

    // Process next queued message
    this.processNextInQueue();
  }

  private async handleError(error: string): Promise<void> {
    this.isProcessing = false;
    if (this.statusChatId) {
      await this.bot.api.sendMessage(this.statusChatId, `\u274C ${escapeHtml(error)}`, {
        parse_mode: "HTML",
      });
    }
    this.processNextInQueue();
  }

  private handleSessionId(_sessionId: string): void {
    // State persistence handled by SessionManager
  }

  private permissionCallbacks = new Map<
    string,
    { respond: (result: { behavior: string; message?: string }) => void; timer: ReturnType<typeof setTimeout> }
  >();

  private async handlePermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    respond: (result: { behavior: string; message?: string; updatedInput?: Record<string, unknown> }) => void,
  ): Promise<void> {
    if (!this.statusChatId) {
      respond({ behavior: "deny", message: "No chat context" });
      return;
    }

    const callbackId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const description = formatToolUse(toolName, input);

    const keyboard = new InlineKeyboard()
      .text("\u2705 Allow", `${callbackId}:allow`)
      .text("\u2705 Always", `${callbackId}:always`)
      .text("\u274C Deny", `${callbackId}:deny`);

    await this.bot.api.sendMessage(
      this.statusChatId,
      `\uD83D\uDD10 <b>Permission Request</b>\n\n${description}`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );

    // Set timeout
    const timer = setTimeout(() => {
      this.permissionCallbacks.delete(callbackId);
      respond({ behavior: "deny", message: "Permission request timed out (5 min)" });
    }, this.config.permissionTimeoutMs);

    this.permissionCallbacks.set(callbackId, { respond, timer });
  }

  private async handleCallbackQuery(ctx: import("grammy").Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const [callbackId, action] = data.split(":");
    const pending = this.permissionCallbacks.get(callbackId);

    await ctx.answerCallbackQuery();

    if (!pending) {
      await ctx.editMessageText("This permission request has expired.");
      return;
    }

    clearTimeout(pending.timer);
    this.permissionCallbacks.delete(callbackId);

    switch (action) {
      case "allow":
        pending.respond({ behavior: "allow" });
        await ctx.editMessageText("\u2705 Allowed");
        break;
      case "always":
        pending.respond({ behavior: "allow" });
        // TODO: Add to session allowedTools
        await ctx.editMessageText("\u2705 Allowed (always for this session)");
        break;
      case "deny":
        pending.respond({ behavior: "deny", message: "User denied this action" });
        await ctx.editMessageText("\u274C Denied");
        break;
    }
  }

  private async handleVoice(ctx: import("grammy").Context): Promise<void> {
    // Will be implemented in Task 8 (media)
    await ctx.reply("\uD83C\uDF99\uFE0F Voice transcription coming soon...");
  }

  private async handlePhoto(ctx: import("grammy").Context): Promise<void> {
    // Will be implemented in Task 8 (media)
    await ctx.reply("\uD83D\uDDBC\uFE0F Image support coming soon...");
  }

  private async handleDocument(ctx: import("grammy").Context): Promise<void> {
    // Will be implemented in Task 8 (media)
    await ctx.reply("\uD83D\uDCC1 Document support coming soon...");
  }

  private getStatus(): string {
    const model = this.project.model ?? this.config.defaults.model;
    const mode = this.project.permissionMode ?? this.config.defaults.permissionMode;
    const sessionId = this.sessionManager.currentSessionId ?? "none";
    return (
      `<b>${escapeHtml(this.project.name)}</b>\n\n` +
      `\uD83D\uDCC2 ${escapeHtml(this.project.path)}\n` +
      `\uD83E\uDDE0 Model: ${escapeHtml(model)}\n` +
      `\uD83D\uDD12 Mode: ${escapeHtml(mode)}\n` +
      `\uD83D\uDCAC Session: <code>${escapeHtml(sessionId.slice(0, 8))}...</code>\n` +
      `\uD83D\uDCB0 Cost: $${this.totalCostUsd.toFixed(4)}`
    );
  }

  private getCost(): string {
    return `\uD83D\uDCB0 Session cost: <b>$${this.totalCostUsd.toFixed(4)}</b>`;
  }

  async start(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Starting bot");
    await this.bot.start({
      onStart: () => {
        this.logger.info({ project: this.project.name }, "Bot is running");
      },
    });
  }

  async stop(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Stopping bot");
    this.sessionManager.close();
    await this.bot.stop();
  }
}
