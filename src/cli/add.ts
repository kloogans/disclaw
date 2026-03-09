import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig, saveConfig, addProject, configExists } from "../config/store.js";
import type { ProjectConfig } from "../config/types.js";

export async function addCommand(pathArg: string): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote init` first.");
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

    console.log("\nCreate a Telegram bot for this project:");
    console.log("  1. Open Telegram, search @BotFather");
    console.log("  2. Send /newbot");
    console.log(`  3. Name it something like "${name} - Claude"`);
    console.log("  4. Copy the bot token\n");

    const botToken = (await rl.question("Bot token: ")).trim();
    if (!botToken || !botToken.includes(":")) {
      console.error("Invalid bot token. Should look like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz");
      rl.close();
      return;
    }

    const project: ProjectConfig = {
      name,
      path: projectPath,
      botToken,
    };

    const config = loadConfig();
    saveConfig(addProject(config, project));

    console.log(`\n✅ Project "${name}" registered.`);
    console.log(`\nStart with: vibemote start`);
  } finally {
    rl.close();
  }
}
