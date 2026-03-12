import { isDaemonRunning, readPidFile } from "../config/state.js";
import { loadConfig, configExists } from "../config/store.js";
import { pollForBotConnected } from "./log-poller.js";
import { spawnDaemon } from "./spawn-daemon.js";

export async function startCommand(): Promise<void> {
  if (!configExists()) {
    console.error("Run `disclaw setup` first.");
    process.exit(1);
  }

  const config = loadConfig();
  if (config.projects.length === 0) {
    console.error("No projects registered. Run: disclaw add <path>");
    process.exit(1);
  }

  if (isDaemonRunning()) {
    console.log(`Daemon already running (PID: ${readPidFile()}). Use 'disclaw restart' to restart.`);
    return;
  }

  const pid = spawnDaemon();

  if (!pid) {
    console.error("Failed to spawn daemon process. Try reinstalling: npm install -g disclaw");
    process.exit(1);
  }

  console.log(`\nDaemon started (PID: ${pid})\n`);

  // Poll for bot connectivity
  const projectNames = config.projects.map((p) => p.name);
  const { connected, pending } = await pollForBotConnected(projectNames, 15000);

  for (const bot of connected) {
    const username = bot.username ? ` — @${bot.username}` : "";
    console.log(`  ✓ ${bot.project}${username} connected`);
  }
  for (const name of pending) {
    console.log(`  ⚠ ${name} — not yet connected (check: disclaw logs ${name})`);
  }

  const total = config.projects.length;
  if (pending.length === 0) {
    console.log(`\n${total} project(s) ready. Open Discord to start.`);
  } else {
    console.log(`\n${connected.length}/${total} bot(s) connected.`);
  }
}
