import {
  type Message,
  type TextChannel,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from "discord.js";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { handleSlashCommand, isAuthorized, type CommandCallbacks } from "./commands.js";
import { formatForDiscord, formatToolUse, escapeMarkdown } from "./formatting.js";
import { chunkMessage } from "../utils/chunker.js";
import { createThrottle } from "../utils/throttle.js";
import { MessageBatcher } from "../utils/batcher.js";
import { scanForSecrets } from "../utils/secrets.js";
import type { PermissionResult as SDKPermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { SessionManager, type TokenUsage } from "../claude/session-manager.js";
import { downloadImage } from "../media/images.js";
import { downloadDocument } from "../media/documents.js";
import { StreamManager } from "./stream-manager.js";
import { GitHelper } from "./git-helpers.js";
import { UsageTracker } from "./usage-tracker.js";
import type pino from "pino";

const MAX_QUEUE_SIZE = 50;
const THROTTLE_DELAY_MS = 3000;
const SUGGESTION_EXPIRY_MS = 5 * 60 * 1000;

export class ProjectHandler {
  private config: AppConfig;
  private project: ProjectConfig;
  private logger: pino.Logger;
  private sessionManager: SessionManager;
  private channel: TextChannel | null = null;
  private statusMessageId: string | null = null;
  private batcher: MessageBatcher;
  private isProcessing = false;
  private pendingQueue: string[] = [];
  private lastPromptSuggestion: string | null = null;

  private stream: StreamManager;
  private git: GitHelper;
  private usage: UsageTracker;

  // Callback maps for interactive components
  private permissionCallbacks = new Map<
    string,
    {
      respond: (result: SDKPermissionResult) => void;
      timer: ReturnType<typeof setTimeout>;
      toolName: string;
    }
  >();
  private suggestionCallbacks = new Map<string, string>();

  constructor(config: AppConfig, project: ProjectConfig, logger: pino.Logger) {
    this.config = config;
    this.project = project;
    this.logger = logger;

    this.stream = new StreamManager(logger);
    this.git = new GitHelper(project.path, project.name, logger);
    this.usage = new UsageTracker();

    this.sessionManager = new SessionManager(project, config, logger, {
      onAssistantMessage: (_text: string) => {},
      onStreamDelta: (text: string) => this.stream.handleStreamDelta(text),
      onThinkingDelta: (text: string) => this.stream.handleThinkingDelta(text),
      onToolUse: (toolName: string, input: Record<string, unknown>) => this.handleToolUse(toolName, input),
      onToolProgress: (toolName: string, elapsed: number) => this.handleToolProgress(toolName, elapsed),
      onTaskStarted: (taskId: string, prompt: string) => this.handleTaskStarted(taskId, prompt),
      onTaskNotification: (taskId: string, status: string, summary: string) =>
        this.handleTaskNotification(taskId, status, summary),
      onRateLimit: (status: string, resetsAt: number | null) => this.handleRateLimit(status, resetsAt),
      onCompacting: (isCompacting: boolean) => this.handleCompacting(isCompacting),
      onPromptSuggestion: (suggestion: string) => {
        this.lastPromptSuggestion = suggestion;
      },
      onResult: (result: string, costUsd: number, usage: TokenUsage | null) =>
        this.handleResult(result, costUsd, usage),
      onError: (error: string) => this.handleError(error),
      onStreamEnd: () => this.handleStreamEnd(),
      onSessionId: (_sessionId: string) => {},
      onPermissionRequest: (
        toolName: string,
        input: Record<string, unknown>,
        respond: (result: SDKPermissionResult) => void,
      ) => this.handlePermissionRequest(toolName, input, respond),
    });

    this.batcher = new MessageBatcher((combined) => this.processMessage(combined), config.messageBatchDelayMs);
  }

  get channelId(): string {
    return this.project.channelId;
  }

  get projectName(): string {
    return this.project.name;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    const updated = config.projects.find((p) => p.channelId === this.project.channelId);
    if (updated) {
      this.project = updated;
    }
  }

  setChannel(channel: TextChannel): void {
    this.channel = channel;
    this.git.startNotifications(channel);
    this.logger.info(
      { event: "handler_ready", project: this.project.name, channel: channel.name },
      "Project handler ready",
    );
  }

  // --- Command callbacks ---

  getCommandCallbacks(): CommandCallbacks {
    return {
      onNew: () => this.sessionManager.newSession(),
      onCancel: () => this.sessionManager.interrupt(),
      onModelChange: (model) => this.sessionManager.setModel(model),
      onModeChange: (mode) => this.sessionManager.setPermissionMode(mode),
      onSessionsList: () => this.sessionManager.listSessions(),
      onResume: (id) => this.sessionManager.resumeSession(id),
      onHandoff: () => this.sessionManager.currentSessionId,
      onUndo: () => this.git.undo(),
      onDiff: () => this.git.diff(),
      onStatus: () => this.getStatus(),
      onCost: () => this.usage.getCost(),
    };
  }

  // --- Incoming message/interaction handlers ---

  async handleMessage(message: Message): Promise<void> {
    if (!isAuthorized(message.author.id, this.config)) return;
    if (message.author.bot) return;

    const attachments = [...message.attachments.values()];
    const imageAttachments = attachments.filter((a) => a.contentType?.startsWith("image/"));
    const docAttachments = attachments.filter((a) => !imageAttachments.includes(a));

    for (const att of imageAttachments) {
      await this.handlePhoto(
        { url: att.url, name: att.name ?? undefined, contentType: att.contentType ?? undefined },
        message.content,
      );
    }

    for (const att of docAttachments) {
      await this.handleDocument({ url: att.url, name: att.name ?? undefined }, message.content);
    }

    const text = message.content.trim();
    if (text && imageAttachments.length === 0 && docAttachments.length === 0) {
      this.batcher.add(text);
    }
  }

  async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isAuthorized(interaction.user.id, this.config)) {
      await interaction.reply({ content: "You are not authorized to use this bot.", ephemeral: true });
      return;
    }

    await handleSlashCommand(interaction, this.getCommandCallbacks(), this.project.name, this.project.path);
  }

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!isAuthorized(interaction.user.id, this.config)) return;

    const data = interaction.customId;

    if (data.startsWith("resume:")) {
      const sessionId = data.slice("resume:".length);
      await interaction.update({
        content: `\u23EA Resuming session \`${sessionId.slice(0, 8)}\`...`,
        components: [],
      });
      this.sessionManager.resumeSession(sessionId);
      return;
    }

    const [callbackId, action] = data.split(":");

    if (action === "suggest") {
      const suggestion = this.suggestionCallbacks.get(callbackId);
      if (!suggestion) {
        await interaction.update({ content: "This suggestion has expired.", components: [] });
        return;
      }
      this.suggestionCallbacks.delete(callbackId);
      await interaction.update({
        content: `\uD83D\uDCA1 ${escapeMarkdown(suggestion)}`,
        components: [],
      });
      this.batcher.add(suggestion);
      return;
    }

    const pending = this.permissionCallbacks.get(callbackId);

    if (!pending) {
      await interaction.update({ content: "This permission request has expired.", components: [] });
      return;
    }

    clearTimeout(pending.timer);
    this.permissionCallbacks.delete(callbackId);

    switch (action) {
      case "allow":
        pending.respond({ behavior: "allow" });
        await interaction.update({ content: "\u2705 Allowed", components: [] });
        break;
      case "always":
        pending.respond({ behavior: "allow" });
        this.sessionManager.addSessionAllowedTool(pending.toolName);
        await interaction.update({
          content: `\u2705 Allowed (always for this session): ${pending.toolName}`,
          components: [],
        });
        break;
      case "deny":
        pending.respond({ behavior: "deny", message: "User denied this action" });
        await interaction.update({ content: "\u274C Denied", components: [] });
        break;
    }
  }

  async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!isAuthorized(interaction.user.id, this.config)) return;

    if (interaction.customId === "session_select") {
      const sessionId = interaction.values[0];
      await interaction.update({
        content: `\u23EA Resuming session \`${sessionId.slice(0, 8)}\`...`,
        components: [],
      });
      this.sessionManager.resumeSession(sessionId);
    }
  }

  // --- Message processing ---

  private async processMessage(text: string): Promise<void> {
    if (this.isProcessing) {
      if (this.pendingQueue.length < MAX_QUEUE_SIZE) {
        this.pendingQueue.push(text);
      }
      return;
    }

    this.isProcessing = true;

    try {
      this.git.snapshotPreInteraction();

      if (this.channel) {
        const msg = await this.channel.send("\u23F3 Working...");
        this.statusMessageId = msg.id;
      }

      if (this.channel) this.stream.startTyping(this.channel);
      this.stream.startStreamingWithFlush(() => this.flushStream());

      await this.sessionManager.sendMessage(text);
    } catch (err) {
      this.logger.error({ err }, "Error processing message");
      this.stream.stopTyping();
      this.stream.stopStreaming();
      if (this.channel) {
        await this.channel.send(`\u274C ${escapeMarkdown(String(err))}`);
      }
      this.isProcessing = false;
      this.processNextInQueue();
    }
  }

  private flushStream(): void {
    if (this.channel && this.statusMessageId) {
      this.stream.flush(this.channel, this.statusMessageId).catch(() => {});
    }
  }

  private processNextInQueue(): void {
    if (this.pendingQueue.length > 0) {
      const combined = this.pendingQueue.join("\n\n");
      this.pendingQueue = [];
      this.processMessage(combined).catch((err) => {
        this.logger.error({ err }, "Error processing queued message");
      });
    }
  }

  private updateStatusThrottled = createThrottle(async (text: string) => {
    if (this.channel && this.statusMessageId) {
      try {
        const msg = await this.channel.messages.fetch(this.statusMessageId);
        await msg.edit(text);
      } catch {
        // Edit might fail if message was deleted
      }
    }
  }, THROTTLE_DELAY_MS);

  private handleToolUse(toolName: string, input: Record<string, unknown>): void {
    this.stream.onToolUse();
    const status = formatToolUse(toolName, input);
    this.updateStatusThrottled(status);
  }

  private handleToolProgress(toolName: string, elapsedSeconds: number): void {
    const elapsed = Math.round(elapsedSeconds);
    this.updateStatusThrottled(`\u2699\uFE0F **${escapeMarkdown(toolName)}** running... (${elapsed}s)`);
  }

  private handleTaskStarted(_taskId: string, prompt: string): void {
    const summary = prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;
    this.updateStatusThrottled(`\uD83D\uDE80 **Subagent spawned**\n${escapeMarkdown(summary)}`);
  }

  private handleTaskNotification(_taskId: string, status: string, summary: string): void {
    if (!this.channel) return;
    const icon = status === "completed" ? "\u2705" : "\u274C";
    const text = summary.length > 200 ? summary.slice(0, 200) + "..." : summary;
    this.updateStatusThrottled(`${icon} **Subagent ${escapeMarkdown(status)}**\n${escapeMarkdown(text)}`);
  }

  private handleRateLimit(status: string, resetsAt: number | null): void {
    if (!this.channel) return;
    if (status === "rejected") {
      const resetInfo = resetsAt ? ` Resets at ${new Date(resetsAt).toLocaleTimeString()}.` : "";
      this.channel
        .send(`\u26A0\uFE0F **Rate limited.**${resetInfo} Message will be retried.`)
        .catch((e) => this.logger.debug(e, "rate limit send failed"));
    } else if (status === "allowed_warning") {
      this.channel
        .send(`\u26A0\uFE0F Approaching rate limit. Responses may slow down.`)
        .catch((e) => this.logger.debug(e, "rate limit warning send failed"));
    }
  }

  private handleCompacting(isCompacting: boolean): void {
    if (!this.channel || !this.statusMessageId) return;
    if (isCompacting) {
      this.updateStatusThrottled("\uD83D\uDDDC\uFE0F Compacting context...");
    }
  }

  private async handleResult(result: string, costUsd: number, usageData: TokenUsage | null): Promise<void> {
    this.usage.recordUsage(costUsd, usageData);
    this.isProcessing = false;
    this.stream.stopTyping();
    this.stream.stopStreaming();

    this.git.trackChangedFiles();

    if (!this.channel) return;

    // Delete the streaming/status message
    if (this.statusMessageId) {
      try {
        const msg = await this.channel.messages.fetch(this.statusMessageId);
        await msg.delete();
      } catch {}
      this.statusMessageId = null;
    }

    const secretWarning = scanForSecrets(result);

    let lastMessage: Message | undefined;

    if (result.length > this.config.maxResponseChars) {
      const buffer = Buffer.from(result, "utf-8");
      const attachment = new AttachmentBuilder(buffer, { name: "response.md" });
      lastMessage = await this.channel.send({
        content: `Response too long for chat (${result.length} chars). Sent as file.`,
        files: [attachment],
      });
    } else {
      const formatted = formatForDiscord(result);
      const chunks = chunkMessage(formatted);
      for (const chunk of chunks) {
        lastMessage = await this.channel.send(chunk);
      }
    }

    if (lastMessage) {
      try {
        await lastMessage.pin();
      } catch {}
    }

    if (secretWarning) {
      await this.channel.send(secretWarning);
    }

    if (usageData) {
      const footer = this.usage.getUsageFooter(costUsd, usageData);
      await this.channel.send(footer);
    }

    // Show prompt suggestion as a tappable button
    if (this.lastPromptSuggestion) {
      const suggestion = this.lastPromptSuggestion;
      this.lastPromptSuggestion = null;
      const callbackId = `suggest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const label = suggestion.length > 70 ? suggestion.slice(0, 67) + "..." : suggestion;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${callbackId}:suggest`)
          .setLabel(`\uD83D\uDCA1 ${label}`)
          .setStyle(ButtonStyle.Secondary),
      );

      this.suggestionCallbacks.set(callbackId, suggestion);
      await this.channel.send({ content: "\uD83D\uDCA1 **Suggested next:**", components: [row] });

      setTimeout(() => this.suggestionCallbacks.delete(callbackId), SUGGESTION_EXPIRY_MS);
    }

    this.stream.reset();

    setImmediate(() => this.processNextInQueue());
  }

  private async handleError(error: string): Promise<void> {
    this.isProcessing = false;
    this.stream.stopTyping();
    this.stream.stopStreaming();
    this.stream.reset();
    if (this.channel) {
      await this.channel.send(`\u274C ${escapeMarkdown(error)}`);
    }
    setImmediate(() => this.processNextInQueue());
  }

  private handleStreamEnd(): void {
    if (this.isProcessing) {
      this.isProcessing = false;
      this.stream.stopTyping();
      this.stream.stopStreaming();
      this.stream.reset();
      this.logger.warn("Stream ended without result/error — reset isProcessing");
      setImmediate(() => this.processNextInQueue());
    }
  }

  // --- Permission handling ---

  private async handlePermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    respond: (result: SDKPermissionResult) => void,
  ): Promise<void> {
    if (!this.channel) {
      respond({ behavior: "deny", message: "No channel context" });
      return;
    }

    const callbackId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const description = formatToolUse(toolName, input);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${callbackId}:allow`)
        .setLabel("Allow")
        .setEmoji("\u2705")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${callbackId}:always`)
        .setLabel("Always")
        .setEmoji("\u2705")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${callbackId}:deny`)
        .setLabel("Deny")
        .setEmoji("\u274C")
        .setStyle(ButtonStyle.Danger),
    );

    try {
      await this.channel.send({
        content: `\uD83D\uDD10 **Permission Request**\n\n${description}`,
        components: [row],
      });
    } catch (err) {
      this.logger.error({ err }, "Failed to send permission request");
      respond({ behavior: "deny", message: "Failed to send permission request to Discord" });
      return;
    }

    const timer = setTimeout(() => {
      this.permissionCallbacks.delete(callbackId);
      respond({ behavior: "deny", message: "Permission request timed out (5 min)" });
    }, this.config.permissionTimeoutMs);

    this.permissionCallbacks.set(callbackId, { respond, timer, toolName });
  }

  // --- Media handlers ---

  private async handlePhoto(
    attachment: { url: string; name?: string; contentType?: string },
    caption: string,
  ): Promise<void> {
    try {
      const localPath = await downloadImage(attachment, this.project.path);
      const prompt = caption
        ? `The user sent an image saved at ${localPath}. Caption: "${caption}"`
        : `The user sent an image saved at ${localPath}. Please analyze it.`;
      this.batcher.add(prompt);
    } catch (err) {
      this.logger.error({ err }, "Image download failed");
      if (this.channel) {
        await this.channel.send("\u274C Couldn't download the image. Please try again.");
      }
    }
  }

  private async handleDocument(attachment: { url: string; name?: string }, caption: string): Promise<void> {
    try {
      const localPath = await downloadDocument(attachment, this.project.path);
      const fileName = attachment.name ?? "file";
      const prompt = caption
        ? `The user sent a file "${fileName}" saved at ${localPath}. Caption: "${caption}"`
        : `The user sent a file "${fileName}" saved at ${localPath}. Please review it.`;
      this.batcher.add(prompt);
    } catch (err) {
      this.logger.error({ err }, "Document download failed");
      if (this.channel) {
        await this.channel.send("\u274C Couldn't download the document. Please try again.");
      }
    }
  }

  // --- Status ---

  private getStatus(): string {
    const model = this.project.model ?? this.config.defaults.model;
    const mode = this.project.permissionMode ?? this.config.defaults.permissionMode;
    return this.usage.getStatus(
      this.project.name,
      this.project.path,
      model,
      mode,
      this.sessionManager.currentSessionId,
    );
  }

  // --- Lifecycle ---

  async stop(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Stopping handler");
    this.batcher.clear();
    this.stream.stopTyping();
    this.stream.stopStreaming();
    this.git.stopNotifications();
    for (const [id, pending] of this.permissionCallbacks) {
      clearTimeout(pending.timer);
      pending.respond({ behavior: "deny", message: "Bot is shutting down" });
      this.permissionCallbacks.delete(id);
    }
    this.sessionManager.close();
  }
}
