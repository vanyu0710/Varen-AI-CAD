import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelConfigPanel from "./ModelConfigPanel";
import { DEFAULT_SETTINGS, useAppStore } from "./store";
import type { ModelConfig } from "./api";

vi.mock("./api", () => ({
  testModelConnection: vi.fn(),
  fetchModelList: vi.fn(),
}));

import * as api from "./api";

function renderPanel(overrides: Partial<ModelConfig> = {}) {
  const onChange = vi.fn();
  const value: ModelConfig = { ...DEFAULT_SETTINGS, ...overrides };
  render(<ModelConfigPanel value={value} onChange={onChange} onApply={vi.fn()} dirty notice="" saving={false} />);
  return { onChange };
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ language: "zh" });
  vi.mocked(api.testModelConnection).mockReset();
  vi.mocked(api.fetchModelList).mockReset();
});

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
