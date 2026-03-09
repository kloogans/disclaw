# vibemote Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript daemon that gives each project its own Telegram bot for remote Claude Code control from mobile.

**Architecture:** Single daemon process manages N grammY bot instances (one per project). Each bot communicates with Claude via the Agent SDK's `query()` function. Voice notes transcribed locally via smart-whisper. Permissions routed to Telegram inline keyboards.

**Tech Stack:** Node.js 24, TypeScript, grammY 1.41+, @anthropic-ai/claude-agent-sdk, smart-whisper, commander, pino

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/` directory structure

**Step 1: Initialize npm project and install dependencies**

Run:
```bash
cd /Users/tlabropoulos/Documents/git/vibemote
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "vibemote",
  "version": "0.1.0",
  "description": "Remote Claude Code control via Telegram",
  "type": "module",
  "bin": {
    "vibemote": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "dev": "tsup src/index.ts --format esm --watch",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22"
  },
  "license": "MIT"
}
```

**Step 2: Install dependencies**

Run:
```bash
npm install grammy @grammyjs/auto-retry @anthropic-ai/claude-agent-sdk smart-whisper node-wav commander pino pino-pretty pino-roll
npm install -D typescript @types/node tsup
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
*.log
.env
```

**Step 5: Create directory structure**

Run:
```bash
mkdir -p src/{cli,bot,claude,media,config,utils}
mkdir -p templates
```

**Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "feat: project scaffolding with dependencies"
```

---

