#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./cli/init.js";
import { addCommand } from "./cli/add.js";
import { startCommand } from "./cli/start.js";
import { stopCommand } from "./cli/stop.js";
import { installCommand, uninstallCommand } from "./cli/install.js";
import { removeCommand } from "./cli/remove.js";
import { logsCommand } from "./cli/logs.js";
import { doctorCommand } from "./cli/doctor.js";

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
  .action(removeCommand);

program
  .command("logs")
  .description("Tail logs (all or specific project)")
  .argument("[name]", "Project name (optional, defaults to daemon)")
  .option("-n, --lines <count>", "Number of lines to show", "50")
  .action(logsCommand);

program
  .command("doctor")
  .description("Health check — verify system dependencies")
  .action(doctorCommand);

program
  .command("tray")
  .description("Launch menu bar icon (macOS/Linux/Windows)")
  .action(async () => {
    const { spawn } = await import("node:child_process");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const trayPath = join(__dirname, "tray.js");
    const child = spawn(process.execPath, [trayPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log("Menu bar icon launched.");
  });

program.parse();
