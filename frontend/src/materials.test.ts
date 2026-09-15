import { describe, expect, it } from "vitest";
import {
  CAD_DEFAULT,
  MATERIAL_CAD,
  colorFromRgb,
  resolveCadMaterial,
  resolveCadMaterialFromName,
} from "./materials";

describe("materials.ts", () => {
  it("暴露全部内核材质键且均为非金属哑光", () => {
    const keys = Object.keys(MATERIAL_CAD).sort();
    expect(keys).toContain("cast_iron");
    expect(keys).toContain("steel");
    expect(keys).toContain("dark_steel");
    expect(keys).toContain("bronze");
    expect(keys.length).toBe(10);
    for (const mat of Object.values(MATERIAL_CAD)) {
      expect(mat.metalness).toBe(0);
      expect(mat.roughness).toBeGreaterThan(0);
      expect(mat.roughness).toBeLessThanOrEqual(1);
      expect(mat.color).toBeGreaterThanOrEqual(0);
      expect(mat.color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("按名推断与内核 _NAME_HINTS 同序（拨叉先于轴）", () => {
    expect(resolveCadMaterialFromName("箱体")).toBe("cast_iron");
    expect(resolveCadMaterialFromName("端盖")).toBe("cast_iron");
    expect(resolveCadMaterialFromName("拨叉轴_1")).toBe("bronze");
    expect(resolveCadMaterialFromName("同步器毂_1")).toBe("dark_steel");
    expect(resolveCadMaterialFromName("输入轴")).toBe("steel");
    expect(resolveCadMaterialFromName("从动齿轮_1挡_z42")).toBe("steel");
    expect(resolveCadMaterialFromName("神秘零件")).toBe("steel");
  });

  it("未知材质键回退中性灰", () => {
    expect(resolveCadMaterial("nope")).toEqual(CAD_DEFAULT);
    expect(resolveCadMaterial(null)).toEqual(CAD_DEFAULT);
    expect(resolveCadMaterial("bronze").color).toBe(MATERIAL_CAD.bronze.color);
  });

  it("material_color(0..1) 转 hex，非法值回退材质表", () => {
    // 纯红 1,0,0 -> 0xff0000
    expect(colorFromRgb([1, 0, 0])).toBe(0xff0000);
    // 内核 steel 基色 (0.55,0.62,0.72)
    expect(colorFromRgb([0.55, 0.62, 0.72])).toBe(
      (Math.round(0.55 * 255) << 16) | (Math.round(0.62 * 255) << 8) | Math.round(0.72 * 255),
    );
    expect(colorFromRgb(null, "bronze")).toBe(MATERIAL_CAD.bronze.color);
    expect(colorFromRgb([1, 2], "steel")).toBe(MATERIAL_CAD.steel.color);
    expect(colorFromRgb([NaN, 0, 0], "steel")).toBe(MATERIAL_CAD.steel.color);
    // 越界钳制
    expect(colorFromRgb([2, -1, 0.5])).toBe((255 << 16) | (0 << 8) | Math.round(0.5 * 255));
  });
});