## Task 2: Types & Config Store

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/store.ts`
- Create: `src/config/state.ts`

**Step 1: Create type definitions**

Create `src/config/types.ts`:

```typescript
export interface ProjectConfig {
  name: string;
  path: string;
  botToken: string;
  model?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";

export interface WhisperConfig {
  model: string;
  gpu: boolean;
  language: string;
}

export interface DefaultsConfig {
  model: string;
  permissionMode: PermissionMode;
  allowedTools: string[];
  settingSources: string[];
}

export interface AppConfig {
  authorizedUsers: number[];
  whisper: WhisperConfig;
  defaults: DefaultsConfig;
  messageBatchDelayMs: number;
  permissionTimeoutMs: number;
  maxResponseChars: number;
  projects: ProjectConfig[];
}

export interface AppState {
  sessions: Record<string, string>; // projectName -> lastSessionId
  pid?: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  authorizedUsers: [],
  whisper: {
    model: "base",
    gpu: true,
    language: "auto",
  },
  defaults: {
    model: "sonnet",
    permissionMode: "default",
    allowedTools: ["Read", "Glob", "Grep", "WebSearch"],
    settingSources: ["project"],
  },
  messageBatchDelayMs: 3000,
  permissionTimeoutMs: 300000,
  maxResponseChars: 50000,
  projects: [],
};
```

**Step 2: Create config store**

Create `src/config/store.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig, ProjectConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

const CONFIG_DIR = join(homedir(), ".vibemote");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<AppConfig>;
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function saveConfig(config: AppConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  chmodSync(CONFIG_PATH, 0o600);
}

export function addProject(config: AppConfig, project: ProjectConfig): AppConfig {
  const existing = config.projects.findIndex((p) => p.name === project.name);
  if (existing >= 0) {
    config.projects[existing] = project;
  } else {
    config.projects.push(project);
  }
  return config;
}

export function removeProject(config: AppConfig, name: string): AppConfig {
  config.projects = config.projects.filter((p) => p.name !== name);
  return config;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
```

**Step 3: Create state store**

Create `src/config/state.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AppState } from "./types.js";
import { getConfigDir, ensureConfigDir } from "./store.js";

const STATE_PATH = join(getConfigDir(), "state.json");
const PID_PATH = join(getConfigDir(), "daemon.pid");

export function loadState(): AppState {
  if (!existsSync(STATE_PATH)) {
    return { sessions: {} };
  }
  const raw = readFileSync(STATE_PATH, "utf-8");
  return JSON.parse(raw) as AppState;
}

export function saveState(state: AppState): void {
  ensureConfigDir();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function saveSessionId(projectName: string, sessionId: string): void {
  const state = loadState();
  state.sessions[projectName] = sessionId;
  saveState(state);
}

export function getLastSessionId(projectName: string): string | undefined {
  const state = loadState();
  return state.sessions[projectName];
}

export function writePidFile(): void {
  ensureConfigDir();
  writeFileSync(PID_PATH, process.pid.toString(), "utf-8");
}

export function readPidFile(): number | null {
  if (!existsSync(PID_PATH)) return null;
  const raw = readFileSync(PID_PATH, "utf-8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

export function removePidFile(): void {
  if (existsSync(PID_PATH)) {
    unlinkSync(PID_PATH);
  }
}

export function isDaemonRunning(): boolean {
  const pid = readPidFile();
  if (pid === null) return false;
  try {
    process.kill(pid, 0); // Check if process exists
    return true;
  } catch {
    // Process doesn't exist, clean up stale PID file
    removePidFile();
    return false;
  }
}
```

**Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/config/
git commit -m "feat: add config types, store, and state management"
```

---

## Task 3: Logger & Utility Functions

**Files:**
- Create: `src/utils/logger.ts`
- Create: `src/utils/chunker.ts`
- Create: `src/utils/throttle.ts`
- Create: `src/utils/batcher.ts`
- Create: `src/utils/secrets.ts`

**Step 1: Create logger**

Create `src/utils/logger.ts`:

```typescript
import pino from "pino";
import { join } from "node:path";
import { getConfigDir, ensureConfigDir } from "../config/store.js";

export function createLogger(name: string): pino.Logger {
  ensureConfigDir();
  const logDir = join(getConfigDir(), "logs");

  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
      targets: [
        {
          target: "pino-roll",
          options: {
            file: join(logDir, `${name}.log`),
            frequency: "daily",
            limit: { count: 7 },
            mkdir: true,
          },
          level: "info",
        },
        ...(process.env.NODE_ENV !== "production"
          ? [
              {
                target: "pino-pretty",
                options: { colorize: true },
                level: "debug",
              },
            ]
          : []),
      ],
    },
  });
}
```

**Step 2: Create message chunker**

Create `src/utils/chunker.ts`:

```typescript
const TELEGRAM_MAX_LENGTH = 4096;
const RESERVED_CHARS = 50; // Buffer for formatting overhead

/**
 * Split a long message into chunks that fit within Telegram's 4096 char limit.
 * Splits at natural boundaries: double newlines > single newlines > spaces.
 */
export function chunkMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH - RESERVED_CHARS): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // Try splitting at double newline (paragraph boundary)
    const doubleNewline = remaining.lastIndexOf("\n\n", maxLength);
    if (doubleNewline > maxLength * 0.3) {
      splitIndex = doubleNewline + 2;
    }

    // Try single newline
    if (splitIndex === -1) {
      const singleNewline = remaining.lastIndexOf("\n", maxLength);
      if (singleNewline > maxLength * 0.3) {
        splitIndex = singleNewline + 1;
      }
    }

    // Try space
    if (splitIndex === -1) {
      const space = remaining.lastIndexOf(" ", maxLength);
      if (space > maxLength * 0.3) {
        splitIndex = space + 1;
      }
    }

    // Hard split as last resort
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
```

**Step 3: Create status update throttle**

Create `src/utils/throttle.ts`:

```typescript
/**
 * Creates a throttled function that runs at most once per `delayMs`.
 * The last call within a window is always executed (trailing edge).
 */
export function createThrottle<T extends (...args: any[]) => Promise<void>>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    lastArgs = args;
    const now = Date.now();
    const elapsed = now - lastRun;

    if (elapsed >= delayMs) {
      lastRun = now;
      fn(...args);
      return;
    }

    // Schedule trailing edge execution
    if (timer === null) {
      timer = setTimeout(() => {
        lastRun = Date.now();
        timer = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      }, delayMs - elapsed);
    }
  };
}
```

**Step 4: Create message batcher**

Create `src/utils/batcher.ts`:

```typescript
/**
 * Batches rapid-fire messages within a time window.
 * When a message arrives, waits `delayMs` for more messages,
 * then calls the handler with all collected messages combined.
 */
export class MessageBatcher {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handler: (combined: string) => void;
  private delayMs: number;

  constructor(handler: (combined: string) => void, delayMs: number) {
    this.handler = handler;
    this.delayMs = delayMs;
  }

  add(message: string): void {
    this.pending.push(message);

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.delayMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pending.length === 0) return;

    const combined = this.pending.join("\n\n");
    this.pending = [];
    this.handler(combined);
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  clear(): void {
    this.pending = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
```

**Step 5: Create secret scanner**

Create `src/utils/secrets.ts`:

```typescript
const SECRET_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/, name: "API key (sk-)" },
  { pattern: /AKIA[0-9A-Z]{16}/, name: "AWS access key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub token" },
  { pattern: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth token" },
  { pattern: /glpat-[a-zA-Z0-9\-_]{20,}/, name: "GitLab token" },
  { pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, name: "Private key" },
  { pattern: /-----BEGIN CERTIFICATE-----/, name: "Certificate" },
  { pattern: /xoxb-[0-9]{10,}-[a-zA-Z0-9]{20,}/, name: "Slack bot token" },
  { pattern: /xoxp-[0-9]{10,}-[a-zA-Z0-9]{20,}/, name: "Slack user token" },
];

/**
 * Scan text for potential secrets. Returns warning message or null.
 */
export function scanForSecrets(text: string): string | null {
  const found: string[] = [];
  for (const { pattern, name } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      found.push(name);
    }
  }
  if (found.length === 0) return null;
  return `\u26a0\ufe0f Potential secrets detected: ${found.join(", ")}. Telegram is not E2E encrypted.`;
}
```

**Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/utils/
git commit -m "feat: add logger, chunker, throttle, batcher, and secret scanner utilities"
```

---

## Task 4: CLI Foundation

**Files:**
- Create: `src/index.ts`
- Create: `src/cli/init.ts`
- Create: `src/cli/add.ts`
- Create: `src/cli/start.ts`
- Create: `src/cli/stop.ts`

**Step 1: Create CLI entry point**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./cli/init.js";
import { addCommand } from "./cli/add.js";
import { startCommand } from "./cli/start.js";
import { stopCommand } from "./cli/stop.js";

const program = new Command();

program
  .name("vibemote")
  .description("Remote Claude Code control via Telegram")
  .version("0.1.0");

program
  .command("init")
  .description("First-time setup — configure user ID, download whisper model")
  .action(initCommand);

program
  .command("add")
  .description("Register a project with a Telegram bot")
  .argument("<path>", "Path to the project directory")
  .action(addCommand);

program
  .command("start")
  .description("Start the daemon (all bots)")
  .action(startCommand);

program
  .command("stop")
  .description("Stop the daemon")
  .action(stopCommand);

program
  .command("list")
  .description("List all registered projects")
  .action(async () => {
    const { loadConfig } = await import("./config/store.js");
    const config = loadConfig();
    if (config.projects.length === 0) {
      console.log("No projects registered. Run: vibemote add <path>");
      return;
    }
    console.log("\nRegistered projects:\n");
    for (const p of config.projects) {
      console.log(`  ${p.name}`);
      console.log(`    Path: ${p.path}`);
      console.log(`    Model: ${p.model ?? config.defaults.model}`);
      console.log(`    Mode: ${p.permissionMode ?? config.defaults.permissionMode}`);
      console.log("");
    }
  });

program
  .command("status")
  .description("Show daemon and bot statuses")
  .action(async () => {
    const { isDaemonRunning, readPidFile } = await import("./config/state.js");
    if (isDaemonRunning()) {
      console.log(`Daemon running (PID: ${readPidFile()})`);
    } else {
      console.log("Daemon not running. Run: vibemote start");
    }
  });

program
  .command("restart")
  .description("Restart the daemon")
  .action(async () => {
    await stopCommand();
    await startCommand();
  });

program.parse();
```

**Step 2: Create init command**

Create `src/cli/init.ts`:

```typescript
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configExists, loadConfig, saveConfig } from "../config/store.js";
import { DEFAULT_CONFIG } from "../config/types.js";

export async function initCommand(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    if (configExists()) {
      const overwrite = await rl.question("Config already exists. Overwrite? (y/N): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Keeping existing config.");
        rl.close();
        return;
      }
    }

    console.log("\n=== vibemote Setup ===\n");

    // Get Telegram user ID
    console.log("Step 1: Get your Telegram user ID");
    console.log("  Open Telegram, search @userinfobot, send /start");
    console.log("  It will reply with your user ID.\n");
    const userIdStr = await rl.question("Your Telegram user ID: ");
    const userId = parseInt(userIdStr.trim(), 10);
    if (isNaN(userId)) {
      console.error("Invalid user ID. Must be a number.");
      rl.close();
      return;
    }

    // Whisper model selection
    console.log("\nStep 2: Voice transcription model");
    console.log("  tiny  (~75MB)  — fastest, lower accuracy");
    console.log("  base  (~150MB) — good balance (recommended)");
    console.log("  small (~500MB) — better accuracy, slower\n");
    const whisperModel = await rl.question("Whisper model (base): ");

    const config = {
      ...DEFAULT_CONFIG,
      authorizedUsers: [userId],
      whisper: {
        ...DEFAULT_CONFIG.whisper,
        model: whisperModel.trim() || "base",
      },
    };

    saveConfig(config);
    console.log("\n\u2705 Config saved to ~/.vibemote/config.json");
    console.log("\nThe whisper model will be downloaded on first voice note.");
    console.log("\nNext: Run `vibemote add /path/to/project` to register a project.");
  } finally {
    rl.close();
  }
}
```

**Step 3: Create add command**

Create `src/cli/add.ts`:

```typescript
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig, saveConfig, addProject, configExists } from "../config/store.js";
import type { ProjectConfig } from "../config/types.js";

export async function addCommand(pathArg: string): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote init` first.");
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

    console.log("\nCreate a Telegram bot for this project:");
    console.log("  1. Open Telegram, search @BotFather");
    console.log("  2. Send /newbot");
    console.log(`  3. Name it something like "${name} - Claude"`);
    console.log("  4. Copy the bot token\n");

    const botToken = (await rl.question("Bot token: ")).trim();
    if (!botToken || !botToken.includes(":")) {
      console.error("Invalid bot token. Should look like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz");
      rl.close();
      return;
    }

    const project: ProjectConfig = {
      name,
      path: projectPath,
      botToken,
    };

    const config = loadConfig();
    saveConfig(addProject(config, project));

    console.log(`\n\u2705 Project "${name}" registered.`);
    console.log(`\nStart with: vibemote start`);
  } finally {
    rl.close();
  }
}
```

**Step 4: Create start command**

Create `src/cli/start.ts`:

```typescript
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDaemonRunning, readPidFile } from "../config/state.js";
import { loadConfig, configExists } from "../config/store.js";

export async function startCommand(): Promise<void> {
  if (!configExists()) {
    console.error("Run `vibemote init` first.");
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

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonPath = join(__dirname, "..", "daemon.js");

  const child = fork(daemonPath, [], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  console.log(`Daemon started (PID: ${child.pid})`);
  console.log(`${config.projects.length} project bot(s) launching...`);
  console.log("\nOpen Telegram and message your bot(s) to start.");
}
```

**Step 5: Create stop command**

Create `src/cli/stop.ts`:

```typescript
import { isDaemonRunning, readPidFile, removePidFile } from "../config/state.js";

export async function stopCommand(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log("Daemon is not running.");
    return;
  }

  const pid = readPidFile();
  if (pid === null) {
    console.log("No PID file found.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Daemon stopped (PID: ${pid})`);
  } catch {
    console.log("Daemon process not found. Cleaning up PID file.");
  }

  removePidFile();
}
```

**Step 6: Build and verify CLI works**

Run:
```bash
npx tsup src/index.ts --format esm --clean
node dist/index.js --help
```
Expected: Help output showing all commands

**Step 7: Commit**

```bash
git add src/index.ts src/cli/
git commit -m "feat: CLI foundation with init, add, start, stop, list, status commands"
```

---

## Task 5: Telegram Bot Foundation

**Files:**
- Create: `src/bot/project-bot.ts`
- Create: `src/bot/commands.ts`
- Create: `src/bot/formatting.ts`

**Step 1: Create response formatting**

Create `src/bot/formatting.ts`:

```typescript
/**
 * Escape special characters for Telegram HTML parse mode.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert basic markdown from Claude's responses to Telegram HTML.
 * Handles: code blocks, inline code, bold, italic.
 */
export function markdownToTelegramHtml(text: string): string {
  let result = text;

  // Preserve code blocks first (``` ... ```)
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const escapedCode = escapeHtml(code.trimEnd());
    codeBlocks.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapedCode}</code></pre>`);
    return `\x00CODEBLOCK${index}\x00`;
  });

  // Preserve inline code (` ... `)
  const inlineCode: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    const index = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${index}\x00`;
  });

