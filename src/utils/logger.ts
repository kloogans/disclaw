import pino from "pino";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { getConfigDir, ensureConfigDir } from "../config/store.js";

/**
 * Find the most recent log file for a given name.
 * pino-roll creates numbered files like `name.1.log`, `name.2.log`, etc.
 */
export function findLogFile(name: string): string | null {
  const logDir = join(getConfigDir(), "logs");
  if (!existsSync(logDir)) return null;

  // Check exact match first (name.log)
  const exact = join(logDir, `${name}.log`);
  if (existsSync(exact)) return exact;

  // Find numbered variants (name.1.log, name.2.log, ...) and pick highest number
  const prefix = `${name}.`;
  const suffix = ".log";
  const files = readdirSync(logDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .sort((a, b) => {
      const numA = parseInt(a.slice(prefix.length, -suffix.length), 10);
      const numB = parseInt(b.slice(prefix.length, -suffix.length), 10);
      return numB - numA; // highest first (most recent)
    });

  return files.length > 0 ? join(logDir, files[0]) : null;
}

export function createLogger(name: string): pino.Logger {
  ensureConfigDir();
  const logDir = join(getConfigDir(), "logs");

  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
      targets: [
        {
          target: "pino-roll",
          options: {
            file: join(logDir, `${name}.log`),
            frequency: "daily",
            limit: { count: 7 },
            mkdir: true,
          },
          level: "info",
        },
        ...(process.env.NODE_ENV !== "production"
          ? [
              {
                target: "pino-pretty",
                options: { colorize: true },
                level: "debug",
              },
            ]
          : []),
      ],
    },
  });
}
