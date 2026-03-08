import { isDaemonRunning, readPidFile, removePidFile } from "../config/state.js";

export async function stopCommand(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log("Daemon is not running.");
    return;
  }

  const pid = readPidFile();
  if (pid === null) {
    console.log("No PID file found.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    // Wait for process to actually exit (up to 5 seconds)
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`Daemon stopped (PID: ${pid})`);
  } catch {
    console.log("Daemon process not found. Cleaning up PID file.");
  }

  removePidFile();
}
