/**
 * Type definitions for Claude Agent SDK message subtypes.
 * These fill gaps in the SDK's exported types.
 */

export interface SystemInitMessage {
  type: "system";
  subtype: "init";
  session_id: string;
}

export interface SystemStatusMessage {
  type: "system";
  subtype: "status";
  status: string;
}

export interface SystemTaskStartedMessage {
  type: "system";
  subtype: "task_started";
  task_id?: string;
  prompt?: string;
}

export interface SystemTaskNotificationMessage {
  type: "system";
  subtype: "task_notification";
  task_id?: string;
  status?: string;
  summary?: string;
}

export interface StreamEventMessage {
  type: "stream_event";
  event?: {
    type: string;
    delta?: {
      type: string;
      text?: string;
      thinking?: string;
    };
  };
}

export interface ToolProgressMessage {
  type: "tool_progress";
  tool_name?: string;
  elapsed_time_seconds?: number;
}

export interface RateLimitMessage {
  type: "rate_limit_event";
  rate_limit_info?: {
    status?: string;
    resetsAt?: number;
  };
}

export interface PromptSuggestionMessage {
  type: "prompt_suggestion";
  suggestion?: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AssistantMessage {
  type: "assistant";
  message: {
    content: ContentBlock[];
  };
}

export interface ResultSuccessMessage {
  type: "result";
  subtype: "success";
  result: string;
  total_cost_usd: number;
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      contextWindow?: number;
      maxOutputTokens?: number;
    }
  >;
}

export interface ResultErrorMessage {
  type: "result";
  subtype: string;
  errors?: string[];
}

// Type guards

export function isSystemInit(msg: { type: string; subtype?: string }): msg is SystemInitMessage {
  return msg.type === "system" && msg.subtype === "init";
}

export function isSystemStatus(msg: { type: string; subtype?: string }): msg is SystemStatusMessage {
  return msg.type === "system" && msg.subtype === "status";
}

export function isSystemTaskStarted(msg: { type: string; subtype?: string }): msg is SystemTaskStartedMessage {
  return msg.type === "system" && msg.subtype === "task_started";
}

export function isSystemTaskNotification(msg: {
  type: string;
  subtype?: string;
}): msg is SystemTaskNotificationMessage {
  return msg.type === "system" && msg.subtype === "task_notification";
}

export function isStreamEvent(msg: { type: string }): msg is StreamEventMessage {
  return msg.type === "stream_event";
}

export function isToolProgress(msg: { type: string }): msg is ToolProgressMessage {
  return msg.type === "tool_progress";
}

export function isRateLimit(msg: { type: string }): msg is RateLimitMessage {
  return msg.type === "rate_limit_event";
}

export function isPromptSuggestion(msg: { type: string }): msg is PromptSuggestionMessage {
  return msg.type === "prompt_suggestion";
}
