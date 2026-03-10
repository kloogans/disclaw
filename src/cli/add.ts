import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig, saveConfig, addProject, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { pollForBotConnected } from "./log-poller.js";
import { spawnDaemon } from "./spawn-daemon.js";
import type { ProjectConfig } from "../config/types.js";

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

  // Ensure path is a real directory (resolve symlinks) and reject non-directories
  let realPath: string;
  try {
    realPath = realpathSync(projectPath);
  } catch {
    console.error(`Cannot resolve path: ${projectPath}`);
    process.exit(1);
  }
  if (!statSync(realPath).isDirectory()) {
    console.error(`Not a directory: ${realPath}`);
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.discordBotToken) {
    console.error("No Discord bot token configured. Run `vibemote setup` first.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const defaultName = basename(realPath);
    const name = (await rl.question(`Project name (${defaultName}): `)).trim() || defaultName;

    // Check for duplicate project name
    if (config.projects.some((p) => p.name === name)) {
      console.error(`\nProject "${name}" already exists. Use a different name or run: vibemote remove ${name}`);
      return;
    }

    // Try to auto-create a Discord channel, or ask for existing channel ID
    let channelId = "";

    console.log("\nDiscord channel setup:");
    console.log("  1. Auto-create a new channel (requires Manage Channels permission)");
    console.log("  2. Use an existing channel ID\n");

    const choice = (await rl.question("  Choice (1): ")).trim() || "1";

    if (choice === "1") {
      // Auto-create channel via Discord REST API
      const channelName = `vibemote-${name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 100);
      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${config.discordGuildId}/channels`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${config.discordBotToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: channelName,
            type: 0, // GUILD_TEXT
            topic: `Vibemote: ${name} — ${realPath}`,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.log(`  ✗ Failed to create channel: ${res.status} ${err}`);
          console.log("  Falling back to manual channel ID entry.\n");
        } else {
          const data = (await res.json()) as { id?: string; name?: string };
          if (data.id) {
            channelId = data.id;
            console.log(`  ✓ Created channel #${data.name ?? channelName}\n`);
          }
        }
      } catch (err) {
        console.log(`  ✗ Network error: ${err instanceof Error ? err.message : String(err)}`);
        console.log("  Falling back to manual channel ID entry.\n");
      }
    }

    if (!channelId) {
      console.log("  Enable Developer Mode: User Settings → Advanced → Developer Mode");
      console.log("  Right-click the channel → Copy Channel ID\n");

      channelId = (await rl.question("  Channel ID: ")).trim();
      if (!channelId || !/^\d+$/.test(channelId)) {
        console.error("\n  ✗ Invalid channel ID — must be a numeric snowflake.");
        return;
      }
      console.log("  ✓ Valid channel ID\n");
    }

    // Check for duplicate channel
    if (config.projects.some((p) => p.channelId === channelId)) {
      console.error(`\nChannel ${channelId} is already assigned to another project.`);
      return;
    }

    const project: ProjectConfig = {
      name,
      path: realPath,
      channelId,
    };

    const updatedConfig = addProject(config, project);
    saveConfig(updatedConfig);

    console.log(`✅ Project "${name}" registered.`);

    // Auto-start or hot-reload daemon
    if (isDaemonRunning()) {
      process.stdout.write("  Reloading daemon... ");
      if (!signalDaemon("SIGHUP")) {
        console.log("⚠ failed to signal daemon, starting a new one...");
        spawnDaemon();
      }
    } else {
      process.stdout.write("  Starting daemon... ");
      spawnDaemon();
    }

    // Poll for connectivity
    const { connected } = await pollForBotConnected([name], 5000);
    if (connected.length > 0) {
      console.log("✓ connected");
    } else {
      console.log("⚠ not yet connected");
      console.log(`  Check: vibemote logs ${name}`);
    }

    console.log(`\nOpen Discord and send a message in the project channel.`);
  } finally {
    rl.close();
  }
}
