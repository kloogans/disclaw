import { platform, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { execSync, spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import SysTrayPkg from "systray2";
import { loadConfig, getConfigDir } from "./config/store.js";
import { isDaemonRunning, readPidFile } from "./config/state.js";

const SysTray = (SysTrayPkg as any).default ?? SysTrayPkg;

// --- PNG Icon Generation ---

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createCircleIcon(size: number, filled: boolean): Buffer {
  const center = size / 2;
  const outerR = size * 0.38;
  const innerR = filled ? 0 : size * 0.25;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 4);
    raw[rowOffset] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = dx * dx + dy * dy;
      const inside = dist <= outerR * outerR && dist >= innerR * innerR;
      raw[px + 3] = inside ? 255 : 0; // black pixel with alpha
    }
  }

  const compressed = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ensureIcons(): { running: string; stopped: string } {
  const iconDir = join(tmpdir(), "claude-control-icons");
  if (!existsSync(iconDir)) mkdirSync(iconDir, { recursive: true });

  const runningPath = join(iconDir, "tray-running.png");
  const stoppedPath = join(iconDir, "tray-stopped.png");

  if (!existsSync(runningPath)) {
    writeFileSync(runningPath, createCircleIcon(22, true));
  }
  if (!existsSync(stoppedPath)) {
    writeFileSync(stoppedPath, createCircleIcon(22, false));
  }

  return { running: runningPath, stopped: stoppedPath };
}

// --- Tray App ---

function getDaemonStatus(): { running: boolean; pid: number | null } {
  const running = isDaemonRunning();
  const pid = running ? readPidFile() : null;
  return { running, pid };
}

function getProjectCount(): number {
  try {
    const config = loadConfig();
    return config.projects.length;
  } catch {
    return 0;
  }
}

function runCommand(cmd: string): string {
  try {
    // Find the CLI entry point
    const cliPath = join(__dirname, "index.js");
    return execSync(`node "${cliPath}" ${cmd}`, {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch (err) {
    return String(err);
  }
}

function openInTerminal(cmd: string): void {
  const cliPath = join(__dirname, "index.js");
  if (platform() === "darwin") {
    spawn("open", ["-a", "Terminal", `node "${cliPath}" ${cmd}`], { detached: true, stdio: "ignore" });
  } else if (platform() === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/k", `node "${cliPath}" ${cmd}`], { detached: true, stdio: "ignore" });
  } else {
    // Linux — try common terminals
    const term = process.env.TERMINAL || "x-terminal-emulator";
    spawn(term, ["-e", `node "${cliPath}" ${cmd}`], { detached: true, stdio: "ignore" });
  }
}

function openConfig(): void {
  const configPath = join(getConfigDir(), "config.json");
  if (platform() === "darwin") {
    spawn("open", [configPath], { detached: true, stdio: "ignore" });
  } else if (platform() === "win32") {
    spawn("cmd", ["/c", "start", configPath], { detached: true, stdio: "ignore" });
  } else {
    spawn("xdg-open", [configPath], { detached: true, stdio: "ignore" });
  }
}

export function launchTray(): void {
  const icons = ensureIcons();
  const isMac = platform() === "darwin";
  const isWindows = platform() === "win32";

  const status = getDaemonStatus();
  const projectCount = getProjectCount();

  // --- Menu Items ---
  const itemStatus = {
    title: status.running
      ? `Running (PID: ${status.pid})`
      : "Stopped",
    tooltip: "Daemon status",
    checked: false,
    enabled: false,
  };

  const itemProjects = {
    title: `${projectCount} project${projectCount === 1 ? "" : "s"}`,
    tooltip: "Registered projects",
    checked: false,
    enabled: false,
  };

  const itemToggle = {
    title: status.running ? "Stop Daemon" : "Start Daemon",
    tooltip: "Start or stop the daemon",
    checked: false,
    enabled: true,
  };

  const itemRestart = {
    title: "Restart Daemon",
    tooltip: "Restart the daemon",
    checked: false,
    enabled: status.running,
  };

  const itemLogs = {
    title: "Open Logs...",
    tooltip: "View daemon logs in terminal",
    checked: false,
    enabled: true,
  };

  const itemConfig = {
    title: "Open Config...",
    tooltip: "Edit configuration file",
    checked: false,
    enabled: true,
  };

  const itemQuit = {
    title: "Quit Menu Bar",
    tooltip: "Close the menu bar icon",
    checked: false,
    enabled: true,
  };

  // --- Create Tray ---
  const currentIcon = status.running ? icons.running : icons.stopped;

  const systray = new SysTray({
    menu: {
      icon: isWindows ? icons.running : currentIcon,
      isTemplateIcon: isMac,
      title: "",
      tooltip: "claude-control",
      items: [
        itemStatus,
        itemProjects,
        SysTray.separator,
        itemToggle,
        itemRestart,
        SysTray.separator,
        itemLogs,
        itemConfig,
        SysTray.separator,
        itemQuit,
      ],
    },
    debug: false,
    copyDir: false,
  });

  // --- Update state ---
  function refreshStatus(): void {
    const s = getDaemonStatus();
    const count = getProjectCount();

    itemStatus.title = s.running
      ? `Running (PID: ${s.pid})`
      : "Stopped";
    itemToggle.title = s.running ? "Stop Daemon" : "Start Daemon";
    itemRestart.enabled = s.running;
    itemProjects.title = `${count} project${count === 1 ? "" : "s"}`;

    systray.sendAction({ type: "update-item", item: itemStatus });
    systray.sendAction({ type: "update-item", item: itemToggle });
    systray.sendAction({ type: "update-item", item: itemRestart });
    systray.sendAction({ type: "update-item", item: itemProjects });

    // Update icon
    const newIcon = s.running ? icons.running : icons.stopped;
    systray.sendAction({
      type: "update-menu",
      menu: {
        icon: newIcon,
        isTemplateIcon: isMac,
        title: "",
        tooltip: s.running ? `claude-control (PID: ${s.pid})` : "claude-control (stopped)",
        items: [] as any,
      },
    });
  }

  // --- Click handlers ---
  (itemToggle as any).click = () => {
    const s = getDaemonStatus();
    if (s.running) {
      runCommand("stop");
    } else {
      runCommand("start");
    }
    // Refresh after a short delay to let the process start/stop
    setTimeout(refreshStatus, 1500);
  };

  (itemRestart as any).click = () => {
    runCommand("stop");
    setTimeout(() => {
      runCommand("start");
      setTimeout(refreshStatus, 1500);
    }, 1000);
  };

  (itemLogs as any).click = () => {
    openInTerminal("logs");
  };

  (itemConfig as any).click = () => {
    openConfig();
  };

  (itemQuit as any).click = () => {
    systray.kill(false);
    process.exit(0);
  };

  // --- Dispatch clicks ---
  systray.onClick((action: any) => {
    if (typeof action.item.click === "function") {
      action.item.click();
    }
  });

  // --- Poll daemon status every 5 seconds ---
  setInterval(refreshStatus, 5000);

  systray.ready().then(() => {
    console.log("claude-control menu bar started");
  }).catch((err: unknown) => {
    console.error("Failed to start menu bar:", err);
    process.exit(1);
  });

  // Keep process alive
  process.on("SIGINT", () => {
    systray.kill(false);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    systray.kill(false);
    process.exit(0);
  });
}

// Direct execution
launchTray();
