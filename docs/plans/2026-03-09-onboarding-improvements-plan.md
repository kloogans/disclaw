# Onboarding Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce first-time setup from 15 steps to 5, validate everything upfront, and make adding projects seamless with hot-reload.

**Architecture:** Extract shared prerequisite checks into `src/cli/checks.ts`. Add `vibemote setup` as the one-time global config command. Refactor daemon to use a `Map<string, ProjectBot>` and handle SIGHUP for hot-reload. Improve `add`, `start`, `status`, and `remove` with real-time feedback and validation. Add `token-update` command. Consolidate docs and make package GitHub-installable.

**Tech Stack:** TypeScript, Node.js built-in `fetch` (for Telegram API), Unix signals (SIGHUP), pino structured logging.

**Design doc:** `docs/plans/2026-03-09-onboarding-improvements-design.md`

---

### Task 1: Extract Shared Checks Module

**Files:**
- Create: `src/cli/checks.ts`

**Step 1: Create `src/cli/checks.ts`**

This module provides reusable prerequisite checks and bot token validation used by `setup`, `add`, `doctor`, `start`, `status`, and `token-update`.

```typescript
import { execSync } from "node:child_process";
import { platform } from "node:os";

export interface CheckResult {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
}

export function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  const pass = major >= 22;
  return {
    label: "Node.js >= 22",
    pass,
    detail: pass ? version : `${version} — upgrade: ${platform() === "darwin" ? "brew install node" : "https://nodejs.org"}`,
  };
}

export function checkFfmpeg(): CheckResult {
  let pass = false;
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    pass = true;
  } catch {}
  return {
    label: "ffmpeg installed",
    pass,
    detail: pass ? "found in PATH" : `not found — install: ${platform() === "darwin" ? "brew install ffmpeg" : "https://ffmpeg.org"}`,
  };
}

export function checkClaudeAuth(): CheckResult {
  let pass = false;
  try {
    execSync("claude auth status", { stdio: "ignore" });
    pass = true;
  } catch {}
  return {
    label: "Claude Code authenticated",
    pass,
    detail: pass ? "logged in" : "not authenticated — run: claude auth login",
  };
}

export function runAllPrerequisites(): { allPassed: boolean; results: CheckResult[] } {
  const results = [checkNodeVersion(), checkFfmpeg(), checkClaudeAuth()];
  const allPassed = results.every((r) => r.pass);
  return { allPassed, results };
}

export function printCheckResults(results: CheckResult[]): void {
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`  ${icon} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  }
}

export async function validateBotToken(token: string): Promise<{ valid: boolean; botInfo?: BotInfo; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result) {
      return {
        valid: true,
        botInfo: {
          id: data.result.id,
          username: data.result.username,
          first_name: data.result.first_name,
        },
      };
    }
    return { valid: false, error: data.description || "Invalid token" };
  } catch (err) {
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add src/cli/checks.ts
git commit -m "feat: extract shared prerequisite checks and bot token validation"
```

---

### Task 2: `vibemote setup` Command

**Files:**
- Create: `src/cli/setup.ts`
- Modify: `src/index.ts`

**Step 1: Create `src/cli/setup.ts`**

```typescript
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configExists, saveConfig } from "../config/store.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { runAllPrerequisites, printCheckResults } from "./checks.js";

export async function setupCommand(): Promise<void> {
  console.log("\n=== vibemote Setup ===\n");

  // Prerequisite checks — all must pass before prompts
  console.log("Checking prerequisites...");
  const { allPassed, results } = runAllPrerequisites();
  printCheckResults(results);

  if (!allPassed) {
    console.log("\nFix the issues above before continuing.");
    process.exit(1);
  }

  console.log("");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (configExists()) {
      const overwrite = await rl.question("Config already exists. Overwrite? (y/N): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Keeping existing config.");
        return;
      }
    }

    console.log("Step 1: Telegram User ID");
    console.log("  Open Telegram → @userinfobot → send /start → copy your ID\n");
    const userIdStr = await rl.question("  Your Telegram user ID: ");
    const userId = parseInt(userIdStr.trim(), 10);
    if (isNaN(userId)) {
      console.error("\n  ✗ Invalid user ID — must be a number.");
      process.exit(1);
    }
    console.log("  ✓ Valid user ID\n");

    console.log("Step 2: Voice transcription model");
    console.log("  tiny (~75MB) | base (~150MB) ← recommended | small (~500MB)\n");
    const whisperModel = await rl.question("  Whisper model (base): ");
    const model = whisperModel.trim() || "base";
    if (!["tiny", "base", "small", "medium", "large"].includes(model)) {
      console.error(`\n  ✗ Invalid model "${model}". Choose: tiny, base, small, medium, large`);
      process.exit(1);
    }

    const config = {
      ...DEFAULT_CONFIG,
      authorizedUsers: [userId],
      whisper: {
        ...DEFAULT_CONFIG.whisper,
        model,
      },
    };

    saveConfig(config);
    console.log("\n✅ Setup complete. Config saved to ~/.vibemote/");
    console.log("\nNext: vibemote add <path-to-project>");
  } finally {
    rl.close();
  }
}
```

**Step 2: Register `setup` command and alias `init` in `src/index.ts`**

Replace the current `init` import and command registration. Add `setup` as the primary command, keep `init` as a hidden alias.

In `src/index.ts`:
- Replace `import { initCommand } from "./cli/init.js"` with `import { setupCommand } from "./cli/setup.js"`
- Replace the `init` command block with:

```typescript
program
  .command("setup")
  .description("First-time setup — check prerequisites, configure user ID and whisper model")
  .action(setupCommand);

