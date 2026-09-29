import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { InterferencePair } from "../api";
import InterferencePairs from "./InterferencePairs";
import { useAppStore } from "../store";

const pairs: InterferencePair[] = [{
  pair_id: "pair:bracket|shaft",
  name_a: "bracket",
  name_b: "shaft",
  interfering: true,
  volume_mm3: 12.5,
  center: [1.25, 2.5, 3.75],
  intersection_bbox: [0, 0, 0, 2.5, 5, 7.5],
  diagnostic_status: "complete",
}];

beforeEach(() => useAppStore.setState({ language: "zh" }));

describe("InterferencePairs", () => {
  it("shows pair evidence and selects either part on click", async () => {
    const selected: string[] = [];
    render(<InterferencePairs pairs={pairs} selected="shaft" onSelectPart={(name) => selected.push(name)} />);
    expect(screen.getByText("干涉零件对（点击零件选中）")).toBeInTheDocument();
    expect(screen.getByText("12.5 mm³")).toBeInTheDocument();
    expect(screen.getByText("(1.25, 2.50, 3.75)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选中零件 shaft" })).toHaveClass("selected");
    await userEvent.click(screen.getByRole("button", { name: "选中零件 bracket" }));
    expect(selected).toEqual(["bracket"]);
  });

  it("marks calculation errors instead of showing them as passed", () => {
    render(<InterferencePairs pairs={[{
      pair_id: "pair:a|error", name_a: "a", name_b: "error", interfering: false,
      volume_mm3: 0, diagnostic_status: "calculation_error", error: "OCC failure",
    }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("计算错误，不能视为通过: OCC failure");
    expect(screen.queryByText("0.0 mm³")).not.toBeInTheDocument();
  });

  it("renders no noise for a clean pair", () => {
    render(<InterferencePairs pairs={[{
      pair_id: "pair:a|b", name_a: "a", name_b: "b", interfering: false,
      volume_mm3: 0, diagnostic_status: "complete",
    }]} />);
    expect(screen.queryByTestId("assembly-interference")).not.toBeInTheDocument();
  });
});
