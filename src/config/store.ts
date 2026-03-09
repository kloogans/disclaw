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
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    whisper: { ...DEFAULT_CONFIG.whisper, ...parsed.whisper },
    defaults: { ...DEFAULT_CONFIG.defaults, ...parsed.defaults },
  };
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