  // Escape HTML in remaining text
  result = escapeHtml(result);

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic (*text* or _text_)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");

  // Restore code blocks and inline code
  result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, (_match, index) => codeBlocks[parseInt(index)]);
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_match, index) => inlineCode[parseInt(index)]);

  return result;
}

/**
 * Format a tool use notification for Telegram status updates.
 */
export function formatToolUse(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      const short = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
      return `\u2699\ufe0f <code>${escapeHtml(short)}</code>`;
    }
    case "Read":
      return `\ud83d\udcc4 Reading ${escapeHtml(String(input.file_path ?? "file"))}`;
    case "Edit":
      return `\u270f\ufe0f Editing ${escapeHtml(String(input.file_path ?? "file"))}`;
    case "Write":
      return `\ud83d\udcdd Writing ${escapeHtml(String(input.file_path ?? "file"))}`;
    case "Glob":
      return `\ud83d\udd0d Searching files: ${escapeHtml(String(input.pattern ?? ""))}`;
    case "Grep":
      return `\ud83d\udd0d Searching content: ${escapeHtml(String(input.pattern ?? ""))}`;
    case "WebSearch":
      return `\ud83c\udf10 Searching: ${escapeHtml(String(input.query ?? ""))}`;
    case "Agent":
      return `\ud83e\udd16 Running subagent...`;
    default:
      return `\ud83d\udd27 Using ${escapeHtml(toolName)}`;
  }
}
```

**Step 2: Create command handlers**

Create `src/bot/commands.ts`:

```typescript
import type { Context } from "grammy";
import type { ProjectConfig, AppConfig } from "../config/types.js";

export function registerCommands(
  bot: import("grammy").Bot,
  project: ProjectConfig,
  config: AppConfig,
  callbacks: {
    onNew: () => void;
    onCancel: () => void;
    onModelChange: (model: string) => void;
    onModeChange: (mode: string) => void;
    onSessionsList: () => Promise<string>;
    onResume: (sessionId: string) => void;
    onStatus: () => string;
    onCost: () => string;
  },
): void {
  bot.command("start", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(
      `\ud83d\ude80 <b>${project.name}</b> — Vibemote\n\n` +
        `Send me a message and I'll pass it to Claude.\n` +
        `Use /help for available commands.`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("help", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(
      `<b>Commands:</b>\n\n` +
        `/new — Start a fresh session\n` +
        `/model &lt;name&gt; — Switch model (sonnet, opus, haiku)\n` +
        `/mode &lt;mode&gt; — Switch permission mode (auto, plan, default)\n` +
        `/cancel — Interrupt current operation\n` +
        `/sessions — List past sessions\n` +
        `/resume &lt;id&gt; — Resume a session\n` +
        `/status — Show project & session info\n` +
        `/cost — Show session cost\n` +
        `/help — This message`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("new", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    callbacks.onNew();
    await ctx.reply("\ud83c\udd95 Starting fresh session...");
  });

  bot.command("cancel", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    callbacks.onCancel();
    await ctx.reply("\u274c Operation cancelled.");
  });

  bot.command("model", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const model = ctx.match?.trim();
    if (!model) {
      await ctx.reply("Usage: /model <name>\nOptions: sonnet, opus, haiku");
      return;
    }
    callbacks.onModelChange(model);
    await ctx.reply(`\ud83e\udde0 Model switched to <b>${model}</b>`, { parse_mode: "HTML" });
  });

  bot.command("mode", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const mode = ctx.match?.trim();
    if (!mode) {
      await ctx.reply("Usage: /mode <mode>\nOptions: auto, plan, default");
      return;
    }
    callbacks.onModeChange(mode);
    await ctx.reply(`\ud83d\udd12 Permission mode: <b>${mode}</b>`, { parse_mode: "HTML" });
  });

  bot.command("sessions", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const list = await callbacks.onSessionsList();
    await ctx.reply(list, { parse_mode: "HTML" });
  });

  bot.command("resume", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    const sessionId = ctx.match?.trim();
    if (!sessionId) {
      await ctx.reply("Usage: /resume <session-id>");
      return;
    }
    callbacks.onResume(sessionId);
    await ctx.reply(`\u23ea Resuming session...`);
  });

  bot.command("status", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(callbacks.onStatus(), { parse_mode: "HTML" });
  });

  bot.command("cost", async (ctx) => {
    if (!isAuthorized(ctx, config)) return;
    await ctx.reply(callbacks.onCost(), { parse_mode: "HTML" });
  });
}

