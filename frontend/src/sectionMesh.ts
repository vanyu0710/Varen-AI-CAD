import * as THREE from "three";

/**
 * 专业 CAD 剖切显示配置与结果
 */
export type SectionCapResult = {
  /** 截面真实三角面（填实实体区域，不填孔洞） */
  geometry: THREE.BufferGeometry;
  /** 截面闭合轮廓边界线（工程粗实线） */
  lineGeometry: THREE.BufferGeometry;
  /** 专业 CAD 45°/135° 剖面斜剖线（Hatch 纹理线） */
  hatchGeometry: THREE.BufferGeometry | null;
  /** 闭合截面环数量（外环与孔洞都计入） */
  loopCount: number;
  /** 截面实体净面积（扣除孔洞），单位同模型空间（mm²） */
  area: number;
};

export type SectionHatchOptions = {
  /** 剖面线倾角（度），默认 45°；装配中相邻零件可传 135° 或 -45° 错开 */
  angleDeg?: number;
  /** 剖面线间距（mm），默认自适应或固定 2~4mm */
  spacing?: number;
};

type Point3 = THREE.Vector3;
type Segment = [number, number];
type Loop = number[];

type ProjectedLoop = {
  indices: number[];
  points: THREE.Vector2[];
  area: number;
  parent: number;
  depth: number;
};

const DIST_EPS = 1e-6;
const POINT_EPS = 1e-5;
const AREA_EPS = 1e-10;

function pointKey(point: Point3): string {
  return `${Math.round(point.x / POINT_EPS)},${Math.round(point.y / POINT_EPS)},${Math.round(point.z / POINT_EPS)}`;
}

function segmentKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function traceLoops(pointCount: number, segments: Segment[]): Loop[] {
  const adjacency: number[][] = Array.from({ length: pointCount }, () => []);
  const unused = new Set<string>();
  for (const [a, b] of segments) {
    adjacency[a].push(b);
    adjacency[b].push(a);
    unused.add(segmentKey(a, b));
  }

  const loops: Loop[] = [];
  for (const [start, first] of segments) {
    const initialKey = segmentKey(start, first);
    if (!unused.has(initialKey)) {
      continue;
    }
    const loop: number[] = [start];
    let previous = start;
    let current = first;
    unused.delete(initialKey);
    let closed = false;

    for (let guard = 0; guard <= segments.length + 2; guard += 1) {
      loop.push(current);
      if (current === start) {
        closed = true;
        break;
      }
      const next = adjacency[current].find((candidate) =>
        unused.has(segmentKey(current, candidate)) && candidate !== previous,
      );
      if (next === undefined) {
        break;
      }
      unused.delete(segmentKey(current, next));
      previous = current;
      current = next;
    }

    if (closed) {
      loop.pop(); // 起点首尾重复，弹出尾部
      const unique = new Set(loop);
      if (loop.length >= 3 && unique.size >= 3) {
        loops.push(loop);
      }
    }
  }
  return loops;
}

function makePlaneBasis(plane: THREE.Plane): { origin: Point3; u: Point3; v: Point3; normal: Point3 } {
  const normal = plane.normal.clone().normalize();
  const reference = Math.abs(normal.z) < 0.9
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const u = reference.clone().cross(normal).normalize();
  const v = normal.clone().cross(u).normalize();
  const origin = normal.clone().multiplyScalar(-plane.constant);
  return { origin, u, v, normal };
}

/**
 * 产生专业工程 CAD 的 45°/135° 截面剖面线（Hatch）。
 * 算法：在二维截面局部坐标系中，按角度旋转后用等间距平行线与所有轮廓边求交，
 * 产生交点对并按深度/奇偶裁切，只保留实体内部的线段。
 */
