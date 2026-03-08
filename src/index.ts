#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./cli/init.js";
import { addCommand } from "./cli/add.js";
import { startCommand } from "./cli/start.js";
import { stopCommand } from "./cli/stop.js";

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

program.parse();
