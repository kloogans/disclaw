#!/usr/bin/env node

import { Command } from "commander";
import { setupCommand } from "./cli/setup.js";
import { addCommand } from "./cli/add.js";
import { startCommand } from "./cli/start.js";
import { stopCommand } from "./cli/stop.js";
import { installCommand, uninstallCommand } from "./cli/install.js";
import { removeCommand } from "./cli/remove.js";
import { tokenUpdateCommand } from "./cli/token-update.js";
import { logsCommand } from "./cli/logs.js";
import { doctorCommand } from "./cli/doctor.js";

const program = new Command();

program.name("disclaw").description("Remote Claude Code control via Discord").version("0.2.0");

program.command("setup").description("First-time setup — configure Discord bot and server").action(setupCommand);

// Hidden alias for backward compatibility
program.command("init", { hidden: true }).action(setupCommand);

program
  .command("add")
  .description("Register a project with a Discord channel")
  .argument("<path>", "Path to the project directory")
  .action(addCommand);

program.command("start").description("Start the daemon").action(startCommand);

program.command("stop").description("Stop the daemon").action(stopCommand);

program
  .command("list")
  .description("List all registered projects")
  .action(async () => {
    const { loadConfig } = await import("./config/store.js");
    const config = loadConfig();
    if (config.projects.length === 0) {
      console.log("No projects registered. Run: disclaw add <path>");
      return;
    }
    console.log("\nRegistered projects:\n");
    for (const p of config.projects) {
      console.log(`  ${p.name}`);
      console.log(`    Path: ${p.path}`);
      console.log(`    Channel: ${p.channelId} (${p.channelType ?? "text"})`);
      console.log(`    Model: ${p.model ?? config.defaults.model}`);
      console.log(`    Mode: ${p.permissionMode ?? config.defaults.permissionMode}`);
      console.log("");
    }
  });

program
  .command("status")
  .description("Show daemon and project statuses")
  .action(async () => {
    const { isDaemonRunning, readPidFile } = await import("./config/state.js");
    const { loadConfig, configExists } = await import("./config/store.js");
    const { validateDiscordToken } = await import("./cli/checks.js");

    if (!configExists()) {
      console.log("Not configured. Run: disclaw setup");
      return;
    }

    if (isDaemonRunning()) {
      console.log(`\nDaemon running (PID: ${readPidFile()})\n`);
    } else {
      console.log("\nDaemon not running. Run: disclaw start\n");
    }

    const config = loadConfig();

    // Validate Discord bot token
    if (config.discordBotToken) {
      const result = await validateDiscordToken(config.discordBotToken);
      if (result.valid && result.botInfo) {
        console.log(`Discord bot: ✓ ${result.botInfo.username}`);
      } else {
        console.log(`Discord bot: ✗ token invalid or unreachable`);
      }
    } else {
      console.log("Discord bot: ✗ not configured");
    }

    if (config.projects.length === 0) {
      console.log("\nNo projects registered. Run: disclaw add <path>");
      return;
    }

    console.log("\nProjects:");
    for (const p of config.projects) {
      const model = p.model ?? config.defaults.model;
      const mode = p.permissionMode ?? config.defaults.permissionMode;
      const type = p.channelType ?? "text";
      console.log(`  ${p.name} — ${type} channel ${p.channelId} (${model}, ${mode} mode)`);
    }
    console.log(`\n${config.projects.length} project(s) registered.`);
  });

program
  .command("restart")
  .description("Restart the daemon")
  .action(async () => {
    await stopCommand();
    await startCommand();
  });

program.command("install").description("Install auto-start service (systemd/launchd)").action(installCommand);

program.command("uninstall").description("Remove auto-start service").action(uninstallCommand);

program
  .command("remove")
  .description("Remove a registered project")
  .argument("<name>", "Project name to remove")
  .action(removeCommand);

program.command("token-update").description("Update the Discord bot token").action(tokenUpdateCommand);

program
  .command("logs")
  .description("Tail logs (all or specific project)")
  .argument("[name]", "Project name (optional, defaults to daemon)")
  .option("-n, --lines <count>", "Number of lines to show", "50")
  .action(logsCommand);

program.command("doctor").description("Health check — verify system dependencies").action(doctorCommand);

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
