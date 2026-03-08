import { loadConfig, saveConfig, removeProject } from "../config/store.js";
import { loadState, saveState } from "../config/state.js";

export async function removeCommand(name: string): Promise<void> {
  const config = loadConfig();
  const exists = config.projects.some((p) => p.name === name);
  if (!exists) {
    console.error(`Project "${name}" not found. Run: claude-control list`);
    process.exit(1);
  }

  saveConfig(removeProject(config, name));

  // Clean up stale session state
  const state = loadState();
  delete state.sessions[name];
  saveState(state);

  console.log(`Project "${name}" removed.`);
  console.log("Restart the daemon for changes to take effect: claude-control restart");
}
