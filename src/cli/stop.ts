import { isDaemonRunning, readPidFile, removePidFile } from "../config/state.js";
import { success, warn, fail, c } from "./ui.js";

export async function stopCommand(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log("  disclaw is not running.");
    return;
  }

  const pid = readPidFile();
  if (pid === null) {
    console.log("  No PID file found.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    warn("disclaw process not found. Cleaning up PID file.");
    removePidFile();
    return;
  }

  // Wait for process to actually exit (up to 5 seconds)
  let died = false;
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      died = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (died) {
    success(`disclaw stopped ${c.dim}(PID: ${pid})${c.reset}`);
    removePidFile();
  } else {
    fail(`disclaw (PID: ${pid}) did not stop within 5 seconds. Try: kill -9 ${pid}`);
  }
}
