import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage, PermissionMode as SDKPermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig, ProjectConfig, PermissionMode } from "../config/types.js";
import { saveSessionId, getLastSessionId } from "../config/state.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type pino from "pino";

interface SessionCallbacks {
  onAssistantMessage: (text: string) => void;
  onToolUse: (toolName: string, input: Record<string, unknown>) => void;
  onResult: (result: string, costUsd: number) => void;
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
    if (this.currentQuery) {
      // Multi-turn: stream new input into existing session
      const sessionId = this._currentSessionId ?? "";
      await this.currentQuery.streamInput(
        (async function* () {
          yield {
            type: "user" as const,
            session_id: sessionId,
            message: { role: "user" as const, content: [{ type: "text" as const, text }] },
            parent_tool_use_id: null,
          };
        })(),
      );
      await this.consumeMessages();
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
        ...(resume ? { resume } : {}),
        canUseTool: async (toolName, input, _options) => {
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
      this.currentQuery = null;
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
        }
        break;

      case "assistant": {
        const text = message.message.content
          .filter((block: any) => block.type === "text")
          .map((block: any) => block.text)
          .join("");
        if (text) {
          this.callbacks.onAssistantMessage(text);
        }
        // Check for tool_use blocks
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
          this.callbacks.onResult(message.result, message.total_cost_usd);
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
