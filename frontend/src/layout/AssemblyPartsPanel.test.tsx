import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartArtifact } from "../api";
import AssemblyPartsPanel from "./AssemblyPartsPanel";
import { useAppStore } from "../store";

const parts: PartArtifact[] = [
  { part: "thrust_chamber", index: 1, library_stl_file: "a.stl" },
  { part: "lox_rotor", index: 2, library_stl_file: "b.stl", pose: { position: [12, 34, 56] } },
  { part: "fuel_rotor", index: 3, library_stl_file: "c.stl", pose: { position: [-12, 0, 0] } },
];

beforeEach(() => useAppStore.setState({ language: "zh" }));

describe("AssemblyPartsPanel", () => {
  it("searches and filters parts without losing visibility state", async () => {
    const hidden: string[][] = [];
    render(
      <AssemblyPartsPanel
        parts={parts}
        hidden={["lox_rotor"]}
        selected={null}
        interfering={["fuel_rotor"]}
        onHiddenChange={(next) => hidden.push(next)}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("3 个零件 · 2 个可见")).toBeInTheDocument();
    expect(screen.getByText("干涉")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "搜索零件" }), "lox");
    expect(screen.queryByRole("button", { name: "thrust_chamber" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lox_rotor" })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("searchbox", { name: "搜索零件" }));
    await userEvent.click(screen.getByRole("button", { name: "可见 · 2" }));
    expect(screen.queryByRole("button", { name: "lox_rotor" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "干涉 · 1" }));
    expect(screen.getByRole("button", { name: "fuel_rotor" })).toBeInTheDocument();
    expect(hidden).toEqual([]);
  });

  it("toggles visibility, selects a part, and solos it from the row action", async () => {
    const hidden: string[][] = [];
    const selected: (string | null)[] = [];
    render(
      <AssemblyPartsPanel
        parts={parts}
        hidden={[]}
        selected={null}
        interfering={[]}
        onHiddenChange={(next) => hidden.push(next)}
        onSelect={(name) => selected.push(name)}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "显示零件：lox_rotor" }));
    expect(hidden).toEqual([["lox_rotor"]]);

    await userEvent.click(screen.getByRole("button", { name: "fuel_rotor" }));
    expect(selected).toEqual(["fuel_rotor"]);

    const soloButtons = screen.getAllByRole("button", { name: "仅看" });
    await userEvent.click(soloButtons[0]);
    expect(hidden.at(-1)).toEqual(["lox_rotor", "fuel_rotor"]);
    expect(selected.at(-1)).toBe("thrust_chamber");
  });

  it("restores every part with one action", async () => {
    const hidden: string[][] = [];
    render(
      <AssemblyPartsPanel
        parts={parts}
        hidden={["lox_rotor", "fuel_rotor"]}
        selected="lox_rotor"
        interfering={[]}
        onHiddenChange={(next) => hidden.push(next)}
        onSelect={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "恢复全部" }));
    expect(hidden).toEqual([[]]);
  });
});
