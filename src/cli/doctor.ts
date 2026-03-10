import { configExists, loadConfig } from "../config/store.js";
import { isDaemonRunning } from "../config/state.js";
import { checkNodeVersion, checkClaudeAuth, validateDiscordToken } from "./checks.js";

export async function doctorCommand(): Promise<void> {
  let ok = true;
  const check = (label: string, pass: boolean, detail?: string) => {
    const icon = pass ? "✓" : "✗";
    console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!pass) ok = false;
  };

  console.log("\nvibemote doctor\n");

  // Prerequisites (from shared checks)
  const nodeCheck = checkNodeVersion();
  check(nodeCheck.label, nodeCheck.pass, nodeCheck.detail);

  const claudeCheck = checkClaudeAuth();
  check(claudeCheck.label, claudeCheck.pass, claudeCheck.detail);

  // Config exists
  check("Config file exists", configExists(), "~/.vibemote/config.json");

  if (configExists()) {
    const config = loadConfig();
    check("Authorized users configured", config.authorizedUsers.length > 0, `${config.authorizedUsers.length} user(s)`);
    check("Projects registered", config.projects.length > 0, `${config.projects.length} project(s)`);

    // Validate Discord bot token (single token for all projects)
    if (config.discordBotToken) {
      const result = await validateDiscordToken(config.discordBotToken);
      if (result.valid && result.botInfo) {
        check("Discord bot token", true, result.botInfo.username);
      } else {
        check("Discord bot token", false, result.error ?? "invalid");
      }
    } else {
      check("Discord bot token", false, "not configured");
    }

    // Check guild ID is set
    check("Discord guild ID", !!config.discordGuildId, config.discordGuildId || "not configured");

    // Check each project has a channel ID
    for (const project of config.projects) {
      check(`Channel: ${project.name}`, !!project.channelId, project.channelId || "not configured");
    }
  }

  // Daemon status
  check("Daemon running", isDaemonRunning());

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed. Fix the issues above.");
}
