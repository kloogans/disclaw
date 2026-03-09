import { loadConfig, saveConfig, removeProject } from "../config/store.js";
import { loadState, saveState, isDaemonRunning, signalDaemon } from "../config/state.js";

export async function removeCommand(name: string): Promise<void> {
  const config = loadConfig();
  const exists = config.projects.some((p) => p.name === name);
  if (!exists) {
    console.error(`Project "${name}" not found. Run: vibemote list`);
    process.exit(1);
  }

  saveConfig(removeProject(config, name));

  // Clean up stale session state
  const state = loadState();
  delete state.sessions[name];
  saveState(state);

  console.log(`Project "${name}" removed.`);

  // Hot-reload daemon if running
  if (isDaemonRunning()) {
    signalDaemon("SIGHUP");
    console.log("Bot stopping...");
  }
}
