import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS, applyProviderPreset, filterModelIds, findPreset, sortVisionLikelyFirst } from "./providers";
import { DEFAULT_SETTINGS } from "./store";

describe("provider presets", () => {
  it("are structurally valid", () => {
    const ids = new Set<string>();
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(preset.label.length).toBeGreaterThan(1);
      expect(["openai", "anthropic"]).toContain(preset.protocol);
      expect(["cn", "global", "local"]).toContain(preset.group);
      if (preset.base_url) expect(preset.base_url).toMatch(/^https?:\/\//);
      if (preset.key_url) expect(preset.key_url).toMatch(/^https:\/\//);
    }
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(ids.has("custom")).toBe(true);
  });

  it("includes the defaults our docs rely on", () => {
    expect(findPreset("deepseek")?.protocol).toBe("openai");
    expect(findPreset("anthropic")?.protocol).toBe("anthropic");
    expect(findPreset("dashscope")?.base_url).toContain("compatible-mode/v1");
  });
});

describe("applyProviderPreset", () => {
  it("fills connection fields for both roles without touching keys or other role", () => {
    const draft = applyProviderPreset(
      { ...DEFAULT_SETTINGS, vision_api_key: "sk-keep", planner_base_url: "https://keep.me" },
      "vision",
      "deepseek",
    );
    expect(draft.vision_base_url).toBe("https://api.deepseek.com");
    expect(draft.vision_protocol).toBe("openai");
    expect(draft.vision_provider).toBe("deepseek");
    expect(draft.vision_api_key).toBe("sk-keep");
    expect(draft.planner_base_url).toBe("https://keep.me");
  });

  it("ignores unknown preset ids", () => {
    const draft = applyProviderPreset(DEFAULT_SETTINGS, "planner", "does-not-exist");
    expect(draft).toEqual(DEFAULT_SETTINGS);
  });
});

describe("model list helpers", () => {
  it("filters case-insensitively and keeps server order", () => {
    expect(filterModelIds(["Qwen-VL", "gpt-4o", "qwen-max"], "qwen")).toEqual(["Qwen-VL", "qwen-max"]);
    expect(filterModelIds(["a", "b"], "  ")).toEqual(["a", "b"]);
    expect(filterModelIds(["a"], "zzz")).toEqual([]);
  });

  it("sorts vision-like ids first without filtering", () => {
    const sorted = sortVisionLikelyFirst(["deepseek-v3", "qwen2.5-vl-72b", "glm-4v-plus"]);
    expect(sorted.slice(0, 2).sort()).toEqual(["glm-4v-plus", "qwen2.5-vl-72b"]);
    expect(sorted[2]).toBe("deepseek-v3");
    expect(sorted.length).toBe(3);
  });
});
