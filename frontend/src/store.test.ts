import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DESCRIPTION_EN,
  DEFAULT_DESCRIPTION_ZH,
  MAX_DRAWER_WIDTH,
  MIN_DRAWER_WIDTH,
  PROJECT_SCOPED_RESET,
  clampDrawerWidth,
  markStartupSeen,
  readLanguage,
  readStartupMode,
  shouldShowStartup,
  useAppStore,
  writeLanguage,
  writeStartupMode,
} from "./store";

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    language: "zh",
    description: DEFAULT_DESCRIPTION_ZH,
    events: [],
    ui: {
      leftTab: "feature",
      rightTab: "assistant",
      leftDrawerOpen: false,
      rightDrawerOpen: false,
      leftWidth: 380,
      rightWidth: 360,
      focusMode: false,
      settingsOpen: false,
    },
  });
});

describe("language helpers", () => {
  it("defaults to Chinese and persists the selected language", () => {
    expect(readLanguage()).toBe("zh");
    writeLanguage("en");
    expect(readLanguage()).toBe("en");
    expect(localStorage.getItem("mechcad_language")).toBe("en");
  });

  it("rejects unknown stored languages", () => {
    localStorage.setItem("mechcad_language", "fr");
    expect(readLanguage()).toBe("zh");
  });
});

describe("startup mode helpers", () => {
  it("defaults to showing every launch", () => {
    expect(readStartupMode()).toBe("always");
    expect(shouldShowStartup()).toBe(true);
  });

  it("only shows once in first mode until marked seen", () => {
    writeStartupMode("first");
    expect(shouldShowStartup()).toBe(true);
    markStartupSeen();
    expect(shouldShowStartup()).toBe(false);
  });

  it("can be disabled entirely", () => {
    writeStartupMode("off");
    expect(shouldShowStartup()).toBe(false);
  });
});

describe("app store", () => {
  it("switches language, persists it, and updates the default description", () => {
    useAppStore.getState().setLanguage("en");
    expect(useAppStore.getState().language).toBe("en");
    expect(useAppStore.getState().description).toBe(DEFAULT_DESCRIPTION_EN);
    expect(localStorage.getItem("mechcad_language")).toBe("en");
    useAppStore.getState().setLanguage("zh");
    expect(useAppStore.getState().description).toBe(DEFAULT_DESCRIPTION_ZH);
  });

  it("keeps a user-entered description when switching language", () => {
    useAppStore.getState().setDescription("自定义零件");
    useAppStore.getState().setLanguage("en");
    expect(useAppStore.getState().description).toBe("自定义零件");
  });

  it("persists drawer and focus ui state", () => {
    useAppStore.getState().setUi({ leftWidth: 520, leftDrawerOpen: true, rightDrawerOpen: true, focusMode: true, rightTab: "review" });
    const ui = useAppStore.getState().ui;
    expect(ui.leftWidth).toBe(520);
    expect(ui.leftDrawerOpen).toBe(true);
    expect(ui.rightDrawerOpen).toBe(true);
    expect(ui.focusMode).toBe(true);
    expect(ui.rightTab).toBe("review");
    const stored = JSON.parse(localStorage.getItem("mechcad_ui_persist") || "{}");
    expect(stored.leftWidth).toBe(520);
    expect(stored.focusMode).toBe(true);
  });

  it("clamps drawer widths to the supported range", () => {
    expect(clampDrawerWidth(10)).toBe(MIN_DRAWER_WIDTH);
    expect(clampDrawerWidth(800)).toBe(MAX_DRAWER_WIDTH);
    expect(clampDrawerWidth(420)).toBe(420);
  });

  it("prepends events and can clear them", () => {
    useAppStore.getState().addEvents(["first"]);
    useAppStore.getState().addEvents(["second"]);
    expect(useAppStore.getState().events).toEqual(["second", "first"]);
    useAppStore.getState().clearEvents();
    expect(useAppStore.getState().events).toEqual([]);
  });
});
describe("agent chat stream store (v0.10)", () => {
  beforeEach(() => {
    useAppStore.setState({ chat: [], agentRunning: false });
  });

  it("appends user entries with image flag", () => {
    useAppStore.getState().appendChatUser("做一个法兰", true);
    const chat = useAppStore.getState().chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].role).toBe("user");
    expect(chat[0].hasImage).toBe(true);
    expect(chat[0].status).toBe("done");
  });

  it("streams assistant deltas into one bubble then finalizes", () => {
    useAppStore.getState().appendChatUser("任务");
    useAppStore.getState().appendChatAssistantDelta("先建");
    useAppStore.getState().appendChatAssistantDelta("基准面");
    let chat = useAppStore.getState().chat;
    expect(chat).toHaveLength(2);
    expect(chat[1].text).toBe("先建基准面");
    expect(chat[1].status).toBe("streaming");
    useAppStore.getState().attachChatToolCard({ step: 1, op: "create_workplane", autofix: false });
    useAppStore.getState().finalizeChatAssistant();
    chat = useAppStore.getState().chat;
    expect(chat[1].tools).toHaveLength(1);
    expect(chat[1].tools[0].op).toBe("create_workplane");
    expect(chat[1].status).toBe("done");
  });

  it("starts a new assistant bubble for tool-only rounds", () => {
    useAppStore.getState().attachChatToolCard({ step: 1, op: "extrude", autofix: false });
    const chat = useAppStore.getState().chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].role).toBe("assistant");
    expect(chat[0].text).toBe("");
    expect(chat[0].tools[0].op).toBe("extrude");
  });

  it("replaces the whole stream on session load", () => {
    useAppStore.getState().appendChatUser("旧的");
    useAppStore.getState().setChat([
      { id: "h1", role: "user", text: "历史消息", hasImage: false, status: "done", tools: [], snapshots: [] },
    ]);
    expect(useAppStore.getState().chat.map((entry) => entry.text)).toEqual(["历史消息"]);
  });
});

