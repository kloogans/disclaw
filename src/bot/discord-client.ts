import {
  Client,
  Events,
  GatewayIntentBits,
  type TextChannel,
  type ForumChannel,
  type AnyThreadChannel,
  type Interaction,
  ChannelType,
  MessageType,
  REST,
  Routes,
} from "discord.js";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { ProjectHandler } from "./project-handler.js";
import { buildSlashCommands } from "./commands.js";
import type pino from "pino";

const MAX_THREAD_HANDLERS = 10;

export class DiscordBot {
  private client: Client;
  private config: AppConfig;
  private logger: pino.Logger;
  private handlers = new Map<string, ProjectHandler>(); // channelId -> handler
  private threadHandlers = new Map<string, ProjectHandler>(); // threadId -> handler
  private threadLastActivity = new Map<string, number>();

  constructor(config: AppConfig, logger: pino.Logger) {
    this.config = config;
    this.logger = logger;

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on(Events.ClientReady, async (client) => {
      this.logger.info({ event: "client_ready", username: client.user.tag }, "Discord bot connected");

      // Register slash commands for the guild
      await this.registerSlashCommands();

      // Resolve channels for all handlers
      for (const [channelId, handler] of this.handlers) {
        try {
          const channel = await this.client.channels.fetch(channelId);
          if (channel && channel.type === ChannelType.GuildText) {
            handler.setChannel(channel as TextChannel);
          } else if (channel && channel.type === ChannelType.GuildForum) {
            // Forum channels are thread-only — the parent handler keeps channel=null.
            // All messages arrive via forum post threads handled by resolveHandler → createThreadHandler.
            this.logger.info({ channelId, project: handler.projectName }, "Forum channel registered (thread-only)");
            handler.markReady(channel.name);
            await this.joinActiveForumThreads(channel as ForumChannel, channelId);
          } else {
            this.logger.warn(
              { channelId, project: handler.projectName },
              "Channel not found or not a supported channel type",
            );
          }
        } catch (err) {
          this.logger.error({ err, channelId, project: handler.projectName }, "Failed to fetch channel");
        }
      }
    });

    // Route messages to the correct handler by channel
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      if (
        message.type !== MessageType.Default &&
        message.type !== MessageType.Reply &&
        message.type !== MessageType.ThreadStarterMessage
      )
        return;
      const handler = this.resolveHandler(message.channelId, message.channel);
      if (!handler) return;
      try {
        await handler.handleMessage(message);
      } catch (err) {
        this.logger.error({ err, channelId: message.channelId }, "Error handling message");
      }
    });

    // Route interactions (slash commands, buttons, select menus)
    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          const handler = this.resolveHandler(interaction.channelId, interaction.channel);
          if (!handler) {
            await interaction.reply({
              content: "This channel is not linked to a Disclaw project.",
              ephemeral: true,
            });
            return;
          }
          if (!handler.hasChannel) {
            await interaction.reply({
              content: "Use this command inside a forum post, not in the forum channel itself.",
              ephemeral: true,
            });
            return;
          }
          await handler.handleInteraction(interaction);
        } else if (interaction.isButton()) {
          const handler = this.resolveHandler(interaction.channelId, interaction.channel);
          if (handler) {
            await handler.handleButtonInteraction(interaction);
          }
        } else if (interaction.isStringSelectMenu()) {
          const handler = this.resolveHandler(interaction.channelId, interaction.channel);
          if (handler) {
            await handler.handleSelectMenuInteraction(interaction);
          }
        }
      } catch (err) {
        this.logger.error({ err, channelId: interaction.channelId }, "Error handling interaction");
      }
    });

    // Thread lifecycle events
    this.client.on(Events.ThreadCreate, async (thread) => {
      if (!thread.parentId || !this.handlers.has(thread.parentId)) return;
      try {
        await thread.join();
        this.logger.info({ threadId: thread.id, threadName: thread.name }, "Joined new thread");
      } catch (err) {
        this.logger.debug({ err, threadId: thread.id }, "Failed to join thread");
      }
    });

    this.client.on(Events.ThreadDelete, async (thread) => {
      await this.stopThreadHandler(thread.id);
    });

    this.client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
      if (newThread.archived && !oldThread.archived) {
        await this.stopThreadHandler(newThread.id);
      }
    });

    this.client.on(Events.Error, (err) => {
      this.logger.error({ err }, "Discord client error");
    });
  }

  private async joinActiveForumThreads(forum: ForumChannel, channelId: string): Promise<void> {
    try {
      const fetched = await forum.threads.fetchActive();
      for (const thread of fetched.threads.values()) {
        await thread.join().catch(() => {});
      }
      if (fetched.threads.size > 0) {
        this.logger.info({ channelId, count: fetched.threads.size }, "Joined active forum threads");
      }
    } catch (err) {
      this.logger.debug({ err, channelId }, "Failed to fetch active forum threads");
    }
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.client.application) return;

    try {
      const commands = buildSlashCommands();
      const rest = new REST().setToken(this.config.discordBotToken);
      await rest.put(Routes.applicationGuildCommands(this.client.application.id, this.config.discordGuildId), {
        body: commands.map((c) => c.toJSON()),
      });
      this.logger.info({ count: commands.length }, "Slash commands registered");
    } catch (err) {
      this.logger.error({ err }, "Failed to register slash commands");
    }
  }

  /**
   * Add a project handler. If the client is already connected, resolve the channel immediately.
   */
  addProject(project: ProjectConfig, projectLogger: pino.Logger): void {
    if (this.handlers.has(project.channelId)) {
      this.logger.warn({ project: project.name }, "Handler already exists for this channel");
      return;
    }

    const handler = new ProjectHandler(this.config, project, projectLogger);
    this.handlers.set(project.channelId, handler);

    // If client is already ready, resolve channel now
    if (this.client.isReady()) {
      this.client.channels
        .fetch(project.channelId)
        .then(async (channel) => {
          if (channel && channel.type === ChannelType.GuildText) {
            handler.setChannel(channel as TextChannel);
          } else if (channel && channel.type === ChannelType.GuildForum) {
            this.logger.info(
              { channelId: project.channelId, project: project.name },
              "Forum channel registered (thread-only)",
            );
            handler.markReady(channel.name);
            await this.joinActiveForumThreads(channel as ForumChannel, project.channelId);
          } else {
            this.logger.warn(
              { channelId: project.channelId, project: project.name },
              "Channel not found or not a supported channel type",
            );
          }
        })
        .catch((err) => {
          this.logger.error({ err, project: project.name }, "Failed to fetch channel");
        });
    }
  }

  /**
   * Remove a project handler and stop it. Also cleans up any thread handlers for this channel.
   */
  async removeProject(channelId: string): Promise<void> {
    const handler = this.handlers.get(channelId);
    if (handler) {
      await handler.stop();
      this.handlers.delete(channelId);
    }

    // Stop all thread handlers belonging to this channel
    for (const [threadId, threadHandler] of this.threadHandlers) {
      if (threadHandler.channelId === channelId) {
        await threadHandler.stop();
        this.threadHandlers.delete(threadId);
        this.threadLastActivity.delete(threadId);
      }
    }
  }

  /**
   * Update the shared config reference (e.g. after hot-reload).
   */
  updateConfig(config: AppConfig): void {
    this.config = config;
    for (const handler of this.handlers.values()) {
      handler.updateConfig(config);
    }
    for (const handler of this.threadHandlers.values()) {
      handler.updateConfig(config);
    }
  }

  /**
   * Get all active channel IDs.
   */
  getChannelIds(): string[] {
    return [...this.handlers.keys()];
  }

  getHandlerByName(name: string): ProjectHandler | undefined {
    for (const handler of this.handlers.values()) {
      if (handler.projectName === name) return handler;
    }
    return undefined;
  }

  private resolveHandler(
    channelId: string,
    channel?: { isThread(): boolean; parentId?: string | null } | null,
  ): ProjectHandler | undefined {
    // Direct channel match (parent channel messages)
    const direct = this.handlers.get(channelId);
    if (direct) return direct;

    // Existing thread handler
    const existing = this.threadHandlers.get(channelId);
    if (existing) {
      this.threadLastActivity.set(channelId, Date.now());
      return existing;
    }

    // Create a new thread handler if the parent channel has a project
    if (channel?.isThread() && channel.parentId) {
      const parentHandler = this.handlers.get(channel.parentId);
      if (parentHandler) {
        return this.createThreadHandler(channelId, channel as AnyThreadChannel, parentHandler) ?? undefined;
      }
    }

    return undefined;
  }

  private createThreadHandler(
    threadId: string,
    thread: AnyThreadChannel,
    parentHandler: ProjectHandler,
  ): ProjectHandler | null {
    // Evict oldest idle handler if at capacity
    if (this.threadHandlers.size >= MAX_THREAD_HANDLERS) {
      if (!this.evictOldestIdle()) {
        this.logger.warn("All thread handlers busy, cannot create new handler");
        return null;
      }
    }

    const project = this.config.projects.find((p) => p.channelId === parentHandler.channelId);
    if (!project) return null;

    const threadLogger = this.logger.child({ project: project.name, threadId, threadName: thread.name });
    const handler = new ProjectHandler(this.config, project, threadLogger, threadId);
    handler.setChannel(thread);
    this.threadHandlers.set(threadId, handler);
    this.threadLastActivity.set(threadId, Date.now());

    this.logger.info(
      { threadId, threadName: thread.name, project: project.name, activeThreads: this.threadHandlers.size },
      "Created thread handler",
    );

    return handler;
  }

  private evictOldestIdle(): boolean {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [threadId, lastActivity] of this.threadLastActivity) {
      const handler = this.threadHandlers.get(threadId);
      if (handler && !handler.processing && lastActivity < oldestTime) {
        oldestTime = lastActivity;
        oldestId = threadId;
      }
    }

    if (!oldestId) return false;

    this.logger.info({ evictedThreadId: oldestId }, "Evicting oldest idle thread handler");
    const handler = this.threadHandlers.get(oldestId);
    handler?.stop().catch((err) => this.logger.error({ err }, "Error stopping evicted handler"));
    this.threadHandlers.delete(oldestId);
    this.threadLastActivity.delete(oldestId);
    return true;
  }

  private async stopThreadHandler(threadId: string): Promise<void> {
    const handler = this.threadHandlers.get(threadId);
    if (handler) {
      this.logger.info({ threadId }, "Thread removed/archived, stopping handler");
      await handler.stop();
      this.threadHandlers.delete(threadId);
      this.threadLastActivity.delete(threadId);
    }
  }

  async start(): Promise<void> {
    this.logger.info("Starting Discord bot");
    await this.client.login(this.config.discordBotToken);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping Discord bot");
    for (const handler of this.handlers.values()) {
      await handler.stop();
    }
    for (const handler of this.threadHandlers.values()) {
      await handler.stop();
    }
    this.handlers.clear();
    this.threadHandlers.clear();
    this.threadLastActivity.clear();
    this.client.destroy();
  }
}
