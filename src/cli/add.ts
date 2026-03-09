import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig, saveConfig, addProject, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { validateBotToken } from "./checks.js";
import { pollForBotConnected } from "./log-poller.js";
import { spawnDaemon } from "./spawn-daemon.js";
import type { ProjectConfig } from "../config/types.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function addCommand(pathArg: string): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote setup` first.");
    process.exit(1);
  }

  const projectPath = resolve(pathArg);
  if (!existsSync(projectPath)) {
    console.error(`Directory not found: ${projectPath}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const defaultName = basename(projectPath);
    const name = (await rl.question(`Project name (${defaultName}): `)).trim() || defaultName;

    // Check for duplicate project name
    const config = loadConfig();
    if (config.projects.some((p) => p.name === name)) {
      console.error(`\nProject "${name}" already exists. Use a different name or run: vibemote remove ${name}`);
      return;
    }

    console.log("\nCreate a Telegram bot:");
    console.log("  Open Telegram → @BotFather → /newbot → copy the token\n");

    // Token validation with retry
    let botToken = "";
    let botUsername = "";
    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question("Bot token: ")).trim();
      if (!token) {
        console.log("  ✗ Token cannot be empty.\n");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        console.error("Max attempts reached.");
        return;
      }

      const result = await validateBotToken(token);
      if (result.valid && result.botInfo) {
        botToken = token;
        botUsername = result.botInfo.username;
        console.log(`  ✓ Token valid — @${botUsername}\n`);
        break;
      }

      console.log(`  ✗ ${result.error ?? "Invalid token"} — check and try again.\n`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        console.error("Max attempts reached.");
        return;
      }
    }

    const project: ProjectConfig = {
      name,
      path: projectPath,
      botToken,
    };

    const updatedConfig = addProject(config, project);
    saveConfig(updatedConfig);

    console.log(`✅ Project "${name}" registered.`);

    // Auto-start or hot-reload daemon
    if (isDaemonRunning()) {
      process.stdout.write("  Reloading daemon... ");
      signalDaemon("SIGHUP");
    } else {
      process.stdout.write("  Starting daemon... ");
      spawnDaemon();
    }

    // Poll for connectivity
    const { connected, pending } = await pollForBotConnected([name], 5000);
    if (connected.length > 0) {
      console.log("✓ connected");
    } else {
      console.log("⚠ not yet connected");
      console.log(`  Check: vibemote logs ${name}`);
    }

    console.log(`\nOpen Telegram and message @${botUsername}`);
  } finally {
    rl.close();
  }
}
