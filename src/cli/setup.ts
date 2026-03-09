import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configExists, saveConfig } from "../config/store.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { runAllPrerequisites, printCheckResults } from "./checks.js";

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

    console.log("Step 1: Telegram User ID");
    console.log("  Open Telegram → @userinfobot → send /start → copy your ID\n");
    const userIdStr = await rl.question("  Your Telegram user ID: ");
    const userId = parseInt(userIdStr.trim(), 10);
    if (isNaN(userId)) {
      console.error("\n  ✗ Invalid user ID — must be a number.");
      process.exit(1);
    }
    console.log("  ✓ Valid user ID\n");

    console.log("Step 2: Voice transcription model");
    console.log("  tiny (~75MB) | base (~150MB) ← recommended | small (~500MB)\n");
    const whisperModel = await rl.question("  Whisper model (base): ");
    const model = whisperModel.trim() || "base";
    if (!["tiny", "base", "small", "medium", "large"].includes(model)) {
      console.error(`\n  ✗ Invalid model "${model}". Choose: tiny, base, small, medium, large`);
      process.exit(1);
    }

    const config = {
      ...DEFAULT_CONFIG,
      authorizedUsers: [userId],
      whisper: {
        ...DEFAULT_CONFIG.whisper,
        model,
      },
    };

    saveConfig(config);
    console.log("\n✅ Setup complete. Config saved to ~/.vibemote/");
    console.log("\nNext: vibemote add <path-to-project>");
  } finally {
    rl.close();
  }
}
