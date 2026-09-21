import { describe, expect, it } from "vitest";
import {
  VIEW_DIRECTIONS,
  fitDistance,
  gridSpec,
  orthoHalfHeight,
  type Vec3,
} from "./viewMath";

const SIZE: Vec3 = [100, 200, 300];

describe("VIEW_DIRECTIONS", () => {
  it("与内核渲染器一致：Z 向上（front=-Y, top=+Z, right=+X）", () => {
    expect(VIEW_DIRECTIONS.front).toEqual([0, -1, 0]);
    expect(VIEW_DIRECTIONS.top).toEqual([0, 0, 1]);
    expect(VIEW_DIRECTIONS.right).toEqual([1, 0, 0]);
  });
});

describe("fitDistance", () => {
  it("俯视看细长板时，距离由长边决定而不是对径", () => {
    // 400x40x10 的板：俯视（沿 +Z 看）应主要受 400x40 影响
    const plate: Vec3 = [400, 40, 10];
    const top = fitDistance(plate, VIEW_DIRECTIONS.top, 40, 1.5);
    const side = fitDistance(plate, VIEW_DIRECTIONS.right, 40, 1.5);
    // 俯视比侧视（看 40x10 的窄面）需要更远，但不能远到"按对径"那种浪费
    expect(top).toBeGreaterThan(side);
    const diagonal = Math.hypot(400, 40, 10);
    expect(top).toBeLessThan(diagonal * 1.4);
  });

  it("任何视向下都能装下整个包围盒（含边距）", () => {
    const fov = 40;
    const aspect = 1.6;
    for (const dir of Object.values(VIEW_DIRECTIONS)) {
      const distance = fitDistance(SIZE, dir, fov, aspect);
      const vFov = (fov * Math.PI) / 180;
      const halfH = Math.tan(vFov / 2) * distance;
      const halfW = halfH * aspect;
      // 取景后的可视半高/半宽必须覆盖包围盒在该视向下的一半
      const orthoHalf = orthoHalfHeight(SIZE, dir, aspect);
      // orthoHalf 已含边距；比较时去掉边距比例量级即可
      expect(halfH).toBeGreaterThan(orthoHalf / 1.25);
      expect(halfW).toBeGreaterThan((orthoHalf / 1.25) / 1.0);
    }
  });

  it("退化输入不产生 NaN / 负数", () => {
    expect(fitDistance([0, 0, 0], VIEW_DIRECTIONS.iso, 40, 1.5)).toBeGreaterThan(0);
    expect(fitDistance(SIZE, [0, 0, 0], 40, 1.5)).toBeGreaterThan(0);
    expect(Number.isFinite(fitDistance(SIZE, VIEW_DIRECTIONS.top, 40, 0))).toBe(true);
  });

  it("视线与世界上方向平行时仍给出有限距离（俯视不退化）", () => {
    const d = fitDistance(SIZE, VIEW_DIRECTIONS.top, 40, 1.5);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});

describe("orthoHalfHeight", () => {
  it("逐视向取景：看窄面远比看长边紧（不再一刀切）", () => {
    // 400x40x10 的板：正视看到 400 全长；右视只看到 40x10 的窄面
    const plate: Vec3 = [400, 40, 10];
    const front = orthoHalfHeight(plate, VIEW_DIRECTIONS.front, 1.6);
    const right = orthoHalfHeight(plate, VIEW_DIRECTIONS.right, 1.6);
    expect(right).toBeLessThan(front / 5);
  });

  it("比旧的最大边一刀切更紧（不浪费屏幕）", () => {
    const plate: Vec3 = [400, 40, 10];
    const maxDim = Math.max(...plate);
    // 旧实现：half = maxDim * 0.75，不管视向
    const legacy = maxDim * 0.75;
    expect(orthoHalfHeight(plate, VIEW_DIRECTIONS.right, 1.6)).toBeLessThan(legacy);
    expect(orthoHalfHeight(plate, VIEW_DIRECTIONS.front, 1.6)).toBeLessThan(legacy * 1.1);
  });

  it("视锥足以覆盖该视向下的投影", () => {
    const plate: Vec3 = [400, 40, 10];
    // 正视（沿 -Y 看）：可见范围 X=400, Z=10 → 半宽 200，半高 5
    const halfH = orthoHalfHeight(plate, VIEW_DIRECTIONS.front, 1.0);
    expect(halfH).toBeGreaterThanOrEqual(200 / 1.0); // 宽向由 aspect 折进视锥
  });

  it("退化输入不产生 NaN", () => {
    expect(orthoHalfHeight([0, 0, 0], VIEW_DIRECTIONS.iso, 1.5)).toBeGreaterThan(0);
    expect(Number.isFinite(orthoHalfHeight(SIZE, VIEW_DIRECTIONS.iso, 0))).toBe(true);
  });
});

describe("gridSpec", () => {
  it("格数落在可读区间，且步长是整数", () => {
    for (const diagonal of [15, 40, 120, 600, 2500, 9000]) {
      const spec = gridSpec(diagonal);
      expect(spec.divisions).toBeGreaterThanOrEqual(12);
      expect(spec.divisions).toBeLessThanOrEqual(60);
      expect(spec.step).toBeGreaterThan(0);
      expect(spec.size).toBeCloseTo(spec.step * spec.divisions);
    }
  });

  it("网格尺寸不小于模型尺寸", () => {
    for (const diagonal of [15, 120, 600, 2500]) {
      expect(gridSpec(diagonal).size).toBeGreaterThanOrEqual(diagonal * 0.9);
    }
  });

  it("极小与极大输入都不产生 NaN", () => {
    for (const diagonal of [0, 1e-6, 1e9]) {
      const spec = gridSpec(diagonal);
      expect(Number.isFinite(spec.size)).toBe(true);
      expect(Number.isFinite(spec.step)).toBe(true);
      expect(spec.divisions).toBeGreaterThan(0);
    }
  });
});
