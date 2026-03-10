import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configExists, saveConfig } from "../config/store.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { runAllPrerequisites, printCheckResults, validateDiscordToken } from "./checks.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function setupCommand(): Promise<void> {
  console.log("\n=== vibemote Setup ===\n");

  // Prerequisite checks — all must pass before prompts
  console.log("Checking prerequisites...");
  const { allPassed, results } = runAllPrerequisites();
  printCheckResults(results);

  if (!allPassed) {
    console.log("\nFix the issues above before continuing.");
    process.exit(1);
  }

  console.log("");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (configExists()) {
      const overwrite = await rl.question("Config already exists. Overwrite? (y/N): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Keeping existing config.");
        return;
      }
    }

    // Step 1: Discord Bot Token
    console.log("Step 1: Discord Bot Setup");
    console.log("  1. Go to https://discord.com/developers/applications");
    console.log('  2. Click "New Application" → name it "Vibemote"');
    console.log('  3. Go to Bot tab → click "Reset Token" → copy the token');
    console.log('  4. Enable "Message Content Intent" under Privileged Gateway Intents');
    console.log('  5. Go to OAuth2 → URL Generator → select "bot" scope');
    console.log("     Permissions: Send Messages, Manage Messages, Embed Links,");
    console.log("     Attach Files, Read Message History, Use Slash Commands, Manage Channels");
    console.log("  6. Copy the invite URL and open it to add the bot to your server\n");

    let discordBotToken = "";
    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question("  Bot token: ")).trim();
      if (!token) {
        console.log("  ✗ Token cannot be empty.\n");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        console.error("Max attempts reached.");
        process.exit(1);
      }

      const result = await validateDiscordToken(token);
      if (result.valid && result.botInfo) {
        discordBotToken = token;
        console.log(`  ✓ Token valid — ${result.botInfo.username}\n`);
        break;
      }

      console.log(`  ✗ ${result.error ?? "Invalid token"} — check and try again.\n`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        console.error("Max attempts reached.");
        process.exit(1);
      }
    }

    // Step 2: Guild (Server) ID
    console.log("Step 2: Discord Server ID");
    console.log("  Enable Developer Mode: User Settings → App Settings → Advanced → Developer Mode");
    console.log("  Right-click your server name → Copy Server ID\n");

    const discordGuildId = (await rl.question("  Server ID: ")).trim();
    if (!discordGuildId || !/^\d+$/.test(discordGuildId)) {
      console.error("\n  ✗ Invalid server ID — must be a numeric snowflake.");
      process.exit(1);
    }
    console.log("  ✓ Valid server ID\n");

    // Step 3: Your Discord User ID
    console.log("Step 3: Your Discord User ID");
    console.log("  Right-click your profile → Copy User ID\n");

    const userId = (await rl.question("  Your Discord user ID: ")).trim();
    if (!userId || !/^\d+$/.test(userId)) {
      console.error("\n  ✗ Invalid user ID — must be a numeric snowflake.");
      process.exit(1);
    }
    console.log("  ✓ Valid user ID\n");

    const config = {
      ...DEFAULT_CONFIG,
      discordBotToken,
      discordGuildId,
      authorizedUsers: [userId],
    };

    saveConfig(config);
    console.log("\n✅ Setup complete. Config saved to ~/.vibemote/");
    console.log("\nNext: vibemote add <path-to-project>");
  } finally {
    rl.close();
  }
}
