import { describe, expect, it } from "vitest";
import { calculateMeasure, formatMeasureText } from "./measureTool";

describe("measureTool", () => {
  it("正确计算空间对角两点距离与分量", () => {
    const res = calculateMeasure([0, 0, 0], [3, 4, 12]);
    expect(res.distance).toBeCloseTo(13, 4);
    expect(res.dx).toBeCloseTo(3, 4);
    expect(res.dy).toBeCloseTo(4, 4);
    expect(res.dz).toBeCloseTo(12, 4);
  });

  it("格式化输出工程测量标注文案", () => {
    const res = calculateMeasure([10, 20, 30], [20, 20, 30]);
    const text = formatMeasureText(res);
    expect(text).toContain("L: 10.00mm");
    expect(text).toContain("ΔX: 10.00");
    expect(text).toContain("ΔY: 0.00");
    expect(text).toContain("ΔZ: 0.00");
  });

  it("格式化 BRep 圆柱直径测量", () => {
    const res = { ...calculateMeasure([-5, 0, 0], [5, 0, 0]), metric: "diameter" as const };
    const text = formatMeasureText(res);
    expect(text).toContain("Ø: 10.00mm");
    expect(text).not.toContain("L:");
  });

  it("格式化 BRep 轴距与面距测量", () => {
    const axis = { ...calculateMeasure([0, 0, 0], [20, 0, 0]), metric: "axis_to_axis" as const };
    expect(formatMeasureText(axis)).toContain("A: 20.00mm");

    const face = { ...calculateMeasure([0, 0, 0], [0, 0, 5]), metric: "face_to_face" as const };
    expect(formatMeasureText(face)).toContain("F: 5.00mm");
    expect(formatMeasureText(face)).not.toContain("L:");
  });
});
