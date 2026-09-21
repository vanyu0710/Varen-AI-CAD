export type Point3D = [number, number, number];

export type MeasureMetric =
  | "distance"
  | "minimum_distance"
  | "diameter"
  | "axis_to_axis"
  | "face_to_face";

export type MeasureResult = {
  metric?: MeasureMetric;
  p1: Point3D;
  p2: Point3D;
  distance: number;
  dx: number;
  dy: number;
  dz: number;
};

/**
 * 计算三维空间两点之间的欧氏距离与三个坐标轴分量投影（mm）
 */
export function calculateMeasure(p1: Point3D, p2: Point3D): MeasureResult {
  const dx = Math.abs(p2[0] - p1[0]);
  const dy = Math.abs(p2[1] - p1[1]);
  const dz = Math.abs(p2[2] - p1[2]);
  const distance = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
  return {
    metric: "distance",
    p1,
    p2,
    distance,
    dx,
    dy,
    dz,
  };
}

/**
 * 格式化工程测量文本
 */
export function formatMeasureText(measure: MeasureResult): string {
  const d = measure.distance.toFixed(2);
  const label =
    measure.metric === "diameter"
      ? "Ø"
      : measure.metric === "axis_to_axis"
        ? "A"
        : measure.metric === "face_to_face"
          ? "F"
          : "L";
  const dx = measure.dx.toFixed(2);
  const dy = measure.dy.toFixed(2);
  const dz = measure.dz.toFixed(2);
  return `${label}: ${d}mm (ΔX: ${dx}, ΔY: ${dy}, ΔZ: ${dz})`;
}
