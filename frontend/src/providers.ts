import type { ModelConfig } from "./api";

/**
 * 厂商预置库：点选自动填 Base URL / 协议 / provider，附创建 API Key 的控制台链接
 * 与推荐模型示例。只覆盖连接字段，绝不覆盖用户已填的 API Key 或参数。
 */
export type ProviderPreset = {
  id: string;
  label: string;
  /** 品牌主色（画廊徽章底色）。 */
  accent: string;
  protocol: "openai" | "anthropic";
  base_url: string;
  key_url: string;
  recommended_vision_model?: string;
  recommended_planner_model?: string;
  /** 分组标签（"国内" / "国际" / "本地"）。 */
  group: "cn" | "global" | "local";
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    accent: "#4d6bfe",
    protocol: "openai",
    base_url: "https://api.deepseek.com",
    key_url: "https://platform.deepseek.com/api_keys",
    recommended_planner_model: "deepseek-chat",
    group: "cn",
  },
  {
    id: "moonshot",
    label: "Kimi · 月之暗面",
    accent: "#171716",
    protocol: "openai",
    base_url: "https://api.moonshot.cn/v1",
    key_url: "https://platform.moonshot.cn/console/api-keys",
    recommended_planner_model: "kimi-k2-0711-preview",
    group: "cn",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    accent: "#3b82f6",
    protocol: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    key_url: "https://open.bigmodel.cn/usercenter/apikeys",
    recommended_vision_model: "glm-4v-plus",
    recommended_planner_model: "glm-4-plus",
    group: "cn",
  },
  {
    id: "dashscope",
    label: "通义千问 DashScope",
    accent: "#615ced",
    protocol: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    key_url: "https://bailian.console.aliyun.com/?apiKey=1",
    recommended_vision_model: "qwen3-vl-plus",
    recommended_planner_model: "qwen-max",
    group: "cn",
  },
  {
    id: "volcengine",
    label: "火山方舟 Doubao",
    accent: "#e5352b",
    protocol: "openai",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    key_url: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    recommended_vision_model: "doubao-vision-pro-32k",
    recommended_planner_model: "doubao-pro-32k",
    group: "cn",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    accent: "#0ea5e9",
    protocol: "openai",
    base_url: "https://api.siliconflow.cn/v1",
    key_url: "https://cloud.siliconflow.cn/account/ak",
    recommended_vision_model: "Qwen/Qwen2.5-VL-32B-Instruct",
    recommended_planner_model: "deepseek-ai/DeepSeek-V3",
    group: "cn",
  },
  {
    id: "scnet",
    label: "中科云 scnet",
    accent: "#f59e0b",
    protocol: "openai",
    base_url: "https://api.scnet.cn/api/llm/v1",
    key_url: "https://console.scnet.cn",
    group: "cn",
  },
  {
    id: "openai",
    label: "OpenAI",
    accent: "#10a37f",
    protocol: "openai",
    base_url: "https://api.openai.com/v1",
    key_url: "https://platform.openai.com/api-keys",
    recommended_vision_model: "gpt-4o",
    recommended_planner_model: "gpt-4o",
    group: "global",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    accent: "#d97757",
    protocol: "anthropic",
    base_url: "https://api.anthropic.com",
    key_url: "https://console.anthropic.com/settings/keys",
    recommended_planner_model: "claude-sonnet-4-5",
    group: "global",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    accent: "#8b5cf6",
    protocol: "openai",
    base_url: "https://openrouter.ai/api/v1",
    key_url: "https://openrouter.ai/keys",
    group: "global",
  },
  {
    id: "xai",
    label: "xAI Grok",
    accent: "#111827",
    protocol: "openai",
    base_url: "https://api.x.ai/v1",
    key_url: "https://console.x.ai",
    recommended_planner_model: "grok-4",
    group: "global",
  },
  {
    id: "ollama",
    label: "Ollama 本地",
    accent: "#374151",
    protocol: "openai",
    base_url: "http://localhost:11434/v1",
    key_url: "",
    recommended_vision_model: "llava:34b",
    recommended_planner_model: "qwen2.5:32b",
    group: "local",
  },
  {
    id: "custom",
    label: "自定义兼容端点",
    accent: "#0e7490",
    protocol: "openai",
    base_url: "",
    key_url: "",
    group: "local",
  },
];

/** 点选厂商：只填连接字段（protocol/base_url/provider），不动 key 与模型名。 */
export function applyProviderPreset(current: ModelConfig, role: "vision" | "planner", presetId: string): ModelConfig {
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    return current;
  }
  return {
    ...current,
    [`${role}_provider`]: preset.id,
    [`${role}_protocol`]: preset.protocol,
    [`${role}_base_url`]: preset.base_url,
  };
}

/** 从厂商库找 preset（provider 字段回写用）。 */
export function findPreset(provider: string | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((item) => item.id === provider);
}

/** combobox 过滤：大小写不敏感子串匹配，保持服务端顺序。 */
export function filterModelIds(ids: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return ids;
  }
  return ids.filter((id) => id.toLowerCase().includes(needle));
}

/** 模型列表里猜"更像视觉模型"的排前面（仅排序提示，不过滤）。 */
export function sortVisionLikelyFirst(ids: string[]): string[] {
  const score = (id: string) => (/(vl|vision|4v|image|multimodal)/i.test(id) ? 0 : 1);
  return [...ids].sort((a, b) => score(a) - score(b));
}
