#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./cli/init.js";
import { addCommand } from "./cli/add.js";
import { startCommand } from "./cli/start.js";
import { stopCommand } from "./cli/stop.js";
import { installCommand, uninstallCommand } from "./cli/install.js";

const program = new Command();

program
  .name("claude-control")
  .description("Remote Claude Code control via Telegram")
  .version("0.1.0");

program
  .command("init")
  .description("First-time setup — configure user ID, download whisper model")
  .action(initCommand);

program
  .command("add")
  .description("Register a project with a Telegram bot")
  .argument("<path>", "Path to the project directory")
  .action(addCommand);

program
  .command("start")
  .description("Start the daemon (all bots)")
  .action(startCommand);

program
  .command("stop")
  .description("Stop the daemon")
  .action(stopCommand);

program
  .command("list")
  .description("List all registered projects")
  .action(async () => {
    const { loadConfig } = await import("./config/store.js");
    const config = loadConfig();
    if (config.projects.length === 0) {
      console.log("No projects registered. Run: claude-control add <path>");
      return;
    }
    console.log("\nRegistered projects:\n");
    for (const p of config.projects) {
      console.log(`  ${p.name}`);
      console.log(`    Path: ${p.path}`);
      console.log(`    Model: ${p.model ?? config.defaults.model}`);
      console.log(`    Mode: ${p.permissionMode ?? config.defaults.permissionMode}`);
      console.log("");
    }
  });

program
  .command("status")
  .description("Show daemon and bot statuses")
  .action(async () => {
    const { isDaemonRunning, readPidFile } = await import("./config/state.js");
    if (isDaemonRunning()) {
      console.log(`Daemon running (PID: ${readPidFile()})`);
    } else {
      console.log("Daemon not running. Run: claude-control start");
    }
  });

program
  .command("restart")
  .description("Restart the daemon")
  .action(async () => {
    await stopCommand();
    await startCommand();
  });

program
  .command("install")
  .description("Install macOS LaunchAgent (auto-start on login)")
  .action(installCommand);

program
  .command("uninstall")
  .description("Remove macOS LaunchAgent")
  .action(uninstallCommand);

program
  .command("remove")
  .description("Remove a registered project")
  .argument("<name>", "Project name to remove")
  .action(async (name: string) => {
    const { loadConfig, saveConfig, removeProject } = await import("./config/store.js");
    const config = loadConfig();
    const exists = config.projects.some((p) => p.name === name);
    if (!exists) {
      console.error(`Project "${name}" not found. Run: claude-control list`);
      process.exit(1);
    }
    saveConfig(removeProject(config, name));
    console.log(`Project "${name}" removed.`);
    console.log("Restart the daemon for changes to take effect: claude-control restart");
  });

program
  .command("logs")
  .description("Tail logs (all or specific project)")
  .argument("[name]", "Project name (optional, defaults to daemon)")
  .option("-n, --lines <count>", "Number of lines to show", "50")
  .action(async (name: string | undefined, opts: { lines: string }) => {
    const { join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const { getConfigDir } = await import("./config/store.js");

    const logDir = join(getConfigDir(), "logs");
    const logName = name ?? "daemon";
    const logFile = join(logDir, `${logName}.log`);

    if (!existsSync(logFile)) {
      console.error(`Log file not found: ${logFile}`);
      const { readdirSync } = await import("node:fs");
      if (existsSync(logDir)) {
        const files = readdirSync(logDir).filter((f) => f.endsWith(".log"));
        if (files.length > 0) {
          console.log(`Available logs: ${files.map((f) => f.replace(".log", "")).join(", ")}`);
        }
      }
      process.exit(1);
    }

    // Use tail -f for real-time following
    const { spawn } = await import("node:child_process");
    const tail = spawn("tail", ["-n", opts.lines, "-f", logFile], { stdio: "inherit" });
    tail.on("error", () => console.error("Failed to tail log file"));
  });

program
  .command("doctor")
  .description("Health check — verify system dependencies")
  .action(async () => {
    const { configExists, loadConfig, getConfigDir } = await import("./config/store.js");
    const { isDaemonRunning } = await import("./config/state.js");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { execSync } = await import("node:child_process");

    let ok = true;
    const check = (label: string, pass: boolean, detail?: string) => {
      const icon = pass ? "\u2705" : "\u274c";
      console.log(`${icon} ${label}${detail ? ` — ${detail}` : ""}`);
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

      // Whisper model
      const modelPath = join(getConfigDir(), "models", `ggml-${config.whisper.model}.bin`);
      check("Whisper model available", existsSync(modelPath), `ggml-${config.whisper.model}.bin`);
    }

    // ffmpeg
    let ffmpegOk = false;
    try {
      execSync("ffmpeg -version", { stdio: "ignore" });
      ffmpegOk = true;
    } catch {}
    check("ffmpeg installed", ffmpegOk, ffmpegOk ? "found in PATH" : "required for voice transcription");

    // ANTHROPIC_API_KEY
    check("ANTHROPIC_API_KEY set", !!process.env.ANTHROPIC_API_KEY);

    // Daemon status
    check("Daemon running", isDaemonRunning());

    console.log(ok ? "\nAll checks passed." : "\nSome checks failed. Fix the issues above.");
  });

program.parse();
