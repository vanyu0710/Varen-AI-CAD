import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import AssemblyCheckSummary from "./layout/AssemblyCheckSummary";
import type { AssemblySummary } from "./api";
import { useAppStore } from "./store";

const base: AssemblySummary = { parts_count: 26, total_pairs: 325,
  interfering_count: 4, exempted_count: 4, max_interference_volume_mm3: 2, pairs: [] };
const metric = (label: string) => screen.getByText(label).parentElement!.querySelector("dd");
beforeEach(() => useAppStore.setState({ language: "zh" }));
describe("AssemblyCheckSummary", () => {
  it("does not infer zero hard collisions from legacy counters", () => {
    render(<AssemblyCheckSummary assembly={base} />);
    expect(metric("硬碰撞")).toHaveTextContent("未记录");
    expect(metric("报告配对数")).toHaveTextContent("325");
    expect(screen.getByText(/不代表当前修改已复验/)).toBeInTheDocument();
  });
  it("shows program classifications without turning zero into certification", () => {
    render(<AssemblyCheckSummary assembly={{ ...base, hard_collision_count: 0,
      expected_fit_count: 1, expected_mesh_count: 3 }} />);
    expect(metric("硬碰撞")).toHaveTextContent("0");
    expect(metric("配合豁免")).toHaveTextContent("1");
    expect(metric("啮合豁免")).toHaveTextContent("3");
    expect(screen.queryByText("PASS")).not.toBeInTheDocument();
  });
  it("highlights recorded collisions and reports calculation errors", () => {
    render(<AssemblyCheckSummary assembly={{ ...base, hard_collision_count: 2,
      pairs: [{ name_a: "a", name_b: "b", interfering: false, volume_mm3: 0, error: "timeout" }] }} />);
    expect(metric("硬碰撞")!.parentElement).toHaveClass("warn");
    expect(screen.getByRole("alert")).toHaveTextContent("计算错误");
  });
  it("handles invalid counters and English labels", () => {
    useAppStore.setState({ language: "en" });
    render(<AssemblyCheckSummary assembly={{ ...base, hard_collision_count: -1,
      expected_fit_count: NaN, expected_mesh_count: null }} />);
    expect(metric("Hard collisions")).toHaveTextContent("Not recorded");
    expect(metric("Fit exemptions")).toHaveTextContent("Not recorded");
  });
});
