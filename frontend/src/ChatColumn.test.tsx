import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatColumn from "./layout/ChatColumn";
import { useAppStore } from "./store";

beforeEach(() => {
  useAppStore.setState({ agentRunning: false });
});

function renderColumn(chat: any[] = []) {
  return render(
    <ChatColumn
      chat={chat}
      chatMessage=""
      busy={false}
      engineLabel="Build123d Worker（受控执行）"
      questions={[]}
      imageFile={null}
      planMode={false}
      onPlanModeChange={vi.fn()}
      onClarificationContinue={vi.fn()}
      onChatMessageChange={vi.fn()}
      onSendChat={vi.fn()}
      onImageChange={vi.fn()}
    />,
  );
}

describe("ChatColumn", () => {
  it("renders the chat input and empty hint", () => {
    renderColumn();
    expect(screen.getByPlaceholderText(/做一个法兰盘/)).toBeInTheDocument();
    expect(screen.getByText(/和 Agent 说说要做什么/)).toBeInTheDocument();
  });

  it("renders user/assistant bubbles with tool cards and snapshots", () => {
    renderColumn([
      { id: "c1", role: "user", text: "做一个法兰，中心孔 30mm", hasImage: true, status: "done", tools: [], snapshots: [] },
      {
        id: "c2",
        role: "assistant",
        text: "好的，先建基准面。",
        hasImage: false,
        status: "streaming",
        tools: [
          { step: 1, op: "create_workplane", argsPreview: '{"name":"base"}', success: true, summary: "", autofix: false },
          { step: 2, op: "extrude", argsPreview: "{}", success: false, summary: "depth 必须大于 0", autofix: true },
        ],
        snapshots: ["/api/artifacts/run9/snapshot_s2"],
      },
    ]);
    expect(screen.getByText("做一个法兰，中心孔 30mm")).toBeInTheDocument();
    expect(screen.getByText(/先建基准面/)).toBeInTheDocument();
    expect(screen.getByText("create_workplane")).toBeInTheDocument();
    expect(screen.getByText('{"name":"base"}')).toBeInTheDocument();
    expect(screen.getByText("extrude ·fix")).toBeInTheDocument();
    expect(screen.getByText("已附草图")).toBeInTheDocument();
    expect(document.querySelector(".chat-caret")).not.toBeNull();
    expect(document.querySelector(".chat-snapshot")).not.toBeNull();
  });

  it("shows the queued hint while the agent is running", () => {
    useAppStore.setState({ agentRunning: true });
    renderColumn();
    expect(screen.getByText(/将在当前步骤结束后生效/)).toBeInTheDocument();
  });

  it("renders the plan checklist with step statuses", () => {
    render(
      <ChatColumn
        chat={[]}
        chatMessage=""
        busy={false}
        engineLabel="Build123d Worker"
        questions={[]}
        imageFile={null}
        planMode={false}
        onPlanModeChange={vi.fn()}
        onClarificationContinue={vi.fn()}
        onChatMessageChange={vi.fn()}
        onSendChat={vi.fn()}
        onImageChange={vi.fn()}
        plan={{ summary: "底板+中心孔", steps: [
          { id: "s1", title: "建底板", status: "completed" },
          { id: "s2", title: "开中心孔", op: "hole", status: "in_progress" },
        ] }}
      />,
    );
    expect(screen.getByText("底板+中心孔")).toBeInTheDocument();
    expect(screen.getByText("建底板")).toBeInTheDocument();
    expect(screen.getByText("开中心孔")).toBeInTheDocument();
    expect(screen.getByText("hole")).toBeInTheDocument();
  });

  it("shows the BOM summary and per-part progress in the plan checklist", () => {
    render(
      <ChatColumn
        chat={[]}
        chatMessage=""
        busy={false}
        engineLabel="Build123d Worker"
        questions={[]}
        imageFile={null}
        planMode={false}
        onPlanModeChange={vi.fn()}
        onClarificationContinue={vi.fn()}
        onChatMessageChange={vi.fn()}
        onSendChat={vi.fn()}
        onImageChange={vi.fn()}
        plan={{ summary: "两级减速箱", bom: [
          { id: "p1", part: "小齿轮", role: "高速级主动轮", quantity: 1 },
          { id: "p2", part: "箱体", role: "壳体", quantity: 1 },
        ], steps: [
          { id: "s1", title: "建小齿轮", part: "小齿轮", status: "completed" },
          { id: "s2", title: "开轴孔", part: "小齿轮", status: "pending" },
          { id: "s3", title: "建箱体", part: "箱体", status: "pending" },
        ] }}
      />,
    );
    expect(screen.getByTestId("plan-bom-summary")).toBeInTheDocument();
    expect(screen.getByText("高速级主动轮")).toBeInTheDocument();
    // 分组标题带完成进度
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("1/2").closest(".plan-step-part-title")).not.toHaveClass("done");
    const details = document.querySelector("details.plan-card") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(screen.getByText("建小齿轮")).toBeInTheDocument();
    expect(screen.getByText("建箱体")).toBeInTheDocument();
  });
});

