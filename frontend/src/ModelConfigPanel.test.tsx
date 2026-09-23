import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelConfigPanel from "./ModelConfigPanel";
import { DEFAULT_SETTINGS, useAppStore } from "./store";
import type { ModelConfig, ModelEnvRole, ModelEnvState } from "./api";

vi.mock("./api", () => ({
  testModelConnection: vi.fn(),
  fetchModelList: vi.fn(),
  fetchEffectiveModels: vi.fn(),
  fetchModelEnvState: vi.fn(),
  saveModelEnv: vi.fn(),
  applyModelEnvProfile: vi.fn(),
}));

import * as api from "./api";

function renderPanel(overrides: Partial<ModelConfig> = {}, options: { projectId?: string; dirty?: boolean } = {}) {
  const onChange = vi.fn();
  const value: ModelConfig = { ...DEFAULT_SETTINGS, ...overrides };
  render(
    <ModelConfigPanel
      value={value}
      onChange={onChange}
      onApply={vi.fn()}
      dirty={options.dirty ?? true}
      notice=""
      saving={false}
      projectId={options.projectId}
    />,
  );
  return { onChange };
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ language: "zh" });
  vi.mocked(api.testModelConnection).mockReset();
  vi.mocked(api.fetchModelList).mockReset();
  vi.mocked(api.fetchEffectiveModels).mockReset();
  vi.mocked(api.fetchModelEnvState).mockReset();
  vi.mocked(api.saveModelEnv).mockReset();
  vi.mocked(api.applyModelEnvProfile).mockReset();
});

const inactiveEnvRole = (role: ModelEnvRole["role"]): ModelEnvRole => ({
  role,
  provider: "",
  configured: false,
  source: "none",
  model: "",
  base_url: "",
  protocol: "openai",
  api_key_tail: "",
  missing: [],
});

const emptyEnvState: ModelEnvState = {
  active: {
    vision: inactiveEnvRole("vision"),
    planner: inactiveEnvRole("planner"),
  },
  profiles: { vision: [], planner: [] },
};

