import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDaemonRunning, readPidFile } from "../config/state.js";
import { loadConfig, configExists } from "../config/store.js";

export async function startCommand(): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote init` first.");
    process.exit(1);
  }

  const config = loadConfig();
  if (config.projects.length === 0) {
    console.error("No projects registered. Run: vibemote add <path>");
    process.exit(1);
  }

  if (isDaemonRunning()) {
    console.log(`Daemon already running (PID: ${readPidFile()}). Use 'vibemote restart' to restart.`);
    return;
  }

  // Resolve daemon.js as sibling of the current script (both in dist/)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonPath = join(__dirname, "daemon.js");

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  console.log(`Daemon started (PID: ${child.pid})`);
  console.log(`${config.projects.length} project bot(s) launching...`);
  console.log("\nOpen Telegram and message your bot(s) to start.");
}
