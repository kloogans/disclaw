/**
 * Escape Discord Markdown special characters in user-supplied text.
 * Used for text that should be displayed literally (e.g. file paths in status messages).
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_~`|>\\])/g, "\\$1");
}

/**
 * Format Claude's Markdown response for Discord.
 * Discord renders Markdown natively, so this is mostly a pass-through.
 * We only need to ensure the output is clean and well-formed.
 */
export function formatForDiscord(text: string): string {
  // Discord handles standard Markdown natively:
  // - Code blocks (``` ```)
  // - Inline code (` `)
  // - Bold (**text**)
  // - Italic (*text*)
  // - Strikethrough (~~text~~)
  // - Blockquotes (> text)
  // - Links [text](url)
  // - Headings (rendered as bold in Discord, but still valid)
  // - Lists (rendered as-is)

  // Just trim trailing whitespace per line and normalize line endings
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
}

/**
 * Format a tool use notification for Discord status updates.
 */
export function formatToolUse(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      const short = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
      return `\u2699\uFE0F \`${escapeMarkdown(short)}\``;
    }
    case "Read":
      return `\uD83D\uDCC4 Reading ${escapeMarkdown(String(input.file_path ?? "file"))}`;
    case "Edit":
      return `\u270F\uFE0F Editing ${escapeMarkdown(String(input.file_path ?? "file"))}`;
    case "Write":
      return `\uD83D\uDCDD Writing ${escapeMarkdown(String(input.file_path ?? "file"))}`;
    case "Glob":
      return `\uD83D\uDD0D Searching files: ${escapeMarkdown(String(input.pattern ?? ""))}`;
    case "Grep":
      return `\uD83D\uDD0D Searching content: ${escapeMarkdown(String(input.pattern ?? ""))}`;
    case "WebSearch":
      return `\uD83C\uDF10 Searching: ${escapeMarkdown(String(input.query ?? ""))}`;
    case "Agent":
      return `\uD83E\uDD16 Running subagent...`;
    default:
      return `\uD83D\uDD27 Using ${escapeMarkdown(toolName)}`;
  }
}
