import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { getConfigDir } from "../config/store.js";
import { findLogFile } from "../utils/logger.js";

export async function logsCommand(name: string | undefined, opts: { lines: string }): Promise<void> {
  const logDir = join(getConfigDir(), "logs");
  const logName = name ?? "daemon";
  const logFile = findLogFile(logName);

  if (!logFile) {
    console.error(`No log file found for: ${logName}`);
    if (existsSync(logDir)) {
      const files = readdirSync(logDir).filter((f) => f.endsWith(".log"));
      if (files.length > 0) {
        // Deduplicate names (e.g. daemon.1.log and daemon.2.log → daemon)
        const names = [...new Set(files.map((f) => f.replace(/\.\d+\.log$/, "").replace(/\.log$/, "")))];
        console.log(`Available logs: ${names.join(", ")}`);
      }
    }
    process.exit(1);
  }

  if (process.platform === "win32") {
    const tail = spawn("powershell", ["-Command", `Get-Content -Path '${logFile}' -Tail ${opts.lines} -Wait`], {
      stdio: "inherit",
    });
    tail.on("error", () => console.error("Failed to tail log file. Try: Get-Content -Path '" + logFile + "' -Wait"));
    tail.on("close", (code) => process.exit(code ?? 0));
    process.on("SIGINT", () => {
      tail.kill();
      process.exit(0);
    });
    return;
  }

  const tail = spawn("tail", ["-n", opts.lines, "-f", logFile], { stdio: "inherit" });
  tail.on("error", () => console.error("Failed to tail log file"));
  tail.on("close", (code) => process.exit(code ?? 0));

  // Clean exit on Ctrl+C
  process.on("SIGINT", () => {
    tail.kill();
    process.exit(0);
  });
}
