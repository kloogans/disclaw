import { loadConfig } from "./config/store.js";
import { writePidFile, removePidFile, isDaemonRunning, readPidFile } from "./config/state.js";
import { DiscordBot } from "./bot/discord-client.js";
import { createLogger } from "./utils/logger.js";
import { cleanupMedia } from "./media/cleanup.js";
import type { AppConfig } from "./config/types.js";

// Remove CLAUDECODE env var so the Agent SDK can spawn Claude Code subprocesses
delete process.env.CLAUDECODE;

const logger = createLogger("daemon");

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_RESET_TIMEOUT_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let discordBot: DiscordBot | null = null;
let currentConfig: AppConfig | null = null;
const shuttingDown = { value: false };

function startBotWithRecovery(config: AppConfig): void {
  let retries = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const launch = () => {
    if (shuttingDown.value) return;

    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }

    discordBot = new DiscordBot(config, logger);
    currentConfig = config;

    // Add all projects
    for (const project of config.projects) {
      const projectLogger = createLogger(project.name);
      discordBot.addProject(project, projectLogger);
    }

    discordBot.start().catch((err) => {
      logger.error({ err, retries }, "Discord bot crashed");
      scheduleRetry();
    });

    // Reset retries after stable running
    resetTimer = setTimeout(() => {
      retries = 0;
    }, RETRY_RESET_TIMEOUT_MS);
  };

  const scheduleRetry = () => {
    if (shuttingDown.value) return;

    if (retries >= MAX_RETRIES) {
      logger.error({ maxRetries: MAX_RETRIES }, "Max retries reached, giving up");
      return;
    }

    // Stop the old bot before retrying to prevent duplicate clients
    if (discordBot) {
      discordBot.stop().catch(() => {});
      discordBot = null;
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retries), MAX_DELAY_MS);
    retries++;
    logger.info({ retries, delayMs: delay }, "Restarting Discord bot");

    setTimeout(launch, delay);
  };

  launch();
}

async function handleReload(): Promise<void> {
  logger.info("SIGHUP received, reloading config");

  // Wait for config file write to complete
  await new Promise((r) => setTimeout(r, 500));

  const newConfig = loadConfig();

  if (!discordBot || !currentConfig) {
    // Bot not running, start fresh
    startBotWithRecovery(newConfig);
    return;
  }

  // If the Discord bot token or guild ID changed, full restart
  if (
    newConfig.discordBotToken !== currentConfig.discordBotToken ||
    newConfig.discordGuildId !== currentConfig.discordGuildId
  ) {
    logger.info("Discord token or guild changed, full restart");
    await discordBot.stop();
    startBotWithRecovery(newConfig);
    return;
  }

  // Otherwise, diff project lists and add/remove handlers
  const currentChannels = new Set(discordBot.getChannelIds());
  const newChannels = new Set(newConfig.projects.map((p) => p.channelId));

  let started = 0;
  let stopped = 0;

  // Stop removed projects
  for (const channelId of currentChannels) {
    if (!newChannels.has(channelId)) {
      await discordBot.removeProject(channelId);
      stopped++;
    }
  }

  // Start new projects
  for (const project of newConfig.projects) {
    if (!currentChannels.has(project.channelId)) {
      const projectLogger = createLogger(project.name);
      discordBot.addProject(project, projectLogger);
      started++;
    }
  }

  // Update config for all handlers (authorizedUsers, defaults, project overrides)
  discordBot.updateConfig(newConfig);
  currentConfig = newConfig;
  logger.info({ started, stopped }, "Hot-reload complete");
}

async function main(): Promise<void> {
  // Prevent duplicate daemons
  if (isDaemonRunning()) {
    const existingPid = readPidFile();
    logger.info({ existingPid }, "Another daemon is already running, exiting");
    process.exit(0);
  }

  writePidFile();
  logger.info({ pid: process.pid }, "Daemon starting");

  const config = loadConfig();

  if (!config.discordBotToken) {
    logger.fatal("No Discord bot token configured. Run 'vibemote setup' first.");
    removePidFile();
    process.exit(1);
  }

  startBotWithRecovery(config);

  logger.info({ projects: config.projects.length }, "Discord bot started with all projects");

  // Clean up stale media files
  for (const project of config.projects) {
    const cleaned = cleanupMedia(project.path);
    if (cleaned > 0) logger.info({ project: project.name, cleaned }, "Cleaned up stale media");
  }

  // Schedule hourly cleanup
  setInterval(() => {
    const freshConfig = loadConfig();
    for (const project of freshConfig.projects) {
      cleanupMedia(project.path);
    }
  }, CLEANUP_INTERVAL_MS);

  // Hot-reload on SIGHUP (with debounce)
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
    if (discordBot) {
      await discordBot.stop().catch(() => {});
    }
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
