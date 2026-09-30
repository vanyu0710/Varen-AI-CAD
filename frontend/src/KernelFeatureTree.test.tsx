import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KernelFeatureTree from "./KernelFeatureTree";
import type { KernelFeatureData } from "./api";
import { useAppStore } from "./store";

const nodes: Record<string, KernelFeatureData> = {
  root: { id: "root", type: "create_workplane", name: "base", state: "COMPUTED" },
  child: { id: "child", type: "extrude", name: "main_body", state: "COMPUTED", parent_id: "root" },
  grandchild: { id: "grandchild", type: "hole", name: "center_bore", state: "PENDING", parent_id: "child" },
};
const history = [
  { feature_id: "root", op: "create_workplane" },
  { feature_id: "child", op: "extrude" },
  { feature_id: "grandchild", op: "hole" },
];

beforeEach(() => useAppStore.setState({ language: "zh" }));

describe("KernelFeatureTree", () => {
  it("renders hierarchy with operation details and state", () => {
    render(<KernelFeatureTree opHistory={history} nodes={nodes} selectedFeatureId="child" onSelectFeature={vi.fn()} />);
    expect(screen.getByText("main_body")).toBeInTheDocument();
    expect(screen.getByText("center_bore")).toBeInTheDocument();
    expect(screen.getByText(/extrude/)).toBeInTheDocument();
    expect(screen.getAllByText("COMPUTED").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("PENDING")).toBeInTheDocument();
  });

  it("indents nested child features", () => {
    render(<KernelFeatureTree opHistory={history} nodes={nodes} selectedFeatureId="" onSelectFeature={vi.fn()} />);
    const child = screen.getByRole("button", { name: /main_body/ }).parentElement;
    expect(child).toHaveStyle({ paddingLeft: "22px" });
    const grandchild = screen.getByRole("button", { name: /center_bore/ }).parentElement;
    expect(grandchild).toHaveStyle({ paddingLeft: "36px" });
  });

  it("selects and deletes a feature", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<KernelFeatureTree opHistory={history} nodes={nodes} selectedFeatureId="" onSelectFeature={onSelect} onDeleteFeature={onDelete} />);
    await user.click(screen.getByText("main_body"));
    expect(onSelect).toHaveBeenCalledWith("child");
    await user.click(screen.getAllByTitle("删除此特征")[0]);
    expect(onDelete).toHaveBeenCalledWith("root");
  });

  it("supports collapsing descendants", async () => {
    render(<KernelFeatureTree opHistory={history} nodes={nodes} selectedFeatureId="" onSelectFeature={vi.fn()} />);
    expect(screen.getByText("center_bore")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "收起子特征" })[0]);
    expect(screen.queryByText("main_body")).not.toBeInTheDocument();
    expect(screen.queryByText("center_bore")).not.toBeInTheDocument();
  });

  it("wires visibility, isolate and focus actions", async () => {
    const visible = vi.fn();
    const isolate = vi.fn();
    const focus = vi.fn();
    const select = vi.fn();
    render(<KernelFeatureTree opHistory={history} nodes={nodes} selectedFeatureId="" onSelectFeature={select} onToggleVisibility={visible} onIsolateFeature={isolate} onFocusFeature={focus} />);
    await userEvent.click(screen.getAllByRole("button", { name: "隐藏特征" })[0]);
    expect(visible).toHaveBeenCalledWith("root", false);
    await userEvent.click(screen.getAllByRole("button", { name: "仅显示此特征" })[2]);
    expect(isolate).toHaveBeenCalledWith("grandchild");
    await userEvent.click(screen.getAllByRole("button", { name: "聚焦此特征" })[2]);
    expect(focus).toHaveBeenCalledWith("grandchild");
    expect(select).toHaveBeenCalledWith("grandchild");
  });

  it("shows an empty state when no history exists", () => {
    render(<KernelFeatureTree opHistory={[]} nodes={{}} selectedFeatureId="" onSelectFeature={vi.fn()} />);
    expect(screen.getByText("尚无特征")).toBeInTheDocument();
  });
});