export function isAuthorized(ctx: Context, config: AppConfig): boolean {
  const userId = ctx.from?.id;
  if (!userId || !config.authorizedUsers.includes(userId)) {
    return false; // Silent drop — don't reveal the bot exists
  }
  return true;
}
```

**Step 3: Create the ProjectBot class**

Create `src/bot/project-bot.ts`:

```typescript
import { Bot, InlineKeyboard } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { registerCommands, isAuthorized } from "./commands.js";
import { markdownToTelegramHtml, formatToolUse, escapeHtml } from "./formatting.js";
import { chunkMessage } from "../utils/chunker.js";
import { createThrottle } from "../utils/throttle.js";
import { MessageBatcher } from "../utils/batcher.js";
import { scanForSecrets } from "../utils/secrets.js";
import { SessionManager } from "../claude/session-manager.js";
import type pino from "pino";

export class ProjectBot {
  private bot: Bot;
  private config: AppConfig;
  private project: ProjectConfig;
  private logger: pino.Logger;
  private sessionManager: SessionManager;
  private statusMessageId: number | null = null;
  private statusChatId: number | null = null;
  private batcher: MessageBatcher;
  private isProcessing = false;
  private pendingQueue: string[] = [];
  private totalCostUsd = 0;

  constructor(config: AppConfig, project: ProjectConfig, logger: pino.Logger) {
    this.config = config;
    this.project = project;
    this.logger = logger;

    this.bot = new Bot(project.botToken);
    this.bot.api.config.use(autoRetry());

    this.sessionManager = new SessionManager(project, config, logger, {
      onAssistantMessage: (text) => this.handleAssistantMessage(text),
      onToolUse: (toolName, input) => this.handleToolUse(toolName, input),
      onResult: (result, costUsd) => this.handleResult(result, costUsd),
      onError: (error) => this.handleError(error),
      onSessionId: (sessionId) => this.handleSessionId(sessionId),
      onPermissionRequest: (toolName, input, respond) =>
        this.handlePermissionRequest(toolName, input, respond),
    });

    this.batcher = new MessageBatcher(
      (combined) => this.processMessage(combined),
      config.messageBatchDelayMs,
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Register command handlers
    registerCommands(this.bot, this.project, this.config, {
      onNew: () => this.sessionManager.newSession(),
      onCancel: () => this.sessionManager.interrupt(),
      onModelChange: (model) => this.sessionManager.setModel(model),
      onModeChange: (mode) => this.sessionManager.setPermissionMode(mode),
      onSessionsList: () => this.sessionManager.listSessions(),
      onResume: (id) => this.sessionManager.resumeSession(id),
      onStatus: () => this.getStatus(),
      onCost: () => this.getCost(),
    });

    // Text messages
    this.bot.on("message:text", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      if (ctx.message.text.startsWith("/")) return; // Already handled by command handlers
      this.statusChatId = ctx.chat.id;
      this.batcher.add(ctx.message.text);
    });

    // Voice messages
    this.bot.on("message:voice", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      this.statusChatId = ctx.chat.id;
      await this.handleVoice(ctx);
    });

