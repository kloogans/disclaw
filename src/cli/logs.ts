import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { getConfigDir } from "../config/store.js";

export async function logsCommand(name: string | undefined, opts: { lines: string }): Promise<void> {
  const logDir = join(getConfigDir(), "logs");
  const logName = name ?? "daemon";
  const logFile = join(logDir, `${logName}.log`);

  if (!existsSync(logFile)) {
    console.error(`Log file not found: ${logFile}`);
    if (existsSync(logDir)) {
      const files = readdirSync(logDir).filter((f) => f.endsWith(".log"));
      if (files.length > 0) {
        console.log(`Available logs: ${files.map((f) => f.replace(".log", "")).join(", ")}`);
      }
    }
    process.exit(1);
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
