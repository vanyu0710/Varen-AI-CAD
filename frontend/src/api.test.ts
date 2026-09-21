import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactUrl, assemblyArtifactUrl, fetchGeometryTopology, isStaleApprovalError, measureTopology, resolveApiRoot, resolveWsRoot, selectGeometryAtPoint, withStrippedKeyMasks, type SemanticPick } from "./api";
import { DEFAULT_SETTINGS } from "./store";
import type { ModelConfig } from "./api";

describe("stale approval errors (v0.22)", () => {
  it("recognizes dead-run and expired-approval details", () => {
    expect(isStaleApprovalError(new Error("No running agent for this project"))).toBe(true);
    expect(isStaleApprovalError(new Error("Approval not found or already resolved: approval-1"))).toBe(true);
    expect(isStaleApprovalError(new Error("审批不存在或已过期: approval-1"))).toBe(true);
  });

  it("does not swallow ordinary failures", () => {
    expect(isStaleApprovalError(new Error("HTTP 500 from upstream"))).toBe(false);
    expect(isStaleApprovalError("boom")).toBe(false);
  });
});

describe("assembly artifact urls (v0.14 F2a)", () => {
  it("builds library file urls with encoding", () => {
    expect(assemblyArtifactUrl("p1", "v003_小齿轮.step"))
      .toBe(`/api/projects/p1/assembly/artifacts/${encodeURIComponent("v003_小齿轮.step")}`);
  });

  it("returns empty for missing project or filename", () => {
    expect(assemblyArtifactUrl(undefined, "a.step")).toBe("");
    expect(assemblyArtifactUrl("p1", null)).toBe("");
  });

  it("artifactUrl still supports dynamic part kinds", () => {
    expect(artifactUrl("r1", "part_01_gear.step")).toBe("/api/artifacts/r1/part_01_gear.step");
    expect(artifactUrl(undefined, "step")).toBe("");
  });
});

describe("same-origin address resolution", () => {
  it("defaults API root to the current origin", () => {
    expect(resolveApiRoot({})).toBe("");
    expect(resolveApiRoot({ VITE_API_ROOT: "http://127.0.0.1:9000" })).toBe("http://127.0.0.1:9000");
  });

  it("prefers an explicit WebSocket override", () => {
    expect(resolveWsRoot({ VITE_WS_ROOT: "wss://example.test" })).toBe("wss://example.test");
  });

  it("derives WebSocket root from an API root", () => {
    expect(resolveWsRoot({}, "http://127.0.0.1:8001")).toBe("ws://127.0.0.1:8001");
  });

  it("derives same-origin WebSocket root from window.location", () => {
    const root = resolveWsRoot({}, "");
    expect(root.startsWith("ws://")).toBe(true);
    expect(root.endsWith("/")).toBe(false);
  });
});

describe("model key mask stripping (v0.20 console)", () => {
  it("treats server masks as unset for probe requests", () => {
    const config: ModelConfig = {
      ...DEFAULT_SETTINGS,
      vision_api_key: "***configured:abcd***",
      planner_api_key: "sk-real-key",
    };
    const stripped = withStrippedKeyMasks(config);
    expect(stripped.vision_api_key).toBe("");
    expect(stripped.planner_api_key).toBe("sk-real-key");
    expect(config.vision_api_key).toBe("***configured:abcd***");
  });
});