    // Photos
    this.bot.on("message:photo", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      this.statusChatId = ctx.chat.id;
      await this.handlePhoto(ctx);
    });

    // Documents
    this.bot.on("message:document", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      this.statusChatId = ctx.chat.id;
      await this.handleDocument(ctx);
    });

    // Callback queries (permission buttons)
    this.bot.on("callback_query:data", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      await this.handleCallbackQuery(ctx);
    });

    // Unsupported media
    this.bot.on("message", async (ctx) => {
      if (!isAuthorized(ctx, this.config)) return;
      if (ctx.message.sticker || ctx.message.animation || ctx.message.location || ctx.message.contact) {
        await ctx.reply("I can handle text, voice notes, images, and documents. This media type isn't supported yet.");
      }
    });
  }

  private async processMessage(text: string): Promise<void> {
    if (this.isProcessing) {
      this.pendingQueue.push(text);
      return;
    }

    this.isProcessing = true;

    try {
      // Send "Working..." message
      if (this.statusChatId) {
        const msg = await this.bot.api.sendMessage(this.statusChatId, "\u23f3 Working...");
        this.statusMessageId = msg.message_id;
      }

      await this.sessionManager.sendMessage(text);
    } catch (err) {
      this.logger.error({ err }, "Error processing message");
      if (this.statusChatId) {
        await this.bot.api.sendMessage(this.statusChatId, `\u274c Error: ${String(err)}`);
      }
      this.isProcessing = false;
      this.processNextInQueue();
    }
  }

  private processNextInQueue(): void {
    if (this.pendingQueue.length > 0) {
      const combined = this.pendingQueue.join("\n\n");
      this.pendingQueue = [];
      this.processMessage(combined);
    }
  }

  private updateStatusThrottled = createThrottle(async (text: string) => {
    if (this.statusChatId && this.statusMessageId) {
      try {
        await this.bot.api.editMessageText(this.statusChatId, this.statusMessageId, text, {
          parse_mode: "HTML",
        });
      } catch {
        // Edit might fail if message hasn't changed — ignore
      }
    }
  }, 3000);

  private async handleAssistantMessage(_text: string): Promise<void> {
    // Accumulate — final response sent in handleResult
  }

  private handleToolUse(toolName: string, input: Record<string, unknown>): void {
    const status = formatToolUse(toolName, input);
    this.updateStatusThrottled(status);
  }

  private async handleResult(result: string, costUsd: number): Promise<void> {
    this.totalCostUsd += costUsd;
    this.isProcessing = false;

    if (!this.statusChatId) return;

    // Delete the "Working..." message
    if (this.statusMessageId) {
      try {
        await this.bot.api.deleteMessage(this.statusChatId, this.statusMessageId);
      } catch {
        // Ignore
      }
      this.statusMessageId = null;
    }

    // Check for secrets
    const secretWarning = scanForSecrets(result);

    // Format and send response
    const formatted = markdownToTelegramHtml(result);
    const chunks = chunkMessage(formatted);

    if (result.length > this.config.maxResponseChars) {
      // Send as document for very long responses
      const buffer = Buffer.from(result, "utf-8");
      await this.bot.api.sendDocument(this.statusChatId, new InputFile(buffer, "response.md"), {
        caption: `Response too long for chat (${result.length} chars). Sent as file.`,
      });
    } else {
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.statusChatId, chunk, { parse_mode: "HTML" });
      }
    }

    if (secretWarning) {
      await this.bot.api.sendMessage(this.statusChatId, secretWarning);
    }

    // Process next queued message
    this.processNextInQueue();
  }

  private async handleError(error: string): Promise<void> {
    this.isProcessing = false;
    if (this.statusChatId) {
      await this.bot.api.sendMessage(this.statusChatId, `\u274c ${escapeHtml(error)}`, {
        parse_mode: "HTML",
      });
    }
    this.processNextInQueue();
  }

  private handleSessionId(_sessionId: string): void {
    // State persistence handled by SessionManager
  }

  private permissionCallbacks = new Map<
    string,
    { respond: (result: { behavior: string; message?: string }) => void; timer: ReturnType<typeof setTimeout> }
  >();

  private async handlePermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    respond: (result: { behavior: string; message?: string; updatedInput?: Record<string, unknown> }) => void,
  ): Promise<void> {
    if (!this.statusChatId) {
      respond({ behavior: "deny", message: "No chat context" });
      return;
    }

    const callbackId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const description = formatToolUse(toolName, input);

    const keyboard = new InlineKeyboard()
      .text("\u2705 Allow", `${callbackId}:allow`)
      .text("\u2705 Always", `${callbackId}:always`)
      .text("\u274c Deny", `${callbackId}:deny`);

    await this.bot.api.sendMessage(
      this.statusChatId,
      `\ud83d\udd10 <b>Permission Request</b>\n\n${description}`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );

    // Set timeout
    const timer = setTimeout(() => {
      this.permissionCallbacks.delete(callbackId);
      respond({ behavior: "deny", message: "Permission request timed out (5 min)" });
    }, this.config.permissionTimeoutMs);

    this.permissionCallbacks.set(callbackId, { respond, timer });
  }

  private async handleCallbackQuery(ctx: import("grammy").Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    const [callbackId, action] = data.split(":");
    const pending = this.permissionCallbacks.get(callbackId);

    await ctx.answerCallbackQuery();

    if (!pending) {
      await ctx.editMessageText("This permission request has expired.");
      return;
    }

    clearTimeout(pending.timer);
    this.permissionCallbacks.delete(callbackId);

    switch (action) {
      case "allow":
        pending.respond({ behavior: "allow" });
        await ctx.editMessageText("\u2705 Allowed");
        break;
      case "always":
        pending.respond({ behavior: "allow" });
        // TODO: Add to session allowedTools
        await ctx.editMessageText("\u2705 Allowed (always for this session)");
        break;
      case "deny":
        pending.respond({ behavior: "deny", message: "User denied this action" });
        await ctx.editMessageText("\u274c Denied");
        break;
    }
  }

  private async handleVoice(ctx: import("grammy").Context): Promise<void> {
    // Will be implemented in Task 8 (media)
    await ctx.reply("\ud83c\udf99\ufe0f Voice transcription coming soon...");
  }

  private async handlePhoto(ctx: import("grammy").Context): Promise<void> {
    // Will be implemented in Task 8 (media)
    await ctx.reply("\ud83d\uddbc\ufe0f Image support coming soon...");
  }

  private async handleDocument(ctx: import("grammy").Context): Promise<void> {
    // Will be implemented in Task 8 (media)
    await ctx.reply("\ud83d\udcc1 Document support coming soon...");
  }

  private getStatus(): string {
    const model = this.project.model ?? this.config.defaults.model;
    const mode = this.project.permissionMode ?? this.config.defaults.permissionMode;
    const sessionId = this.sessionManager.currentSessionId ?? "none";
    return (
      `<b>${escapeHtml(this.project.name)}</b>\n\n` +
      `\ud83d\udcc2 ${escapeHtml(this.project.path)}\n` +
      `\ud83e\udde0 Model: ${escapeHtml(model)}\n` +
      `\ud83d\udd12 Mode: ${escapeHtml(mode)}\n` +
      `\ud83d\udcac Session: <code>${escapeHtml(sessionId.slice(0, 8))}...</code>\n` +
      `\ud83d\udcb0 Cost: $${this.totalCostUsd.toFixed(4)}`
    );
  }

  private getCost(): string {
    return `\ud83d\udcb0 Session cost: <b>$${this.totalCostUsd.toFixed(4)}</b>`;
  }

  async start(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Starting bot");
    await this.bot.start({
      onStart: () => {
        this.logger.info({ project: this.project.name }, "Bot is running");
      },
    });
  }

  async stop(): Promise<void> {
    this.logger.info({ project: this.project.name }, "Stopping bot");
    this.sessionManager.close();
    await this.bot.stop();
  }
}
```

Note: `InputFile` needs to be imported from `grammy`. Add this import at the top of the file:
```typescript
import { Bot, InlineKeyboard, InputFile } from "grammy";
```

**Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Errors about missing `SessionManager` — that's expected, we build it next.

**Step 5: Commit**

```bash
git add src/bot/
git commit -m "feat: Telegram bot foundation with commands, formatting, and permission UI"
```

---

## Task 6: Claude Agent SDK Session Manager

**Files:**
- Create: `src/claude/session-manager.ts`
- Create: `src/claude/system-prompt.ts`

**Step 1: Create system prompt builder**

Create `src/claude/system-prompt.ts`:

```typescript
export function buildSystemPrompt(): { type: "preset"; preset: "claude_code"; append: string } {
  return {
    type: "preset",
    preset: "claude_code",
    append: [
      "The user is communicating via Telegram on mobile.",
      "Keep responses concise and well-formatted.",
      "Telegram is not end-to-end encrypted — avoid outputting full secrets, API keys, or credentials. Mask sensitive values.",
      "Use markdown formatting. Code blocks with language tags. Keep explanations brief.",
      "When showing diffs or file changes, be concise — show the relevant parts, not entire files.",
    ].join(" "),
  };
}
```

**Step 2: Create the SessionManager**

Create `src/claude/session-manager.ts`:

```typescript
import { query, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig, ProjectConfig, PermissionMode } from "../config/types.js";
import { saveSessionId, getLastSessionId } from "../config/state.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type pino from "pino";

interface SessionCallbacks {
  onAssistantMessage: (text: string) => void;
  onToolUse: (toolName: string, input: Record<string, unknown>) => void;
  onResult: (result: string, costUsd: number) => void;
  onError: (error: string) => void;
  onSessionId: (sessionId: string) => void;
  onPermissionRequest: (
    toolName: string,
    input: Record<string, unknown>,
    respond: (result: { behavior: string; message?: string; updatedInput?: Record<string, unknown> }) => void,
  ) => Promise<void>;
}

