import { execSync } from "node:child_process";

export interface CheckResult {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface BotInfo {
  id: string;
  username: string;
}

// Note: execSync calls below use hardcoded commands, not user input.

export function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  const pass = major >= 22;
  return {
    label: "Node.js >= 22",
    pass,
    detail: pass ? version : `${version} — upgrade: https://nodejs.org`,
  };
}

export function checkClaudeAuth(): CheckResult {
  let pass = false;
  try {
    execSync("claude auth status", { stdio: "ignore" });
    pass = true;
  } catch {}
  return {
    label: "Claude Code authenticated",
    pass,
    detail: pass ? "logged in" : "not authenticated — run: claude auth login",
  };
}

export function runAllPrerequisites(): { allPassed: boolean; results: CheckResult[] } {
  const results = [checkNodeVersion(), checkClaudeAuth()];
  const allPassed = results.every((r) => r.pass);
  return { allPassed, results };
}

export function printCheckResults(results: CheckResult[]): void {
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`  ${icon} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  }
}

/**
 * Validate a Discord bot token by calling the Discord API.
 */
export async function validateDiscordToken(
  token: string,
): Promise<{ valid: boolean; botInfo?: BotInfo; error?: string }> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      return { valid: false, error: `Discord API returned ${res.status}` };
    }
    const data = (await res.json()) as { id?: string; username?: string };
    if (data.id && data.username) {
      return {
        valid: true,
        botInfo: { id: data.id, username: data.username },
      };
    }
    return { valid: false, error: "Unexpected response from Discord" };
  } catch (err) {
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
