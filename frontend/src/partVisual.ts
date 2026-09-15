/**
 * 零件视觉状态纯逻辑（v0.21 SW 式右键透明度/隐藏）。
 * 与 three 解耦，便于单测。
 */

export type TransparencyLevel = "opaque" | "semi" | "ghost";

export const TRANSPARENCY_LEVELS: TransparencyLevel[] = ["opaque", "semi", "ghost"];

const BODY_OPACITY: Record<TransparencyLevel, number> = {
  opaque: 1,
  semi: 0.45,
  ghost: 0.15,
};

/** 主体网格不透明度（opaque=1；ghost 接近 X 光）。 */
export function bodyOpacity(level: TransparencyLevel | undefined): number {
  return BODY_OPACITY[level ?? "opaque"];
}

/** 特征棱线随透明度衰减：半透明件棱线略淡、透明件棱线仍可见。 */
export function edgeOpacity(level: TransparencyLevel | undefined, base: number): number {
  switch (level ?? "opaque") {
    case "semi":
      return base * 0.6;
    case "ghost":
      return base * 0.4;
    default:
      return base;
  }
}

/** 右键菜单定位：夹在容器内，靠近边缘时自动翻边。 */
export function clampMenuPos(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  containerWidth: number,
  containerHeight: number,
): { left: number; top: number } {
  const left = Math.max(4, Math.min(x, containerWidth - menuWidth - 4));
  const top = Math.max(4, Math.min(y, containerHeight - menuHeight - 4));
  return { left, top };
}

type PickCandidate = {
  isMesh?: boolean;
  visible?: boolean;
  userData?: { partName?: unknown; isEdgeHelper?: unknown };
};

/** 从射线命中（按距离排序）中取第一个"零件主体网格"的名字；跳过棱线与隐藏件。 */
export function pickPartName(hits: PickCandidate[]): string | null {
  for (const hit of hits) {
    if (!hit || hit.isMesh !== true || hit.visible === false) {
      continue;
    }
    if (hit.userData?.isEdgeHelper) {
      continue;
    }
    const name = hit.userData?.partName;
    if (typeof name === "string" && name) {
      return name;
    }
  }
  return null;
}
