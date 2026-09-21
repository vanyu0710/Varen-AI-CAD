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
  userData?: { partName?: unknown; isEdgeHelper?: unknown; isStencilHelper?: unknown };
};

/**
 * 从射线命中（按距离排序）中取第一个"零件主体网格"的名字。
 * 跳过棱线、模板缓冲辅助网格与隐藏件——three 的 Raycaster 不看 `visible`，
 * 命中里包含隐藏件与辅助网格，必须在这里剔除。
 */
export function pickPartName(hits: PickCandidate[]): string | null {
  for (const hit of hits) {
    if (!hit || hit.isMesh !== true || hit.visible === false) {
      continue;
    }
    if (hit.userData?.isEdgeHelper || hit.userData?.isStencilHelper) {
      continue;
    }
    const name = hit.userData?.partName;
    if (typeof name === "string" && name) {
      return name;
    }
  }
  return null;
}

/**
 * 零件是否隐藏。隐藏状态有两份来源：视口右键菜单（本地）与上层装配面板
 * （`hidden` 属性）。取并集才不会出现「面板里勾回来、视口里还是不见」。
 */
export function isPartHidden(
  name: string,
  localHidden: boolean | undefined,
  hiddenNames: string[] | undefined,
): boolean {
  return Boolean(localHidden) || (hiddenNames || []).includes(name);
}

/** 两份隐藏状态的去重并集，用于计数与「全部显示」的清理目标。 */
export function mergeHiddenNames(local: string[], remote: string[] | undefined): string[] {
  return Array.from(new Set([...local, ...(remote || [])]));
}
