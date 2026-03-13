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
  onSendPrompt: (prompt: string) => void;
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
    new SlashCommandBuilder().setName("simplify").setDescription("Review and simplify recently changed code"),
    new SlashCommandBuilder().setName("review").setDescription("Review recent changes for bugs and issues"),
    new SlashCommandBuilder()
      .setName("commit")
      .setDescription("Commit current changes")
      .addStringOption((opt) =>
        opt.setName("message").setDescription("Optional commit message or instructions").setRequired(false),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName("skill")
      .setDescription("Run a Claude Code skill")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Skill name (e.g. frontend-design)").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("args").setDescription("Arguments to pass to the skill").setRequired(false),
      ) as SlashCommandBuilder,
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
          "/new - Start a fresh session\n" +
          "/model `<name>` - Switch model (sonnet, opus, haiku)\n" +
          "/mode `<mode>` - Switch permission mode (default, acceptEdits, plan, dontAsk)\n" +
          "/cancel - Interrupt current operation\n" +
          "/simplify - Review and simplify recently changed code\n" +
          "/review - Review recent changes for bugs and issues\n" +
          "/commit `[message]` - Commit current changes\n" +
          "/skill `<name>` `[args]` - Run a Claude Code skill\n" +
          "/undo - Revert last file changes\n" +
          "/diff - Show recent git changes\n" +
          "/sessions - List past sessions\n" +
          "/resume `<id>` - Resume a session\n" +
          "/handoff - Get CLI command to continue in Claude Code\n" +
          "/status - Show project & session info\n" +
          "/cost - Show session cost\n" +
          "/help - This message",
      );
      return true;
    }

    case "new": {
      callbacks.onNew();
      await interaction.reply("Session reset. Send a message to start a new session.");
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

    case "simplify": {
      callbacks.onSendPrompt(
        "Review the code you just changed. Look for opportunities to simplify, reuse existing patterns, and improve clarity. Fix any issues you find.",
      );
      await interaction.reply("\uD83E\uDDF9 Reviewing code for simplification...");
      return true;
    }

    case "review": {
      callbacks.onSendPrompt(
        "Review the recent changes for bugs, logic errors, security vulnerabilities, and code quality issues. Report what you find.",
      );
      await interaction.reply("\uD83D\uDD0D Reviewing recent changes...");
      return true;
    }

    case "commit": {
      const message = interaction.options.getString("message");
      const prompt = message
        ? `Review the current git diff and create a commit. Instructions: ${message}`
        : "Review the current git diff and create a commit with a clear, concise message.";
      callbacks.onSendPrompt(prompt);
      await interaction.reply("\uD83D\uDCDD Committing changes...");
      return true;
    }

    case "skill": {
      const name = interaction.options.getString("name", true);
      const args = interaction.options.getString("args");
      const prompt = args ? `/${name} ${args}` : `/${name}`;
      callbacks.onSendPrompt(prompt);
      await interaction.reply(`\uD83D\uDD27 Running /${escapeMarkdown(name)}...`);
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
