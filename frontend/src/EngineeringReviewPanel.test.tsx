import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EngineeringReviewPanel from "./EngineeringReviewPanel";
import StructurePanel from "./layout/StructurePanel";
import { useAppStore } from "./store";

const review = {
  project_id: "p1",
  generated_at: "2026-10-03T10:00:00",
  status: "BLOCKED",
  active_parts_count: 2,
  materials: [
    { material: "steel", part_count: 1, parts: ["gear"], basis: "manifest" },
    { material: "cast_iron", part_count: 1, parts: ["housing"], basis: "manifest" },
  ],
  critical_parts: [
    {
      part: "gear",
      version: 1,
      material: "steel",
      material_basis: "manifest",
      role: "drive",
      depends_on: ["housing"],
      validation_status: "PASS",
      volume_mm3: 123.45,
      criticality_reasons: ["functional_role_recorded", "dependency_recorded"],
      blocking_issues: [{ code: "step_file_missing", message: "Part STEP artifact is missing.", parts: [] }],
      warning_issues: [{ code: "material_inferred", message: "Viewport material inferred." }],
      is_critical: true,
    },
  ],
  assembly: {
    available: true,
    exported_at: "2026-10-03T10:01:00",
    step_file: "assembly_001.step",
    render_file: null,
    report_file: "assembly_001_report.json",
    parts_count: 2,
    active_parts_count: 2,
    total_pairs: 1,
    interfering_count: 1,
    exempted_count: 1,
    hard_collision_count: 1,
    expected_fit_count: 1,
    expected_mesh_count: 0,
    excluded_superseded: ["old gear"],
    blocking_issues: [{ code: "hard_collision", message: "Hard collision." }],
    warning_issues: [{ code: "expected_fit", message: "Expected fit." }],
  },
  limitations: ["Material keys are viewport rendering proxies, not engineering material specifications."],
};

const response = () => Promise.resolve(new Response(JSON.stringify(review), {
  status: 200,
  headers: { "content-type": "application/json" },
}));

beforeEach(() => {
  useAppStore.setState({ language: "zh" });
  vi.stubGlobal("fetch", vi.fn(response));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).showSaveFilePicker;
});

describe("EngineeringReviewPanel", () => {
  it("renders material groups, critical part findings, and assembly findings", async () => {
    render(<EngineeringReviewPanel projectId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("材料与工程审查")).toBeInTheDocument());
    expect(screen.getAllByTestId("engineering-material")).toHaveLength(2);
    expect(screen.getByText("material 是渲染材质代理，不是工程材料规格；不可用于采购、强度或合规判断。")).toBeInTheDocument();
    expect(screen.getByText("零件 STEP 产物缺失。")).toBeInTheDocument();
    expect(screen.getByText("渲染材质由零件名推断，非工程规格。")).toBeInTheDocument();
    expect(screen.getByText("装配报告存在未豁免硬碰撞。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "装配报告" })).toHaveAttribute(
      "href",
      "/api/projects/p1/assembly/artifacts/assembly_001_report.json",
    );
    expect(screen.queryByText(/6061|屈服强度|抗拉强度/i)).not.toBeInTheDocument();
  });
});

describe("StructurePanel materials tab", () => {
  it("loads the engineering review in the structure drawer", async () => {
    render(
      <StructurePanel
        busy={false}
        projectId="p1"
        onKnowledgeError={vi.fn()}
        kernelTree={{ graph: { nodes: {}, edges: {} }, op_history: [], narrative: [], node_count: 0 }}
        kernelSelectedFeature={null}
        selectedFeatureId=""
        modeLabel="OCC"
        processSteps={[]}
        featurePlan={null}
        unresolved={[]}
        runId="run-1"
        engineLabel="OCC"
        onSelectKernelFeature={vi.fn()}
        onSaveKernelFeature={vi.fn()}
        onDeleteKernelFeature={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "材料" }));
    await waitFor(() => expect(screen.getAllByText("gear").length).toBeGreaterThan(0));
    expect(screen.getByText("装配体审查")).toBeInTheDocument();
  });
});
