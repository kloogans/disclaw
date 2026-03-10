import { describe, it, expect } from "vitest";
import { chunkMessage } from "./chunker.js";

describe("chunkMessage", () => {
  it("returns a single chunk for short messages", () => {
    const result = chunkMessage("Hello, world!");
    expect(result).toEqual(["Hello, world!"]);
  });

  it("splits at paragraph boundary (double newline)", () => {
    const para1 = "A".repeat(80);
    const para2 = "B".repeat(80);
    const text = `${para1}\n\n${para2}`;
    const result = chunkMessage(text, 100);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(para1);
    expect(result[1]).toBe(para2);
  });

  it("splits at single newline when no paragraph boundary", () => {
    const line1 = "A".repeat(60);
    const line2 = "B".repeat(60);
    const text = `${line1}\n${line2}`;
    const result = chunkMessage(text, 80);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(line1);
    expect(result[1]).toBe(line2);
  });

  it("splits at space when no newline boundary", () => {
    const word1 = "A".repeat(50);
    const word2 = "B".repeat(50);
    const text = `${word1} ${word2}`;
    const result = chunkMessage(text, 70);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(word1);
    expect(result[1]).toBe(word2);
  });

  it("hard splits when no natural boundary", () => {
    const text = "A".repeat(200);
    const result = chunkMessage(text, 100);
    expect(result.length).toBe(2);
    expect(result[0]).toBe("A".repeat(100));
    expect(result[1]).toBe("A".repeat(100));
  });

  it("closes unclosed code blocks and re-opens them in next chunk", () => {
    const code = "x".repeat(60);
    const after = "y".repeat(20);
    const text = `\`\`\`ts\n${code}\n${after}`;
    const result = chunkMessage(text, 80);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should end with a closing fence
    expect(result[0]).toMatch(/```$/);
    // Second chunk should start with a re-opening fence
    expect(result[1]).toMatch(/^```ts\n/);
  });
});
