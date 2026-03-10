import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { AppConfig } from "../config/types.js";
import { escapeMarkdown } from "./formatting.js";

export interface CommandCallbacks {
  onNew: () => void;
  onCancel: () => void;
  onModelChange: (model: string) => void;
  onModeChange: (mode: string) => void;
  onSessionsList: () => Promise<{ text: string; sessions: { sessionId: string; summary: string }[] }>;
  onResume: (sessionId: string) => void;
  onHandoff: () => string | null;
  onUndo: () => Promise<string>;
  onDiff: () => Promise<string>;
  onStatus: () => string;
  onCost: () => string;
}

/**
 * Build the slash command definitions for guild registration.
 */
export function buildSlashCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder().setName("new").setDescription("Start a fresh session"),
    new SlashCommandBuilder().setName("cancel").setDescription("Interrupt current operation"),
    new SlashCommandBuilder()
      .setName("model")
      .setDescription("Switch model")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Model name (sonnet, opus, haiku)").setRequired(true),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName("mode")
      .setDescription("Switch permission mode")
      .addStringOption((opt) =>
        opt.setName("mode").setDescription("Permission mode (default, acceptEdits, plan, dontAsk)").setRequired(true),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder().setName("undo").setDescription("Revert last file changes"),
    new SlashCommandBuilder().setName("diff").setDescription("Show recent git changes"),
    new SlashCommandBuilder().setName("sessions").setDescription("List past sessions"),
    new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Resume a session")
      .addStringOption((opt) =>
        opt.setName("id").setDescription("Session ID").setRequired(true),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder().setName("handoff").setDescription("Get CLI command to continue in Claude Code"),
    new SlashCommandBuilder().setName("status").setDescription("Project and session info"),
    new SlashCommandBuilder().setName("cost").setDescription("Session cost"),
    new SlashCommandBuilder().setName("help").setDescription("Show all commands"),
  ];
}

/**
 * Handle a slash command interaction. Returns true if the command was handled.
 */
export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  callbacks: CommandCallbacks,
  projectName: string,
  projectPath: string,
): Promise<boolean> {
  const { commandName } = interaction;

  switch (commandName) {
    case "help": {
      await interaction.reply(
        "**Commands:**\n\n" +
          "/new \u2014 Start a fresh session\n" +
          "/model `<name>` \u2014 Switch model (sonnet, opus, haiku)\n" +
          "/mode `<mode>` \u2014 Switch permission mode (auto, plan, default)\n" +
          "/cancel \u2014 Interrupt current operation\n" +
          "/undo \u2014 Revert last file changes\n" +
          "/diff \u2014 Show recent git changes\n" +
          "/sessions \u2014 List past sessions\n" +
          "/resume `<id>` \u2014 Resume a session\n" +
          "/handoff \u2014 Get CLI command to continue in Claude Code\n" +
          "/status \u2014 Show project & session info\n" +
          "/cost \u2014 Show session cost\n" +
          "/help \u2014 This message",
      );
      return true;
    }

    case "new": {
      callbacks.onNew();
      await interaction.reply("\uD83C\uDD95 Starting fresh session...");
      return true;
    }

    case "cancel": {
      callbacks.onCancel();
      await interaction.reply("\u274C Operation cancelled.");
      return true;
    }

    case "model": {
      const model = interaction.options.getString("name", true);
      callbacks.onModelChange(model);
      await interaction.reply(`\uD83E\uDDE0 Model switched to **${escapeMarkdown(model)}**`);
      return true;
    }

    case "mode": {
      const mode = interaction.options.getString("mode", true);
      callbacks.onModeChange(mode);
      await interaction.reply(`\uD83D\uDD12 Permission mode: **${escapeMarkdown(mode)}**`);
      return true;
    }

    case "undo": {
      await interaction.deferReply();
      const result = await callbacks.onUndo();
      await interaction.editReply(truncateForDiscord(result));
      return true;
    }

    case "diff": {
      await interaction.deferReply();
      const result = await callbacks.onDiff();
      await interaction.editReply(truncateForDiscord(result));
      return true;
    }

    case "sessions": {
      await interaction.deferReply();
      const { text, sessions } = await callbacks.onSessionsList();
      if (sessions.length === 0) {
        await interaction.editReply(text);
        return true;
      }

      // Use buttons for up to 5 sessions, select menu for more
      if (sessions.length <= 5) {
        const rows: ActionRowBuilder<ButtonBuilder>[] = [];
        for (const s of sessions) {
          const label = s.summary.length > 70 ? s.summary.slice(0, 67) + "..." : s.summary;
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`resume:${s.sessionId}`).setLabel(label).setStyle(ButtonStyle.Secondary),
          );
          rows.push(row);
        }
        await interaction.editReply({ content: text, components: rows });
      } else {
        const menu = new StringSelectMenuBuilder()
          .setCustomId("session_select")
          .setPlaceholder("Select a session to resume")
          .addOptions(
            sessions.map((s) => ({
              label: s.summary.length > 90 ? s.summary.slice(0, 87) + "..." : s.summary,
              value: s.sessionId,
              description: s.sessionId.slice(0, 8),
            })),
          );
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
        await interaction.editReply({ content: text, components: [row] });
      }
      return true;
    }

    case "resume": {
      const sessionId = interaction.options.getString("id", true);
      callbacks.onResume(sessionId);
      await interaction.reply("\u23EA Resuming session...");
      return true;
    }

    case "handoff": {
      const sessionId = callbacks.onHandoff();
      if (!sessionId) {
        await interaction.reply("No active session to hand off.");
        return true;
      }
      await interaction.reply(
        `\uD83D\uDCBB **Continue in Claude Code:**\n\n` +
          `\`\`\`\ncd ${projectPath} && claude --resume ${sessionId}\n\`\`\`\n\n` +
          `Copy and paste this into your terminal.`,
      );
      return true;
    }

    case "status": {
      await interaction.reply(callbacks.onStatus());
      return true;
    }

    case "cost": {
      await interaction.reply(callbacks.onCost());
      return true;
    }

    default:
      return false;
  }
}

/**
 * Check if a Discord user is authorized.
 */
export function isAuthorized(userId: string, config: AppConfig): boolean {
  return config.authorizedUsers.includes(userId);
}

/**
 * Truncate a string to fit Discord's 2000-character message limit.
 */
function truncateForDiscord(text: string, limit = 1950): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n\n... (truncated)";
}
