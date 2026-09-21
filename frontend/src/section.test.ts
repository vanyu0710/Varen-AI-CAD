import { describe, expect, it } from "vitest";
import { capPlacement, sectionPlane, type Vec3 } from "./section";

/** 把点代入 three 的平面保留判据 normal·p + constant >= 0。 */
function kept(plane: { normal: Vec3; constant: number }, point: Vec3): boolean {
  return (
    plane.normal[0] * point[0] +
      plane.normal[1] * point[1] +
      plane.normal[2] * point[2] +
      plane.constant >=
    0
  );
}

const CENTER: Vec3 = [10, 20, 30];
const SIZE: Vec3 = [100, 200, 300];

describe("sectionPlane", () => {
  it("offset=0 时平面过模型中心", () => {
    const plane = sectionPlane("y", 0, false, CENTER, SIZE);
    expect(plane.normal).toEqual([0, -1, 0]);
    // 平面过点 -constant*normal = (0, 20, 0)
    expect(-plane.constant * plane.normal[1]).toBeCloseTo(20);
  });

  it("offset 按该轴的半尺寸缩放", () => {
    const plane = sectionPlane("y", 1, false, CENTER, SIZE);
    // 半尺寸 = 200/2 = 100 → 切面在 y = 20 + 100 = 120
    expect(-plane.constant * plane.normal[1]).toBeCloseTo(120);
    expect(plane.offsetMm).toBeCloseTo(100);
  });

  it("flip 同时取反法线与常量：平面不变、保留侧交换", () => {
    const plain = sectionPlane("z", 0.5, false, CENTER, SIZE);
    const flipped = sectionPlane("z", 0.5, true, CENTER, SIZE);
    // 落在平面上的点，两种声明都判定为「在平面上」
    const onPlane: Vec3 = [0, 0, -flipped.constant * flipped.normal[2]];
    expect(kept(plain, onPlane)).toBe(true);
    expect(kept(flipped, onPlane)).toBe(true);
    // 沿保留侧走一步：false 保留 -z 方向、true 保留 +z 方向
    const towardNegZ: Vec3 = [0, 0, onPlane[2] - 10];
    expect(kept(plain, towardNegZ)).toBe(true);
    expect(kept(flipped, towardNegZ)).toBe(false);
  });

  it("三个轴的默认法线与内核 Z-up 约定一致", () => {
    expect(sectionPlane("x", 0, false, CENTER, SIZE).normal).toEqual([-1, 0, 0]);
    expect(sectionPlane("y", 0, false, CENTER, SIZE).normal).toEqual([0, -1, 0]);
    expect(sectionPlane("z", 0, false, CENTER, SIZE).normal).toEqual([0, 0, -1]);
  });

  it("尺寸为 0 的退化包围盒不产生 NaN", () => {
    const plane = sectionPlane("y", 0.5, false, [0, 0, 0], [0, 0, 0]);
    expect(Number.isFinite(plane.constant)).toBe(true);
    expect(Number.isFinite(plane.offsetMm)).toBe(true);
  });
});

describe("capPlacement", () => {
  it("封盖中心落在平面上", () => {
    const plane = sectionPlane("y", 0.5, false, CENTER, SIZE);
    const cap = capPlacement(plane, CENTER, SIZE);
    const residual =
      plane.normal[0] * cap.position[0] +
      plane.normal[1] * cap.position[1] +
      plane.normal[2] * cap.position[2] +
      plane.constant;
    expect(residual).toBeCloseTo(0);
  });

  it("封盖中心是模型中心在平面上的投影（不沿法线平移）", () => {
    const plane = sectionPlane("x", 0, false, CENTER, SIZE);
    const cap = capPlacement(plane, CENTER, SIZE);
    // 法线为 -x：切面在 x=10，中心其余分量保持 20/30
    expect(cap.position[0]).toBeCloseTo(10);
    expect(cap.position[1]).toBeCloseTo(20);
    expect(cap.position[2]).toBeCloseTo(30);
  });

  it("封盖边长足以覆盖包围盒对径", () => {
    const plane = sectionPlane("y", 0, false, CENTER, SIZE);
    const cap = capPlacement(plane, CENTER, SIZE);
    const diagonal = Math.hypot(SIZE[0], SIZE[1], SIZE[2]);
    expect(cap.extent).toBeGreaterThanOrEqual(diagonal);
  });

  it("旋转轴角把 +Z 转到目标法线", () => {
    const cases: [Vec3, number][] = [
      [sectionPlane("y", 0, false, CENTER, SIZE).normal, 90],
      [sectionPlane("x", 0, false, CENTER, SIZE).normal, 90],
      [sectionPlane("z", 0, false, CENTER, SIZE).normal, 180],
    ];
    for (const [normal, expectedAngle] of cases) {
      const plane = { normal, constant: 0, offsetMm: 0 };
      const cap = capPlacement(plane, CENTER, SIZE);
      expect(cap.angleDeg).toBeCloseTo(expectedAngle, 4);
      // Rodrigues：v' = v cosθ + (k×v) sinθ + k (k·v)(1-cosθ)，v=(0,0,1)
      const [kx, ky, kz] = cap.axis;
      const len = Math.hypot(kx, ky, kz);
      expect(len).toBeGreaterThan(0.5); // 非退化
      const [ux, uy, uz] = [kx / len, ky / len, kz / len];
      const theta = (cap.angleDeg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      // k×v = (ky*1 - kz*0, kz*0 - kx*1, 0) = (uy, -ux, 0)
      const rotated: Vec3 = [
        uy * sin + ux * uz * (1 - cos),
        -ux * sin + uy * uz * (1 - cos),
        cos + uz * uz * (1 - cos),
      ];
      expect(rotated[0]).toBeCloseTo(normal[0], 4);
      expect(rotated[1]).toBeCloseTo(normal[1], 4);
      expect(rotated[2]).toBeCloseTo(normal[2], 4);
    }
  });

  it("法线平行 ±Z 时给出非退化轴（避免 setFromAxisAngle 抖动）", () => {
    const up = capPlacement({ normal: [0, 0, 1], constant: 0, offsetMm: 0 }, CENTER, SIZE);
    expect(up.angleDeg).toBeCloseTo(0);
    const down = capPlacement({ normal: [0, 0, -1], constant: 0, offsetMm: 0 }, CENTER, SIZE);
    expect(down.angleDeg).toBeCloseTo(180);
    expect(Math.hypot(...down.axis)).toBeGreaterThan(0.5);
  });
});
