import { describe, it, expect } from "vitest";
import { escapeMarkdown, formatForDiscord, formatToolUse } from "./formatting.js";

describe("escapeMarkdown", () => {
  it("escapes special characters", () => {
    expect(escapeMarkdown("*bold*")).toBe("\\*bold\\*");
    expect(escapeMarkdown("_italic_")).toBe("\\_italic\\_");
    expect(escapeMarkdown("~strike~")).toBe("\\~strike\\~");
    expect(escapeMarkdown("`code`")).toBe("\\`code\\`");
    expect(escapeMarkdown("|table|")).toBe("\\|table\\|");
    expect(escapeMarkdown("> quote")).toBe("\\> quote");
    expect(escapeMarkdown("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeMarkdown("Hello world")).toBe("Hello world");
    expect(escapeMarkdown("abc 123 !@#$%^&()")).toBe("abc 123 !@#$%^&()");
  });
});

describe("formatForDiscord", () => {
  it("normalizes \\r\\n to \\n", () => {
    expect(formatForDiscord("line1\r\nline2")).toBe("line1\nline2");
  });

  it("trims trailing whitespace per line", () => {
    expect(formatForDiscord("hello   \nworld\t")).toBe("hello\nworld");
  });

  it("passes through standard Markdown", () => {
    const md = "**bold** *italic* `code` [link](url)";
    expect(formatForDiscord(md)).toBe(md);
  });
});

describe("formatToolUse", () => {
  it("formats Bash commands", () => {
    const result = formatToolUse("Bash", { command: "ls -la" });
    expect(result).toContain("ls -la");
  });

  it("truncates long Bash commands", () => {
    const longCmd = "a".repeat(100);
    const result = formatToolUse("Bash", { command: longCmd });
    expect(result).toContain("...");
  });

  it("formats Read file", () => {
    const result = formatToolUse("Read", { file_path: "/src/index.ts" });
    expect(result).toContain("Reading");
    expect(result).toContain("/src/index.ts");
  });

  it("formats Edit file", () => {
    const result = formatToolUse("Edit", { file_path: "/src/index.ts" });
    expect(result).toContain("Editing");
  });

  it("formats Write file", () => {
    const result = formatToolUse("Write", { file_path: "/src/index.ts" });
    expect(result).toContain("Writing");
  });

  it("formats Glob search", () => {
    const result = formatToolUse("Glob", { pattern: "**/*.ts" });
    expect(result).toContain("Searching files");
    expect(result).toContain("\\*\\*/\\*.ts");
  });

  it("formats Grep search", () => {
    const result = formatToolUse("Grep", { pattern: "TODO" });
    expect(result).toContain("Searching content");
    expect(result).toContain("TODO");
  });

  it("formats WebSearch", () => {
    const result = formatToolUse("WebSearch", { query: "vitest docs" });
    expect(result).toContain("Searching");
    expect(result).toContain("vitest docs");
  });

  it("formats unknown tool", () => {
    const result = formatToolUse("CustomTool", {});
    expect(result).toContain("Using");
    expect(result).toContain("CustomTool");
  });
});
