/**
 * v0.19 工程 CAD 视口材质表。
 *
 * 与内核 `mech_kernel/materials.py` 的 MATERIALS 基色对齐（权威来源在内核）；
 * 前端只做展示，用非金属哑光着色（metalness=0）——这是 CAD 视口的惯例：
 * 分材质区分零件，但不做写实金属反射，保持工程图的均匀可读性。
 *
 * 键名与内核 resolve_material() 的返回值一致；后端归档时会把 material 与
 * material_color 写进 manifest，前端优先用后端的解析结果，本地表仅作回退。
 */
export type CadMaterial = {
  color: number;
  roughness: number;
  metalness: number;
};

// 基色取内核 materials.py 的 base（0..1）转 hex；roughness 按材质给人的
// 粗糙感设定（铸铁/橡胶粗糙，青铜/黄铜稍亮），metalness 统一 0。
export const MATERIAL_CAD: Record<string, CadMaterial> = {
  steel: { color: 0x8c9eb8, roughness: 0.42, metalness: 0.0 },
  cast_iron: { color: 0x787c82, roughness: 0.72, metalness: 0.0 },
  aluminum: { color: 0xb3bac2, roughness: 0.38, metalness: 0.0 },
  bronze: { color: 0xc28c40, roughness: 0.40, metalness: 0.0 },
  copper: { color: 0xb8734d, roughness: 0.40, metalness: 0.0 },
  brass: { color: 0xbd9e52, roughness: 0.38, metalness: 0.0 },
  titanium: { color: 0x8c8c94, roughness: 0.46, metalness: 0.0 },
  dark_steel: { color: 0x5c616b, roughness: 0.50, metalness: 0.0 },
  nylon: { color: 0xdbdbd1, roughness: 0.78, metalness: 0.0 },
  rubber: { color: 0x29292b, roughness: 0.92, metalness: 0.0 },
};

/** 未命中材质键时的中性 CAD 灰。 */
export const CAD_DEFAULT: CadMaterial = { color: 0x9aa7b6, roughness: 0.5, metalness: 0.0 };

/** 材质键 → CAD 材质；未知键回退中性灰。 */
export function resolveCadMaterial(key?: string | null): CadMaterial {
  if (key && MATERIAL_CAD[key]) {
    return MATERIAL_CAD[key];
  }
  return CAD_DEFAULT;
}

/**
 * 内核 material_color（0..1 浮点）→ three 用的 hex。
 * 后端 manifest 里的 material_color 是权威色；无效值回退到材质表/中性灰。
 */
export function colorFromRgb(rgb?: number[] | null, fallbackKey?: string | null): number {
  if (Array.isArray(rgb) && rgb.length >= 3 && rgb.every((v) => Number.isFinite(v))) {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return (clamp(rgb[0]) << 16) | (clamp(rgb[1]) << 8) | clamp(rgb[2]);
  }
  return resolveCadMaterial(fallbackKey).color;
}

/** 按零件名关键词推断材质（与内核 _NAME_HINTS 同序，仅在前端缺后端字段时用）。 */
export function resolveCadMaterialFromName(name: string): string {
  const low = String(name || "").toLowerCase();
  const hints: [string[], string][] = [
    [["箱体", "箱盖", "壳", "盖", "housing", "case", "cover"], "cast_iron"],
    [["拨叉", "fork"], "bronze"],
    [["同步器", "接合套", "synchron"], "dark_steel"],
    [["轴承", "bearing", "铜", "bronze", "衬套", "bush"], "bronze"],
    [["齿轮", "gear", "惰轮", "idler", "轴", "shaft", "花键", "spline"], "steel"],
  ];
  for (const [keys, mat] of hints) {
    if (keys.some((k) => low.includes(k))) {
      return mat;
    }
  }
  return "steel";
}
