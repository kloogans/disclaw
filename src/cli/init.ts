import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configExists, loadConfig, saveConfig } from "../config/store.js";
import { DEFAULT_CONFIG } from "../config/types.js";

export async function initCommand(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (configExists()) {
      const overwrite = await rl.question("Config already exists. Overwrite? (y/N): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Keeping existing config.");
        rl.close();
        return;
      }
    }

    console.log("\n=== vibemote Setup ===\n");

    console.log("Step 1: Get your Telegram user ID");
    console.log("  Open Telegram, search @userinfobot, send /start");
    console.log("  It will reply with your user ID.\n");
    const userIdStr = await rl.question("Your Telegram user ID: ");
    const userId = parseInt(userIdStr.trim(), 10);
    if (isNaN(userId)) {
      console.error("Invalid user ID. Must be a number.");
      rl.close();
      return;
    }

    console.log("\nStep 2: Voice transcription model");
    console.log("  tiny  (~75MB)  — fastest, lower accuracy");
    console.log("  base  (~150MB) — good balance (recommended)");
    console.log("  small (~500MB) — better accuracy, slower\n");
    const whisperModel = await rl.question("Whisper model (base): ");

    const config = {
      ...DEFAULT_CONFIG,
      authorizedUsers: [userId],
      whisper: {
        ...DEFAULT_CONFIG.whisper,
        model: whisperModel.trim() || "base",
      },
    };

    saveConfig(config);
    console.log("\n✅ Config saved to ~/.vibemote/config.json");
    console.log("\nThe whisper model will be downloaded on first voice note.");
    console.log("\nNext: Run `vibemote add /path/to/project` to register a project.");
  } finally {
    rl.close();
  }
}