// Hidden alias for backward compatibility
program
  .command("init", { hidden: true })
  .action(setupCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

Run: `node dist/index.js setup --help`
Expected: Shows setup command description.

Run: `node dist/index.js --help`
Expected: Shows `setup` but NOT `init` in command list.

**Step 4: Commit**

```bash
git add src/cli/setup.ts src/index.ts
git commit -m "feat: add vibemote setup command with prerequisite checks, alias init"
```

---

### Task 3: Daemon Hot-Reload via SIGHUP

**Files:**
- Modify: `src/daemon.ts`
- Modify: `src/bot/project-bot.ts` (add `getBotToken()` accessor and structured connect log)

**Step 1: Add `getBotToken()` accessor and structured connect log to `ProjectBot`**

In `src/bot/project-bot.ts`, add a public method to expose the bot token (needed by SIGHUP handler to detect token changes):

After the `stop()` method (~line 930), add:

```typescript
getBotToken(): string {
  return this.project.botToken;
}
```

Also modify the `start()` method (line 901) to log a structured event with the bot username when connected. Replace:

```typescript
async start(): Promise<void> {
  this.logger.info({ project: this.project.name }, "Starting bot");
  this.startGitNotifications();
  await this.bot.start({
    onStart: () => {
      this.logger.info({ project: this.project.name }, "Bot is running");
    },
  });
}
```

With:

```typescript
async start(): Promise<void> {
  this.logger.info({ project: this.project.name }, "Starting bot");
  this.startGitNotifications();
  await this.bot.start({
    onStart: async () => {
      try {
        const me = await this.bot.api.getMe();
        this.logger.info(
          { event: "bot_connected", project: this.project.name, username: me.username },
          "Bot connected to Telegram",
        );
      } catch {
        this.logger.info({ event: "bot_connected", project: this.project.name }, "Bot is running");
      }
    },
  });
}
```

**Step 2: Refactor `daemon.ts` — replace `bots` array with `Map` and add SIGHUP handler**

Replace the entire `src/daemon.ts` with:

```typescript
import { loadConfig } from "./config/store.js";
import { writePidFile, removePidFile, isDaemonRunning, readPidFile } from "./config/state.js";
import { ProjectBot } from "./bot/project-bot.js";
import { createLogger } from "./utils/logger.js";
import { freeWhisper } from "./media/transcriber.js";
import { cleanupMedia } from "./media/cleanup.js";
import type { AppConfig, ProjectConfig } from "./config/types.js";
import type pino from "pino";

// Remove CLAUDECODE env var so the Agent SDK can spawn Claude Code subprocesses
delete process.env.CLAUDECODE;

const logger = createLogger("daemon");

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

const runningBots = new Map<string, ProjectBot>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const resetTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();
const shuttingDown = { value: false };

function startBotWithRecovery(
  config: AppConfig,
  project: ProjectConfig,
  botLogger: pino.Logger,
): void {
  let retries = retryCounts.get(project.name) ?? 0;

  const launch = () => {
    if (shuttingDown.value) return;

    // Clear any existing reset timer
    const existingReset = resetTimers.get(project.name);
    if (existingReset) {
      clearTimeout(existingReset);
      resetTimers.delete(project.name);
    }

    const bot = new ProjectBot(config, project, botLogger);
    runningBots.set(project.name, bot);

    bot.start().then(() => {
      botLogger.warn("Bot stopped unexpectedly");
      if (runningBots.get(project.name) === bot) scheduleRetry();
    }).catch((err) => {
      botLogger.error({ err, retries }, "Bot crashed");
      if (runningBots.get(project.name) === bot) scheduleRetry();
    });

    // Reset retries after 60s of stable running
    const timer = setTimeout(() => {
      retries = 0;
      retryCounts.set(project.name, 0);
    }, 60_000);
    resetTimers.set(project.name, timer);
  };

  const scheduleRetry = () => {
    if (shuttingDown.value) return;

    if (retries >= MAX_RETRIES) {
      botLogger.error({ maxRetries: MAX_RETRIES }, "Max retries reached, giving up");
      return;
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retries), MAX_DELAY_MS);
    retries++;
    retryCounts.set(project.name, retries);
    botLogger.info({ retries, delayMs: delay }, "Restarting bot");

    const timer = setTimeout(launch, delay);
    retryTimers.set(project.name, timer);
  };

  launch();
}

async function stopBot(name: string): Promise<void> {
  const bot = runningBots.get(name);
  if (bot) {
    await bot.stop().catch(() => {});
    runningBots.delete(name);
  }
  const retryTimer = retryTimers.get(name);
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimers.delete(name);
  }
  const resetTimer = resetTimers.get(name);
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimers.delete(name);
  }
  retryCounts.delete(name);
}

async function handleReload(): Promise<void> {
  logger.info("SIGHUP received, reloading config");

  // Wait for config file write to complete
  await new Promise((r) => setTimeout(r, 500));

  const newConfig = loadConfig();
  const currentNames = new Set(runningBots.keys());
  const newNames = new Set(newConfig.projects.map((p) => p.name));

  let started = 0;
  let stopped = 0;
  let restarted = 0;

  // Stop removed projects
  for (const name of currentNames) {
    if (!newNames.has(name)) {
      await stopBot(name);
      stopped++;
    }
  }

  // Start new projects or restart projects with changed tokens
  for (const project of newConfig.projects) {
    const existingBot = runningBots.get(project.name);
    if (!existingBot) {
      // New project
      const botLogger = createLogger(project.name);
      startBotWithRecovery(newConfig, project, botLogger);
      started++;
    } else if (existingBot.getBotToken() !== project.botToken) {
      // Token changed — restart
      await stopBot(project.name);
      const botLogger = createLogger(project.name);
      startBotWithRecovery(newConfig, project, botLogger);
      restarted++;
    }
  }

  logger.info({ started, stopped, restarted }, "Hot-reload complete");
}

async function main(): Promise<void> {
  // Prevent duplicate daemons (LaunchAgent + manual start)
  if (isDaemonRunning()) {
    const existingPid = readPidFile();
    logger.info({ existingPid }, "Another daemon is already running, exiting");
    process.exit(0);
  }

  writePidFile();
  logger.info({ pid: process.pid }, "Daemon starting");

  const config = loadConfig();

  for (const project of config.projects) {
    try {
      const botLogger = createLogger(project.name);
      startBotWithRecovery(config, project, botLogger);
    } catch (err) {
      logger.error({ err, project: project.name }, "Failed to create bot");
    }
  }

  logger.info({ count: config.projects.length }, "All bots started");

  // Clean up stale media files
  for (const project of config.projects) {
    const cleaned = cleanupMedia(project.path);
    if (cleaned > 0) logger.info({ project: project.name, cleaned }, "Cleaned up stale media");
  }

  // Schedule hourly cleanup
  setInterval(() => {
    const currentConfig = loadConfig();
    for (const project of currentConfig.projects) {
      cleanupMedia(project.path);
    }
  }, 60 * 60 * 1000);

  // Hot-reload on SIGHUP
  process.on("SIGHUP", () => {
    handleReload().catch((err) => {
      logger.error({ err }, "Hot-reload failed");
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    shuttingDown.value = true;
    logger.info({ signal }, "Shutting down");
    for (const name of runningBots.keys()) {
      await stopBot(name);
    }
    await freeWhisper();
    removePidFile();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Daemon failed to start");
  removePidFile();
  process.exit(1);
});
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

Run: `npm run typecheck`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/daemon.ts src/bot/project-bot.ts
git commit -m "feat: add SIGHUP hot-reload to daemon, refactor bots array to Map"
```

---

### Task 4: Helper — Send SIGHUP to Running Daemon

**Files:**
- Modify: `src/config/state.ts`

**Step 1: Add `signalDaemon()` helper to `src/config/state.ts`**

Add this export at the end of the file (after `isDaemonRunning`):

```typescript
export function signalDaemon(signal: NodeJS.Signals = "SIGHUP"): boolean {
  const pid = readPidFile();
  if (pid === null) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/config/state.ts
git commit -m "feat: add signalDaemon helper for SIGHUP hot-reload"
```

---

### Task 5: Log Polling Helper

**Files:**
- Create: `src/cli/log-poller.ts`

**Step 1: Create log polling utility**

This module polls a pino log file for structured events. Used by `add` and `start` to confirm bot connectivity.

```typescript
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/store.js";

export interface ConnectedBot {
  project: string;
  username?: string;
}

/**
 * Poll log files for "bot_connected" events.
 * Returns the list of projects that connected within the timeout.
 */
export async function pollForBotConnected(
  projectNames: string[],
  timeoutMs: number = 5000,
): Promise<{ connected: ConnectedBot[]; pending: string[] }> {
  const logDir = join(getConfigDir(), "logs");
  const remaining = new Set(projectNames);
  const connected: ConnectedBot[] = [];

  // Record file sizes at start so we only read new lines
  const startOffsets = new Map<string, number>();
  for (const name of projectNames) {
    const logFile = join(logDir, `${name}.log`);
    try {
      startOffsets.set(name, statSync(logFile).size);
    } catch {
      startOffsets.set(name, 0);
    }
  }

  const startTime = Date.now();
  while (remaining.size > 0 && Date.now() - startTime < timeoutMs) {
    for (const name of [...remaining]) {
      const logFile = join(logDir, `${name}.log`);
      if (!existsSync(logFile)) continue;

      try {
        const content = readFileSync(logFile, "utf-8");
        const startOffset = startOffsets.get(name) ?? 0;
        const newContent = content.slice(startOffset);

        // Parse pino JSON lines looking for bot_connected events
        for (const line of newContent.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.event === "bot_connected" && entry.project === name) {
              connected.push({ project: name, username: entry.username });
              remaining.delete(name);
              break;
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      } catch {
        // File read error, skip
      }
    }

    if (remaining.size > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { connected, pending: [...remaining] };
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/cli/log-poller.ts
git commit -m "feat: add log polling utility for bot connectivity confirmation"
```

---

### Task 6: Improve `vibemote add`

**Files:**
- Modify: `src/cli/add.ts`

**Step 1: Rewrite `src/cli/add.ts`**

Replace the entire file:

```typescript
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig, saveConfig, addProject, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { validateBotToken } from "./checks.js";
import { pollForBotConnected } from "./log-poller.js";
import { startCommand } from "./start.js";
import type { ProjectConfig } from "../config/types.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function addCommand(pathArg: string): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote setup` first.");
    process.exit(1);
  }

  const projectPath = resolve(pathArg);
  if (!existsSync(projectPath)) {
    console.error(`Directory not found: ${projectPath}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const defaultName = basename(projectPath);
    const name = (await rl.question(`Project name (${defaultName}): `)).trim() || defaultName;

    // Check for duplicate project name
    const config = loadConfig();
    if (config.projects.some((p) => p.name === name)) {
      console.error(`\nProject "${name}" already exists. Use a different name or run: vibemote remove ${name}`);
      return;
    }

    console.log("\nCreate a Telegram bot:");
    console.log("  Open Telegram → @BotFather → /newbot → copy the token\n");

    // Token validation with retry
    let botToken = "";
    let botUsername = "";
    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question("Bot token: ")).trim();
      if (!token) {
        console.log("  ✗ Token cannot be empty.\n");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        console.error("Max attempts reached.");
        return;
      }

      const result = await validateBotToken(token);
      if (result.valid && result.botInfo) {
        botToken = token;
        botUsername = result.botInfo.username;
        console.log(`  ✓ Token valid — @${botUsername}\n`);
        break;
      }

      console.log(`  ✗ ${result.error ?? "Invalid token"} — check and try again.\n`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        console.error("Max attempts reached.");
        return;
      }
    }

    const project: ProjectConfig = {
      name,
      path: projectPath,
      botToken,
    };

    const updatedConfig = addProject(config, project);
    saveConfig(updatedConfig);

    console.log(`✅ Project "${name}" registered.`);

    // Auto-start or hot-reload daemon
    if (isDaemonRunning()) {
      process.stdout.write("  Reloading daemon... ");
      signalDaemon("SIGHUP");
    } else {
      process.stdout.write("  Starting daemon... ");
      // Import and call startDaemonProcess to spawn the daemon
      await spawnDaemon();
    }

    // Poll for connectivity
    const { connected, pending } = await pollForBotConnected([name], 5000);
    if (connected.length > 0) {
      console.log("✓ connected");
    } else {
      console.log("⚠ not yet connected");
      console.log(`  Check: vibemote logs ${name}`);
    }

    console.log(`\nOpen Telegram and message @${botUsername}`);
  } finally {
    rl.close();
  }
}

async function spawnDaemon(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonPath = join(__dirname, "daemon.js");

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/cli/add.ts
git commit -m "feat: add bot token validation, auto start/hot-reload, and connectivity check to vibemote add"
```

---

### Task 7: Improve `vibemote start` Feedback

**Files:**
- Modify: `src/cli/start.ts`

**Step 1: Rewrite `src/cli/start.ts`**

Replace the entire file:

```typescript
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDaemonRunning, readPidFile } from "../config/state.js";
import { loadConfig, configExists } from "../config/store.js";
import { pollForBotConnected } from "./log-poller.js";

export async function startCommand(): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote setup` first.");
    process.exit(1);
  }

  const config = loadConfig();
  if (config.projects.length === 0) {
    console.error("No projects registered. Run: vibemote add <path>");
    process.exit(1);
  }

  if (isDaemonRunning()) {
    console.log(`Daemon already running (PID: ${readPidFile()}). Use 'vibemote restart' to restart.`);
    return;
  }

  // Resolve daemon.js as sibling of the current script (both in dist/)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonPath = join(__dirname, "daemon.js");

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  console.log(`\nDaemon started (PID: ${child.pid})\n`);

  // Poll for bot connectivity
  const projectNames = config.projects.map((p) => p.name);
  const { connected, pending } = await pollForBotConnected(projectNames, 8000);

  for (const bot of connected) {
    const username = bot.username ? ` — @${bot.username}` : "";
    console.log(`  ✓ ${bot.project}${username} connected`);
  }
  for (const name of pending) {
    console.log(`  ⚠ ${name} — not yet connected (check: vibemote logs ${name})`);
  }

  const total = config.projects.length;
  if (pending.length === 0) {
    console.log(`\n${total} bot(s) ready. Open Telegram to start.`);
  } else {
    console.log(`\n${connected.length}/${total} bot(s) connected.`);
  }
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/cli/start.ts
git commit -m "feat: add per-bot connectivity feedback to vibemote start"
```

---

### Task 8: Improve `vibemote status`

**Files:**
- Modify: `src/index.ts` (the inline `status` action)

**Step 1: Replace the inline `status` command in `src/index.ts`**

Replace the current `status` command block (lines 63-71) with:

```typescript
program
  .command("status")
  .description("Show daemon and bot statuses")
  .action(async () => {
    const { isDaemonRunning, readPidFile } = await import("./config/state.js");
    const { loadConfig, configExists } = await import("./config/store.js");
    const { validateBotToken } = await import("./cli/checks.js");

    if (!configExists()) {
      console.log("Not configured. Run: vibemote setup");
      return;
    }

    if (isDaemonRunning()) {
      console.log(`\nDaemon running (PID: ${readPidFile()})\n`);
    } else {
      console.log("\nDaemon not running. Run: vibemote start\n");
    }

    const config = loadConfig();
    if (config.projects.length === 0) {
      console.log("No projects registered. Run: vibemote add <path>");
      return;
    }

    console.log("Projects:");
    for (const p of config.projects) {
      const model = p.model ?? config.defaults.model;
      const mode = p.permissionMode ?? config.defaults.permissionMode;
      const result = await validateBotToken(p.botToken);
      if (result.valid && result.botInfo) {
        console.log(`  ✓ ${p.name} — @${result.botInfo.username} (${model}, ${mode} mode)`);
      } else {
        console.log(`  ✗ ${p.name} — token invalid or bot unreachable`);
      }
    }
    console.log(`\n${config.projects.length} project(s) registered.`);
  });
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: improve vibemote status with per-bot connectivity checks"
```

---

### Task 9: `vibemote token-update` Command

**Files:**
- Create: `src/cli/token-update.ts`
- Modify: `src/index.ts`

**Step 1: Create `src/cli/token-update.ts`**

```typescript
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, configExists } from "../config/store.js";
import { isDaemonRunning, signalDaemon } from "../config/state.js";
import { validateBotToken } from "./checks.js";
import { pollForBotConnected } from "./log-poller.js";

