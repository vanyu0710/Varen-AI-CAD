/**
 * 视口取景与相机数学（与 three 解耦，便于单测）。
 *
 * 坐标系约定：**Z 向上**。内核渲染器（`mech_kernel/renderer.py` 的
 * front/top/side）与后端 BOM 位姿都用 Z 作竖直轴，视口必须一致——否则
 * 「俯视」看到的不是俯视、轨道球绕错了轴。
 */

export type Vec3 = [number, number, number];
export type ViewDirection = "front" | "top" | "right" | "iso";

/** 各预设的视线方向（从目标指向相机），单位向量。与内核渲染器一致。 */
export const VIEW_DIRECTIONS: Record<ViewDirection, Vec3> = {
  front: [0, -1, 0],
  top: [0, 0, 1],
  right: [1, 0, 0],
  iso: [1, 1, 1],
};

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len < 1e-9 ? [1, 1, 1] : [v[0] / len, v[1] / len, v[2] / len];
};

/**
 * 沿给定视向看完整包围盒所需的相机距离。
 *
 * 关键在「逐视向」：用包围盒对径（旧实现的做法）会让细长轴在正视图里
 * 小得看不清，而在正视其短边时又可能溢出。这里把包围盒八个角投影到
 * 相机基底上取真实覆盖半径。
 */
export function fitDistance(
  size: Vec3,
  direction: Vec3,
  fovDeg: number,
  aspect: number,
  margin = 1.25,
): number {
  const dir = normalize(direction);
  // 相机基底：forward = -dir（看向目标），right/up 由世界 Z 向上推出
  const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const worldUp: Vec3 = [0, 0, 1];
  let right: Vec3 = [
    forward[1] * worldUp[2] - forward[2] * worldUp[1],
    forward[2] * worldUp[0] - forward[0] * worldUp[2],
    forward[0] * worldUp[1] - forward[1] * worldUp[0],
  ];
  // 视线与世界上方向平行（俯视/仰视）：Z 不能当 up，改用 +Y
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) {
    const fallbackUp: Vec3 = [0, 1, 0];
    right = [
      forward[1] * fallbackUp[2] - forward[2] * fallbackUp[1],
      forward[2] * fallbackUp[0] - forward[0] * fallbackUp[2],
      forward[0] * fallbackUp[1] - forward[1] * fallbackUp[0],
    ];
  }
  const r = normalize(right);
  const up: Vec3 = [
    r[1] * forward[2] - r[2] * forward[1],
    r[2] * forward[0] - r[0] * forward[2],
    r[0] * forward[1] - r[1] * forward[0],
  ];

  // 半尺寸：把八个角投到 right/up 上取最大绝对值
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  let halfW = 0;
  let halfH = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner: Vec3 = [half[0] * sx, half[1] * sy, half[2] * sz];
        halfW = Math.max(halfW, Math.abs(corner[0] * r[0] + corner[1] * r[1] + corner[2] * r[2]));
        halfH = Math.max(halfH, Math.abs(corner[0] * up[0] + corner[1] * up[1] + corner[2] * up[2]));
      }
    }
  }

  const vFov = (fovDeg * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.1, aspect));
  const distanceV = halfH / Math.tan(vFov / 2);
  const distanceH = halfW / Math.tan(horizontalFov / 2);
  const needed = Math.max(distanceV, distanceH, 1e-3);
  return needed * margin;
}

/**
 * 同一取景在正交相机下对应的视锥半高（世界单位）。
 * 正交投影没有「距离→缩放」的关系，必须显式给视锥大小。
 */
export function orthoHalfHeight(size: Vec3, direction: Vec3, aspect: number, margin = 1.25): number {
  const dir = normalize(direction);
  const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const worldUp: Vec3 = [0, 0, 1];
  let right: Vec3 = [
    forward[1] * worldUp[2] - forward[2] * worldUp[1],
    forward[2] * worldUp[0] - forward[0] * worldUp[2],
    forward[0] * worldUp[1] - forward[1] * worldUp[0],
  ];
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) {
    right = [1, 0, 0];
  }
  const r = normalize(right);
  const up: Vec3 = [
    r[1] * forward[2] - r[2] * forward[1],
    r[2] * forward[0] - r[0] * forward[2],
    r[0] * forward[1] - r[1] * forward[0],
  ];
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  let halfW = 0;
  let halfH = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner: Vec3 = [half[0] * sx, half[1] * sy, half[2] * sz];
        halfW = Math.max(halfW, Math.abs(corner[0] * r[0] + corner[1] * r[1] + corner[2] * r[2]));
        halfH = Math.max(halfH, Math.abs(corner[0] * up[0] + corner[1] * up[1] + corner[2] * up[2]));
      }
    }
  }
  const neededH = Math.max(halfH, halfW / Math.max(0.1, aspect));
  return Math.max(neededH * margin, 1e-3);
}

/**
 * 网格自适应步长：取 1/2/5×10ⁿ 中第一个使格数落在 [12, 60] 的值。
 * 固定 400mm/40 格对 500mm 的箱体太小、对 20mm 的小件太大，这里按模型定。
 */
export function gridSpec(diagonal: number): { size: number; divisions: number; step: number } {
  const target = Math.max(20, diagonal);
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  for (const step of candidates) {
    const divisions = Math.round(target / step);
    if (divisions >= 12 && divisions <= 60) {
      return { size: step * divisions, divisions, step };
    }
  }
  const step = 10000;
  const divisions = Math.max(12, Math.round(target / step));
  return { size: step * divisions, divisions, step };
}
