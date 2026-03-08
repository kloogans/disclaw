export interface ProjectConfig {
  name: string;
  path: string;
  botToken: string;
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto" | "dontAsk";

export interface WhisperConfig {
  model: string;
  gpu: boolean;
  language: string;
}

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
  authorizedUsers: number[];
  whisper: WhisperConfig;
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
  authorizedUsers: [],
  whisper: {
    model: "base",
    gpu: true,
    language: "auto",
  },
  defaults: {
    model: "sonnet",
    permissionMode: "default",
    allowedTools: ["Read", "Glob", "Grep", "WebSearch"],
    settingSources: ["project"],
  },
  messageBatchDelayMs: 3000,
  permissionTimeoutMs: 300000,
  maxResponseChars: 50000,
  projects: [],
};