const MAX_TOKEN_ATTEMPTS = 3;

export async function tokenUpdateCommand(projectName: string): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote setup` first.");
    process.exit(1);
  }

  const config = loadConfig();
  const projectIndex = config.projects.findIndex((p) => p.name === projectName);
  if (projectIndex === -1) {
    console.error(`Project "${projectName}" not found. Run: vibemote list`);
    process.exit(1);
  }

  const project = config.projects[projectIndex];

  // Show current bot info
  const currentResult = await validateBotToken(project.botToken);
  if (currentResult.valid && currentResult.botInfo) {
    console.log(`\nCurrent bot: @${currentResult.botInfo.username}`);
  } else {
    console.log("\nCurrent bot: unknown (token invalid)");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    let newToken = "";
    let newUsername = "";

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = (await rl.question("\nNew bot token: ")).trim();
      if (!token) {
        console.log("  ✗ Token cannot be empty.");
        if (attempt < MAX_TOKEN_ATTEMPTS) continue;
        console.error("Max attempts reached.");
        return;
      }

      const result = await validateBotToken(token);
      if (result.valid && result.botInfo) {
        newToken = token;
        newUsername = result.botInfo.username;
        console.log(`  ✓ Token valid — @${newUsername}`);
        break;
      }

      console.log(`  ✗ ${result.error ?? "Invalid token"} — check and try again.`);
      if (attempt >= MAX_TOKEN_ATTEMPTS) {
        console.error("Max attempts reached.");
        return;
      }
    }

    // Update config
    config.projects[projectIndex] = { ...project, botToken: newToken };
    saveConfig(config);

    console.log("\n✅ Token updated.");

    // Hot-reload if daemon is running
    if (isDaemonRunning()) {
      process.stdout.write("  Reloading... ");
      signalDaemon("SIGHUP");
      const { connected } = await pollForBotConnected([projectName], 5000);
      if (connected.length > 0) {
        console.log("✓ connected");
      } else {
        console.log("⚠ not yet connected");
        console.log(`  Check: vibemote logs ${projectName}`);
      }
    }
  } finally {
    rl.close();
  }
}
```

