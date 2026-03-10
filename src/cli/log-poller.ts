import { existsSync, readFileSync, statSync } from "node:fs";
import { findLogFile } from "../utils/logger.js";

export interface ConnectedBot {
  project: string;
  username?: string;
}

/**
 * Poll log files for "handler_ready" or "client_ready" events.
 * Returns the list of projects that connected within the timeout.
 */
export async function pollForBotConnected(
  projectNames: string[],
  timeoutMs: number = 5000,
): Promise<{ connected: ConnectedBot[]; pending: string[] }> {
  const remaining = new Set(projectNames);
  const connected: ConnectedBot[] = [];

  // Record file sizes at start so we only read new lines
  const startOffsets = new Map<string, number>();
  const logFiles = new Map<string, string>();
  for (const name of projectNames) {
    const logFile = findLogFile(name);
    if (logFile) {
      logFiles.set(name, logFile);
      try {
        startOffsets.set(name, statSync(logFile).size);
      } catch {
        startOffsets.set(name, 0);
      }
    }
  }

  const startTime = Date.now();
  while (remaining.size > 0 && Date.now() - startTime < timeoutMs) {
    for (const name of [...remaining]) {
      // Re-resolve log file each iteration in case it was just created
      let logFile = logFiles.get(name);
      if (!logFile) {
        logFile = findLogFile(name) ?? undefined;
        if (logFile) {
          logFiles.set(name, logFile);
          startOffsets.set(name, 0);
        }
      }
      if (!logFile || !existsSync(logFile)) continue;

      try {
        const content = readFileSync(logFile, "utf-8");
        const startOffset = startOffsets.get(name) ?? 0;
        const newContent = content.slice(startOffset);

        // Parse pino JSON lines looking for handler_ready/client_ready events
        for (const line of newContent.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if ((entry.event === "handler_ready" || entry.event === "client_ready") && entry.project === name) {
              connected.push({ project: name, username: entry.username });
              remaining.delete(name);
              break;
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      } catch {
        // File read error, skip
      }
    }

    if (remaining.size > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { connected, pending: [...remaining] };
}
