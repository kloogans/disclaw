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
    console.log(`Daemon stopped (PID: ${pid})`);
  } catch {
    console.log("Daemon process not found. Cleaning up PID file.");
  }

  removePidFile();
}
