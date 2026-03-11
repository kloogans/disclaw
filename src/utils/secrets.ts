const SECRET_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/, name: "API key (sk-)" },
  { pattern: /AKIA[0-9A-Z]{16}/, name: "AWS access key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub token" },
  { pattern: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth token" },
  { pattern: /glpat-[a-zA-Z0-9\-_]{20,}/, name: "GitLab token" },
  { pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, name: "Private key" },
  { pattern: /-----BEGIN CERTIFICATE-----/, name: "Certificate" },
  { pattern: /xoxb-[0-9]{10,}-[a-zA-Z0-9]{20,}/, name: "Slack bot token" },
  { pattern: /xoxp-[0-9]{10,}-[a-zA-Z0-9]{20,}/, name: "Slack user token" },
  { pattern: /sk-ant-api\d{2}-[a-zA-Z0-9_\-]{20,}/, name: "Anthropic API key" },
  { pattern: /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/, name: "Discord bot token" },
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, name: "JWT token" },
  {
    pattern: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s"'`]+:[^\s"'`]+@[^\s"'`]+/,
    name: "Database connection string",
  },
  { pattern: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/i, name: "Bearer token" },
];

/**
 * Replace all detected secrets in text with [REDACTED].
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern } of SECRET_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    result = result.replace(global, "[REDACTED]");
  }
  return result;
}

/**
 * Scan text for potential secrets. Returns warning message or null.
 */
export function scanForSecrets(text: string): string | null {
  const found: string[] = [];
  for (const { pattern, name } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      found.push(name);
    }
  }
  if (found.length === 0) return null;
  return `⚠️ Potential secrets detected: ${found.join(", ")}. Discord is not E2E encrypted.`;
}
