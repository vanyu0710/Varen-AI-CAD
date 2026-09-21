import { describe, expect, it } from "vitest";
import {
  TRANSPARENCY_LEVELS,
  bodyOpacity,
  clampMenuPos,
  edgeOpacity,
  isPartHidden,
  mergeHiddenNames,
  pickPartName,
} from "./partVisual";

describe("partVisual opacity mapping", () => {
  it("maps levels to monotonic opacities", () => {
    expect(bodyOpacity("opaque")).toBe(1);
    expect(bodyOpacity(undefined)).toBe(1);
    expect(bodyOpacity("semi")).toBe(0.45);
    expect(bodyOpacity("ghost")).toBe(0.15);
    expect(bodyOpacity("semi")).toBeLessThan(bodyOpacity("opaque"));
    expect(bodyOpacity("ghost")).toBeLessThan(bodyOpacity("semi"));
    expect(TRANSPARENCY_LEVELS).toEqual(["opaque", "semi", "ghost"]);
  });

  it("fades edges but keeps them visible", () => {
    expect(edgeOpacity(undefined, 0.8)).toBe(0.8);
    expect(edgeOpacity("semi", 0.8)).toBeCloseTo(0.48);
    expect(edgeOpacity("ghost", 0.8)).toBeCloseTo(0.32);
    expect(edgeOpacity("ghost", 0.8)).toBeGreaterThan(0);
  });
});

describe("clampMenuPos", () => {
  it("keeps the menu inside the container", () => {
    expect(clampMenuPos(50, 50, 200, 240, 800, 600)).toEqual({ left: 50, top: 50 });
    // 右下角：翻进容器
    expect(clampMenuPos(790, 590, 200, 240, 800, 600)).toEqual({ left: 596, top: 356 });
    // 左上角贴边
    expect(clampMenuPos(0, 0, 200, 240, 800, 600)).toEqual({ left: 4, top: 4 });
  });
});

describe("pickPartName", () => {
  const mesh = (name: string, extra: Record<string, unknown> = {}) => ({
    isMesh: true,
    visible: true,
    userData: { partName: name, ...extra },
  });

  it("returns the first visible part mesh by hit order", () => {
    expect(pickPartName([mesh("shaft"), mesh("gear")])).toBe("shaft");
  });

  it("skips edge helpers, lines and hidden meshes", () => {
    expect(
      pickPartName([
        { isMesh: false, visible: true, userData: {} },
        mesh("edge", { isEdgeHelper: true }),
        { isMesh: true, visible: false, userData: { partName: "hidden-part" } },
        mesh("bearing"),
      ]),
    ).toBe("bearing");
  });

  it("skips the stencil helper mesh that shares the part's geometry", () => {
    // 辅助网格也带 partName，必须靠 isStencilHelper 标记剔除
    expect(pickPartName([mesh("gear", { isStencilHelper: true }), mesh("gear")])).toBe("gear");
  });

  it("returns null when nothing pickable", () => {
    expect(pickPartName([])).toBeNull();
    expect(pickPartName([{ isMesh: true, visible: true, userData: {} }])).toBeNull();
  });
});

describe("hidden state union", () => {
  it("isPartHidden ORs the viewport-local flag with the panel's list", () => {
    expect(isPartHidden("gear", undefined, [])).toBe(false);
    expect(isPartHidden("gear", true, [])).toBe(true);
    expect(isPartHidden("gear", undefined, ["gear"])).toBe(true);
    expect(isPartHidden("gear", false, ["gear"])).toBe(true);
    expect(isPartHidden("gear", false, ["shaft"])).toBe(false);
    expect(isPartHidden("gear", undefined, undefined)).toBe(false);
  });

  it("mergeHiddenNames dedupes so 'show all' clears both sources", () => {
    expect(mergeHiddenNames(["gear"], ["gear", "shaft"])).toEqual(["gear", "shaft"]);
    expect(mergeHiddenNames([], undefined)).toEqual([]);
    expect(mergeHiddenNames(["a"], [])).toEqual(["a"]);
  });
});
