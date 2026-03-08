import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getConfigDir } from "../config/store.js";

const PLIST_NAME = "com.claude-control.daemon.plist";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");

export async function installCommand(): Promise<void> {
  const plistDest = join(LAUNCH_AGENTS_DIR, PLIST_NAME);

  if (!existsSync(LAUNCH_AGENTS_DIR)) {
    mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatePath = join(__dirname, "..", "templates", PLIST_NAME);
  const daemonPath = join(__dirname, "..", "daemon.js");
  const logDir = join(getConfigDir(), "logs");

  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  // Find node path
  const nodePath = execSync("which node", { encoding: "utf-8" }).trim();

  let template = readFileSync(templatePath, "utf-8");
  template = template.replace(/\{\{NODE_PATH\}\}/g, nodePath);
  template = template.replace(/\{\{DAEMON_PATH\}\}/g, daemonPath);
  template = template.replace(/\{\{HOME\}\}/g, homedir());
  template = template.replace(/\{\{LOG_DIR\}\}/g, logDir);
  template = template.replace(/\{\{PATH\}\}/g, process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin");

  writeFileSync(plistDest, template, "utf-8");

  // Load the launch agent
  const uid = execSync("id -u", { encoding: "utf-8" }).trim();
  try {
    execSync(`launchctl bootout gui/${uid} "${plistDest}" 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // Might not be loaded yet
  }
  execSync(`launchctl bootstrap gui/${uid} "${plistDest}"`);

  console.log("LaunchAgent installed. claude-control will auto-start on login.");
  console.log(`  Plist: ${plistDest}`);
}

export async function uninstallCommand(): Promise<void> {
  const plistDest = join(LAUNCH_AGENTS_DIR, PLIST_NAME);

  if (!existsSync(plistDest)) {
    console.log("LaunchAgent not installed.");
    return;
  }

  const uid = execSync("id -u", { encoding: "utf-8" }).trim();
  try {
    execSync(`launchctl bootout gui/${uid} "${plistDest}"`);
  } catch {
    // Might already be unloaded
  }

  unlinkSync(plistDest);
  console.log("LaunchAgent removed. claude-control will no longer auto-start.");
}
