import { describe, expect, it } from "vitest";
import { artifactUrl, assemblyArtifactUrl, resolveApiRoot, resolveWsRoot, withStrippedKeyMasks } from "./api";
import { DEFAULT_SETTINGS } from "./store";
import type { ModelConfig } from "./api";

describe("assembly artifact urls (v0.14 F2a)", () => {
  it("builds library file urls with encoding", () => {
    expect(assemblyArtifactUrl("p1", "v003_小齿轮.step"))
      .toBe(`/api/projects/p1/assembly/artifacts/${encodeURIComponent("v003_小齿轮.step")}`);
  });

  it("returns empty for missing project or filename", () => {
    expect(assemblyArtifactUrl(undefined, "a.step")).toBe("");
    expect(assemblyArtifactUrl("p1", null)).toBe("");
  });

  it("artifactUrl still supports dynamic part kinds", () => {
    expect(artifactUrl("r1", "part_01_gear.step")).toBe("/api/artifacts/r1/part_01_gear.step");
    expect(artifactUrl(undefined, "step")).toBe("");
  });
});

describe("same-origin address resolution", () => {
  it("defaults API root to the current origin", () => {
    expect(resolveApiRoot({})).toBe("");
    expect(resolveApiRoot({ VITE_API_ROOT: "http://127.0.0.1:9000" })).toBe("http://127.0.0.1:9000");
  });

  it("prefers an explicit WebSocket override", () => {
    expect(resolveWsRoot({ VITE_WS_ROOT: "wss://example.test" })).toBe("wss://example.test");
  });

  it("derives WebSocket root from an API root", () => {
    expect(resolveWsRoot({}, "http://127.0.0.1:8001")).toBe("ws://127.0.0.1:8001");
  });

  it("derives same-origin WebSocket root from window.location", () => {
    const root = resolveWsRoot({}, "");
    expect(root.startsWith("ws://")).toBe(true);
    expect(root.endsWith("/")).toBe(false);
  });
});

describe("model key mask stripping (v0.20 console)", () => {
  it("treats server masks as unset for probe requests", () => {
    const config: ModelConfig = {
      ...DEFAULT_SETTINGS,
      vision_api_key: "***configured:abcd***",
      planner_api_key: "sk-real-key",
    };
    const stripped = withStrippedKeyMasks(config);
    expect(stripped.vision_api_key).toBe("");
    expect(stripped.planner_api_key).toBe("sk-real-key");
    expect(config.vision_api_key).toBe("***configured:abcd***");
  });
});
