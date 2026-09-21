/**
 * 剖切平面与封盖位姿的纯几何（与 three 解耦，便于单测）。
 *
 * 约定：three 的 `Plane` 保留 `normal·p + constant >= 0` 的一侧，因此这里的
 * `normal` 指向「保留侧」，`constant` 与该法线配套。`sectionFlip` 同时取反
 * 两者——这保持平面不变、只交换被切掉的一半。
 */

export type SectionAxis = "x" | "y" | "z";
export type Vec3 = [number, number, number];

export type SectionPlane = {
  /** 指向保留侧的单位法线。 */
  normal: Vec3;
  /** 平面常量：平面过点 `-constant * normal`。 */
  constant: number;
  /** 切面到模型中心沿法线的毫米距离（供 UI 读数）。 */
  offsetMm: number;
};

export type CapPlacement = {
  /** 封盖中心（已投影到平面上，保证覆盖整个截面）。 */
  position: Vec3;
  /** 由 +Z 旋转到法线的轴角。 */
  axis: Vec3;
  angleDeg: number;
  /** 封盖边长（已按模型包围盒放大到足以盖住任意截面）。 */
  extent: number;
};

/** 各轴的默认切向（与内核 renderer.py 的 front/top/side 一致：Z 轴向上）。 */
const AXIS_NORMAL: Record<SectionAxis, Vec3> = {
  x: [-1, 0, 0],
  y: [0, -1, 0],
  z: [0, 0, -1],
};

const axisValue = (v: Vec3, axis: SectionAxis): number =>
  axis === "x" ? v[0] : axis === "y" ? v[1] : v[2];

/**
 * 由轴 + 归一化偏移（-1..1，相对半尺寸）构造剖切平面。
 * `offset = 0` 即过模型中心。
 */
export function sectionPlane(
  axis: SectionAxis,
  offset: number,
  flip: boolean,
  center: Vec3,
  size: Vec3,
): SectionPlane {
  const base = axisValue(center, axis);
  const halfExtent = Math.max(1e-6, axisValue(size, axis) / 2);
  const cut = base + offset * halfExtent;
  const source = AXIS_NORMAL[axis];
  const normal: Vec3 = flip ? [-source[0], -source[1], -source[2]] : [...source];
  // 平面过点 cut*axis，即 constant 使 normal·p + constant = 0 在 p = cut*axis 成立。
  // normal 在该轴上的分量恒为 ∓1，故 constant 的量值就是 cut。
  const constant = flip ? -cut : cut;
  return { normal, constant, offsetMm: offset * halfExtent };
}

/**
 * 封盖位姿：把一块单位正方形放到平面上，覆盖整个模型截面。
 *
 * 中心取「模型中心在平面上的投影」而非原点——这样无论剖面滑到哪一端，
 * 封盖都居中压在模型上，不会露边。
 */
export function capPlacement(plane: SectionPlane, center: Vec3, size: Vec3): CapPlacement {
  const [nx, ny, nz] = plane.normal;
  const signedDistance = nx * center[0] + ny * center[1] + nz * center[2] + plane.constant;
  const position: Vec3 = [
    center[0] - nx * signedDistance,
    center[1] - ny * signedDistance,
    center[2] - nz * signedDistance,
  ];
  const diagonal = Math.hypot(size[0], size[1], size[2]);
  // 截面是模型在平面上的投影，其对径不超过包围盒对径；乘以 1.5 留边角余量。
  const extent = Math.max(1, diagonal * 1.5);
  // 单位正方形法线为 +Z，旋转到目标法线。
  const dot = nz;
  if (dot > 1 - 1e-9) {
    return { position, axis: [0, 1, 0], angleDeg: 0, extent };
  }
  if (dot < -1 + 1e-9) {
    return { position, axis: [1, 0, 0], angleDeg: 180, extent };
  }
  return { position, axis: [-ny, nx, 0], angleDeg: (Math.acos(dot) * 180) / Math.PI, extent };
}

