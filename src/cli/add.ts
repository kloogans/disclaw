import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig, saveConfig, addProject, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { captureLogOffsets, pollForBotConnected } from "./log-poller.js";
import { spawnDaemon } from "./spawn-daemon.js";
import type { ProjectConfig } from "../config/types.js";
import { step, hint, fail, done, c, Spinner } from "./ui.js";

export async function addCommand(pathArg: string): Promise<void> {
  if (!configExists()) {
    fail("Run `disclaw setup` first.");
    process.exit(1);
  }

  const projectPath = resolve(pathArg);
  if (!existsSync(projectPath)) {
    fail(`Directory not found: ${projectPath}`);
    process.exit(1);
  }

  // Ensure path is a real directory (resolve symlinks) and reject non-directories
  let realPath: string;
  try {
    realPath = realpathSync(projectPath);
  } catch {
    fail(`Cannot resolve path: ${projectPath}`);
    process.exit(1);
  }
  if (!statSync(realPath).isDirectory()) {
    fail(`Not a directory: ${realPath}`);
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.discordBotToken) {
    fail("No Discord bot token configured. Run `disclaw setup` first.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const defaultName = basename(realPath);
    const name =
      (await rl.question(`  ${c.bold}Project name${c.reset} ${c.dim}(${defaultName}):${c.reset} `)).trim() ||
      defaultName;

    // Check for duplicate project name
    if (config.projects.some((p) => p.name === name)) {
      fail(`Project "${name}" already exists. Use a different name or run: disclaw remove ${name}`);
      return;
    }

    // Try to auto-create a Discord channel, or ask for existing channel ID
    let channelId = "";

    console.log();
    step(1, 1, "Discord Channel Setup");
    hint("1. Auto-create a new channel (requires Manage Channels permission)");
    hint("2. Use an existing channel ID");
    console.log();

    const choice = (await rl.question(`  ${c.bold}Choice${c.reset} ${c.dim}(1):${c.reset} `)).trim() || "1";

    let isForum = false;

    if (choice === "1") {
      // Ask for channel type
      console.log();
      hint("a. Text channel — messages go directly in the channel");
      hint("b. Forum channel — each conversation becomes a post/thread");
      console.log();

      const typeChoice =
        (await rl.question(`  ${c.bold}Channel type${c.reset} ${c.dim}(a):${c.reset} `)).trim().toLowerCase() || "a";
      isForum = typeChoice === "b";
      const channelType = isForum ? 15 : 0; // 15 = GuildForum, 0 = GuildText

      // Auto-create channel via Discord REST API
      const channelName = `disclaw-${name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 100);

      const spinner = new Spinner("Creating channel");
      spinner.start();

      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${config.discordGuildId}/channels`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${config.discordBotToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: channelName,
            type: channelType,
            topic: `Disclaw: ${name} — ${realPath}`,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          spinner.stop(`${c.red}✗${c.reset} Failed to create channel: ${res.status} ${err}`);
          hint("Falling back to manual channel ID entry.");
          console.log();
        } else {
          const data = (await res.json()) as { id?: string; name?: string };
          if (data.id) {
            channelId = data.id;
            spinner.stop(`${c.green}✓${c.reset} Created channel ${c.bold}#${data.name ?? channelName}${c.reset}`);
          }
        }
      } catch (err) {
        spinner.stop(`${c.red}✗${c.reset} Network error: ${err instanceof Error ? err.message : String(err)}`);
        hint("Falling back to manual channel ID entry.");
        console.log();
      }
    }

    if (!channelId) {
      hint("Enable Developer Mode: User Settings → Advanced → Developer Mode");
      hint("Right-click the channel → Copy Channel ID");
      console.log();

      channelId = (await rl.question(`  ${c.bold}Channel ID:${c.reset} `)).trim();
      if (!channelId || !/^\d+$/.test(channelId)) {
        fail("Invalid channel ID — must be a numeric snowflake.");
        return;
      }

      // Detect channel type via Discord API
      const detectSpinner = new Spinner("Detecting channel type");
      detectSpinner.start();
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
          headers: { Authorization: `Bot ${config.discordBotToken}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { type?: number };
          if (data.type === 15) {
            isForum = true;
            detectSpinner.stop(`${c.green}✓${c.reset} Detected forum channel`);
          } else if (data.type === 0) {
            isForum = false;
            detectSpinner.stop(`${c.green}✓${c.reset} Detected text channel`);
          } else {
            detectSpinner.stop(`${c.yellow}⚠${c.reset} Unexpected channel type (${data.type}), treating as text`);
          }
        } else {
          detectSpinner.stop(`${c.yellow}⚠${c.reset} Could not fetch channel (${res.status}), treating as text`);
        }
      } catch {
        detectSpinner.stop(`${c.yellow}⚠${c.reset} Could not reach Discord API, treating as text`);
      }
    }

    // Check for duplicate channel
    if (config.projects.some((p) => p.channelId === channelId)) {
      fail(`Channel ${channelId} is already assigned to another project.`);
      return;
    }

    const project: ProjectConfig = {
      name,
      path: realPath,
      channelId,
      channelType: isForum ? "forum" : "text",
    };

    const updatedConfig = addProject(config, project);
    saveConfig(updatedConfig);

    done(`Project "${name}" registered.`);

    // Capture log offsets BEFORE spawn/reload so we only see new handler_ready events
    const logOffsets = captureLogOffsets([name]);

    // Auto-start or hot-reload daemon
    const spinner = new Spinner(isDaemonRunning() ? "Reloading daemon" : "Starting daemon");
    spinner.start();

    if (isDaemonRunning()) {
      if (!signalDaemon("SIGHUP")) {
        spinner.stop(`${c.yellow}⚠${c.reset} Failed to signal daemon, starting a new one...`);
        spawnDaemon();
      }
    } else {
      spawnDaemon();
    }

    // Poll for connectivity
    const { connected } = await pollForBotConnected([name], 5000, logOffsets);
    if (connected.length > 0) {
      spinner.stop(`${c.green}✓${c.reset} Connected`);
    } else {
      spinner.stop(`${c.yellow}⚠${c.reset} Not yet connected`);
      hint(`Check: disclaw logs ${name}`);
    }

    if (isForum) {
      console.log(`\n  Open Discord and create a post in the forum channel.`);
    } else {
      console.log(`\n  Open Discord and send a message in the project channel.`);
    }
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
