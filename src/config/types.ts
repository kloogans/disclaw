export interface ProjectConfig {
  name: string;
  path: string;
  channelId: string;
  channelType?: "text" | "forum";
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";

export type Effort = "low" | "medium" | "high" | "max";

export type ThinkingMode = "adaptive" | "enabled" | "disabled";

export interface DefaultsConfig {
  model: string;
  permissionMode: PermissionMode;
  allowedTools: string[];
  settingSources: string[];
  effort?: Effort;
  thinking?: ThinkingMode;
  maxTurns?: number;
}

export interface AppConfig {
  discordBotToken: string;
  discordGuildId: string;
  authorizedUsers: string[];
  defaults: DefaultsConfig;
  messageBatchDelayMs: number;
  permissionTimeoutMs: number;
  maxResponseChars: number;
  projects: ProjectConfig[];
}

export interface AppState {
  sessions: Record<string, string>;
  pid?: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  discordBotToken: "",
  discordGuildId: "",
  authorizedUsers: [],
  defaults: {
    model: "claude-sonnet-4-6",
    permissionMode: "default",
    allowedTools: ["Read", "Glob", "Grep", "WebSearch"],
    settingSources: ["user", "project"],
  },
  messageBatchDelayMs: 3000,
  permissionTimeoutMs: 300000,
  maxResponseChars: 50000,
  projects: [],
};
