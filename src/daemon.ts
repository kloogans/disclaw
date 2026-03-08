import { loadConfig } from "./config/store.js";
import { writePidFile, removePidFile, isDaemonRunning, readPidFile } from "./config/state.js";
import { ProjectBot } from "./bot/project-bot.js";
import { createLogger } from "./utils/logger.js";
import { freeWhisper } from "./media/transcriber.js";
import { cleanupMedia } from "./media/cleanup.js";
import type { AppConfig, ProjectConfig } from "./config/types.js";
import type pino from "pino";

// Remove CLAUDECODE env var so the Agent SDK can spawn Claude Code subprocesses
delete process.env.CLAUDECODE;

const logger = createLogger("daemon");

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

function startBotWithRecovery(
  config: AppConfig,
  project: ProjectConfig,
  botLogger: pino.Logger,
  bots: ProjectBot[],
  shuttingDown: { value: boolean },
): void {
  let retries = 0;

  const launch = () => {
    if (shuttingDown.value) return;

    const bot = new ProjectBot(config, project, botLogger);
    // Track current bot instance for shutdown
    const index = bots.findIndex((b) => (b as any).project?.name === project.name);
    if (index >= 0) bots[index] = bot;
    else bots.push(bot);

    bot.start().then(() => {
      // start() resolved — bot stopped cleanly (shouldn't happen normally)
      botLogger.warn("Bot stopped unexpectedly");
      scheduleRetry();
    }).catch((err) => {
      botLogger.error({ err, retries }, "Bot crashed");
      scheduleRetry();
    });
  };

  const scheduleRetry = () => {
    if (shuttingDown.value) return;

    if (retries >= MAX_RETRIES) {
      botLogger.error({ maxRetries: MAX_RETRIES }, "Max retries reached, giving up");
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 5 min
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retries), MAX_DELAY_MS);
    retries++;
    botLogger.info({ retries, delayMs: delay }, "Restarting bot");

    setTimeout(() => {
      // Reset retry count if bot has been running for a while (recovered successfully)
      launch();
    }, delay);
  };

  // Reset retries after 60s of stable running
  const originalLaunch = launch;
  const launchWithReset = () => {
    originalLaunch();
    setTimeout(() => {
      // If we get here, the bot has been running for 60s — reset retry counter
      if (!shuttingDown.value) retries = 0;
    }, 60_000);
  };

  launchWithReset();
}

async function main(): Promise<void> {
  // Prevent duplicate daemons (LaunchAgent + manual start)
  if (isDaemonRunning()) {
    const existingPid = readPidFile();
    logger.info({ existingPid }, "Another daemon is already running, exiting");
    process.exit(0);
  }

  writePidFile();
  logger.info({ pid: process.pid }, "Daemon starting");

  const config = loadConfig();
  const bots: ProjectBot[] = [];
  const shuttingDown = { value: false };

  for (const project of config.projects) {
    try {
      const botLogger = createLogger(project.name);
      startBotWithRecovery(config, project, botLogger, bots, shuttingDown);
    } catch (err) {
      logger.error({ err, project: project.name }, "Failed to create bot");
    }
  }

  logger.info({ count: config.projects.length }, "All bots started");

  // Clean up stale media files
  for (const project of config.projects) {
    const cleaned = cleanupMedia(project.path);
    if (cleaned > 0) logger.info({ project: project.name, cleaned }, "Cleaned up stale media");
  }

  // Schedule hourly cleanup
  setInterval(() => {
    for (const project of config.projects) {
      cleanupMedia(project.path);
    }
  }, 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    shuttingDown.value = true;
    logger.info({ signal }, "Shutting down");
    for (const bot of bots) {
      await bot.stop().catch(() => {});
    }
    await freeWhisper();
    removePidFile();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Daemon failed to start");
  removePidFile();
  process.exit(1);
});
