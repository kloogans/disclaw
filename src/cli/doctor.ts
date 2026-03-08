import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { configExists, loadConfig, getConfigDir } from "../config/store.js";
import { isDaemonRunning } from "../config/state.js";

export async function doctorCommand(): Promise<void> {
  let ok = true;
  const check = (label: string, pass: boolean, detail?: string) => {
    const icon = pass ? "\u2705" : "\u274c";
    console.log(`${icon} ${label}${detail ? ` \u2014 ${detail}` : ""}`);
    if (!pass) ok = false;
  };

  console.log("\nclaude-control doctor\n");

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  check("Node.js >= 22", major >= 22, nodeVersion);

  // Config exists
  check("Config file exists", configExists(), "~/.claude-control/config.json");

  if (configExists()) {
    const config = loadConfig();
    check("Authorized users configured", config.authorizedUsers.length > 0, `${config.authorizedUsers.length} user(s)`);
    check("Projects registered", config.projects.length > 0, `${config.projects.length} project(s)`);

    // Whisper model — check local path first, then smart-whisper manager
    const modelPath = join(getConfigDir(), "models", `ggml-${config.whisper.model}.bin`);
    let whisperOk = existsSync(modelPath);
    if (!whisperOk) {
      try {
        const { manager } = await import("smart-whisper");
        whisperOk = manager.check(config.whisper.model);
      } catch {}
    }
    check("Whisper model available", whisperOk, `ggml-${config.whisper.model}.bin${whisperOk && !existsSync(modelPath) ? " (via smart-whisper)" : ""}`);
  }

  // ffmpeg
  let ffmpegOk = false;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    ffmpegOk = true;
  } catch {}
  check("ffmpeg installed", ffmpegOk, ffmpegOk ? "found in PATH" : "required for voice transcription");

  // Claude Code auth — the SDK uses Claude Code's login, not an API key
  let claudeAuthOk = false;
  try {
    execSync("claude auth status", { stdio: "ignore" });
    claudeAuthOk = true;
  } catch {}
  check("Claude Code authenticated", claudeAuthOk, claudeAuthOk ? "logged in" : "run: claude auth login");

  // Daemon status
  check("Daemon running", isDaemonRunning());

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed. Fix the issues above.");
}
