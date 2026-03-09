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

const runningBots = new Map<string, ProjectBot>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const resetTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();
const shuttingDown = { value: false };

function startBotWithRecovery(
  config: AppConfig,
  project: ProjectConfig,
  botLogger: pino.Logger,
): void {
  let retries = retryCounts.get(project.name) ?? 0;

  const launch = () => {
    if (shuttingDown.value) return;

    // Clear any existing reset timer
    const existingReset = resetTimers.get(project.name);
    if (existingReset) {
      clearTimeout(existingReset);
      resetTimers.delete(project.name);
    }

    const bot = new ProjectBot(config, project, botLogger);
    runningBots.set(project.name, bot);

    bot.start().then(() => {
      botLogger.warn("Bot stopped unexpectedly");
      if (runningBots.get(project.name) === bot) scheduleRetry();
    }).catch((err) => {
      botLogger.error({ err, retries }, "Bot crashed");
      if (runningBots.get(project.name) === bot) scheduleRetry();
    });

    // Reset retries after 60s of stable running
    const timer = setTimeout(() => {
      retries = 0;
      retryCounts.set(project.name, 0);
    }, 60_000);
    resetTimers.set(project.name, timer);
  };

  const scheduleRetry = () => {
    if (shuttingDown.value) return;

    if (retries >= MAX_RETRIES) {
      botLogger.error({ maxRetries: MAX_RETRIES }, "Max retries reached, giving up");
      return;
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retries), MAX_DELAY_MS);
    retries++;
    retryCounts.set(project.name, retries);
    botLogger.info({ retries, delayMs: delay }, "Restarting bot");

    const timer = setTimeout(launch, delay);
    retryTimers.set(project.name, timer);
  };

  launch();
}

async function stopBot(name: string): Promise<void> {
  const bot = runningBots.get(name);
  if (bot) {
    await bot.stop().catch(() => {});
    runningBots.delete(name);
  }
  const retryTimer = retryTimers.get(name);
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimers.delete(name);
  }
  const resetTimer = resetTimers.get(name);
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimers.delete(name);
  }
  retryCounts.delete(name);
}

async function handleReload(): Promise<void> {
  logger.info("SIGHUP received, reloading config");

  // Wait for config file write to complete
  await new Promise((r) => setTimeout(r, 500));

  const newConfig = loadConfig();
  const currentNames = new Set(runningBots.keys());
  const newNames = new Set(newConfig.projects.map((p) => p.name));

  let started = 0;
  let stopped = 0;
  let restarted = 0;

  // Stop removed projects
  for (const name of currentNames) {
    if (!newNames.has(name)) {
      await stopBot(name);
      stopped++;
    }
  }

  // Start new projects or restart projects with changed tokens
  for (const project of newConfig.projects) {
    const existingBot = runningBots.get(project.name);
    if (!existingBot) {
      // New project
      const botLogger = createLogger(project.name);
      startBotWithRecovery(newConfig, project, botLogger);
      started++;
    } else if (existingBot.getBotToken() !== project.botToken) {
      // Token changed — restart
      await stopBot(project.name);
      const botLogger = createLogger(project.name);
      startBotWithRecovery(newConfig, project, botLogger);
      restarted++;
    }
  }

  logger.info({ started, stopped, restarted }, "Hot-reload complete");
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

  for (const project of config.projects) {
    try {
      const botLogger = createLogger(project.name);
      startBotWithRecovery(config, project, botLogger);
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
    const currentConfig = loadConfig();
    for (const project of currentConfig.projects) {
      cleanupMedia(project.path);
    }
  }, 60 * 60 * 1000);

  // Hot-reload on SIGHUP (with debounce to prevent race conditions)
  let reloadInProgress = false;
  let reloadQueued = false;

  process.on("SIGHUP", () => {
    if (reloadInProgress) {
      reloadQueued = true;
      return;
    }
    reloadInProgress = true;
    handleReload()
      .catch((err) => {
        logger.error({ err }, "Hot-reload failed");
      })
      .finally(() => {
        reloadInProgress = false;
        if (reloadQueued) {
          reloadQueued = false;
          process.emit("SIGHUP");
        }
      });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    shuttingDown.value = true;
    logger.info({ signal }, "Shutting down");
    for (const name of runningBots.keys()) {
      await stopBot(name);
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
