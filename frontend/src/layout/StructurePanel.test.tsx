import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StructurePanel from "./StructurePanel";
import { useAppStore } from "../store";

beforeEach(() => useAppStore.setState({ language: "zh" }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).showSaveFilePicker;
});

function renderPanel(exportArtifacts: Parameters<typeof StructurePanel>[0]["exportArtifacts"]) {
  return render(
    <StructurePanel
      busy={false}
      kernelTree={{
        graph: { nodes: {}, edges: {} },
        op_history: [],
        narrative: [],
        node_count: 0,
      }}
      kernelSelectedFeature={null}
      selectedFeatureId=""
      modeLabel="OCC"
      processSteps={[]}
      featurePlan={null}
      unresolved={[]}
      runId="run-1"
      exportArtifacts={exportArtifacts}
      engineLabel="OCC"
      onSelectKernelFeature={vi.fn()}
      onSaveKernelFeature={vi.fn()}
      onDeleteKernelFeature={vi.fn()}
    />,
  );
}

describe("StructurePanel export links", () => {
  it("opens the native save dialog and streams the selected export", async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const picker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue(writable),
    });
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: picker });
    const fetchMock = vi.fn().mockResolvedValue(new Response("STEP", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderPanel({
      step: { url: "/api/artifacts/run-1/step", filename: "engine.step" },
    });
    await userEvent.click(screen.getByRole("tab", { name: "导出" }));
    await userEvent.click(screen.getByRole("link", { name: "STEP" }));

    await waitFor(() => expect(writable.close).toHaveBeenCalled());
    expect(picker).toHaveBeenCalledWith({ suggestedName: "engine.step" });
    expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/run-1/step", { credentials: "same-origin" });
  });
  it("enables only real top-level STEP artifacts and keeps download filenames", async () => {
    renderPanel({
      step: {
        url: "/api/projects/p1/assembly/artifacts/assembly_001.step",
        filename: "assembly_001.step",
      },
    });
    await userEvent.click(screen.getByRole("tab", { name: "导出" }));

    const step = screen.getByRole("link", { name: "STEP" });
    expect(step).toHaveAttribute("href", "/api/projects/p1/assembly/artifacts/assembly_001.step");
    expect(step).toHaveAttribute("download", "assembly_001.step");

    const stl = screen.getByText("STL");
    expect(stl).toHaveClass("disabled");
    expect(stl).not.toHaveAttribute("href");
  });
});
