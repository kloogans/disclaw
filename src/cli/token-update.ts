import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { validateDiscordToken } from "./checks.js";
import { fail, done, c, Spinner } from "./ui.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function tokenUpdateCommand(): Promise<void> {
  if (!configExists()) {
    fail("Run `disclaw setup` first.");
    process.exit(1);
  }

  const config = loadConfig();

  // Show current bot info
  if (config.discordBotToken) {
    const spinner = new Spinner("Checking current token");
    spinner.start();
    const currentResult = await validateDiscordToken(config.discordBotToken);
    if (currentResult.valid && currentResult.botInfo) {
      spinner.stop(`${c.green}✓${c.reset} Current bot: ${c.bold}${currentResult.botInfo.username}${c.reset}`);
    } else {
      spinner.stop(`${c.red}✗${c.reset} Current bot: ${c.dim}unknown (token invalid)${c.reset}`);
    }
  } else {
    fail("No bot token configured.");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    let newToken = "";

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question(`\n  ${c.bold}New bot token:${c.reset} `)).trim();
      if (!token) {
        fail("Token cannot be empty.");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        fail("Max attempts reached.");
        return;
      }

      const spinner = new Spinner("Validating token");
      spinner.start();
      const result = await validateDiscordToken(token);
      if (result.valid && result.botInfo) {
        spinner.stop(`${c.green}✓${c.reset} Token valid — ${c.bold}${result.botInfo.username}${c.reset}`);
        newToken = token;
        break;
      }

      spinner.stop(`${c.red}✗${c.reset} ${result.error ?? "Invalid token"}`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        fail("Max attempts reached.");
        return;
      }
    }

    // Update config
    config.discordBotToken = newToken;
    saveConfig(config);

    done("Token updated.");

    // Hot-reload if daemon is running (token change triggers full restart)
    if (isDaemonRunning()) {
      const spinner = new Spinner("Reloading daemon");
      spinner.start();
      signalDaemon("SIGHUP");
      await new Promise((r) => setTimeout(r, 3000));
      spinner.stop(`${c.green}✓${c.reset} Daemon notified`);
    }
  } finally {
    rl.close();
  }
}
