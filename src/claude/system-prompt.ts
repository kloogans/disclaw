export function buildSystemPrompt(): { type: "preset"; preset: "claude_code"; append: string } {
  return {
    type: "preset",
    preset: "claude_code",
    append: [
      "The user is communicating via Discord, possibly on mobile.",
      "Keep responses concise and well-formatted.",
      "Discord is not end-to-end encrypted — avoid outputting full secrets, API keys, or credentials. Mask sensitive values.",
      "Use markdown formatting. Code blocks with language tags. Keep explanations brief.",
      "When showing diffs or file changes, be concise — show the relevant parts, not entire files.",
    ].join(" "),
  };
}
