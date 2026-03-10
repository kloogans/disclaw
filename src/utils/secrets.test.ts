import { describe, it, expect } from "vitest";
import { scanForSecrets } from "./secrets.js";

describe("scanForSecrets", () => {
  it("returns null for clean text", () => {
    expect(scanForSecrets("Just a normal message")).toBeNull();
  });

  it("detects API key (sk-...)", () => {
    const result = scanForSecrets("My key is sk-abcdefghijklmnopqrstuvwxyz");
    expect(result).not.toBeNull();
    expect(result).toContain("API key");
  });

  it("detects AWS access key (AKIA...)", () => {
    const result = scanForSecrets("AKIA1234567890ABCDEF");
    expect(result).not.toBeNull();
    expect(result).toContain("AWS access key");
  });

  it("detects GitHub token (ghp_...)", () => {
    const result = scanForSecrets("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(result).not.toBeNull();
    expect(result).toContain("GitHub token");
  });

  it("detects private key header", () => {
    const result = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----");
    expect(result).not.toBeNull();
    expect(result).toContain("Private key");
  });

  it("detects multiple secrets in one text", () => {
    const text = "sk-abcdefghijklmnopqrstuvwxyz and AKIA1234567890ABCDEF";
    const result = scanForSecrets(text);
    expect(result).not.toBeNull();
    expect(result).toContain("API key");
    expect(result).toContain("AWS access key");
  });
});
