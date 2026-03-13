import { isDaemonRunning, readPidFile } from "../config/state.js";
import { loadConfig, configExists } from "../config/store.js";
import { spawnDaemon } from "./spawn-daemon.js";
import { banner, fail, c } from "./ui.js";

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
      `  disclaw already running ${c.dim}(PID: ${readPidFile()})${c.reset}. Use 'disclaw restart' to restart.`,
    );
    return;
  }

  banner("starting");

  const pid = spawnDaemon();

  if (!pid) {
    fail("Failed to start disclaw. Try reinstalling: npm install -g disclaw");
    process.exit(1);
  }

  console.log(`  disclaw is clawing away ${c.dim}(PID: ${pid})${c.reset}\n`);

  for (const project of config.projects) {
    console.log(`  ${c.dim}•${c.reset} ${project.name}`);
  }

  console.log(`\n  ${config.projects.length} project(s) registered. Check ${c.dim}disclaw logs${c.reset} for status.`);
}
