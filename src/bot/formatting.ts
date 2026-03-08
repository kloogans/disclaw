/**
 * Escape special characters for Telegram HTML parse mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert markdown from Claude's responses to Telegram HTML.
 * Handles: code blocks, inline code, bold, italic, headings,
 * blockquotes, links, strikethrough, lists, horizontal rules.
 */
export function markdownToTelegramHtml(text: string): string {
  let result = text;

  // Preserve code blocks first (``` ... ```)
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const escapedCode = escapeHtml(code.trimEnd());
    codeBlocks.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapedCode}</code></pre>`);
    return `\x00CODEBLOCK${index}\x00`;
  });

  // Preserve inline code (` ... `)
  const inlineCode: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    const index = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${index}\x00`;
  });

  // Escape HTML in remaining text
  result = escapeHtml(result);

  // Headings (# ... ######) -> bold text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Blockquotes (> text) -> <blockquote>
  // Collapse consecutive blockquote lines into one block
  result = result.replace(/(?:^&gt;\s?(.*)$\n?)+/gm, (match) => {
    const lines = match
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.replace(/^&gt;\s?/, ""))
      .join("\n");
    return `<blockquote>${lines}</blockquote>\n`;
  });

  // Links [text](url) -> <a href="url">text</a>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic (*text* or _text_)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");

  // Strikethrough (~~text~~)
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Horizontal rules (---, ***, ___) -> thin line
  result = result.replace(/^[-*_]{3,}\s*$/gm, "---");

  // Restore code blocks and inline code
  result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, (_match, index) => codeBlocks[parseInt(index)]);
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_match, index) => inlineCode[parseInt(index)]);

  return result;
}

/**
 * Format a tool use notification for Telegram status updates.
 */
export function formatToolUse(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      const short = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
      return `\u2699\uFE0F <code>${escapeHtml(short)}</code>`;
    }
    case "Read":
      return `\uD83D\uDCC4 Reading ${escapeHtml(String(input.file_path ?? "file"))}`;
    case "Edit":
      return `\u270F\uFE0F Editing ${escapeHtml(String(input.file_path ?? "file"))}`;
    case "Write":
      return `\uD83D\uDCDD Writing ${escapeHtml(String(input.file_path ?? "file"))}`;
    case "Glob":
      return `\uD83D\uDD0D Searching files: ${escapeHtml(String(input.pattern ?? ""))}`;
    case "Grep":
      return `\uD83D\uDD0D Searching content: ${escapeHtml(String(input.pattern ?? ""))}`;
    case "WebSearch":
      return `\uD83C\uDF10 Searching: ${escapeHtml(String(input.query ?? ""))}`;
    case "Agent":
      return `\uD83E\uDD16 Running subagent...`;
    default:
      return `\uD83D\uDD27 Using ${escapeHtml(toolName)}`;
  }
}
