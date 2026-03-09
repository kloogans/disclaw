import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { validateBotToken } from "./checks.js";
import { pollForBotConnected } from "./log-poller.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function tokenUpdateCommand(projectName: string): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote setup` first.");
    process.exit(1);
  }

  const config = loadConfig();
  const projectIndex = config.projects.findIndex((p) => p.name === projectName);
  if (projectIndex === -1) {
    console.error(`Project "${projectName}" not found. Run: vibemote list`);
    process.exit(1);
  }

  const project = config.projects[projectIndex];

  // Show current bot info
  const currentResult = await validateBotToken(project.botToken);
  if (currentResult.valid && currentResult.botInfo) {
    console.log(`\nCurrent bot: @${currentResult.botInfo.username}`);
  } else {
    console.log("\nCurrent bot: unknown (token invalid)");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    let newToken = "";

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question("\nNew bot token: ")).trim();
      if (!token) {
        console.log("  ✗ Token cannot be empty.");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        console.error("Max attempts reached.");
        return;
      }

      const result = await validateBotToken(token);
      if (result.valid && result.botInfo) {
        newToken = token;
        console.log(`  ✓ Token valid — @${result.botInfo.username}`);
        break;
      }

      console.log(`  ✗ ${result.error ?? "Invalid token"} — check and try again.`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        console.error("Max attempts reached.");
        return;
      }
    }

    // Update config
    config.projects[projectIndex] = { ...project, botToken: newToken };
    saveConfig(config);

    console.log("\n✅ Token updated.");

    // Hot-reload if daemon is running
    if (isDaemonRunning()) {
      process.stdout.write("  Reloading... ");
      signalDaemon("SIGHUP");
      const { connected } = await pollForBotConnected([projectName], 5000);
      if (connected.length > 0) {
        console.log("✓ connected");
      } else {
        console.log("⚠ not yet connected");
        console.log(`  Check: vibemote logs ${projectName}`);
      }
    }
  } finally {
    rl.close();
  }
}
