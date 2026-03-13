import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type {
  Query,
  SDKMessage,
  PermissionMode as SDKPermissionMode,
  PermissionResult as SDKPermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig, ProjectConfig, PermissionMode } from "../config/types.js";
import { saveSessionId, getLastSessionId, removeSessionEntry } from "../config/state.js";
import { buildSystemPrompt } from "./system-prompt.js";
import {
  isSystemInit,
  isSystemStatus,
  isSystemTaskStarted,
  isSystemTaskNotification,
  isStreamEvent,
  isToolProgress,
  isRateLimit,
  isPromptSuggestion,
  type ContentBlock,
  type ResultSuccessMessage,
} from "./sdk-types.js";
import type pino from "pino";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
}

interface SessionCallbacks {
  onAssistantMessage: (text: string) => void;
  onStreamDelta: (text: string) => void;
  onThinkingDelta: (text: string) => void;
  onToolUse: (toolName: string, input: Record<string, unknown>) => void;
  onToolProgress: (toolName: string, elapsedSeconds: number) => void;
  onTaskStarted: (taskId: string, prompt: string) => void;
  onTaskNotification: (taskId: string, status: string, summary: string) => void;
  onRateLimit: (status: string, resetsAt: number | null) => void;
  onCompacting: (isCompacting: boolean) => void;
  onPromptSuggestion: (suggestion: string) => void;
  onResult: (result: string, costUsd: number, usage: TokenUsage | null) => void;
  onError: (error: string) => void;
  onStreamEnd: () => void;
  onSessionId: (sessionId: string) => void;
  onPermissionRequest: (
    toolName: string,
    input: Record<string, unknown>,
    respond: (result: SDKPermissionResult) => void,
  ) => Promise<void>;
}

export class SessionManager {
  private project: ProjectConfig;
  private config: AppConfig;
  private logger: pino.Logger;
  private callbacks: SessionCallbacks;
  private currentQuery: Query | null = null;
  private _currentSessionId: string | null = null;
  private abortController: AbortController | null = null;
  private sessionAllowedTools = new Set<string>();
  private sessionPermissionMode: PermissionMode | null = null;
  private sessionModel: string | null = null;
  private threadId: string | undefined;

  constructor(
    project: ProjectConfig,
    config: AppConfig,
    logger: pino.Logger,
    callbacks: SessionCallbacks,
    threadId?: string,
  ) {
    this.project = project;
    this.config = config;
    this.logger = logger;
    this.callbacks = callbacks;
    this.threadId = threadId;
  }

  private get sessionKey(): string {
    return this.threadId ? `${this.project.name}/${this.threadId}` : this.project.name;
  }

  get currentSessionId(): string | null {
    return this._currentSessionId;
  }

  async sendMessage(text: string): Promise<void> {
    if (this._currentSessionId) {
      await this.startSession(text, this._currentSessionId);
    } else {
      await this.startSession(text);
    }
  }

  async startSession(prompt: string, resumeId?: string): Promise<void> {
    this.close();

    const model = this.sessionModel ?? this.project.model ?? this.config.defaults.model;
    const permissionMode = (this.sessionPermissionMode ??
      this.project.permissionMode ??
      this.config.defaults.permissionMode) as PermissionMode;
    const allowedTools = this.project.allowedTools ?? this.config.defaults.allowedTools;
    const effort = this.config.defaults.effort;
    const thinking = this.config.defaults.thinking;
    const maxTurns = this.config.defaults.maxTurns;

    this.abortController = new AbortController();

    const resumeValue = resumeId || getLastSessionId(this.sessionKey);
    const resume = resumeValue && resumeValue.length > 0 ? resumeValue : undefined;

    this.currentQuery = query({
      prompt,
      options: {
        cwd: this.project.path,
        model,
        permissionMode: permissionMode as SDKPermissionMode,
        allowedTools,
        settingSources: this.config.defaults.settingSources as ("user" | "project" | "local")[],
        systemPrompt: buildSystemPrompt(),
        abortController: this.abortController,
        includePartialMessages: true,
        enableFileCheckpointing: true,
        promptSuggestions: true,
        ...(resume ? { resume } : {}),
        ...(effort ? { effort } : {}),
        ...(thinking ? { thinking: { type: thinking } } : {}),
        ...(maxTurns ? { maxTurns } : {}),
        stderr: (data: string) => {
          this.logger.warn({ stderr: data.trim() }, "Claude stderr");
        },
        canUseTool: async (toolName, input, _options) => {
          if (toolName === "ExitPlanMode" || toolName === "EnterPlanMode") {
            return { behavior: "allow" } satisfies SDKPermissionResult;
          }
          if (this.sessionAllowedTools.has(toolName)) {
            return { behavior: "allow" } satisfies SDKPermissionResult;
          }
          return new Promise<SDKPermissionResult>((resolve) => {
            this.callbacks.onPermissionRequest(toolName, input as Record<string, unknown>, resolve);
          });
        },
      },
    });

    await this.consumeMessages();
  }

  private async consumeMessages(): Promise<void> {
    if (!this.currentQuery) return;

    try {
      for await (const message of this.currentQuery) {
        this.handleMessage(message);
      }
    } catch (err) {
      this.logger.error({ err }, "Error consuming messages");
      this.callbacks.onError(String(err));
    } finally {
      this.callbacks.onStreamEnd();
    }
  }