**Step 2: Register in `src/index.ts`**

Add import at top:
```typescript
import { tokenUpdateCommand } from "./cli/token-update.js";
```

Add command registration (after the `remove` command):
```typescript
program
  .command("token-update")
  .description("Update a project's Telegram bot token")
  .argument("<name>", "Project name")
  .action(tokenUpdateCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/cli/token-update.ts src/index.ts
git commit -m "feat: add vibemote token-update command with validation and hot-reload"
```

---

### Task 10: Improve `vibemote remove` with Hot-Reload

**Files:**
- Modify: `src/cli/remove.ts`

**Step 1: Update `src/cli/remove.ts`**

Replace the entire file:

```typescript
import { loadConfig, saveConfig, removeProject } from "../config/store.js";
import { loadState, saveState, isDaemonRunning, signalDaemon } from "../config/state.js";

export async function removeCommand(name: string): Promise<void> {
  const config = loadConfig();
  const exists = config.projects.some((p) => p.name === name);
  if (!exists) {
    console.error(`Project "${name}" not found. Run: vibemote list`);
    process.exit(1);
  }

  saveConfig(removeProject(config, name));

  // Clean up stale session state
  const state = loadState();
  delete state.sessions[name];
  saveState(state);

  console.log(`Project "${name}" removed.`);

  // Hot-reload daemon if running
  if (isDaemonRunning()) {
    signalDaemon("SIGHUP");
    console.log("Bot stopped.");
  }
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/cli/remove.ts
git commit -m "feat: add hot-reload to vibemote remove, stop bot without daemon restart"
```

