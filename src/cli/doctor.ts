import { configExists, loadConfig } from "../config/store.js";
import { isDaemonRunning } from "../config/state.js";
import { checkNodeVersion, checkClaudeAuth, validateDiscordToken } from "./checks.js";
import { banner, success, fail, c, Spinner } from "./ui.js";

export async function doctorCommand(): Promise<void> {
  let ok = true;
  const check = (label: string, pass: boolean, detail?: string) => {
    if (pass) {
      success(`${label}${detail ? ` ${c.dim}— ${detail}${c.reset}` : ""}`);
    } else {
      fail(`${label}${detail ? ` ${c.dim}— ${detail}${c.reset}` : ""}`);
      ok = false;
    }
  };

  banner("doctor");

  // Prerequisites (from shared checks)
  const nodeCheck = checkNodeVersion();
  check(nodeCheck.label, nodeCheck.pass, nodeCheck.detail);

  const claudeCheck = checkClaudeAuth();
  check(claudeCheck.label, claudeCheck.pass, claudeCheck.detail);

  // Config exists
  check("Config file exists", configExists(), "~/.disclaw/config.json");

  if (configExists()) {
    const config = loadConfig();
    check("Authorized users configured", config.authorizedUsers.length > 0, `${config.authorizedUsers.length} user(s)`);
    check("Projects registered", config.projects.length > 0, `${config.projects.length} project(s)`);

    // Validate Discord bot token (single token for all projects)
    if (config.discordBotToken) {
      const spinner = new Spinner("Validating Discord token");
      spinner.start();
      const result = await validateDiscordToken(config.discordBotToken);
      if (result.valid && result.botInfo) {
        spinner.stop(`${c.green}✓${c.reset} Discord bot token ${c.dim}— ${result.botInfo.username}${c.reset}`);
      } else {
        spinner.stop(`${c.red}✗${c.reset} Discord bot token ${c.dim}— ${result.error ?? "invalid"}${c.reset}`);
        ok = false;
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

  if (ok) {
    console.log(`\n  ${c.green}${c.bold}All checks passed.${c.reset}`);
  } else {
    console.log(`\n  ${c.red}Some checks failed.${c.reset} Fix the issues above.`);
  }
}
