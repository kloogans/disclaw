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
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = process doesn't exist, safe to clean up PID file
    // EPERM = process exists but belongs to another user, don't remove
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      removePidFile();
    }
    return false;
  }
}

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
