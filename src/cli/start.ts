import { isDaemonRunning, readPidFile } from "../config/state.js";
import { loadConfig, configExists } from "../config/store.js";
import { pollForBotConnected } from "./log-poller.js";
import { spawnDaemon } from "./spawn-daemon.js";
import { banner, success, fail, warn, c } from "./ui.js";

export async function startCommand(): Promise<void> {
  if (!configExists()) {
    fail("Run `disclaw setup` first.");
    process.exit(1);
  }

  const config = loadConfig();
  if (config.projects.length === 0) {
    fail("No projects registered. Run: disclaw add <path>");
    process.exit(1);
  }

  if (isDaemonRunning()) {
    console.log(
      `  Daemon already running ${c.dim}(PID: ${readPidFile()})${c.reset}. Use 'disclaw restart' to restart.`,
    );
    return;
  }

  banner("starting");

  const pid = spawnDaemon();

  if (!pid) {
    fail("Failed to spawn daemon process. Try reinstalling: npm install -g disclaw");
    process.exit(1);
  }

  console.log(`  Daemon started ${c.dim}(PID: ${pid})${c.reset}\n`);

  // Poll for bot connectivity
  const projectNames = config.projects.map((p) => p.name);
  const { connected, pending } = await pollForBotConnected(projectNames, 15000);

  for (const bot of connected) {
    const username = bot.username ? ` ${c.dim}— @${bot.username}${c.reset}` : "";
    success(`${bot.project}${username}`);
  }
  for (const name of pending) {
    warn(`${name} ${c.dim}— not yet connected (check: disclaw logs ${name})${c.reset}`);
  }

  const total = config.projects.length;
  if (pending.length === 0) {
    console.log(`\n  ${c.green}${c.bold}${total} project(s) ready.${c.reset} Open Discord to start.`);
  } else {
    console.log(`\n  ${connected.length}/${total} bot(s) connected.`);
  }
}
