import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ClarificationPanel from "./ClarificationPanel";

describe("ClarificationPanel", () => {
  it("shows progress, defaults, and submits only provided answers", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <ClarificationPanel
        questions={[
          { id: "depth", text: "盲孔深度？", options: [], required: true, answer_type: "number", unit: "mm", default_value: "5" },
          { id: "style", text: "需要倒角吗？", options: ["是", "否"], required: false, answer_type: "choice", default_value: "否" },
        ]}
        onContinue={onContinue}
      />
    );
    expect(screen.getByText("需要补充建模信息")).toBeInTheDocument();
    expect(screen.getByText("已回答 0/2")).toBeInTheDocument();
    expect(screen.getByText("还有 1 个必答项未完成")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "确认答案并继续建模" });
    expect(submit).toBeDisabled();
    const depthCard = screen.getByText("盲孔深度？").closest("article")!;
    await user.click(within(depthCard as HTMLElement).getByRole("button", { name: "使用建议值" }));
    expect(screen.getByText("已回答 1/2")).toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onContinue).toHaveBeenCalledWith("5");
  });

  it("blocks invalid numbers with an inline reason", () => {
    const onContinue = vi.fn();
    render(
      <ClarificationPanel
        questions={[{ id: "depth", text: "盲孔深度？", options: [], required: true, answer_type: "number", unit: "mm" }]}
        onContinue={onContinue}
      />
    );
    const input = screen.getByRole("spinbutton");
    Object.defineProperty(input, "value", { value: "abc", configurable: true });
    fireEvent.input(input);
    fireEvent.blur(input);
    expect(screen.getByText("请输入有效数字")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认答案并继续建模" })).toBeDisabled();
  });
});
