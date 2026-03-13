import { escapeMarkdown } from "./formatting.js";
import type { TokenUsage } from "../claude/session-manager.js";

export class UsageTracker {
  private totalCostUsd = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheReadTokens = 0;
  private lastContextWindow = 0;
  private lastUsage: TokenUsage | null = null;

  recordUsage(costUsd: number, usage: TokenUsage | null): void {
    this.totalCostUsd += costUsd;
    this.lastUsage = usage;
    if (usage) {
      this.totalInputTokens += usage.inputTokens;
      this.totalOutputTokens += usage.outputTokens;
      this.totalCacheReadTokens += usage.cacheReadTokens;
      if (usage.contextWindow > 0) this.lastContextWindow = usage.contextWindow;
    }
  }

  formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
  }

  /** Per-turn usage footer for Discord — rendered as a dim code block. */
  getUsageFooter(usage: TokenUsage): string {
    const parts: string[] = [
      `${this.formatTokenCount(usage.inputTokens)} in`,
      `${this.formatTokenCount(usage.outputTokens)} out`,
    ];
    if (usage.cacheReadTokens > 0) {
      parts.push(`${this.formatTokenCount(usage.cacheReadTokens)} cached`);
    }

    if (this.lastContextWindow > 0) {
      const usedPct = Math.round((usage.inputTokens / this.lastContextWindow) * 100);
      if (usedPct >= 80) {
        return `\`${parts.join(" · ")} · ctx ${usedPct}% - consider /new\``;
      }
      parts.push(`ctx ${usedPct}%`);
    }

    return `\`${parts.join(" · ")}\``;
  }

  getStatus(projectName: string, projectPath: string, model: string, mode: string, sessionId: string | null): string {
    const sessionDisplay = sessionId ? `\`${sessionId.slice(0, 8)}...\`` : "none";
    let status =
      `**${escapeMarkdown(projectName)}**\n\n` +
      `\uD83D\uDCC2 ${escapeMarkdown(projectPath)}\n` +
      `\uD83E\uDDE0 Model: ${escapeMarkdown(model)}\n` +
      `\uD83D\uDD12 Mode: ${escapeMarkdown(mode)}\n` +
      `\uD83D\uDCAC Session: ${sessionDisplay}\n` +
      `\uD83D\uDCB0 Cost: $${this.totalCostUsd.toFixed(4)}`;

    if (this.totalInputTokens > 0 || this.totalOutputTokens > 0) {
      status += `\n\uD83D\uDCCA Tokens: ${this.formatTokenCount(this.totalInputTokens)} in / ${this.formatTokenCount(this.totalOutputTokens)} out`;
      if (this.lastContextWindow > 0 && this.lastUsage) {
        const usedPct = Math.round((this.lastUsage.inputTokens / this.lastContextWindow) * 100);
        status += `\n\uD83D\uDCCF Context: ${usedPct}% of ${this.formatTokenCount(this.lastContextWindow)}`;
      }
    }

    return status;
  }

  getCost(): string {
    const parts = [`\uD83D\uDCB0 Session cost: **$${this.totalCostUsd.toFixed(4)}**`];
    if (this.totalInputTokens > 0 || this.totalOutputTokens > 0) {
      parts.push(
        `\uD83D\uDCCA Tokens: ${this.formatTokenCount(this.totalInputTokens)} in / ${this.formatTokenCount(this.totalOutputTokens)} out`,
      );
      if (this.totalCacheReadTokens > 0) {
        parts.push(`\uD83D\uDCBE Cache hits: ${this.formatTokenCount(this.totalCacheReadTokens)}`);
      }
      if (this.lastContextWindow > 0 && this.lastUsage) {
        const usedPct = Math.round((this.lastUsage.inputTokens / this.lastContextWindow) * 100);
        parts.push(`\uD83D\uDCCF Context: ${usedPct}% of ${this.formatTokenCount(this.lastContextWindow)}`);
      }
    }
    return parts.join("\n");
  }
}
