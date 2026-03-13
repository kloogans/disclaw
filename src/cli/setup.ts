import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configExists, saveConfig } from "../config/store.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { runAllPrerequisites, validateDiscordToken } from "./checks.js";
import { banner, step, hint, success, fail, done, next, c, Spinner } from "./ui.js";

const MAX_TOKEN_ATTEMPTS = 3;
const TOTAL_STEPS = 3;

export async function setupCommand(): Promise<void> {
  banner("setup");

  // Prerequisite checks
  const { allPassed, results } = runAllPrerequisites();
  for (const r of results) {
    if (r.pass) {
      success(`${r.label}${r.detail ? ` ${c.dim}- ${r.detail}${c.reset}` : ""}`);
    } else {
      fail(`${r.label}${r.detail ? ` ${c.dim}- ${r.detail}${c.reset}` : ""}`);
    }
  }

  if (!allPassed) {
    console.log(`\n${c.red}Fix the issues above before continuing.${c.reset}`);
    process.exit(1);
  }

  console.log();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (configExists()) {
      const overwrite = await rl.question(`  ${c.yellow}Config already exists. Overwrite? (y/N):${c.reset} `);
      if (overwrite.toLowerCase() !== "y") {
        console.log("  Keeping existing config.");
        return;
      }
      console.log();
    }

    // Step 1: Discord Bot Token
    step(1, TOTAL_STEPS, "Discord Bot Setup");
    hint("1. Go to https://discord.com/developers/applications");
    hint('2. Click "New Application" → name it "disclaw"');
    hint('3. Go to Bot tab → click "Reset Token" → copy the token');
    hint('4. Enable "Message Content Intent" under Privileged Gateway Intents');
    hint('5. Go to OAuth2 → URL Generator → select "bot" scope');
    hint("   Permissions: Send Messages, Manage Messages, Embed Links,");
    hint("   Attach Files, Read Message History, Use Slash Commands, Manage Channels");
    hint("6. Copy the invite URL and open it to add the bot to your server");
    console.log();

    let discordBotToken = "";
    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question(`  ${c.bold}Bot token:${c.reset} `)).trim();
      if (!token) {
        fail("Token cannot be empty.");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        fail("Max attempts reached.");
        process.exit(1);
      }

      const spinner = new Spinner("Validating token");
      spinner.start();
      const result = await validateDiscordToken(token);
      if (result.valid && result.botInfo) {
        spinner.stop(`${c.green}✓${c.reset} Token valid - ${c.bold}${result.botInfo.username}${c.reset}`);
        discordBotToken = token;
        break;
      }

      spinner.stop(`${c.red}✗${c.reset} ${result.error ?? "Invalid token"}`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        fail("Max attempts reached.");
        process.exit(1);
      }
    }

    console.log();

    // Step 2: Guild (Server) ID
    step(2, TOTAL_STEPS, "Discord Server ID");
    hint("Enable Developer Mode: User Settings → Advanced → Developer Mode");
    hint("Right-click your server name → Copy Server ID");
    console.log();

    const discordGuildId = (await rl.question(`  ${c.bold}Server ID:${c.reset} `)).trim();
    if (!discordGuildId || !/^\d+$/.test(discordGuildId)) {
      fail("Invalid server ID, must be a numeric snowflake.");
      process.exit(1);
    }
    success("Valid server ID");

    console.log();

    // Step 3: Your Discord User ID
    step(3, TOTAL_STEPS, "Your Discord User ID");
    hint("Right-click your profile → Copy User ID");
    console.log();

    const userId = (await rl.question(`  ${c.bold}Your Discord user ID:${c.reset} `)).trim();
    if (!userId || !/^\d+$/.test(userId)) {
      fail("Invalid user ID, must be a numeric snowflake.");
      process.exit(1);
    }
    success("Valid user ID");

    const config = {
      ...DEFAULT_CONFIG,
      discordBotToken,
      discordGuildId,
      authorizedUsers: [userId],
    };

    saveConfig(config);
    done("Setup complete. Config saved to ~/.disclaw/");
    next("disclaw add <path-to-project>");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") {
      console.log("\n");
      process.exit(0);
    }
    throw err;
  } finally {
    rl.close();
  }
}
