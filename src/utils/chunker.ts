const TELEGRAM_MAX_LENGTH = 4096;
const RESERVED_CHARS = 50;

/**
 * Split a long message into chunks that fit within Telegram's 4096 char limit.
 * Splits at natural boundaries: double newlines > single newlines > spaces.
 * Avoids splitting inside HTML tags and re-opens any unclosed tags in the next chunk.
 */
export function chunkMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH - RESERVED_CHARS): string[] {
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

    // Avoid splitting inside an HTML tag (e.g. <pre><code class="...">)
    const lastOpenBracket = remaining.lastIndexOf("<", splitIndex);
    if (lastOpenBracket > -1 && lastOpenBracket > splitIndex - 100) {
      const closingBracket = remaining.indexOf(">", lastOpenBracket);
      if (closingBracket === -1 || closingBracket >= splitIndex) {
        // We're inside an unclosed tag — split before it
        splitIndex = lastOpenBracket;
      }
    }

    let chunk = remaining.slice(0, splitIndex).trimEnd();
    remaining = remaining.slice(splitIndex).trimStart();

    // Close any unclosed HTML tags in this chunk and re-open in the next
    const { closed, reopened } = balanceHtmlTags(chunk);
    chunk = closed;
    if (reopened && remaining.length > 0) {
      remaining = reopened + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Find unclosed HTML tags and close them. Returns the closed string
 * and the tags to re-open in the next chunk.
 */
function balanceHtmlTags(text: string): { closed: string; reopened: string } {
  const tagStack: string[] = [];
  const tagRegex = /<\/?([a-z][a-z0-9]*)[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();

    // Skip self-closing and void elements
    if (fullMatch.endsWith("/>") || ["br", "hr", "img", "input"].includes(tagName)) {
      continue;
    }

    if (fullMatch.startsWith("</")) {
      // Closing tag — pop matching open tag
      const lastIndex = tagStack.lastIndexOf(tagName);
      if (lastIndex >= 0) tagStack.splice(lastIndex, 1);
    } else {
      tagStack.push(tagName);
    }
  }

  if (tagStack.length === 0) {
    return { closed: text, reopened: "" };
  }

  // Close unclosed tags in reverse order
  const closingTags = [...tagStack].reverse().map((t) => `</${t}>`).join("");
  // Re-open them in original order for the next chunk
  const openingTags = tagStack.map((t) => `<${t}>`).join("");

  return { closed: text + closingTags, reopened: openingTags };
}
