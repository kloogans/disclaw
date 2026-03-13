import { existsSync, readFileSync, statSync } from "node:fs";
import { findLogFile } from "../utils/logger.js";

export interface ConnectedBot {
  project: string;
  username?: string;
}

export interface LogOffsets {
  offsets: Map<string, { file: string; size: number }>;
}

/**
 * Capture current log file sizes BEFORE spawning/reloading the daemon.
 * Any content written after these offsets is guaranteed to be from the new startup.
 */
export function captureLogOffsets(projectNames: string[]): LogOffsets {
  const offsets = new Map<string, { file: string; size: number }>();
  for (const name of projectNames) {
    const logFile = findLogFile(name);
    if (logFile && existsSync(logFile)) {
      try {
        offsets.set(name, { file: logFile, size: statSync(logFile).size });
      } catch {
        offsets.set(name, { file: logFile, size: 0 });
      }
    }
  }
  return { offsets };
}

/**
 * Poll log files for "handler_ready" events in content written after the captured offsets.
 * If no offsets provided, scans all content (for new log files created after capture).
 */
export async function pollForBotConnected(
  projectNames: string[],
  timeoutMs: number = 5000,
  logOffsets?: LogOffsets,
): Promise<{ connected: ConnectedBot[]; pending: string[] }> {
  const remaining = new Set(projectNames);
  const connected: ConnectedBot[] = [];

  const startTime = Date.now();
  while (remaining.size > 0 && Date.now() - startTime < timeoutMs) {
    for (const name of [...remaining]) {
      // Re-resolve log file each iteration in case it was just created
      const logFile = findLogFile(name);
      if (!logFile || !existsSync(logFile)) continue;

      try {
        const content = readFileSync(logFile, "utf-8");

        // Determine where to start reading
        const pre = logOffsets?.offsets.get(name);
        // If we have a pre-captured offset for this exact file, use it.
        // Otherwise scan all content (file was created after capture = entirely new).
        const startOffset = pre && pre.file === logFile ? pre.size : 0;
        const newContent = content.slice(startOffset);

        for (const line of newContent.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.event === "handler_ready" && entry.project === name) {
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
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return { connected, pending: [...remaining] };
}
