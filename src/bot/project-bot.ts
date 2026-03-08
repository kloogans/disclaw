import { Bot, InlineKeyboard, InputFile } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { execSync } from "node:child_process";
import path from "node:path";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { registerCommands, isAuthorized } from "./commands.js";
import { markdownToTelegramHtml, formatToolUse, escapeHtml } from "./formatting.js";
import { chunkMessage } from "../utils/chunker.js";
import { createThrottle } from "../utils/throttle.js";
import { MessageBatcher } from "../utils/batcher.js";
import { scanForSecrets } from "../utils/secrets.js";
import { SessionManager, type TokenUsage } from "../claude/session-manager.js";
import { transcribeAudio } from "../media/transcriber.js";
import { downloadImage } from "../media/images.js";
import { downloadDocument } from "../media/documents.js";
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
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private streamBuffer = "";
  private streamUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private gitNotifyInterval: ReturnType<typeof setInterval> | null = null;
  private lastGitState: string | null = null;
  private preInteractionGitState: string | null = null;
  private lastChangedFiles: string[] = [];
  private static readonly MAX_STREAM_BUFFER = 100_000;
  private thinkingBuffer = "";
  private isShowingThinking = false;
  private lastPromptSuggestion: string | null = null;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheReadTokens = 0;
  private lastContextWindow = 0;
  private lastUsage: TokenUsage | null = null;

  constructor(config: AppConfig, project: ProjectConfig, logger: pino.Logger) {
    this.config = config;
    this.project = project;
    this.logger = logger;

    this.bot = new Bot(project.botToken);
    this.bot.api.config.use(autoRetry());
    this.bot.catch((err) => {
      this.logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Unhandled bot error");
    });

    this.sessionManager = new SessionManager(project, config, logger, {
      onAssistantMessage: (text: string) => this.handleAssistantMessage(text),
      onStreamDelta: (text: string) => this.handleStreamDelta(text),
      onThinkingDelta: (text: string) => this.handleThinkingDelta(text),
      onToolUse: (toolName: string, input: Record<string, unknown>) => this.handleToolUse(toolName, input),
      onToolProgress: (toolName: string, elapsed: number) => this.handleToolProgress(toolName, elapsed),
      onTaskStarted: (taskId: string, prompt: string) => this.handleTaskStarted(taskId, prompt),
      onTaskNotification: (taskId: string, status: string, summary: string) => this.handleTaskNotification(taskId, status, summary),
      onRateLimit: (status: string, resetsAt: string | null) => this.handleRateLimit(status, resetsAt),
      onCompacting: (isCompacting: boolean) => this.handleCompacting(isCompacting),
      onPromptSuggestion: (suggestion: string) => this.handlePromptSuggestion(suggestion),
      onResult: (result: string, costUsd: number, usage: TokenUsage | null) => this.handleResult(result, costUsd, usage),
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
      onUndo: () => this.handleUndo(),
      onDiff: () => this.handleDiff(),
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

  // --- Typing indicator ---

  private startTypingIndicator(): void {
    this.stopTypingIndicator();
    if (!this.statusChatId) return;
    const chatId = this.statusChatId;
    // Send immediately, then every 4 seconds (Telegram cancels after 5s)
    this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
    this.typingInterval = setInterval(() => {
      this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
  }

  private stopTypingIndicator(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  // --- Progress streaming ---

  private startStreamUpdates(): void {
    this.streamBuffer = "";
    this.stopStreamUpdates();
    // Update the status message every 4 seconds with streamed content
    this.streamUpdateInterval = setInterval(() => {
      this.flushStreamBuffer();
    }, 4000);
  }

  private stopStreamUpdates(): void {
    if (this.streamUpdateInterval) {
      clearInterval(this.streamUpdateInterval);
      this.streamUpdateInterval = null;
    }
  }

  private flushStreamBuffer(): void {
    if (!this.statusChatId || !this.statusMessageId) return;

    let icon: string;
    let preview: string;

    if (this.isShowingThinking && this.thinkingBuffer) {
      icon = "\uD83E\uDDE0";
      preview = this.thinkingBuffer;
    } else if (this.streamBuffer) {
      icon = "\u270D\uFE0F";
      preview = this.streamBuffer;
    } else {
      return;
    }

    if (preview.length > 3800) {
      preview = "..." + preview.slice(-3700);
    }
    const escaped = escapeHtml(preview);
    this.bot.api.editMessageText(this.statusChatId, this.statusMessageId, `${icon}\n\n${escaped}`, {
      parse_mode: "HTML",
    }).catch(() => {});
  }

  private handleStreamDelta(text: string): void {
    this.isShowingThinking = false;
    this.streamBuffer += text;
    if (this.streamBuffer.length > ProjectBot.MAX_STREAM_BUFFER) {
      this.streamBuffer = this.streamBuffer.slice(-ProjectBot.MAX_STREAM_BUFFER);
    }
  }

  private handleThinkingDelta(text: string): void {
    this.isShowingThinking = true;
    this.thinkingBuffer += text;
    if (this.thinkingBuffer.length > ProjectBot.MAX_STREAM_BUFFER) {
      this.thinkingBuffer = this.thinkingBuffer.slice(-ProjectBot.MAX_STREAM_BUFFER);
    }
  }

  // --- Message processing ---

  private async processMessage(text: string): Promise<void> {
    if (this.isProcessing) {
      if (this.pendingQueue.length < 50) {
        this.pendingQueue.push(text);
      }
      return;
    }

    this.isProcessing = true;

    try {
      // Snapshot git state before Claude makes changes (for /undo tracking)
      try {
        this.preInteractionGitState = execSync("git status --porcelain", {
          cwd: this.project.path,
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
      } catch {
        this.preInteractionGitState = null;
      }

      // Send "Working..." message and start indicators
      if (this.statusChatId) {
        const msg = await this.bot.api.sendMessage(this.statusChatId, "\u23F3 Working...");
        this.statusMessageId = msg.message_id;
      }

      this.startTypingIndicator();
      this.startStreamUpdates();

      await this.sessionManager.sendMessage(text);
    } catch (err) {
      this.logger.error({ err }, "Error processing message");
      this.stopTypingIndicator();
      this.stopStreamUpdates();
      if (this.statusChatId) {
        await this.bot.api.sendMessage(this.statusChatId, `\u274C ${escapeHtml(String(err))}`, { parse_mode: "HTML" });
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
        // Edit might fail if message hasn't changed
      }
    }
  }, 3000);

  private async handleAssistantMessage(_text: string): Promise<void> {
    // Full assistant messages arrive after streaming is done — handled in handleResult
  }

  private handleToolUse(toolName: string, input: Record<string, unknown>): void {
    this.streamBuffer = "";
    this.thinkingBuffer = "";
    this.isShowingThinking = false;
    const status = formatToolUse(toolName, input);
    this.updateStatusThrottled(status);
  }

  private handleToolProgress(toolName: string, elapsedSeconds: number): void {
    const elapsed = Math.round(elapsedSeconds);
    this.updateStatusThrottled(
      `\u2699\uFE0F <b>${escapeHtml(toolName)}</b> running... (${elapsed}s)`,
    );
  }

  private handleTaskStarted(_taskId: string, prompt: string): void {
    const summary = prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;
    this.updateStatusThrottled(
      `\uD83D\uDE80 <b>Subagent spawned</b>\n${escapeHtml(summary)}`,
    );
  }

  private handleTaskNotification(_taskId: string, status: string, summary: string): void {
    if (!this.statusChatId) return;
    const icon = status === "completed" ? "\u2705" : "\u274C";
    const text = summary.length > 200 ? summary.slice(0, 200) + "..." : summary;
    this.updateStatusThrottled(
      `${icon} <b>Subagent ${escapeHtml(status)}</b>\n${escapeHtml(text)}`,
    );
  }

  private handleRateLimit(status: string, resetsAt: string | null): void {
    if (!this.statusChatId) return;
    if (status === "rejected") {
      const resetInfo = resetsAt ? ` Resets at ${new Date(resetsAt).toLocaleTimeString()}.` : "";
      this.bot.api.sendMessage(
        this.statusChatId,
        `\u26A0\uFE0F <b>Rate limited.</b>${resetInfo} Message will be retried.`,
        { parse_mode: "HTML" },
      ).catch(() => {});
    } else if (status === "allowed_warning") {
      this.bot.api.sendMessage(
        this.statusChatId,
        `\u26A0\uFE0F Approaching rate limit. Responses may slow down.`,
        { parse_mode: "HTML" },
      ).catch(() => {});
    }
  }

  private handleCompacting(isCompacting: boolean): void {
    if (!this.statusChatId || !this.statusMessageId) return;
    if (isCompacting) {
      this.updateStatusThrottled("\uD83D\uDDDC\uFE0F Compacting context...");
    }
  }

  private handlePromptSuggestion(suggestion: string): void {
    this.lastPromptSuggestion = suggestion;
  }

  private async handleResult(result: string, costUsd: number, usage: TokenUsage | null): Promise<void> {
    this.totalCostUsd += costUsd;
    this.lastUsage = usage;
    if (usage) {
      this.totalInputTokens += usage.inputTokens;
      this.totalOutputTokens += usage.outputTokens;
      this.totalCacheReadTokens += usage.cacheReadTokens;
      if (usage.contextWindow > 0) this.lastContextWindow = usage.contextWindow;
    }
    this.isProcessing = false;
    this.stopTypingIndicator();
    this.stopStreamUpdates();

    // Track files Claude changed by diffing git state
    this.trackChangedFiles();

    if (!this.statusChatId) return;

    // Delete the streaming/status message
    if (this.statusMessageId) {
      try {
        await this.bot.api.deleteMessage(this.statusChatId, this.statusMessageId);
      } catch {}
      this.statusMessageId = null;
    }

    // Check for secrets
    const secretWarning = scanForSecrets(result);

    let lastMessageId: number | undefined;

    if (result.length > this.config.maxResponseChars) {
      // Send as document for very long responses
      const buffer = Buffer.from(result, "utf-8");
      const msg = await this.bot.api.sendDocument(this.statusChatId, new InputFile(buffer, "response.md"), {
        caption: `Response too long for chat (${result.length} chars). Sent as file.`,
      });
      lastMessageId = msg.message_id;
    } else {
      // Format and send response
      const formatted = markdownToTelegramHtml(result);
      const chunks = chunkMessage(formatted);
      for (const chunk of chunks) {
        const msg = await this.bot.api.sendMessage(this.statusChatId, chunk, { parse_mode: "HTML" });
        lastMessageId = msg.message_id;
      }
    }

    // Pin the last response message
    if (lastMessageId) {
      try {
        await this.bot.api.pinChatMessage(this.statusChatId, lastMessageId, { disable_notification: true });
      } catch {}
    }

    if (secretWarning) {
      await this.bot.api.sendMessage(this.statusChatId, secretWarning);
    }

    // Show per-turn usage footer
    if (usage) {
      const totalTokens = usage.inputTokens + usage.outputTokens;
      const parts: string[] = [
        `${this.formatTokenCount(usage.inputTokens)} in`,
        `${this.formatTokenCount(usage.outputTokens)} out`,
      ];
      if (usage.cacheReadTokens > 0) {
        parts.push(`${this.formatTokenCount(usage.cacheReadTokens)} cached`);
      }
      let footer = `\uD83D\uDCCA ${parts.join(" \u00B7 ")} \u00B7 $${costUsd.toFixed(4)}`;

      // Context window warning
      if (this.lastContextWindow > 0) {
        const usedPct = Math.round((usage.inputTokens / this.lastContextWindow) * 100);
        if (usedPct >= 80) {
          footer += `\n\u26A0\uFE0F Context ${usedPct}% full — consider /new`;
        } else if (usedPct >= 50) {
          footer += ` \u00B7 ctx ${usedPct}%`;
        }
      }

      await this.bot.api.sendMessage(this.statusChatId, footer);
    }

    // Show prompt suggestion as a tappable button
    if (this.lastPromptSuggestion) {
      const suggestion = this.lastPromptSuggestion;
      this.lastPromptSuggestion = null;
      const callbackId = `suggest_${Date.now()}`;
      const label = suggestion.length > 60 ? suggestion.slice(0, 57) + "..." : suggestion;
      const keyboard = new InlineKeyboard().text(`\uD83D\uDCA1 ${label}`, `${callbackId}:suggest`);
      this.suggestionCallbacks.set(callbackId, suggestion);
      await this.bot.api.sendMessage(this.statusChatId, "\uD83D\uDCA1 <b>Suggested next:</b>", {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      // Auto-expire after 5 minutes
      setTimeout(() => this.suggestionCallbacks.delete(callbackId), 5 * 60 * 1000);
    }

    // Reset buffers
    this.streamBuffer = "";
    this.thinkingBuffer = "";
    this.isShowingThinking = false;

    // Process next queued message (deferred to avoid reentrant async generator iteration)
    setImmediate(() => this.processNextInQueue());
  }

  private async handleError(error: string): Promise<void> {
    this.isProcessing = false;
    this.stopTypingIndicator();
    this.stopStreamUpdates();
    this.streamBuffer = "";
    this.thinkingBuffer = "";
    this.isShowingThinking = false;
    if (this.statusChatId) {
      await this.bot.api.sendMessage(this.statusChatId, `\u274C ${escapeHtml(error)}`, {
        parse_mode: "HTML",
      });
    }
    setImmediate(() => this.processNextInQueue());
  }

  private handleSessionId(_sessionId: string): void {
    // State persistence handled by SessionManager
  }

  // --- Permission handling ---

  private permissionCallbacks = new Map<
    string,
    {
      respond: (result: { behavior: string; message?: string; updatedInput?: Record<string, unknown> }) => void;
      timer: ReturnType<typeof setTimeout>;
      toolName: string;
    }
  >();
  private suggestionCallbacks = new Map<string, string>();

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

    this.permissionCallbacks.set(callbackId, { respond, timer, toolName });
  }

  private async handleCallbackQuery(ctx: import("grammy").Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const [callbackId, action] = data.split(":");

    // Handle prompt suggestion taps
    if (action === "suggest") {
      const suggestion = this.suggestionCallbacks.get(callbackId);
      await ctx.answerCallbackQuery();
      if (!suggestion) {
        await ctx.editMessageText("This suggestion has expired.");
        return;
      }
      this.suggestionCallbacks.delete(callbackId);
      await ctx.editMessageText(`\uD83D\uDCA1 ${escapeHtml(suggestion)}`, { parse_mode: "HTML" });
      this.batcher.add(suggestion);
      return;
    }

    // Handle permission callbacks
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
        this.sessionManager.addSessionAllowedTool(pending.toolName);
        await ctx.editMessageText(`\u2705 Allowed (always for this session): ${pending.toolName}`);
        break;
      case "deny":
        pending.respond({ behavior: "deny", message: "User denied this action" });
        await ctx.editMessageText("\u274C Denied");
        break;
    }
  }

  // --- /undo and /diff ---

  private trackChangedFiles(): void {
    if (this.preInteractionGitState === null) {
      this.lastChangedFiles = [];
      return;
    }
    try {
      const currentState = execSync("git status --porcelain", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const priorFiles = new Set(
        this.preInteractionGitState ? this.preInteractionGitState.split("\n").filter(Boolean) : [],
      );
      const currentFiles = currentState ? currentState.split("\n").filter(Boolean) : [];

      // Files that are new or changed since pre-interaction snapshot
      this.lastChangedFiles = currentFiles
        .filter((line) => !priorFiles.has(line))
        .map((line) => line.slice(3));
    } catch {
      this.lastChangedFiles = [];
    }
  }

  private async handleUndo(): Promise<string> {
    try {
      const { rmSync } = await import("node:fs");

      if (this.lastChangedFiles.length === 0) {
        return "Nothing to undo — no files were changed in the last interaction.";
      }

      const currentStatus = execSync("git status --porcelain", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const statusLines = currentStatus ? currentStatus.split("\n") : [];

      const reverted: string[] = [];

      for (const file of this.lastChangedFiles) {
        const resolved = path.resolve(this.project.path, file);
        if (!resolved.startsWith(this.project.path + path.sep) && resolved !== this.project.path) continue;

        const statusLine = statusLines.find((l) => l.slice(3) === file);
        if (!statusLine) continue;

        try {
          if (statusLine.startsWith("??")) {
            // Untracked file — delete it (handles files and directories)
            rmSync(path.join(this.project.path, file), { recursive: true, force: true });
            reverted.push(file);
          } else {
            // Modified/deleted — restore via git checkout
            execSync(`git checkout -- "${file}"`, {
              cwd: this.project.path,
              encoding: "utf-8",
              timeout: 5000,
            });
            reverted.push(file);
          }
        } catch (err) {
          this.logger.warn({ err, file }, "Failed to undo file");
        }
      }

      if (reverted.length === 0) {
        return "Nothing to undo — changed files may have already been committed or reverted.";
      }

      this.lastChangedFiles = [];
      return `\u21A9\uFE0F Reverted ${reverted.length} file(s):\n${reverted.map((f) => `  - <code>${escapeHtml(f)}</code>`).join("\n")}`;
    } catch (err) {
      this.logger.error({ err }, "Undo failed");
      return `Undo failed: ${escapeHtml(String(err))}`;
    }
  }

  private async handleDiff(): Promise<string> {
    try {
      // Show both staged and unstaged changes
      const unstaged = execSync("git diff --stat", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const staged = execSync("git diff --cached --stat", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const untracked = execSync("git ls-files --others --exclude-standard", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const log = execSync("git log --oneline -5", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const parts: string[] = [];

      if (staged) {
        parts.push(`<b>Staged:</b>\n<pre>${escapeHtml(staged)}</pre>`);
      }
      if (unstaged) {
        parts.push(`<b>Unstaged:</b>\n<pre>${escapeHtml(unstaged)}</pre>`);
      }
      if (untracked) {
        const files = untracked.split("\n").slice(0, 10);
        const suffix = untracked.split("\n").length > 10 ? `\n  ... and ${untracked.split("\n").length - 10} more` : "";
        parts.push(`<b>Untracked:</b>\n<pre>${escapeHtml(files.join("\n") + suffix)}</pre>`);
      }
      if (!staged && !unstaged && !untracked) {
        parts.push("Working tree is clean.");
      }

      if (log) {
        parts.push(`<b>Recent commits:</b>\n<pre>${escapeHtml(log)}</pre>`);
      }

      return parts.join("\n\n");
    } catch (err) {
      return `Error: ${escapeHtml(String(err))}`;
    }
  }

  // --- Media handlers ---

  private async handleVoice(ctx: import("grammy").Context): Promise<void> {
    const voice = ctx.message?.voice;
    if (!voice) return;

    const duration = voice.duration;
    if (duration > 60) {
      await ctx.reply("\uD83C\uDF99\uFE0F Transcribing long recording, this may take a moment...");
    } else {
      await ctx.reply("\uD83C\uDF99\uFE0F Transcribing...");
    }

    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("Could not get voice file");

      const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
      let buffer: Buffer;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
        buffer = Buffer.from(await response.arrayBuffer());
      } catch (err) {
        throw new Error(`Telegram file download failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const text = await transcribeAudio(buffer, this.config.whisper, this.logger);
      await ctx.reply(`\uD83C\uDF99\uFE0F <i>${escapeHtml(text)}</i>`, { parse_mode: "HTML" });

      this.batcher.add(`(Transcribed from voice note) ${text}`);
    } catch (err) {
      this.logger.error({ err }, "Voice transcription failed");
      await ctx.reply("\u274C Transcription failed. Please try again or send as text.");
    }
  }

  private async handlePhoto(ctx: import("grammy").Context): Promise<void> {
    try {
      const localPath = await downloadImage(ctx, this.project.path);
      const caption = ctx.message?.caption ?? "";
      const prompt = caption
        ? `The user sent an image saved at ${localPath}. Caption: "${caption}"`
        : `The user sent an image saved at ${localPath}. Please analyze it.`;

      this.batcher.add(prompt);
    } catch (err) {
      this.logger.error({ err }, "Image download failed");
      await ctx.reply("\u274C Couldn't download the image. Please try again.");
    }
  }

  private async handleDocument(ctx: import("grammy").Context): Promise<void> {
    try {
      const localPath = await downloadDocument(ctx, this.project.path);
      const fileName = ctx.message?.document?.file_name ?? "file";
      const caption = ctx.message?.caption ?? "";
      const prompt = caption
        ? `The user sent a file "${fileName}" saved at ${localPath}. Caption: "${caption}"`
        : `The user sent a file "${fileName}" saved at ${localPath}. Please review it.`;

      this.batcher.add(prompt);
    } catch (err) {
      this.logger.error({ err }, "Document download failed");
      await ctx.reply("\u274C Couldn't download the document. Please try again.");
    }
  }

  // --- Git status notifications ---

  private startGitNotifications(): void {
    // Initialize last known state so we don't fire a notification on first check
    try {
      this.lastGitState = execSync("git status --porcelain", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
    } catch {
      this.lastGitState = "";
    }

    // Check every 30 minutes
    this.gitNotifyInterval = setInterval(() => {
      this.checkGitStatus();
    }, 30 * 60 * 1000);
  }

  private checkGitStatus(): void {
    if (!this.statusChatId) return;

    try {
      const status = execSync("git status --porcelain", {
        cwd: this.project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      // Only notify if state changed since last check
      if (status === this.lastGitState) return;
      this.lastGitState = status;

      if (!status) return; // Clean — don't notify

      const lines = status.split("\n");
      const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
      const added = lines.filter((l) => l.startsWith("??")).length;
      const deleted = lines.filter((l) => l.startsWith(" D") || l.startsWith("D ")).length;

      const parts: string[] = [];
      if (modified > 0) parts.push(`${modified} modified`);
      if (added > 0) parts.push(`${added} untracked`);
      if (deleted > 0) parts.push(`${deleted} deleted`);

      this.bot.api.sendMessage(
        this.statusChatId,
        `\uD83D\uDCCB <b>${escapeHtml(this.project.name)}</b> has uncommitted changes: ${parts.join(", ")}\n\nUse /diff for details.`,
        { parse_mode: "HTML" },
      ).catch(() => {});
    } catch {
      // Git not available or timeout — skip silently
    }
  }

  // --- Status ---

  private getStatus(): string {
    const model = this.project.model ?? this.config.defaults.model;
    const mode = this.project.permissionMode ?? this.config.defaults.permissionMode;
    const sessionId = this.sessionManager.currentSessionId;
    const sessionDisplay = sessionId ? `<code>${escapeHtml(sessionId.slice(0, 8))}...</code>` : "none";
    let status =
      `<b>${escapeHtml(this.project.name)}</b>\n\n` +
      `\uD83D\uDCC2 ${escapeHtml(this.project.path)}\n` +
      `\uD83E\uDDE0 Model: ${escapeHtml(model)}\n` +
      `\uD83D\uDD12 Mode: ${escapeHtml(mode)}\n` +
      `\uD83D\uDCAC Session: ${sessionDisplay}\n` +
      `\uD83D\uDCB0 Cost: $${this.totalCostUsd.toFixed(4)}`;

    if (this.totalInputTokens > 0 || this.totalOutputTokens > 0) {
      status += `\n\uD83D\uDCCA Tokens: ${this.formatTokenCount(this.totalInputTokens)} in / ${this.formatTokenCount(this.totalOutputTokens)} out`;
      if (this.lastContextWindow > 0 && this.lastUsage) {
        const usedPct = Math.round((this.lastUsage.inputTokens / this.lastContextWindow) * 100);
        status += `\n\uD83D\uDCCF Context: ${usedPct}% of ${this.formatTokenCount(this.lastContextWindow)}`;
      }
    }

    return status;
  }

  private formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
  }

  private getCost(): string {
    const parts = [`\uD83D\uDCB0 Session cost: <b>$${this.totalCostUsd.toFixed(4)}</b>`];
    if (this.totalInputTokens > 0 || this.totalOutputTokens > 0) {
      parts.push(
        `\uD83D\uDCCA Tokens: ${this.formatTokenCount(this.totalInputTokens)} in / ${this.formatTokenCount(this.totalOutputTokens)} out`,
      );
      if (this.totalCacheReadTokens > 0) {
        parts.push(`\uD83D\uDCBE Cache hits: ${this.formatTokenCount(this.totalCacheReadTokens)}`);
      }
      if (this.lastContextWindow > 0 && this.lastUsage) {
        const usedPct = Math.round((this.lastUsage.inputTokens / this.lastContextWindow) * 100);
        parts.push(`\uD83D\uDCCF Context: ${usedPct}% of ${this.formatTokenCount(this.lastContextWindow)}`);
      }
    }
    return parts.join("\n");
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Starting bot");
    this.startGitNotifications();
    await this.bot.start({
      onStart: () => {
        this.logger.info({ project: this.project.name }, "Bot is running");
      },
    });
  }

  async stop(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Stopping bot");
    this.batcher.clear();
    this.stopTypingIndicator();
    this.stopStreamUpdates();
    if (this.gitNotifyInterval) {
      clearInterval(this.gitNotifyInterval);
      this.gitNotifyInterval = null;
    }
    for (const [id, pending] of this.permissionCallbacks) {
      clearTimeout(pending.timer);
      pending.respond({ behavior: "deny", message: "Bot is shutting down" });
      this.permissionCallbacks.delete(id);
    }
    this.sessionManager.close();
    await this.bot.stop();
  }
}
