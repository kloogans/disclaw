const TELEGRAM_MAX_LENGTH = 4096;
const RESERVED_CHARS = 50;

/**
 * Split a long message into chunks that fit within Telegram's 4096 char limit.
 * Splits at natural boundaries: double newlines > single newlines > spaces.
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

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