describe("agent chat snapshots (v0.10)", () => {
  beforeEach(() => {
    useAppStore.setState({ chat: [] });
  });

  it("attaches snapshot urls to the streaming assistant entry", () => {
    useAppStore.getState().appendChatAssistantDelta("拉伸完成");
    useAppStore.getState().attachChatSnapshot("/api/artifacts/run1/snapshot_s3");
    const chat = useAppStore.getState().chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].snapshots).toEqual(["/api/artifacts/run1/snapshot_s3"]);
  });

  it("creates an assistant entry for snapshots after user turn", () => {
    useAppStore.getState().appendChatUser("再改一下");
    useAppStore.getState().attachChatSnapshot("/api/artifacts/run1/snapshot_s5");
    const chat = useAppStore.getState().chat;
    expect(chat).toHaveLength(2);
    expect(chat[1].role).toBe("assistant");
    expect(chat[1].snapshots).toHaveLength(1);
  });
});

describe("project-scoped reset (v0.23 串台修复)", () => {
  it("clears every field that belongs to the current project", () => {
    // 用 store 自身 API 造出"上一个项目"的残留状态
    useAppStore.getState().appendChatUser("上一个项目的对话");
    useAppStore.getState().appendChatAssistantDelta("上一个项目的流式回复");
    useAppStore.getState().addEvents(["上一个项目的事件"]);
    useAppStore.getState().setProcessSteps([{ stage: "cad", status: "completed", message: "旧步骤", at: "t" } as never]);
    useAppStore.setState({
      selectedFeatureId: "F_0001",
      chatMessage: "打了一半的草稿",
      agentRunning: true,
      agentSteps: 7,
      agentLastOp: "extrude",
      plan: { summary: "上一个项目的计划", steps: [], approved: true },
      pendingApprovals: [{
        approval_id: "approval-1",
        kind: "destructive_op",
        op: "delete_feature",
        args: {},
        message: "要删除吗？",
        options: {},
        context: "",
      }],
    });

    useAppStore.setState(PROJECT_SCOPED_RESET);

    const state = useAppStore.getState();
    expect(state.selectedFeatureId).toBe("");
    expect(state.chatMessage).toBe("");
    expect(state.events).toEqual([]);
    expect(state.processSteps).toEqual([]);
    expect(state.chat).toEqual([]);
    expect(state.plan).toBeNull();
    expect(state.pendingApprovals).toEqual([]);
    expect(state.agentRunning).toBe(false);
    expect(state.agentSteps).toBe(0);
    expect(state.agentLastOp).toBe("");
  });

  it("keeps non-project state (language, ui, settings) untouched", () => {
    useAppStore.setState({ chat: [{ id: "c1", role: "user", text: "x", hasImage: false, status: "done", tools: [], snapshots: [] }] });
    useAppStore.getState().setLanguage("en");
    useAppStore.setState(PROJECT_SCOPED_RESET);
    expect(useAppStore.getState().language).toBe("en");
    expect(useAppStore.getState().ui.leftTab).toBe("feature");
    expect(useAppStore.getState().settings.operation_mode).toBe("strict");
  });
});
