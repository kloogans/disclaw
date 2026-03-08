import { loadConfig } from "./config/store.js";
import { writePidFile, removePidFile, isDaemonRunning, readPidFile } from "./config/state.js";
import { ProjectBot } from "./bot/project-bot.js";
import { createLogger } from "./utils/logger.js";
import { freeWhisper } from "./media/transcriber.js";
import { cleanupMedia } from "./media/cleanup.js";

// Remove CLAUDECODE env var so the Agent SDK can spawn Claude Code subprocesses
delete process.env.CLAUDECODE;

const logger = createLogger("daemon");

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

  for (const project of config.projects) {
    try {
      const botLogger = createLogger(project.name);
      const bot = new ProjectBot(config, project, botLogger);
      bots.push(bot);
      // Start each bot without awaiting (they run forever via long polling)
      bot.start().catch((err) => {
        botLogger.error({ err }, "Bot crashed");
      });
    } catch (err) {
      logger.error({ err, project: project.name }, "Failed to create bot");
    }
  }

  logger.info({ count: bots.length }, "All bots started");

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