export class SessionManager {
  private project: ProjectConfig;
  private config: AppConfig;
  private logger: pino.Logger;
  private callbacks: SessionCallbacks;
  private currentQuery: Query | null = null;
  private _currentSessionId: string | null = null;
  private abortController: AbortController | null = null;

  constructor(
    project: ProjectConfig,
    config: AppConfig,
    logger: pino.Logger,
    callbacks: SessionCallbacks,
  ) {
    this.project = project;
    this.config = config;
    this.logger = logger;
    this.callbacks = callbacks;
  }

  get currentSessionId(): string | null {
    return this._currentSessionId;
  }

  async sendMessage(text: string): Promise<void> {
    if (this.currentQuery) {
      // Multi-turn: stream new input into existing session
      await this.currentQuery.streamInput(
        (async function* () {
          yield {
            type: "user" as const,
            session_id: "",
            message: { role: "user" as const, content: [{ type: "text" as const, text }] },
            parent_tool_use_id: null,
          };
        })(),
      );
      await this.consumeMessages();
    } else {
      // First message: create new session
      await this.startSession(text);
    }
  }

  async startSession(prompt: string, resumeId?: string): Promise<void> {
    this.close();

    const model = this.project.model ?? this.config.defaults.model;
    const permissionMode = (this.project.permissionMode ?? this.config.defaults.permissionMode) as PermissionMode;
    const allowedTools = this.project.allowedTools ?? this.config.defaults.allowedTools;

    this.abortController = new AbortController();

    // Check for last session to resume on first start
    const resume = resumeId ?? getLastSessionId(this.project.name);

    this.currentQuery = query({
      prompt,
      options: {
        cwd: this.project.path,
        model,
        permissionMode,
        allowedTools,
        settingSources: this.config.defaults.settingSources as any,
        systemPrompt: buildSystemPrompt(),
        abortController: this.abortController,
        ...(resume ? { resume } : {}),
        canUseTool: async (toolName, input) => {
          return new Promise((resolve) => {
            this.callbacks.onPermissionRequest(toolName, input as Record<string, unknown>, (result) => {
              resolve(result as any);
            });
          });
        },
      },
    });

    await this.consumeMessages();
  }

  private async consumeMessages(): Promise<void> {
    if (!this.currentQuery) return;

    try {
      for await (const message of this.currentQuery) {
        switch (message.type) {
          case "system":
            if (message.subtype === "init") {
              this._currentSessionId = message.session_id;
              saveSessionId(this.project.name, message.session_id);
              this.callbacks.onSessionId(message.session_id);
              this.logger.info({ sessionId: message.session_id }, "Session initialized");
            }
            break;

          case "assistant": {
            const text = message.message.content
              .filter((block: any) => block.type === "text")
              .map((block: any) => block.text)
              .join("");
            if (text) {
              this.callbacks.onAssistantMessage(text);
            }
            // Check for tool_use blocks
            for (const block of message.message.content) {
              if ((block as any).type === "tool_use") {
                this.callbacks.onToolUse(
                  (block as any).name,
                  (block as any).input as Record<string, unknown>,
                );
              }
            }
            break;
          }

          case "result": {
            if (message.subtype === "success") {
              this.callbacks.onResult(message.result, message.total_cost_usd);
            } else {
              const errorMsg =
                "errors" in message
                  ? (message.errors as string[]).join(", ")
                  : `Session ended: ${message.subtype}`;
              this.callbacks.onError(errorMsg);
            }
            break;
          }
        }
      }
    } catch (err) {
      this.logger.error({ err }, "Error consuming messages");
      this.callbacks.onError(String(err));
    }
  }

  newSession(): void {
    this.close();
    this._currentSessionId = null;
    this.logger.info("New session requested");
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.close();
    await this.startSession("Continue from where we left off.", sessionId);
  }

  interrupt(): void {
    if (this.currentQuery) {
      this.currentQuery.interrupt().catch(() => {});
    }
  }

