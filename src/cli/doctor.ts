import { existsSync } from "node:fs";
import { join } from "node:path";
import { configExists, loadConfig, getConfigDir } from "../config/store.js";
import { isDaemonRunning } from "../config/state.js";
import { checkNodeVersion, checkFfmpeg, checkClaudeAuth, validateBotToken } from "./checks.js";

export async function doctorCommand(): Promise<void> {
  let ok = true;
  const check = (label: string, pass: boolean, detail?: string) => {
    const icon = pass ? "✓" : "✗";
    console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!pass) ok = false;
  };

  console.log("\nvibemote doctor\n");

  // Prerequisites (from shared checks)
  const nodeCheck = checkNodeVersion();
  check(nodeCheck.label, nodeCheck.pass, nodeCheck.detail);

  const ffmpegCheck = checkFfmpeg();
  check(ffmpegCheck.label, ffmpegCheck.pass, ffmpegCheck.detail);

  const claudeCheck = checkClaudeAuth();
  check(claudeCheck.label, claudeCheck.pass, claudeCheck.detail);

  // Config exists
  check("Config file exists", configExists(), "~/.vibemote/config.json");

  if (configExists()) {
    const config = loadConfig();
    check("Authorized users configured", config.authorizedUsers.length > 0, `${config.authorizedUsers.length} user(s)`);
    check("Projects registered", config.projects.length > 0, `${config.projects.length} project(s)`);

    // Validate bot tokens
    for (const project of config.projects) {
      const result = await validateBotToken(project.botToken);
      if (result.valid && result.botInfo) {
        check(`Bot token: ${project.name}`, true, `@${result.botInfo.username}`);
      } else {
        check(`Bot token: ${project.name}`, false, result.error ?? "invalid");
      }
    }

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

  // Daemon status
  check("Daemon running", isDaemonRunning());

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed. Fix the issues above.");
}
