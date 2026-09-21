import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildSectionCapGeometry } from "./sectionMesh";

const cutAtZ = (z: number) => new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);

function dispose(result: ReturnType<typeof buildSectionCapGeometry>) {
  result?.geometry.dispose();
  result?.lineGeometry.dispose();
  result?.hatchGeometry?.dispose();
}

describe("buildSectionCapGeometry", () => {
  it("为实体盒生成真实矩形截面，并且生成 45° 专业 CAD 剖面线 (Hatch)", () => {
    const geometry = new THREE.BoxGeometry(20, 20, 10);
    const result = buildSectionCapGeometry(geometry, cutAtZ(0), new THREE.Matrix4(), {
      angleDeg: 45,
      spacing: 2,
    });

    expect(result).not.toBeNull();
    expect(result?.loopCount).toBe(1);
    expect(result?.area).toBeCloseTo(400, 1);
    expect(result?.lineGeometry.getAttribute("position").count).toBeGreaterThanOrEqual(8);

    // 验证剖面斜线生成
    expect(result?.hatchGeometry).not.toBeNull();
    const hatchCount = result?.hatchGeometry?.getAttribute("position").count ?? 0;
    expect(hatchCount).toBeGreaterThan(0);

    dispose(result);
    geometry.dispose();
  });

  it("保留空心件的内孔：外环与孔洞都生成，且剖面线不穿过孔洞内部", () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 20, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 10, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 10,
      bevelEnabled: false,
      curveSegments: 32,
    });
    geometry.translate(0, 0, -5);

    const result = buildSectionCapGeometry(geometry, cutAtZ(0), new THREE.Matrix4(), {
      angleDeg: 45,
      spacing: 2,
    });
    expect(result).not.toBeNull();
    expect(result?.loopCount).toBe(2);
    // 外圆面积 400π - 内孔 100π = 300π ≈ 942.47
    // 32分段离散多边形多边面积略小于理论极限 (940.9 vs 942.48)
    expect(Math.abs((result?.area ?? 0) - Math.PI * 300)).toBeLessThan(5);

    // 验证剖面线存在
    expect(result?.hatchGeometry).not.toBeNull();
    const hatchPos = result?.hatchGeometry?.getAttribute("position");
    expect(hatchPos?.count).toBeGreaterThan(0);

    // 检查是否有任何 hatch 线段的中点落在内孔内 (半径 < 9.9)
    if (hatchPos) {
      for (let i = 0; i < hatchPos.count; i += 2) {
        const x1 = hatchPos.getX(i);
        const y1 = hatchPos.getY(i);
        const x2 = hatchPos.getX(i + 1);
        const y2 = hatchPos.getY(i + 1);
        const midR = Math.hypot((x1 + x2) / 2, (y1 + y2) / 2);
        // 不应落入内孔 (半径 10 以内)
        expect(midR).toBeGreaterThanOrEqual(9.5);
      }
    }

    dispose(result);
    geometry.dispose();
  });

  it("支持 indexed 与 non-indexed 网格，并在无交集时返回 null", () => {
    const indexed = new THREE.BoxGeometry(2, 2, 2);
    const nonIndexed = indexed.toNonIndexed();
    const hit = buildSectionCapGeometry(nonIndexed, cutAtZ(0));
    const miss = buildSectionCapGeometry(indexed, cutAtZ(5));

    expect(hit).not.toBeNull();
    expect(miss).toBeNull();

    dispose(hit);
    indexed.dispose();
    nonIndexed.dispose();
  });

  it("应用装配的世界变换后仍在世界剖切面得到正确面积", () => {
    const geometry = new THREE.BoxGeometry(2, 4, 2);
    const transform = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    transform.setPosition(10, 20, 0);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const result = buildSectionCapGeometry(geometry, plane, transform);

    expect(result).not.toBeNull();
    expect(result?.area).toBeCloseTo(8, 4);

    dispose(result);
    geometry.dispose();
  });
});
