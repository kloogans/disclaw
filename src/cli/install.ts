import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getConfigDir } from "../config/store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getDaemonPath(): string {
  return join(__dirname, "daemon.js");
}

function getTrayPath(): string {
  return join(__dirname, "tray.js");
}

function getNodePath(): string {
  const cmd = platform() === "win32" ? "where node" : "which node";
  return execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0];
}

function getLogDir(): string {
  const logDir = join(getConfigDir(), "logs");
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  return logDir;
}

// --- macOS LaunchAgent ---

function installMacOS(): void {
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  const plistDest = join(launchAgentsDir, "com.claude-control.daemon.plist");

  if (!existsSync(launchAgentsDir)) {
    mkdirSync(launchAgentsDir, { recursive: true });
  }

  const nodePath = getNodePath();
  const daemonPath = getDaemonPath();
  const logDir = getLogDir();

  const template = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-control.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${daemonPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${homedir()}</string>
  <key>StandardOutPath</key>
  <string>${logDir}/daemon.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daemon.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistDest, template, "utf-8");

  const uid = execSync("id -u", { encoding: "utf-8" }).trim();
  try {
    execSync(`launchctl bootout gui/${uid} "${plistDest}" 2>/dev/null`, { stdio: "ignore" });
  } catch {}
  execSync(`launchctl bootstrap gui/${uid} "${plistDest}"`);

  console.log("LaunchAgent installed. claude-control will auto-start on login.");
  console.log(`  Plist: ${plistDest}`);

  // Also install tray LaunchAgent
  installMacOSTray(launchAgentsDir, nodePath, logDir);
}

function installMacOSTray(launchAgentsDir: string, nodePath: string, logDir: string): void {
  const plistDest = join(launchAgentsDir, "com.claude-control.tray.plist");
  const trayPath = getTrayPath();

  const template = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-control.tray</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${trayPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>WorkingDirectory</key>
  <string>${homedir()}</string>
  <key>StandardOutPath</key>
  <string>${logDir}/tray.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/tray.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistDest, template, "utf-8");

  const uid = execSync("id -u", { encoding: "utf-8" }).trim();
  try {
    execSync(`launchctl bootout gui/${uid} "${plistDest}" 2>/dev/null`, { stdio: "ignore" });
  } catch {}
  execSync(`launchctl bootstrap gui/${uid} "${plistDest}"`);

  console.log("Menu bar icon will auto-start on login.");
}

function uninstallMacOS(): void {
  const uid = execSync("id -u", { encoding: "utf-8" }).trim();
  let removed = false;

  const daemonPlist = join(homedir(), "Library", "LaunchAgents", "com.claude-control.daemon.plist");
  if (existsSync(daemonPlist)) {
    try { execSync(`launchctl bootout gui/${uid} "${daemonPlist}"`); } catch {}
    unlinkSync(daemonPlist);
    console.log("Daemon LaunchAgent removed.");
    removed = true;
  }

  const trayPlist = join(homedir(), "Library", "LaunchAgents", "com.claude-control.tray.plist");
  if (existsSync(trayPlist)) {
    try { execSync(`launchctl bootout gui/${uid} "${trayPlist}"`); } catch {}
    unlinkSync(trayPlist);
    console.log("Tray LaunchAgent removed.");
    removed = true;
  }

  if (!removed) {
    console.log("LaunchAgents not installed.");
    return;
  }

  console.log("claude-control will no longer auto-start.");
}

// --- Linux systemd ---

function getSystemdDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

function installLinux(): void {
  const systemdDir = getSystemdDir();
  const serviceDest = join(systemdDir, "claude-control.service");

  if (!existsSync(systemdDir)) {
    mkdirSync(systemdDir, { recursive: true });
  }

  const nodePath = getNodePath();
  const daemonPath = getDaemonPath();
  const logDir = getLogDir();

  const template = `[Unit]
Description=claude-control daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonPath}
Restart=always
RestartSec=5
WorkingDirectory=${homedir()}
Environment=PATH=${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}
Environment=HOME=${homedir()}
StandardOutput=append:${logDir}/daemon.stdout.log
StandardError=append:${logDir}/daemon.stderr.log

[Install]
WantedBy=default.target
`;

  writeFileSync(serviceDest, template, "utf-8");

  execSync("systemctl --user daemon-reload");
  execSync("systemctl --user enable claude-control.service");
  execSync("systemctl --user start claude-control.service");

  // Enable lingering so the service runs without an active login session
  try {
    execSync("loginctl enable-linger");
  } catch {}

  console.log("systemd service installed. claude-control will auto-start on login.");
  console.log(`  Service: ${serviceDest}`);
}

function uninstallLinux(): void {
  const serviceDest = join(getSystemdDir(), "claude-control.service");

  if (!existsSync(serviceDest)) {
    console.log("systemd service not installed.");
    return;
  }

  try {
    execSync("systemctl --user stop claude-control.service", { stdio: "ignore" });
  } catch {}
  try {
    execSync("systemctl --user disable claude-control.service", { stdio: "ignore" });
  } catch {}

  unlinkSync(serviceDest);
  execSync("systemctl --user daemon-reload");

  console.log("systemd service removed. claude-control will no longer auto-start.");
}

// --- Windows Task Scheduler ---

function installWindows(): void {
  const nodePath = getNodePath();
  const daemonPath = getDaemonPath();
  getLogDir(); // ensure log dir exists

  const taskName = "claude-control";

  // Remove existing task if present
  try {
    execSync(`schtasks /Delete /TN "${taskName}" /F 2>nul`, { stdio: "ignore" });
  } catch {}

  // Create a task that runs at logon and restarts on failure
  execSync(
    `schtasks /Create /TN "${taskName}" /TR "\\"${nodePath}\\" \\"${daemonPath}\\"" /SC ONLOGON /RL HIGHEST /F`,
  );

  // Start it now
  try {
    execSync(`schtasks /Run /TN "${taskName}"`, { stdio: "ignore" });
  } catch {}

  console.log("Scheduled task installed. claude-control will auto-start on login.");
  console.log(`  Task: ${taskName}`);
}

function uninstallWindows(): void {
  const taskName = "claude-control";

  try {
    execSync(`schtasks /Delete /TN "${taskName}" /F`);
    console.log("Scheduled task removed. claude-control will no longer auto-start.");
  } catch {
    console.log("Scheduled task not found.");
  }
}

// --- Public API ---

export async function installCommand(): Promise<void> {
  const os = platform();
  switch (os) {
    case "darwin":
      installMacOS();
      break;
    case "linux":
      installLinux();
      break;
    case "win32":
      installWindows();
      break;
    default:
      console.error(`Unsupported platform: ${os}. Manual setup required.`);
      process.exit(1);
  }
}

export async function uninstallCommand(): Promise<void> {
  const os = platform();
  switch (os) {
    case "darwin":
      uninstallMacOS();
      break;
    case "linux":
      uninstallLinux();
      break;
    case "win32":
      uninstallWindows();
      break;
    default:
      console.error(`Unsupported platform: ${os}`);
      process.exit(1);
  }
}
