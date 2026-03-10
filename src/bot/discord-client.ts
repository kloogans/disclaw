import {
  Client,
  Events,
  GatewayIntentBits,
  type TextChannel,
  type Interaction,
  ChannelType,
  REST,
  Routes,
} from "discord.js";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { ProjectHandler } from "./project-handler.js";
import { buildSlashCommands } from "./commands.js";
import type pino from "pino";

export class DiscordBot {
  private client: Client;
  private config: AppConfig;
  private logger: pino.Logger;
  private handlers = new Map<string, ProjectHandler>(); // channelId -> handler

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
          } else {
            this.logger.warn({ channelId, project: handler.projectName }, "Channel not found or not a text channel");
          }
        } catch (err) {
          this.logger.error({ err, channelId, project: handler.projectName }, "Failed to fetch channel");
        }
      }
    });

    // Route messages to the correct handler by channel
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      const handler = this.handlers.get(message.channelId);
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
          const handler = this.handlers.get(interaction.channelId);
          if (!handler) {
            await interaction.reply({
              content: "This channel is not linked to a Vibemote project.",
              ephemeral: true,
            });
            return;
          }
          await handler.handleInteraction(interaction);
        } else if (interaction.isButton()) {
          const handler = this.handlers.get(interaction.channelId);
          if (handler) {
            await handler.handleButtonInteraction(interaction);
          }
        } else if (interaction.isStringSelectMenu()) {
          const handler = this.handlers.get(interaction.channelId);
          if (handler) {
            await handler.handleSelectMenuInteraction(interaction);
          }
        }
      } catch (err) {
        this.logger.error({ err, channelId: interaction.channelId }, "Error handling interaction");
      }
    });

    this.client.on(Events.Error, (err) => {
      this.logger.error({ err }, "Discord client error");
    });
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
        .then((channel) => {
          if (channel && channel.type === ChannelType.GuildText) {
            handler.setChannel(channel as TextChannel);
          } else {
            this.logger.warn(
              { channelId: project.channelId, project: project.name },
              "Channel not found or not a text channel",
            );
          }
        })
        .catch((err) => {
          this.logger.error({ err, project: project.name }, "Failed to fetch channel");
        });
    }
  }

  /**
   * Remove a project handler and stop it.
   */
  async removeProject(channelId: string): Promise<void> {
    const handler = this.handlers.get(channelId);
    if (handler) {
      await handler.stop();
      this.handlers.delete(channelId);
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
  }

  /**
   * Get all active channel IDs.
   */
  getChannelIds(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Get a handler by project name.
   */
  getHandlerByName(name: string): ProjectHandler | undefined {
    for (const handler of this.handlers.values()) {
      if (handler.projectName === name) return handler;
    }
    return undefined;
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
    this.handlers.clear();
    this.client.destroy();
  }
}