function generateHatchLines(
  projectedLoops: ProjectedLoop[],
  options?: SectionHatchOptions,
): [THREE.Vector2, THREE.Vector2][] {
  if (projectedLoops.length === 0) {
    return [];
  }

  const angleDeg = options?.angleDeg ?? 45;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // 旋转到剖面线对齐坐标系 (s, t)，其中 s 沿剖面线方向，t 垂直于剖面线
  // 变换: s = x * cos + y * sin, t = -x * sin + y * cos
  let minT = Infinity;
  let maxT = -Infinity;
  const transformedLoops = projectedLoops.map((loop) => {
    const pts = loop.points.map((p) => {
      const s = p.x * cosA + p.y * sinA;
      const t = -p.x * sinA + p.y * cosA;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
      return { s, t, orig: p };
    });
    return { pts, isOuter: loop.depth % 2 === 0 };
  });

  const rangeT = maxT - minT;
  if (rangeT <= 1e-4) {
    return [];
  }

  // 自适应步长：若未传 spacing，按截面跨度 30~50 根线自动计算，上限不超过 10mm，下限不小于 1.2mm
  const spacing = options?.spacing ?? Math.min(8.0, Math.max(1.5, rangeT / 35));

  const hatchSegments: [THREE.Vector2, THREE.Vector2][] = [];

  // 从 minT + spacing 到 maxT 依次扫描
  const startT = Math.ceil(minT / spacing) * spacing;
  for (let t = startT; t <= maxT; t += spacing) {
    // 找出所有边与扫描线 t 的交点 (s 值)
    const intersections: number[] = [];

    for (const { pts } of transformedLoops) {
      for (let i = 0; i < pts.length; i += 1) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];

        if ((p1.t <= t && p2.t > t) || (p2.t <= t && p1.t > t)) {
          const ratio = (t - p1.t) / (p2.t - p1.t);
          const s = p1.s + ratio * (p2.s - p1.s);
          intersections.push(s);
        }
      }
    }

    intersections.sort((a, b) => a - b);

    // 成对连接奇偶交点，中点需落在实体内部 (pointInPolygon 校验)
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const s1 = intersections[i];
      const s2 = intersections[i + 1];
      if (s2 - s1 < 1e-4) {
        continue;
      }

      // 转回 2D 剖面基底坐标系 (x, y)
      // x = s * cos - t * sin, y = s * sin + t * cos
      const midS = (s1 + s2) / 2;
      const mid2D = new THREE.Vector2(
        midS * cosA - t * sinA,
        midS * sinA + t * cosA,
      );

      // 验证中点是否在某个 outer loop 内且不在该 outer 的任意直接孔内
      let insideSolid = false;
      for (let lIdx = 0; lIdx < projectedLoops.length; lIdx += 1) {
        const loop = projectedLoops[lIdx];
        if (loop.depth % 2 === 0) {
          if (pointInPolygon(mid2D, loop.points)) {
            // 检查是否落入其子洞中
            const inHole = projectedLoops.some(
              (h) => h.parent === lIdx && pointInPolygon(mid2D, h.points),
            );
            if (!inHole) {
              insideSolid = true;
              break;
            }
          }
        }
      }

      if (insideSolid) {
        const pt1 = new THREE.Vector2(s1 * cosA - t * sinA, s1 * sinA + t * cosA);
        const pt2 = new THREE.Vector2(s2 * cosA - t * sinA, s2 * sinA + t * cosA);
        hatchSegments.push([pt1, pt2]);
      }
    }
  }

  return hatchSegments;
}

/**
 * 从三角网格与剖切平面的交线建立真实截面面、外轮廓与专业 CAD 剖面线。
 */
