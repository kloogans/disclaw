const DISCORD_MAX_LENGTH = 2000;
const RESERVED_CHARS = 50;

/**
 * Split a long message into chunks that fit within Discord's 2000 char limit.
 * Splits at natural boundaries: double newlines > single newlines > spaces.
 * Avoids splitting inside Markdown code blocks — closes and re-opens them across chunks.
 */
export function chunkMessage(text: string, maxLength = DISCORD_MAX_LENGTH - RESERVED_CHARS): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // Try splitting at double newline (paragraph boundary)
    const doubleNewline = remaining.lastIndexOf("\n\n", maxLength);
    if (doubleNewline > maxLength * 0.3) {
      splitIndex = doubleNewline + 2;
    }

    // Try single newline
    if (splitIndex === -1) {
      const singleNewline = remaining.lastIndexOf("\n", maxLength);
      if (singleNewline > maxLength * 0.3) {
        splitIndex = singleNewline + 1;
      }
    }

    // Try space
    if (splitIndex === -1) {
      const space = remaining.lastIndexOf(" ", maxLength);
      if (space > maxLength * 0.3) {
        splitIndex = space + 1;
      }
    }

    // Hard split as last resort
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    let chunk = remaining.slice(0, splitIndex).trimEnd();
    remaining = remaining.slice(splitIndex).trimStart();

    // Handle Markdown code block continuity across chunks
    const { closed, prefix } = balanceCodeBlocks(chunk);
    chunk = closed;
    if (prefix && remaining.length > 0) {
      remaining = prefix + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Track open triple-backtick code blocks. If a chunk ends inside an unclosed
 * code block, close it and return a re-opening fence for the next chunk.
 */
function balanceCodeBlocks(text: string): { closed: string; prefix: string } {
  // Count triple-backtick fences to determine if we're inside a code block
  const fenceRegex = /^```(\w*)/gm;
  let insideBlock = false;
  let language = "";
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (insideBlock) {
      // This is a closing fence
      insideBlock = false;
      language = "";
    } else {
      // This is an opening fence
      insideBlock = true;
      language = match[1];
    }
  }

  if (!insideBlock) {
    return { closed: text, prefix: "" };
  }

  // We're inside an unclosed code block — close it and prepare re-opener
  return {
    closed: text + "\n```",
    prefix: "```" + language + "\n",
  };
}
