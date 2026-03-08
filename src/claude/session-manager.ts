import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage, PermissionMode as SDKPermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig, ProjectConfig, PermissionMode } from "../config/types.js";
import { saveSessionId, getLastSessionId } from "../config/state.js";
import { buildSystemPrompt } from "./system-prompt.js";
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
  onRateLimit: (status: string, resetsAt: string | null) => void;
  onCompacting: (isCompacting: boolean) => void;
  onPromptSuggestion: (suggestion: string) => void;
  onResult: (result: string, costUsd: number, usage: TokenUsage | null) => void;
  onError: (error: string) => void;
  onSessionId: (sessionId: string) => void;
  onPermissionRequest: (
    toolName: string,
    input: Record<string, unknown>,
    respond: (result: { behavior: string; message?: string; updatedInput?: Record<string, unknown> }) => void,
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

  constructor(
    project: ProjectConfig,
    config: AppConfig,
    logger: pino.Logger,
    callbacks: SessionCallbacks,
  ) {
    this.project = project;
    this.config = config;
    this.logger = logger;
    this.callbacks = callbacks;
  }

  get currentSessionId(): string | null {
    return this._currentSessionId;
  }

  async sendMessage(text: string): Promise<void> {
    if (this._currentSessionId) {
      // Multi-turn: start a new query that resumes the existing session
      await this.startSession(text, this._currentSessionId);
    } else {
      // First message: create new session
      await this.startSession(text);
    }
  }

  async startSession(prompt: string, resumeId?: string): Promise<void> {
    this.close();

    const model = this.project.model ?? this.config.defaults.model;
    const permissionMode = (this.project.permissionMode ?? this.config.defaults.permissionMode) as PermissionMode;
    const allowedTools = this.project.allowedTools ?? this.config.defaults.allowedTools;
    const effort = this.config.defaults.effort;
    const thinking = this.config.defaults.thinking;
    const maxTurns = this.config.defaults.maxTurns;

    this.abortController = new AbortController();

    // Check for last session to resume on first start
    const resumeValue = resumeId || getLastSessionId(this.project.name);
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
          // Check session-level allow list first
          if (this.sessionAllowedTools.has(toolName)) {
            return { behavior: "allow" } as any;
          }
          return new Promise((resolve) => {
            this.callbacks.onPermissionRequest(toolName, input as Record<string, unknown>, (result) => {
              resolve(result as any);
            });
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
    }
  }

  private handleMessage(message: SDKMessage): void {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this._currentSessionId = message.session_id;
          saveSessionId(this.project.name, message.session_id);
          this.callbacks.onSessionId(message.session_id);
          this.logger.info({ sessionId: message.session_id }, "Session initialized");
        } else if (message.subtype === "status") {
          const status = (message as any).status;
          this.callbacks.onCompacting(status === "compacting");
        }
        break;

      case "stream_event": {
        const event = (message as any).event;
        if (event?.type === "content_block_delta") {
          if (event.delta?.type === "text_delta" && event.delta.text) {
            this.callbacks.onStreamDelta(event.delta.text);
          } else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
            this.callbacks.onThinkingDelta(event.delta.thinking);
          }
        }
        break;
      }

      case "tool_progress": {
        const msg = message as any;
        this.callbacks.onToolProgress(msg.tool_name ?? "tool", msg.elapsed_time_seconds ?? 0);
        break;
      }

      case "task_started": {
        const msg = message as any;
        this.callbacks.onTaskStarted(msg.task_id ?? "", msg.prompt ?? "");
        break;
      }

      case "task_notification": {
        const msg = message as any;
        this.callbacks.onTaskNotification(
          msg.task_id ?? "",
          msg.status ?? "completed",
          msg.summary ?? "",
        );
        break;
      }

      case "rate_limit_event": {
        const msg = message as any;
        const info = msg.rate_limit_info ?? {};
        this.callbacks.onRateLimit(info.status ?? "unknown", info.resetsAt ?? null);
        break;
      }

      case "prompt_suggestion": {
        const msg = message as any;
        if (msg.suggestion) {
          this.callbacks.onPromptSuggestion(msg.suggestion);
        }
        break;
      }

      case "assistant": {
        const text = message.message.content
          .filter((block: any) => block.type === "text")
          .map((block: any) => block.text)
          .join("");
        if (text) {
          this.callbacks.onAssistantMessage(text);
        }
        for (const block of message.message.content) {
          if ((block as any).type === "tool_use") {
            this.callbacks.onToolUse(
              (block as any).name,
              (block as any).input as Record<string, unknown>,
            );
          }
        }
        break;
      }

      case "result": {
        if (message.subtype === "success") {
          const usage = this.extractUsage(message);
          this.callbacks.onResult(message.result, message.total_cost_usd, usage);
        } else {
          const errors = (message as { errors?: string[] }).errors;
          const errorMsg = errors && errors.length > 0
            ? errors.join(", ")
            : `Session ended: ${message.subtype}`;
          this.callbacks.onError(errorMsg);
        }
        break;
      }
    }
  }

  newSession(): void {
    this.close();
    this._currentSessionId = null;
    this.sessionAllowedTools.clear();
    saveSessionId(this.project.name, "");
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
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
      this.logger.info({ model }, "Model changed");
    }
    this.project.model = model;
  }

  async setPermissionMode(mode: string): Promise<void> {
    if (this.currentQuery) {
      await this.currentQuery.setPermissionMode(mode as SDKPermissionMode);
      this.logger.info({ mode }, "Permission mode changed");
    }
    this.project.permissionMode = mode as PermissionMode;
  }

  async listSessions(): Promise<string> {
    try {
      const sessions = await listSessions({ dir: this.project.path, limit: 10 });
      if (sessions.length === 0) {
        return "No past sessions found.";
      }
      const lines = sessions.map((s, i) => {
        const date = new Date(s.lastModified).toLocaleDateString();
        const summary = s.summary.slice(0, 60);
        const id = s.sessionId.slice(0, 8);
        return `${i + 1}. <code>${id}</code> ${date}\n   ${summary}`;
      });
      return `<b>Past Sessions:</b>\n\n${lines.join("\n\n")}`;
    } catch (err) {
      return `Error listing sessions: ${String(err)}`;
    }
  }

  private extractUsage(message: any): TokenUsage | null {
    try {
      const modelUsage = message.modelUsage;
      if (!modelUsage) return null;

      // Get the first (usually only) model's usage
      const models = Object.values(modelUsage) as any[];
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
