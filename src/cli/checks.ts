import { execSync } from "node:child_process";
import { platform } from "node:os";

export interface CheckResult {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
}

export function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  const pass = major >= 22;
  return {
    label: "Node.js >= 22",
    pass,
    detail: pass ? version : `${version} — upgrade: ${platform() === "darwin" ? "brew install node" : "https://nodejs.org"}`,
  };
}

export function checkFfmpeg(): CheckResult {
  let pass = false;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    pass = true;
  } catch {}
  return {
    label: "ffmpeg installed",
    pass,
    detail: pass ? "found in PATH" : `not found — install: ${platform() === "darwin" ? "brew install ffmpeg" : "https://ffmpeg.org"}`,
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
  const results = [checkNodeVersion(), checkFfmpeg(), checkClaudeAuth()];
  const allPassed = results.every((r) => r.pass);
  return { allPassed, results };
}

export function printCheckResults(results: CheckResult[]): void {
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`  ${icon} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  }
}

export async function validateBotToken(token: string): Promise<{ valid: boolean; botInfo?: BotInfo; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok?: boolean; result?: { id: number; username: string; first_name: string }; description?: string };
    if (data.ok && data.result) {
      return {
        valid: true,
        botInfo: {
          id: data.result.id,
          username: data.result.username,
          first_name: data.result.first_name,
        },
      };
    }
    return { valid: false, error: data.description || "Invalid token" };
  } catch (err) {
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