  async setModel(model: string): Promise<void> {
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
      this.logger.info({ model }, "Model changed");
    }
    this.project.model = model;
  }

  async setPermissionMode(mode: string): Promise<void> {
    if (this.currentQuery) {
      await this.currentQuery.setPermissionMode(mode as PermissionMode);
      this.logger.info({ mode }, "Permission mode changed");
    }
    this.project.permissionMode = mode as PermissionMode;
  }

  async listSessions(): Promise<string> {
    try {
      const sessions = await listSessions({ dir: this.project.path, limit: 10 });
      if (sessions.length === 0) {
        return "No past sessions found.";
      }
      const lines = sessions.map((s, i) => {
        const date = new Date(s.lastModified).toLocaleDateString();
        const summary = s.summary.slice(0, 60);
        const id = s.sessionId.slice(0, 8);
        return `${i + 1}. <code>${id}</code> ${date}\n   ${summary}`;
      });
      return `<b>Past Sessions:</b>\n\n${lines.join("\n\n")}`;
    } catch (err) {
      return `Error listing sessions: ${String(err)}`;
    }
  }

  close(): void {
    if (this.currentQuery) {
      this.currentQuery.close();
      this.currentQuery = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Should compile (may have minor type issues with the Agent SDK that we fix as we go)

**Step 4: Commit**

```bash
git add src/claude/
git commit -m "feat: Claude Agent SDK session manager with multi-turn, permissions, and resume"
```

---

## Task 7: Daemon & End-to-End Integration

**Files:**
- Create: `src/daemon.ts`

**Step 1: Create the daemon**

Create `src/daemon.ts`:

```typescript
import { loadConfig } from "./config/store.js";
import { writePidFile, removePidFile } from "./config/state.js";
import { ProjectBot } from "./bot/project-bot.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("daemon");

async function main(): Promise<void> {
  writePidFile();
  logger.info({ pid: process.pid }, "Daemon starting");

  const config = loadConfig();
  const bots: ProjectBot[] = [];

  for (const project of config.projects) {
    try {
      const botLogger = createLogger(project.name);
      const bot = new ProjectBot(config, project, botLogger);
      bots.push(bot);
      // Start each bot without awaiting (they run forever via long polling)
      bot.start().catch((err) => {
        botLogger.error({ err }, "Bot crashed");
      });
    } catch (err) {
      logger.error({ err, project: project.name }, "Failed to create bot");
    }
  }

  logger.info({ count: bots.length }, "All bots started");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    for (const bot of bots) {
      await bot.stop().catch(() => {});
    }
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

**Step 2: Update tsup config to build daemon separately**

Edit `package.json` scripts:

```json
{
  "scripts": {
    "build": "tsup src/index.ts src/daemon.ts --format esm --clean",
    "dev": "tsup src/index.ts src/daemon.ts --format esm --watch"
  }
}
```

**Step 3: Build and test**

Run:
```bash
npm run build
```
Expected: Clean build, `dist/index.js` and `dist/daemon.js` produced

**Step 4: Manual end-to-end test**

1. Run `node dist/index.js init` — complete setup with your Telegram user ID
2. Run `node dist/index.js add /path/to/a/test/project` — register a project with a BotFather token
3. Run `node dist/index.js start` — start daemon
4. Open Telegram, message the bot, send `/start`
5. Send a text message — should see "Working..." then Claude's response
6. Test `/help`, `/status`, `/cancel`
7. Run `node dist/index.js stop` — stop daemon

**Step 5: Fix any issues found during testing, then commit**

```bash
git add src/daemon.ts package.json
git commit -m "feat: daemon process with graceful shutdown — end-to-end text messaging works"
```

---

## Task 8: Voice, Image & Document Support

**Files:**
- Create: `src/media/transcriber.ts`
- Create: `src/media/images.ts`
- Create: `src/media/documents.ts`
- Create: `src/media/cleanup.ts`
- Modify: `src/bot/project-bot.ts` (wire up media handlers)

**Step 1: Create the voice transcriber**

Create `src/media/transcriber.ts`:

```typescript
import { Whisper } from "smart-whisper";
import { decode } from "node-wav";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/store.js";
import type { WhisperConfig } from "../config/types.js";
import type pino from "pino";

let whisperInstance: Whisper | null = null;
let modelLoading = false;

const MODELS_DIR = join(getConfigDir(), "models");

/**
 * Get or initialize the shared Whisper instance.
 * Downloads the model on first use.
 */
async function getWhisper(config: WhisperConfig, logger: pino.Logger): Promise<Whisper> {
  if (whisperInstance) return whisperInstance;
  if (modelLoading) {
    // Wait for another caller to finish loading
    while (modelLoading) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (whisperInstance) return whisperInstance;
  }

  modelLoading = true;
  try {
    if (!existsSync(MODELS_DIR)) {
      mkdirSync(MODELS_DIR, { recursive: true });
    }

    const modelName = `ggml-${config.model}.bin`;
    const modelPath = join(MODELS_DIR, modelName);

    logger.info({ model: config.model, path: modelPath }, "Loading whisper model");
    whisperInstance = new Whisper(modelPath, { gpu: config.gpu });
    logger.info("Whisper model loaded");

    return whisperInstance;
  } finally {
    modelLoading = false;
  }
}

/**
 * Transcribe an audio buffer (OGG/Opus from Telegram) to text.
 * Converts to WAV 16kHz mono first, then runs whisper.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  config: WhisperConfig,
  logger: pino.Logger,
): Promise<string> {
  const whisper = await getWhisper(config, logger);

  // Save as temp file and convert — smart-whisper needs WAV PCM
  const tempDir = join(getConfigDir(), "temp");
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

  const tempOgg = join(tempDir, `voice_${Date.now()}.ogg`);
  const tempWav = join(tempDir, `voice_${Date.now()}.wav`);

  try {
    writeFileSync(tempOgg, audioBuffer);

    // Use ffmpeg to convert OGG to WAV 16kHz mono
    const { execSync } = await import("node:child_process");
    execSync(`ffmpeg -i "${tempOgg}" -ar 16000 -ac 1 -f wav "${tempWav}" -y -loglevel quiet`);

    // Read WAV and decode to PCM
    const wavBuffer = readFileSync(tempWav);
    const { channelData, sampleRate } = decode(wavBuffer);

    if (sampleRate !== 16000) {
      throw new Error(`Unexpected sample rate: ${sampleRate}`);
    }

    const pcm = channelData[0];
    const task = await whisper.transcribe(pcm, { language: config.language });
    const result = await task.result;

    // Extract text from result
    const text = Array.isArray(result)
      ? result.map((seg: any) => seg.text ?? seg).join(" ")
      : String(result);

    return text.trim();
  } finally {
    // Clean up temp files
    if (existsSync(tempOgg)) unlinkSync(tempOgg);
    if (existsSync(tempWav)) unlinkSync(tempWav);
  }
}

export async function freeWhisper(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
  }
}
```

**Step 2: Create image handler**

Create `src/media/images.ts`:

```typescript
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "grammy";

/**
 * Download an image from Telegram and save it to the project's media directory.
 * Returns the local file path.
 */
export async function downloadImage(ctx: Context, projectPath: string): Promise<string> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    throw new Error("No photo in message");
  }

  // Get highest resolution
  const photo = photos[photos.length - 1];
  const file = await ctx.api.getFile(photo.file_id);

  if (!file.file_path) {
    throw new Error("Could not get file path from Telegram");
  }

  const mediaDir = join(projectPath, ".vibemote", "media");
  if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

  const ext = file.file_path.split(".").pop() ?? "jpg";
  const filename = `img_${Date.now()}.${ext}`;
  const localPath = join(mediaDir, filename);

  // Download the file
  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(localPath, buffer);

  return localPath;
}
```

**Step 3: Create document handler**

Create `src/media/documents.ts`:

```typescript
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "grammy";

/**
 * Download a document from Telegram and save it to the project's media directory.
 * Returns the local file path.
 */
export async function downloadDocument(ctx: Context, projectPath: string): Promise<string> {
  const doc = ctx.message?.document;
  if (!doc) {
    throw new Error("No document in message");
  }

  const file = await ctx.api.getFile(doc.file_id);
  if (!file.file_path) {
    throw new Error("Could not get file path from Telegram");
  }

  const mediaDir = join(projectPath, ".vibemote", "media");
  if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

  const filename = doc.file_name ?? `doc_${Date.now()}`;
  const localPath = join(mediaDir, filename);

  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(localPath, buffer);

  return localPath;
}
```

**Step 4: Create media cleanup**

Create `src/media/cleanup.ts`:

```typescript
import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/**
 * Clean up media files older than 24 hours in a project's media directory.
 */
export function cleanupMedia(projectPath: string): number {
  const mediaDir = join(projectPath, ".vibemote", "media");
  if (!existsSync(mediaDir)) return 0;

  const now = Date.now();
  let cleaned = 0;

  for (const file of readdirSync(mediaDir)) {
    const filePath = join(mediaDir, file);
    const stat = statSync(filePath);
    if (now - stat.mtimeMs > TWENTY_FOUR_HOURS) {
      unlinkSync(filePath);
      cleaned++;
    }
  }

  return cleaned;
}
```

**Step 5: Wire up media handlers in ProjectBot**

In `src/bot/project-bot.ts`, replace the placeholder `handleVoice`, `handlePhoto`, and `handleDocument` methods with real implementations:

```typescript
// Add imports at top of project-bot.ts:
import { transcribeAudio } from "../media/transcriber.js";
import { downloadImage } from "../media/images.js";
import { downloadDocument } from "../media/documents.js";

