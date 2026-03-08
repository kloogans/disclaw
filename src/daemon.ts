import { loadConfig } from "./config/store.js";
import { writePidFile, removePidFile } from "./config/state.js";
import { ProjectBot } from "./bot/project-bot.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("daemon");

async function main(): Promise<void> {
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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    for (const bot of bots) {
      await bot.stop().catch(() => {});
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
