import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Spawn the daemon as a detached background process.
 * Returns the child process PID.
 */
export function spawnDaemon(): number | undefined {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonPath = join(__dirname, "daemon.js");

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}