function interactionProps() {
  return { chat: [], chatMessage: "把盲孔深度改为 6mm", busy: false,
    engineLabel: "Worker", questions: [], imageFile: null, planMode: false,
    onPlanModeChange: vi.fn(), onClarificationContinue: vi.fn(),
    onChatMessageChange: vi.fn(), onSendChat: vi.fn(), onImageChange: vi.fn() };
}

describe("ChatColumn input and reading position", () => {
  it("uses multiline input; only plain Enter sends", () => {
    const props = interactionProps();
    render(<ChatColumn {...props} />);
    const input = screen.getByRole("textbox");
    expect(input.tagName).toBe("TEXTAREA");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(props.onSendChat).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSendChat).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    expect(props.onChatMessageChange).toHaveBeenCalledWith("第一行\n第二行");
  });

  it("does not submit whitespace through the keyboard", () => {
    const props = { ...interactionProps(), chatMessage: "  \n " };
    render(<ChatColumn {...props} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onSendChat).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("keeps history in place during streaming and can resume following", () => {
    const props = interactionProps();
    const entry = { id: "a", role: "assistant" as const, text: "building", hasImage: false,
      status: "streaming" as const, tools: [], snapshots: [] };
    const { container, rerender } = render(<ChatColumn {...props} chat={[entry]} />);
    const stream = container.querySelector(".chat-stream") as HTMLDivElement;
    Object.defineProperties(stream, { scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true } });
    stream.scrollTop = 100;
    fireEvent.scroll(stream);
    rerender(<ChatColumn {...props} chat={[{ ...entry, text: "more output" }]} />);
    expect(stream.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: /回到最新消息/ }));
    expect(stream.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /回到最新消息/ })).not.toBeInTheDocument();
    stream.scrollTop = 800;
    fireEvent.scroll(stream);
    Object.defineProperty(stream, "scrollHeight", { value: 1200 });
    rerender(<ChatColumn {...props} chat={[{ ...entry, text: "latest output" }]} />);
    expect(stream.scrollTop).toBe(1200);
  });

  it("renders unconfigured warning banner and opens settings when clicked", () => {
    const onOpenSettings = vi.fn();
    render(
      <ChatColumn
        chat={[]}
        chatMessage=""
        busy={false}
        engineLabel="Worker"
        questions={[]}
        imageFile={null}
        planMode={false}
        isPlannerConfigured={false}
        onOpenSettings={onOpenSettings}
        onPlanModeChange={vi.fn()}
        onClarificationContinue={vi.fn()}
        onChatMessageChange={vi.fn()}
        onSendChat={vi.fn()}
        onImageChange={vi.fn()}
      />
    );
    expect(screen.getByText(/未配置 Planner 模型/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/未配置 Planner 模型/));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("renders assistant error bubble with action button", () => {
    const onOpenSettings = vi.fn();
    render(
      <ChatColumn
        chat={[
          {
            id: "err1",
            role: "assistant",
            text: "当前未配置建模 Planner 模型",
            hasImage: false,
            status: "done",
            tools: [],
            snapshots: [],
            error: true,
            action: { type: "open_settings" },
          },
        ]}
        chatMessage=""
        busy={false}
        engineLabel="Worker"
        questions={[]}
        imageFile={null}
        planMode={false}
        onOpenSettings={onOpenSettings}
        onPlanModeChange={vi.fn()}
        onClarificationContinue={vi.fn()}
        onChatMessageChange={vi.fn()}
        onSendChat={vi.fn()}
        onImageChange={vi.fn()}
      />
    );
    expect(screen.getByText("当前未配置建模 Planner 模型")).toBeInTheDocument();
    const actionBtn = screen.getByRole("button", { name: "前往配置模型" });
    expect(actionBtn).toBeInTheDocument();
    fireEvent.click(actionBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});