export function buildSectionCapGeometry(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  matrixWorld: THREE.Matrix4 = new THREE.Matrix4(),
  hatchOptions?: SectionHatchOptions,
): SectionCapResult | null {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) {
    return null;
  }

  const worldPoints: Point3[] = [];
  const pointIds = new Map<string, number>();
  const segments: Segment[] = [];
  const segmentIds = new Set<string>();
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;

  const getVertex = (vertexIndex: number): Point3 => {
    const point = new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(matrixWorld);
    return point;
  };
  const getPointId = (point: Point3): number => {
    const key = pointKey(point);
    const existing = pointIds.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = worldPoints.length;
    worldPoints.push(point.clone());
    pointIds.set(key, id);
    return id;
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const readIndex = (corner: number) => index
      ? index.getX(triangle * 3 + corner)
      : triangle * 3 + corner;
    const vertices = [getVertex(readIndex(0)), getVertex(readIndex(1)), getVertex(readIndex(2))];
    const distances = vertices.map((point) => plane.distanceToPoint(point));
    const intersections: Point3[] = [];

    for (let edge = 0; edge < 3; edge += 1) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % 3];
      const da = distances[edge];
      const db = distances[(edge + 1) % 3];
      if (Math.abs(da) <= DIST_EPS) {
        intersections.push(a);
      }
      if ((da < -DIST_EPS && db > DIST_EPS) || (da > DIST_EPS && db < -DIST_EPS)) {
        const t = da / (da - db);
        intersections.push(a.clone().lerp(b, t));
      }
    }

    const unique = new Map<string, Point3>();
    intersections.forEach((point) => unique.set(pointKey(point), point));
    const points = [...unique.values()];
    if (points.length < 2) {
      continue;
    }
    let first = points[0];
    let second = points[1];
    let longest = first.distanceToSquared(second);
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const length = points[a].distanceToSquared(points[b]);
        if (length > longest) {
          longest = length;
          first = points[a];
          second = points[b];
        }
      }
    }
    if (longest <= POINT_EPS * POINT_EPS) {
      continue;
    }
    const firstId = getPointId(first);
    const secondId = getPointId(second);
    const key = segmentKey(firstId, secondId);
    if (!segmentIds.has(key)) {
      segmentIds.add(key);
      segments.push([firstId, secondId]);
    }
  }

  if (segments.length === 0) {
    return null;
  }

  const loops = traceLoops(worldPoints.length, segments);
  if (loops.length === 0) {
    return null;
  }

  const { origin, u, v } = makePlaneBasis(plane);
  const projected: ProjectedLoop[] = loops.map((indices) => {
    const points = indices.map((idx) => {
      const relative = worldPoints[idx].clone().sub(origin);
      return new THREE.Vector2(relative.dot(u), relative.dot(v));
    });
    return { indices, points, area: signedArea(points), parent: -1, depth: 0 };
  }).filter((loop) => Math.abs(loop.area) > AREA_EPS);

  if (projected.length === 0) {
    return null;
  }

  projected.forEach((loop, i) => {
    let parent = -1;
    let parentArea = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < projected.length; candidate += 1) {
      if (candidate === i) continue;
      const candidateArea = Math.abs(projected[candidate].area);
      if (candidateArea > Math.abs(loop.area) && candidateArea < parentArea
          && pointInPolygon(loop.points[0], projected[candidate].points)) {
        parent = candidate;
        parentArea = candidateArea;
      }
    }
    loop.parent = parent;
  });
  projected.forEach((loop) => {
    let depth = 0;
    let parent = loop.parent;
    while (parent >= 0) {
      depth += 1;
      parent = projected[parent].parent;
    }
    loop.depth = depth;
  });

  const capPositions: number[] = [];
  const linePositions: number[] = [];
  let area = 0;
  const toWorld = (point: THREE.Vector2): Point3 => origin.clone()
    .addScaledVector(u, point.x)
    .addScaledVector(v, point.y);
  const appendTriangle = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => {
    const pa = toWorld(a);
    const pb = toWorld(b);
    const pc = toWorld(c);
    capPositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z);
    area += Math.abs(pb.clone().sub(pa).cross(pc.clone().sub(pa)).length()) / 2;
  };

  projected.forEach((outer, outerIndex) => {
    if (outer.depth % 2 !== 0) {
      return;
    }
    const holes = projected
      .filter((candidate) => candidate.parent === outerIndex && candidate.depth === outer.depth + 1)
      .map((candidate) => candidate.points);
    const triangles = THREE.ShapeUtils.triangulateShape(outer.points, holes);
    triangles.forEach(([a, b, c]) => {
      const allPoints = [outer.points, ...holes].flat();
      appendTriangle(allPoints[a], allPoints[b], allPoints[c]);
    });
  });

  if (capPositions.length === 0 || area <= AREA_EPS) {
    return null;
  }

  // 轮廓线（Outer + Holes）
  projected.forEach((loop) => {
    for (let i = 0; i < loop.points.length; i += 1) {
      const a = toWorld(loop.points[i]);
      const b = toWorld(loop.points[(i + 1) % loop.points.length]);
      linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });

  // 专业 CAD Hatch 剖面线
  const hatchSegs = generateHatchLines(projected, hatchOptions);
  let hatchGeometry: THREE.BufferGeometry | null = null;
  if (hatchSegs.length > 0) {
    const hatchPositions: number[] = [];
    hatchSegs.forEach(([ptA, ptB]) => {
      const wA = toWorld(ptA);
      const wB = toWorld(ptB);
      hatchPositions.push(wA.x, wA.y, wA.z, wB.x, wB.y, wB.z);
    });
    hatchGeometry = new THREE.BufferGeometry();
    hatchGeometry.setAttribute("position", new THREE.Float32BufferAttribute(hatchPositions, 3));
    hatchGeometry.computeBoundingSphere();
  }

  const capGeometry = new THREE.BufferGeometry();
  capGeometry.setAttribute("position", new THREE.Float32BufferAttribute(capPositions, 3));
  capGeometry.computeVertexNormals();
  capGeometry.computeBoundingSphere();

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeometry.computeBoundingSphere();

  return {
    geometry: capGeometry,
    lineGeometry,
    hatchGeometry,
    loopCount: projected.length,
    area,
  };
}
