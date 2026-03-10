import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { validateDiscordToken } from "./checks.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function tokenUpdateCommand(): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote setup` first.");
    process.exit(1);
  }

  const config = loadConfig();

  // Show current bot info
  if (config.discordBotToken) {
    const currentResult = await validateDiscordToken(config.discordBotToken);
    if (currentResult.valid && currentResult.botInfo) {
      console.log(`\nCurrent bot: ${currentResult.botInfo.username}`);
    } else {
      console.log("\nCurrent bot: unknown (token invalid)");
    }
  } else {
    console.log("\nNo bot token configured.");
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

      const result = await validateDiscordToken(token);
      if (result.valid && result.botInfo) {
        newToken = token;
        console.log(`  ✓ Token valid — ${result.botInfo.username}`);
        break;
      }

      console.log(`  ✗ ${result.error ?? "Invalid token"} — check and try again.`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        console.error("Max attempts reached.");
        return;
      }
    }

    // Update config
    config.discordBotToken = newToken;
    saveConfig(config);

    console.log("\n✅ Token updated.");

    // Hot-reload if daemon is running (token change triggers full restart)
    if (isDaemonRunning()) {
      process.stdout.write("  Reloading... ");
      signalDaemon("SIGHUP");
      // Give it a moment to restart
      await new Promise((r) => setTimeout(r, 3000));
      console.log("✓ daemon notified");
    }
  } finally {
    rl.close();
  }
}
