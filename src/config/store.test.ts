import { describe, it, expect } from "vitest";
import { addProject, removeProject } from "./store.js";
import type { AppConfig, ProjectConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

function makeConfig(projects: ProjectConfig[] = []): AppConfig {
  return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults }, projects: [...projects] };
}

const projectA: ProjectConfig = { name: "alpha", path: "/a", channelId: "111" };
const projectB: ProjectConfig = { name: "beta", path: "/b", channelId: "222" };

describe("addProject", () => {
  it("adds to empty list", () => {
    const config = makeConfig();
    const result = addProject(config, projectA);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toBe(projectA);
  });

  it("replaces existing project by name", () => {
    const config = makeConfig([projectA, projectB]);
    const updated: ProjectConfig = { name: "alpha", path: "/a-new", channelId: "333" };
    const result = addProject(config, updated);
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]).toBe(updated);
    expect(result.projects[0].path).toBe("/a-new");
  });
});

describe("removeProject", () => {
  it("removes by name", () => {
    const config = makeConfig([projectA, projectB]);
    const result = removeProject(config, "alpha");
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("beta");
  });

  it("is a no-op for missing name", () => {
    const config = makeConfig([projectA]);
    const result = removeProject(config, "nonexistent");
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toBe(projectA);
  });
});