  private handleMessage(message: SDKMessage): void {
    if (isSystemInit(message)) {
      this._currentSessionId = message.session_id;
      saveSessionId(this.sessionKey, message.session_id);
      this.callbacks.onSessionId(message.session_id);
      this.logger.info({ sessionId: message.session_id }, "Session initialized");
    } else if (isSystemStatus(message)) {
      this.callbacks.onCompacting(message.status === "compacting");
    } else if (isSystemTaskStarted(message)) {
      this.callbacks.onTaskStarted(message.task_id ?? "", message.prompt ?? "");
    } else if (isSystemTaskNotification(message)) {
      this.callbacks.onTaskNotification(message.task_id ?? "", message.status ?? "completed", message.summary ?? "");
    } else if (isStreamEvent(message)) {
      const event = message.event;
      if (event?.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && event.delta.text) {
          this.callbacks.onStreamDelta(event.delta.text);
        } else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
          this.callbacks.onThinkingDelta(event.delta.thinking);
        }
      }
    } else if (isToolProgress(message)) {
      this.callbacks.onToolProgress(message.tool_name ?? "tool", message.elapsed_time_seconds ?? 0);
    } else if (isRateLimit(message)) {
      const info = message.rate_limit_info ?? {};
      this.callbacks.onRateLimit(info.status ?? "unknown", info.resetsAt ?? null);
    } else if (isPromptSuggestion(message)) {
      if (message.suggestion) {
        this.callbacks.onPromptSuggestion(message.suggestion);
      }
    } else if (message.type === "assistant") {
      const content = message.message.content as ContentBlock[];
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      if (text) {
        this.callbacks.onAssistantMessage(text);
      }
      for (const block of content) {
        if (block.type === "tool_use" && block.name) {
          this.callbacks.onToolUse(block.name, (block.input ?? {}) as Record<string, unknown>);
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        const usage = this.extractUsage(message as unknown as ResultSuccessMessage);
        this.callbacks.onResult(message.result, message.total_cost_usd, usage);
      } else {
        const errors = (message as { errors?: string[] }).errors;
        const errorMsg = errors && errors.length > 0 ? errors.join(", ") : `Session ended: ${message.subtype}`;
        this.callbacks.onError(errorMsg);
      }
    }
  }

  newSession(): void {
    this.close();
    this._currentSessionId = null;
    this.sessionAllowedTools.clear();
    this.sessionPermissionMode = null;
    this.sessionModel = null;
    saveSessionId(this.sessionKey, "");
    this.logger.info("New session requested");
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.close();
    await this.startSession("Continue from where we left off.", sessionId);
  }

  interrupt(): void {
    if (this.currentQuery) {
      this.currentQuery.interrupt().catch(() => {});
    }
  }

  async setModel(model: string): Promise<void> {
    this.sessionModel = model;
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
    }
    this.logger.info({ model }, "Model changed (session-level)");
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.sessionPermissionMode = mode as PermissionMode;
    if (this.currentQuery) {
      await this.currentQuery.setPermissionMode(mode as SDKPermissionMode);
    }
    this.logger.info({ mode }, "Permission mode changed (session-level)");
  }

  async listSessions(): Promise<{ text: string; sessions: { sessionId: string; summary: string }[] }> {
    try {
      const sessions = await listSessions({ dir: this.project.path, limit: 10 });
      if (sessions.length === 0) {
        return { text: "No past sessions found.", sessions: [] };
      }
      const lines = sessions.map((s, i) => {
        const date = new Date(s.lastModified).toLocaleDateString();
        const summary = s.summary.slice(0, 60);
        const id = s.sessionId.slice(0, 8);
        return `${i + 1}. \`${id}\` ${date}\n   ${summary}`;
      });
      return {
        text: `**Past Sessions:**\n\n${lines.join("\n\n")}`,
        sessions: sessions.map((s) => ({ sessionId: s.sessionId, summary: s.summary })),
      };
    } catch (err) {
      return { text: `Error listing sessions: ${String(err)}`, sessions: [] };
    }
  }

  private extractUsage(message: ResultSuccessMessage): TokenUsage | null {
    try {
      const modelUsage = message.modelUsage;
      if (!modelUsage) return null;

      const models = Object.values(modelUsage);
      if (models.length === 0) return null;

      const model = models[0];
      return {
        inputTokens: model.inputTokens ?? 0,
        outputTokens: model.outputTokens ?? 0,
        cacheReadTokens: model.cacheReadInputTokens ?? 0,
        cacheCreationTokens: model.cacheCreationInputTokens ?? 0,
        contextWindow: model.contextWindow ?? 0,
        maxOutputTokens: model.maxOutputTokens ?? 0,
      };
    } catch {
      return null;
    }
  }

  addSessionAllowedTool(toolName: string): void {
    this.sessionAllowedTools.add(toolName);
    this.logger.info({ toolName }, "Tool added to session allow list");
  }

  clearSessionState(): void {
    removeSessionEntry(this.sessionKey);
    this.logger.info({ sessionKey: this.sessionKey }, "Session state cleared");
  }

  close(): void {
    if (this.currentQuery) {
      this.currentQuery.close();
      this.currentQuery = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