---

### Task 11: Update `vibemote doctor` to Use Shared Checks

**Files:**
- Modify: `src/cli/doctor.ts`

**Step 1: Refactor `doctor.ts` to use `checks.ts`**

Replace the entire file:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { configExists, loadConfig, getConfigDir } from "../config/store.js";
import { isDaemonRunning } from "../config/state.js";
import { checkNodeVersion, checkFfmpeg, checkClaudeAuth, validateBotToken } from "./checks.js";

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

  const ffmpegCheck = checkFfmpeg();
  check(ffmpegCheck.label, ffmpegCheck.pass, ffmpegCheck.detail);

  const claudeCheck = checkClaudeAuth();
  check(claudeCheck.label, claudeCheck.pass, claudeCheck.detail);

  // Config exists
  check("Config file exists", configExists(), "~/.vibemote/config.json");

  if (configExists()) {
    const config = loadConfig();
    check("Authorized users configured", config.authorizedUsers.length > 0, `${config.authorizedUsers.length} user(s)`);
    check("Projects registered", config.projects.length > 0, `${config.projects.length} project(s)`);

    // Validate bot tokens
    for (const project of config.projects) {
      const result = await validateBotToken(project.botToken);
      if (result.valid && result.botInfo) {
        check(`Bot token: ${project.name}`, true, `@${result.botInfo.username}`);
      } else {
        check(`Bot token: ${project.name}`, false, result.error ?? "invalid");
      }
    }

    // Whisper model — check local path first, then smart-whisper manager
    const modelPath = join(getConfigDir(), "models", `ggml-${config.whisper.model}.bin`);
    let whisperOk = existsSync(modelPath);
    if (!whisperOk) {
      try {
        const { manager } = await import("smart-whisper");
        whisperOk = manager.check(config.whisper.model);
      } catch {}
    }
    check("Whisper model available", whisperOk, `ggml-${config.whisper.model}.bin${whisperOk && !existsSync(modelPath) ? " (via smart-whisper)" : ""}`);
  }

  // Daemon status
  check("Daemon running", isDaemonRunning());

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed. Fix the issues above.");
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/cli/doctor.ts
git commit -m "refactor: update doctor to use shared checks and validate bot tokens"
```

---

### Task 12: GitHub-Installable Package

**Files:**
- Modify: `package.json`

**Step 1: Update `package.json`**

Add `"files"` field and `"prepare"` script. The `prepare` script runs automatically during `npm install` from git, triggering the build.

Add to `package.json`:
- Add `"files": ["src", "dist", "package.json", "README.md", "tsconfig.json"]` at the top level. Include `src` and `tsconfig.json` because the `prepare` script needs them to build.
- Add `"prepare": "npm run build"` to the `scripts` section.

The resulting `scripts` section should be:
```json
"scripts": {
  "build": "tsup src/index.ts src/daemon.ts src/tray.ts --format esm --clean --external systray2",
  "dev": "tsup src/index.ts src/daemon.ts src/tray.ts --format esm --watch --external systray2",
  "start": "node dist/index.js",
  "typecheck": "tsc --noEmit",
  "prepare": "npm run build",
  "postinstall": "node -e \"const{chmodSync,existsSync}=require('fs');const{join}=require('path');const p=join(__dirname,'node_modules/systray2/traybin/tray_darwin_release');if(existsSync(p))chmodSync(p,0o755);const l=join(__dirname,'node_modules/systray2/traybin/tray_linux_release');if(existsSync(l))chmodSync(l,0o755)\""
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build — confirms `prepare` script target works.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: make package GitHub-installable with prepare script"
```

---

### Task 13: Doc Consolidation

**Files:**
- Modify: `GETTING-STARTED.md`
- Delete: `SETUP.md`
- Modify: `README.md`

**Step 1: Rewrite `GETTING-STARTED.md`**

Replace the entire file with the updated walkthrough reflecting the new `setup`/`add` flow. Key changes:
- Remove manual prerequisite steps (setup handles them)
- Remove hardcoded path `/Users/tlabropoulos/Documents/git/vibemote`
- Replace clone/build/link with `npm install -g github:username/vibemote`
- Update `add` section to show token validation and auto-start
- Remove separate doctor/start steps
- Remove reference to SETUP.md
- Keep the "What you can do now" section, commands reference, troubleshooting

```markdown
# Getting Started with vibemote

A step-by-step walkthrough. Follow each step in order.

---

## What you'll need

- Your Mac (the one with your projects)
- Your phone with Telegram installed
- Node.js 22+, ffmpeg, and Claude Code authenticated
- ~5 minutes

---

## Step 1: Install vibemote

```bash
npm install -g github:yourusername/vibemote
```

Verify it works:

```bash
vibemote --version
```

> **Building from source?** Clone the repo, run `npm install && npm run build && npm link`.

---

## Step 2: Run setup

```bash
vibemote setup
```

This checks prerequisites (Node.js, ffmpeg, Claude Code auth), then asks for:

- **Your Telegram user ID** — open Telegram, search @userinfobot, send /start, copy the number
- **Whisper model** — press Enter for `base` (recommended)

If any prerequisites fail, setup tells you exactly what to install.

---

## Step 3: Add a project

```bash
vibemote add ~/path/to/your/project
```

This asks for:

- **Project name** — press Enter to use the directory name
- **Bot token** — create a bot in Telegram via @BotFather (send /newbot, choose a name and username, copy the token)

The token is validated instantly — if it's wrong, you can re-paste. Once valid, the daemon starts automatically and confirms the bot is connected.

### Adding more projects

Repeat this step for each project. Each project gets its own bot. If the daemon is already running, new bots are added via hot-reload — no restart needed.

---

## Step 4: Open Telegram and start coding

1. Open Telegram on your phone
2. Search for your bot's username
3. Tap **Start**
4. Send a message like: "What does this project do?"
5. You'll see "Working..." then Claude's response

**That's it — you're up and running!**

---

## What you can do

### Text messages
Just type normally. Claude sees your full project and works on it.

### Voice notes
Hold the mic button in Telegram and speak. Your voice is transcribed locally on your Mac and sent to Claude.

### Images
Send a screenshot or photo. Claude can see and analyze it.

### Documents
Send a file. Claude can read and process it.

### Commands

| Command | What it does |
|---|---|
| `/help` | Show all commands |
| `/new` | Start a fresh Claude session |
| `/cancel` | Stop what Claude is doing |
| `/model opus` | Switch to a more powerful model |
| `/status` | See project info, tokens, and context usage |
| `/cost` | See session cost and token breakdown |
| `/undo` | Revert last file changes |
| `/diff` | Show uncommitted changes and recent commits |
| `/sessions` | List past sessions (tap any to resume) |
| `/handoff` | Get a CLI command to continue in Claude Code |

### Live feedback while Claude works

- **Thinking preview** — Claude's extended reasoning shown live with a brain icon
- **Streaming text** — response text appears as it's generated
- **Tool progress** — elapsed time shown during long-running operations
- **Subagent status** — notifications when Claude spawns and completes subagents

After each response, a usage footer shows tokens used and cost:
```
12.5k in · 3.2k out · 8.1k cached · $0.0234
```

### Permission approvals
When Claude wants to edit files, run commands, etc., you get buttons:

- **Allow** — approve once
- **Always** — approve this tool for the rest of the session
- **Deny** — reject

---

## Optional: Auto-start on login

So you don't have to manually run `vibemote start` every time:

```bash
vibemote install
```

To remove auto-start:

```bash
vibemote uninstall
```

---

## CLI reference

```bash
vibemote setup           # First-time setup
vibemote add <path>      # Register a project with a bot
vibemote remove <name>   # Remove a project
vibemote list            # See all your projects
vibemote status          # Daemon and bot status
vibemote start           # Start the daemon
vibemote stop            # Stop the daemon
vibemote restart         # Restart the daemon
vibemote logs [name]     # Tail logs (daemon or specific project)
vibemote doctor          # Health check
vibemote token-update <name>  # Update a project's bot token
vibemote install         # Auto-start on login
vibemote uninstall       # Remove auto-start
```

---

## Troubleshooting

**Bot doesn't respond?**
- Run `vibemote status` — check if daemon is running and bot token is valid
- Run `vibemote logs <project-name>` — look for errors
- Verify your Telegram user ID: `vibemote doctor`

**Voice notes not working?**
- Run `vibemote doctor` — checks ffmpeg and whisper model
- The whisper model downloads on first use — check logs for progress

**Need to change a bot token?**
```bash
vibemote token-update my-project
```

**Want to change other settings?**
Edit `~/.vibemote/config.json` directly, then `vibemote restart`.
```

**Step 2: Delete `SETUP.md`**

```bash
git rm SETUP.md
```

**Step 3: Update `README.md`**

In `README.md`, update the CLI Commands table to include `setup` (replacing `init`) and `token-update`. Also update "Quick Start" to reference the new flow. Remove any references to SETUP.md.

Specific changes to `README.md`:
- In the CLI Commands table: replace `vibemote init` row with `vibemote setup` and add `vibemote token-update <name>` row
- Remove `SETUP.md` reference if any remain
- In Quick Start section, keep the link to `GETTING-STARTED.md`

**Step 4: Build and verify**

Run: `npm run build`
Expected: Clean build (docs don't affect build but verify nothing broke).

**Step 5: Commit**

```bash
git add GETTING-STARTED.md README.md
git rm SETUP.md
git commit -m "docs: consolidate setup docs, update for new setup/add flow, delete SETUP.md"
```

---

### Task 14: Final Integration Verification

**Step 1: Clean build**

```bash
rm -rf dist && npm run build
```

Expected: Clean build with no errors.

**Step 2: Type check**

```bash
npm run typecheck
```

Expected: No type errors.

**Step 3: Verify CLI commands**

```bash
node dist/index.js --help
```

Expected: Shows `setup`, `add`, `start`, `stop`, `list`, `status`, `restart`, `install`, `uninstall`, `remove`, `logs`, `doctor`, `token-update`, `tray`. Does NOT show `init`.

```bash
node dist/index.js setup --help
node dist/index.js token-update --help
```

Expected: Both show their descriptions and arguments.

**Step 4: Verify hidden alias**

```bash
node dist/index.js init --help
```

Expected: Works (same as `setup`), but `init` does not appear in `--help` output.

**Step 5: Manual end-to-end test**

If you have an existing config:
1. Run `vibemote doctor` — should show bot token validation for each project
2. Run `vibemote status` — should show per-bot connectivity with usernames
3. Run `vibemote stop && vibemote start` — should show per-bot connection status
4. Add a new project with `vibemote add /tmp/test-project` (create dir first) — should validate token, start bot, confirm connectivity
5. Run `vibemote remove test-project` — should hot-reload and confirm bot stopped

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration issues from final verification"
```