describe("selectGeometryAtPoint (M1 BRep semantics)", () => {
  const pick: SemanticPick = {
    partName: "part_01",
    point: [10, 20, 30],
    direction: [0, 0, -1],
  };
  const selection = {
    topology: { type: "face", id: "face_0001", kind: "cylinder", fingerprint: "sha256:test" },
    geometry: { kind: "cylinder", axis: [0, 0, 1], radius_mm: 5, area_mm2: 100 },
    hit: { point_mm: [10, 20, 30], distance_to_face_mm: 0 },
    feature_id: "F_0001",
    display: {
      type: "triangles" as const,
      vertices: [[0, 0, 5], [10, 0, 5], [10, 10, 5], [0, 10, 5]],
      indices: [0, 1, 2, 0, 2, 3],
      triangle_count: 2,
      source: "brep" as const,
    },
    source: "brep" as const,
    units: "mm",
    accuracy: 0.001,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the mesh hit to the BRep semantic endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        part_name: "part_01",
        matched: true,
        selection,
        reason: null,
        source: "brep",
      }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await selectGeometryAtPoint("project-1", pick, 0.25);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/projects/project-1/geometry/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        point: pick.point,
        direction: pick.direction,
        tolerance_mm: 0.25,
        part_name: "part_01",
      }),
    });
    expect(result.matched).toBe(true);
    expect(result.selection?.source).toBe("brep");
    expect(result.selection?.topology.kind).toBe("cylinder");
    const display = result.selection?.display;
    expect(display?.source).toBe("brep");
    if (display?.type === "triangles") {
      expect(display.triangle_count).toBe(2);
    } else {
      throw new Error("expected a triangles display mesh");
    }
  });

  it("preserves BRep edge and vertex display payloads", async () => {
    const edgeSelection = {
      topology: { type: "edge", id: "edge_0001", kind: "circle", fingerprint: "sha256:edge" },
      geometry: { kind: "circle", center: [0, 0, 10], radius_mm: 5, length_mm: 31.4159 },
      hit: { point_mm: [0, 5, 10], distance_to_edge_mm: 0 },
      feature_id: "F_0001",
      display: {
        type: "polyline" as const,
        vertices: [[5, 0, 10], [0, 5, 10], [-5, 0, 10]],
        source: "brep" as const,
      },
      source: "brep" as const,
      units: "mm",
      accuracy: 0.001,
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        matched: true,
        selection: edgeSelection,
        source: "brep",
      }),
    } as Response)));

    const result = await selectGeometryAtPoint("project-1", pick);
    expect(result.selection?.topology.type).toBe("edge");
    expect(result.selection?.display?.type).toBe("polyline");
    expect(result.selection?.display?.type === "polyline" && result.selection.display.vertices).toHaveLength(3);
  });

  it("returns a structured miss instead of pretending it is a transport error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        matched: false,
        selection: null,
        reason: "no_brep_topology_within_tolerance",
        source: null,
      }),
    } as Response)));

    const result = await selectGeometryAtPoint("project-1", pick);
    expect(result.matched).toBe(false);
    expect(result.selection).toBeNull();
    expect(result.reason).toBe("no_brep_topology_within_tolerance");
  });
});


describe("fetchGeometryTopology (semantic ID reverse lookup)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the encoded topology ID and preserves the geometry revision", async () => {
    const topologyId = "edge:sha256:test";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        matched: true,
        selection: {
          topology: { type: "edge", id: topologyId, kind: "circle", fingerprint: "sha256:test" },
          geometry: { kind: "circle", radius_mm: 5 },
          hit: null,
          geometry_revision: 12,
          feature_id: "F_0001",
          display: {
            type: "polyline",
            vertices: [[5, 0, 0], [0, 5, 0]],
            source: "brep",
          },
          source: "brep",
          units: "mm",
          accuracy: 0.001,
        },
        reason: null,
        geometry_revision: 12,
        source: "brep",
      }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGeometryTopology("project-1", topologyId);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/projects/project-1/geometry/topology/edge%3Asha256%3Atest",
      { method: "POST" },
    );
    expect(result.matched).toBe(true);
    expect(result.geometry_revision).toBe(12);
    expect(result.selection?.hit).toBeNull();
    expect(result.selection?.geometry_revision).toBe(12);
  });

  it("keeps a stale ID as a structured miss", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        matched: false,
        selection: null,
        reason: "topology_not_found",
        geometry_revision: 13,
        source: null,
      }),
    } as Response)));

    const result = await fetchGeometryTopology("project-1", "face:sha256:old");
    expect(result.matched).toBe(false);
    expect(result.selection).toBeNull();
    expect(result.reason).toBe("topology_not_found");
    expect(result.geometry_revision).toBe(13);
  });
});


describe("measureTopology (M2 BRep measurements)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts semantic IDs and returns an OCC measurement", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        matched: true,
        measurement: {
          topology_ids: ["edge:sha256:test"],
          metric: "diameter",
          result: { p1: [-5, 0, 0], p2: [5, 0, 0], distance: 10, dx: 10, dy: 0, dz: 0 },
          algorithm: "occ_analytic_brep",
          source: "brep",
          units: "mm",
          accuracy: 0.001,
          geometry_revision: 12,
        },
        reason: null,
        geometry_revision: 12,
        source: "brep",
      }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await measureTopology("project-1", ["edge:sha256:test"]);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/projects/project-1/geometry/measure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topology_ids: ["edge:sha256:test"] }),
    });
    expect(result.matched).toBe(true);
    expect(result.measurement?.metric).toBe("diameter");
    expect(result.measurement?.result.distance).toBe(10);
    expect(result.measurement?.source).toBe("brep");
  });

  it("keeps unresolved topology IDs as a structured miss", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        matched: false,
        measurement: null,
        reason: "topology_not_found",
        geometry_revision: 13,
        source: null,
      }),
    } as Response)));

    const result = await measureTopology("project-1", ["face:sha256:old", "edge:sha256:old"]);
    expect(result.matched).toBe(false);
    expect(result.measurement).toBeNull();
    expect(result.reason).toBe("topology_not_found");
  });
});