describe("ModelConfigPanel (v0.20 console)", () => {
  it("clicking a provider chip fills connection fields and keeps the typed key", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({ vision_api_key: "sk-local-typed" });
    const chips = screen.getAllByRole("option", { name: /DeepSeek/ });
    await user.click(chips[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const patched = onChange.mock.calls[0][0] as ModelConfig;
    expect(patched.vision_provider).toBe("deepseek");
    expect(patched.vision_base_url).toBe("https://api.deepseek.com");
    expect(patched.vision_api_key).toBe("sk-local-typed");
  });

  it("shows the saved-key badge with the tail from the server mask", () => {
    renderPanel({ vision_api_key: "***configured:abcd***" });
    expect(screen.getByText("已保存 ····abcd")).toBeInTheDocument();
  });

  it("fetches model ids into the combobox list with vision-like first", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchModelList).mockResolvedValue({
      ok: true,
      role: "vision",
      provider: "custom",
      protocol: "openai",
      model_ids: ["deepseek-v3", "qwen-vl-max", "qwen3-vl-plus"],
      message: "",
    });
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "拉取模型" })[0]);
    const picked = await screen.findByRole("option", { name: "qwen-vl-max" });
    expect(picked).toBeInTheDocument();
    expect(api.fetchModelList).toHaveBeenCalledWith("vision", expect.anything(), "zh");
  });

  it("reports a failed fetch inline", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchModelList).mockResolvedValue({
      ok: false,
      role: "vision",
      provider: "custom",
      protocol: "openai",
      model_ids: [],
      message: "认证失败（HTTP 401）。",
    });
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "拉取模型" })[0]);
    expect(await screen.findByText(/认证失败/)).toBeInTheDocument();
  });

  it("shows latency and echo after a successful test", async () => {
    const user = userEvent.setup();
    vi.mocked(api.testModelConnection).mockResolvedValue({
      ok: true,
      role: "planner",
      provider: "custom",
      protocol: "openai",
      model: "m",
      message: "",
      diagnostics: { used_env_fallback: false, elapsed_ms: 1234, endpoint: "https://x.test/v1/chat/completions", echo: "OK" },
    });
    renderPanel();
    await user.click(screen.getAllByRole("button", { name: "测试连接" })[1]);
    expect(await screen.findByText("1234 ms")).toBeInTheDocument();
    expect(screen.getByText("“OK”")).toBeInTheDocument();
  });

  it("shows the effective model and source when project fields are empty", async () => {
    vi.mocked(api.fetchEffectiveModels).mockResolvedValue({
      vision: {
        role: "vision",
        configured: true,
        source: "env",
        model: "Qwen3.8-Flash",
        base_url: "https://env.test/v1",
        protocol: "openai",
        api_key_tail: "3456",
        sources: { api_key: "env", base_url: "env", model: "env", protocol: "env" },
        missing: [],
      },
      planner: {
        role: "planner",
        configured: false,
        source: "none",
        model: "",
        base_url: "",
        protocol: "openai",
        api_key_tail: "",
        sources: { api_key: "none", base_url: "none", model: "none", protocol: "none" },
        missing: ["api_key", "base_url", "model"],
      },
    });
    renderPanel({}, { projectId: "project-1" });
    expect(await screen.findByText("Qwen3.8-Flash")).toBeInTheDocument();
    expect(screen.getByText("来自 .env")).toBeInTheDocument();
    expect(screen.getAllByText("草稿未应用")).toHaveLength(2);
    expect(api.fetchEffectiveModels).toHaveBeenCalledWith("project-1", expect.anything());
  });

  it("fills effective values without copying an API key", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchEffectiveModels).mockResolvedValue({
      vision: {
        role: "vision", configured: true, source: "env", model: "vision-env", base_url: "https://vision.test/v1",
        protocol: "openai", api_key_tail: "3456",
        sources: { api_key: "env", base_url: "env", model: "env", protocol: "env" }, missing: [],
      },
      planner: {
        role: "planner", configured: true, source: "env", model: "planner-env", base_url: "https://planner.test/v1",
        protocol: "anthropic", api_key_tail: "6789",
        sources: { api_key: "env", base_url: "env", model: "env", protocol: "env" }, missing: [],
      },
    });
    const { onChange } = renderPanel({}, { projectId: "project-1" });
    await screen.findByText("planner-env");
    const fillButtons = screen.getAllByRole("button", { name: "填入当前生效值" });
    await user.click(fillButtons[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const patched = onChange.mock.calls[0][0] as ModelConfig;
    expect(patched.planner_model).toBe("planner-env");
    expect(patched.planner_base_url).toBe("https://planner.test/v1");
    expect(patched.planner_protocol).toBe("anthropic");
    expect(patched.planner_api_key).toBe("");
  });

  it("saves the current draft to .env and a provider profile", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchModelEnvState).mockResolvedValue(emptyEnvState);
    const savedProfile: ModelEnvRole = {
      role: "vision",
      provider: "deepseek",
      configured: true,
      source: "profile",
      model: "deepseek-chat",
      base_url: "https://api.deepseek.com",
      protocol: "openai",
      api_key_tail: "7890",
      missing: [],
    };
    const savedState: ModelEnvState = {
      active: {
        vision: { ...savedProfile, source: "env" },
        planner: inactiveEnvRole("planner"),
      },
      profiles: { vision: [savedProfile], planner: [] },
    };
    vi.mocked(api.saveModelEnv).mockResolvedValue(savedState);
    renderPanel({ vision_provider: "deepseek", vision_model: "deepseek-chat" }, { projectId: "project-1" });
    await user.click(screen.getAllByRole("button", { name: "保存到 .env" })[0]);
    expect(await screen.findByText("已保存 .env 与供应商档案")).toBeInTheDocument();
    expect(api.saveModelEnv).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ vision_provider: "deepseek" }),
      "vision",
    );
  });

  it("clicking a provider with a saved profile switches instead of only filling presets", async () => {
    const user = userEvent.setup();
    const savedProfile: ModelEnvRole = {
      role: "vision",
      provider: "deepseek",
      configured: true,
      source: "profile",
      model: "deepseek-chat",
      base_url: "https://api.deepseek.com",
      protocol: "openai",
      api_key_tail: "7890",
      missing: [],
    };
    const state: ModelEnvState = {
      active: {
        vision: inactiveEnvRole("vision"),
        planner: inactiveEnvRole("planner"),
      },
      profiles: { vision: [savedProfile], planner: [] },
    };
    vi.mocked(api.fetchModelEnvState).mockResolvedValue(state);
    vi.mocked(api.applyModelEnvProfile).mockResolvedValue({} as never);
    const { onChange } = renderPanel(
      { vision_provider: "openai", vision_model: "gpt-4o", vision_base_url: "https://api.openai.com/v1", vision_api_key: "sk-old" },
      { projectId: "project-1" },
    );
    const chips = await screen.findAllByRole("option", { name: /DeepSeek/ });
    await user.click(chips[0]);
    await waitFor(() => expect(api.applyModelEnvProfile).toHaveBeenCalledWith("project-1", "vision", "deepseek"));
    expect(onChange).toHaveBeenCalled();
    const patched = onChange.mock.calls[0][0] as ModelConfig;
    expect(patched.vision_provider).toBe("deepseek");
    expect(patched.vision_api_key).toBe("");
    expect(patched.vision_model).toBe("");
    expect(patched.vision_base_url).toBe("");
  });

  it("exports JSON with locally typed keys redacted", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel({ planner_api_key: "sk-top-secret" });
    await user.click(screen.getByRole("button", { name: "导出 JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).not.toContain("sk-top-secret");
    expect(payload).toContain('"planner_api_key": "***"');
  });
});
