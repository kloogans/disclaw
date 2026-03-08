import pino from "pino";
import { join } from "node:path";
import { getConfigDir, ensureConfigDir } from "../config/store.js";

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
