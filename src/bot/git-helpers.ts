import { execFileSync } from "node:child_process";
import path from "node:path";
import type { TextChannel } from "discord.js";
import { escapeMarkdown } from "./formatting.js";
import type pino from "pino";

const GIT_COMMAND_TIMEOUT_MS = 5000;
const GIT_STATUS_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export class GitHelper {
  private projectPath: string;
  private projectName: string;
  private logger: pino.Logger;
  private lastGitState: string | null = null;
  private preInteractionGitState: string | null = null;
  private lastChangedFiles: string[] = [];
  private gitNotifyInterval: ReturnType<typeof setInterval> | null = null;

  constructor(projectPath: string, projectName: string, logger: pino.Logger) {
    this.projectPath = projectPath;
    this.projectName = projectName;
    this.logger = logger;
  }

  private git(args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.projectPath,
      encoding: "utf-8",
      timeout: GIT_COMMAND_TIMEOUT_MS,
    }).trim();
  }

  snapshotPreInteraction(): void {
    try {
      this.preInteractionGitState = this.git(["status", "--porcelain"]);
    } catch {
      this.preInteractionGitState = null;
    }
  }

  trackChangedFiles(): void {
    if (this.preInteractionGitState === null) {
      this.lastChangedFiles = [];
      return;
    }
    try {
      const currentState = this.git(["status", "--porcelain"]);

      const priorFiles = new Set(
        this.preInteractionGitState ? this.preInteractionGitState.split("\n").filter(Boolean) : [],
      );
      const currentFiles = currentState ? currentState.split("\n").filter(Boolean) : [];

      this.lastChangedFiles = currentFiles.filter((line) => !priorFiles.has(line)).map((line) => line.slice(3));
    } catch {
      this.lastChangedFiles = [];
    }
  }

  async undo(): Promise<string> {
    try {
      const { rmSync } = await import("node:fs");

      if (this.lastChangedFiles.length === 0) {
        return "Nothing to undo \u2014 no files were changed in the last interaction.";
      }

      const currentStatus = this.git(["status", "--porcelain"]);
      const statusLines = currentStatus ? currentStatus.split("\n") : [];

      const reverted: string[] = [];

      for (const file of this.lastChangedFiles) {
        const resolved = path.resolve(this.projectPath, file);
        if (!resolved.startsWith(this.projectPath + path.sep) && resolved !== this.projectPath) continue;

        const statusLine = statusLines.find((l) => l.slice(3) === file);
        if (!statusLine) continue;

        try {
          if (statusLine.startsWith("??")) {
            rmSync(path.join(this.projectPath, file), { recursive: true, force: true });
            reverted.push(file);
          } else {
            execFileSync("git", ["checkout", "--", file], {
              cwd: this.projectPath,
              encoding: "utf-8",
              timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            reverted.push(file);
          }
        } catch (err) {
          this.logger.warn({ err, file }, "Failed to undo file");
        }
      }

      if (reverted.length === 0) {
        return "Nothing to undo \u2014 changed files may have already been committed or reverted.";
      }

      this.lastChangedFiles = [];
      return `\u21A9\uFE0F Reverted ${reverted.length} file(s):\n${reverted.map((f) => `  - \`${escapeMarkdown(f)}\``).join("\n")}`;
    } catch (err) {
      this.logger.error({ err }, "Undo failed");
      return `Undo failed: ${escapeMarkdown(String(err))}`;
    }
  }

  async diff(): Promise<string> {
    try {
      const unstaged = this.git(["diff", "--stat"]);
      const staged = this.git(["diff", "--cached", "--stat"]);
      const untracked = this.git(["ls-files", "--others", "--exclude-standard"]);
      const log = this.git(["log", "--oneline", "-5"]);

      const parts: string[] = [];

      if (staged) {
        parts.push(`**Staged:**\n\`\`\`\n${staged}\n\`\`\``);
      }
      if (unstaged) {
        parts.push(`**Unstaged:**\n\`\`\`\n${unstaged}\n\`\`\``);
      }
      if (untracked) {
        const files = untracked.split("\n").slice(0, 10);
        const suffix = untracked.split("\n").length > 10 ? `\n  ... and ${untracked.split("\n").length - 10} more` : "";
        parts.push(`**Untracked:**\n\`\`\`\n${files.join("\n") + suffix}\n\`\`\``);
      }
      if (!staged && !unstaged && !untracked) {
        parts.push("Working tree is clean.");
      }

      if (log) {
        parts.push(`**Recent commits:**\n\`\`\`\n${log}\n\`\`\``);
      }

      return parts.join("\n\n");
    } catch (err) {
      return `Error: ${escapeMarkdown(String(err))}`;
    }
  }

  startNotifications(channel: TextChannel): void {
    try {
      this.lastGitState = this.git(["status", "--porcelain"]);
    } catch {
      this.lastGitState = "";
    }

    this.gitNotifyInterval = setInterval(() => {
      this.checkStatus(channel);
    }, GIT_STATUS_CHECK_INTERVAL_MS);
  }

  stopNotifications(): void {
    if (this.gitNotifyInterval) {
      clearInterval(this.gitNotifyInterval);
      this.gitNotifyInterval = null;
    }
  }

  private checkStatus(channel: TextChannel): void {
    try {
      const status = this.git(["status", "--porcelain"]);

      if (status === this.lastGitState) return;
      this.lastGitState = status;

      if (!status) return;

      const lines = status.split("\n");
      const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
      const added = lines.filter((l) => l.startsWith("??")).length;
      const deleted = lines.filter((l) => l.startsWith(" D") || l.startsWith("D ")).length;

      const parts: string[] = [];
      if (modified > 0) parts.push(`${modified} modified`);
      if (added > 0) parts.push(`${added} untracked`);
      if (deleted > 0) parts.push(`${deleted} deleted`);

      channel
        .send(
          `\uD83D\uDCCB **${escapeMarkdown(this.projectName)}** has uncommitted changes: ${parts.join(", ")}\n\nUse /diff for details.`,
        )
        .catch((e) => this.logger.debug(e, "git notification send failed"));
    } catch {
      // Git not available or timeout — skip silently
    }
  }
}