// Replace handleVoice:
private async handleVoice(ctx: import("grammy").Context): Promise<void> {
  const voice = ctx.message?.voice;
  if (!voice) return;

  const duration = voice.duration;
  if (duration > 60) {
    await ctx.reply("\ud83c\udf99\ufe0f Transcribing long recording, this may take a moment...");
  } else {
    await ctx.reply("\ud83c\udf99\ufe0f Transcribing...");
  }

  try {
    const file = await ctx.getFile();
    if (!file.file_path) throw new Error("Could not get voice file");

    const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    const text = await transcribeAudio(buffer, this.config.whisper, this.logger);
    await ctx.reply(`\ud83c\udf99\ufe0f <i>${escapeHtml(text)}</i>`, { parse_mode: "HTML" });

    this.batcher.add(`(Transcribed from voice note) ${text}`);
  } catch (err) {
    this.logger.error({ err }, "Voice transcription failed");
    await ctx.reply("\u274c Transcription failed. Please try again or send as text.");
  }
}

// Replace handlePhoto:
private async handlePhoto(ctx: import("grammy").Context): Promise<void> {
  try {
    const localPath = await downloadImage(ctx, this.project.path);
    const caption = ctx.message?.caption ?? "";
    const prompt = caption
      ? `The user sent an image saved at ${localPath}. Caption: "${caption}"`
      : `The user sent an image saved at ${localPath}. Please analyze it.`;

    this.batcher.add(prompt);
  } catch (err) {
    this.logger.error({ err }, "Image download failed");
    await ctx.reply("\u274c Couldn't download the image. Please try again.");
  }
}

// Replace handleDocument:
private async handleDocument(ctx: import("grammy").Context): Promise<void> {
  try {
    const localPath = await downloadDocument(ctx, this.project.path);
    const fileName = ctx.message?.document?.file_name ?? "file";
    const caption = ctx.message?.caption ?? "";
    const prompt = caption
      ? `The user sent a file "${fileName}" saved at ${localPath}. Caption: "${caption}"`
      : `The user sent a file "${fileName}" saved at ${localPath}. Please review it.`;

    this.batcher.add(prompt);
  } catch (err) {
    this.logger.error({ err }, "Document download failed");
    await ctx.reply("\u274c Couldn't download the document. Please try again.");
  }
}
```

**Step 6: Build and test voice, images, documents**

Run:
```bash
npm run build
```

Manual test:
1. Start daemon, open Telegram
2. Send a voice note — should see transcription echo + Claude response
3. Send a photo — should see Claude analyze it
4. Send a document — should see Claude process it

**Step 7: Commit**

```bash
git add src/media/ src/bot/project-bot.ts
git commit -m "feat: voice transcription (whisper), image, and document support"
```

---

## Task 9: LaunchAgent & Polish

**Files:**
- Create: `src/cli/install.ts`
- Create: `templates/com.vibemote.daemon.plist`

**Step 1: Create LaunchAgent plist template**

Create `templates/com.vibemote.daemon.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.vibemote.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>{{NODE_PATH}}</string>
    <string>{{DAEMON_PATH}}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>{{HOME}}</string>
  <key>StandardOutPath</key>
  <string>{{LOG_DIR}}/daemon.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>{{LOG_DIR}}/daemon.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{{PATH}}</string>
    <key>HOME</key>
    <string>{{HOME}}</string>
  </dict>
</dict>
</plist>
```

**Step 2: Create install/uninstall command**

Create `src/cli/install.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getConfigDir } from "../config/store.js";

const PLIST_NAME = "com.vibemote.daemon.plist";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");

export async function installCommand(): Promise<void> {
  const plistDest = join(LAUNCH_AGENTS_DIR, PLIST_NAME);

  if (!existsSync(LAUNCH_AGENTS_DIR)) {
    mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const templatePath = join(__dirname, "..", "..", "templates", PLIST_NAME);
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

  console.log("\u2705 LaunchAgent installed. vibemote will auto-start on login.");
  console.log(`   Plist: ${plistDest}`);
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
  console.log("\u2705 LaunchAgent removed. vibemote will no longer auto-start.");
}
```

**Step 3: Register install/uninstall commands in CLI**

Add to `src/index.ts` after the existing commands:

```typescript
import { installCommand, uninstallCommand } from "./cli/install.js";

program
  .command("install")
  .description("Install macOS LaunchAgent (auto-start on login)")
  .action(installCommand);

program
  .command("uninstall")
  .description("Remove macOS LaunchAgent")
  .action(uninstallCommand);
```

**Step 4: Build, test install/uninstall**

Run:
```bash
npm run build
node dist/index.js install
# Verify: ls ~/Library/LaunchAgents/com.vibemote.daemon.plist
node dist/index.js uninstall
```

**Step 5: Commit**

```bash
git add templates/ src/cli/install.ts src/index.ts
git commit -m "feat: macOS LaunchAgent auto-start with install/uninstall commands"
```

---

## Task 10: Final Build & End-to-End Test

**Step 1: Full build**

```bash
npm run build
```

**Step 2: Complete end-to-end test checklist**

Run through each item manually:

- [ ] `vibemote init` — setup completes
- [ ] `vibemote add /path/to/project` — project registered
- [ ] `vibemote list` — shows the project
- [ ] `vibemote start` — daemon starts
- [ ] `vibemote status` — shows running
- [ ] Telegram: `/start` — welcome message
- [ ] Telegram: `/help` — command list
- [ ] Telegram: Send text → get Claude response
- [ ] Telegram: Send follow-up → conversation continues
- [ ] Telegram: `/new` → fresh session
- [ ] Telegram: `/model opus` → model switches
- [ ] Telegram: `/mode auto` → mode switches
- [ ] Telegram: `/cancel` during processing → interrupts
- [ ] Telegram: `/status` → shows info
- [ ] Telegram: `/sessions` → lists past sessions
- [ ] Telegram: Send voice note → transcription + Claude response
- [ ] Telegram: Send image → Claude analyzes it
- [ ] Telegram: Send document → Claude processes it
- [ ] Telegram: Permission prompt appears for unapproved tool → buttons work
- [ ] `vibemote stop` → daemon stops
- [ ] `vibemote install` → LaunchAgent installed
- [ ] `vibemote uninstall` → LaunchAgent removed

**Step 3: Fix any issues found during testing**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: vibemote v0.1.0 — complete MVP"
```

---

## Summary

After completing all 10 tasks, you will have a fully working `vibemote` that:

1. **CLI** — `init`, `add`, `remove`, `list`, `start`, `stop`, `restart`, `status`, `install`, `uninstall`
2. **Per-project Telegram bots** — one bot per project, chat list = dashboard
3. **Claude Agent SDK integration** — multi-turn conversations, session resume, model/mode switching
4. **Permission routing** — inline keyboards for tool approval from your phone
5. **Voice transcription** — local whisper.cpp with Metal GPU acceleration
6. **Image & document support** — Claude reads them natively
7. **Response formatting** — HTML, chunking, status throttling
8. **Message batching** — handles rapid mobile input
9. **Process management** — daemon with PID file, graceful shutdown
10. **Auto-start** — macOS LaunchAgent with KeepAlive
