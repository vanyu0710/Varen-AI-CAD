import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useT } from "./i18n";
import { colorFromRgb, resolveCadMaterial, resolveCadMaterialFromName } from "./materials";

export type AssemblyModel = {
  name: string;
  url: string;
  position?: number[] | null;
  rotationDeg?: [number, number[]] | null;
  /** v0.19：材质键（内核推断，后端 manifest 写入）；缺失时按零件名回退。 */
  material?: string | null;
  /** v0.19：材质基色 [r,g,b]（0..1）；缺失时用材质表色。 */
  color?: number[] | null;
};

type Props = {
  objUrl?: string;
  stlUrl?: string;
  breadcrumb?: string;
  statusLabel?: string;
  // v0.14 F2a：装配预览——多零件按位姿叠加（提供 models 时优先于 stlUrl）
  models?: AssemblyModel[];
  hidden?: string[];
  selected?: string | null;
};

type ViewPreset = "iso" | "front" | "top" | "right" | "fit";
type ViewStatus =
  | "waiting"
  | "loading_obj"
  | "obj_loaded"
  | "obj_fallback"
  | "loading_stl"
  | "stl_loaded"
  | "load_failed";
type Projection = "ortho" | "perspective";
type Quality = "high" | "standard";

// v0.19 工程 CAD 视口常量
const BACKGROUND = 0x232d3a;        // 中性科技灰蓝（非纯黑，接近 CAD 视口）
const CAD_SKY = 0xeef3f8;           // 半球天光
const CAD_GROUND = 0x3a4552;        // 半球地光
const CAD_KEY = 0xffffff;           // 主光
const CAD_FILL = 0xa8ccea;          // 冷色补光（塑形）
const EDGE_COLOR = 0x0d1722;        // 深色特征棱线
const EDGE_OPACITY = 0.8;
const CREASE_ANGLE = THREE.MathUtils.degToRad(30);   // >30° 视为棱边，曲面平滑
const EDGE_THRESHOLD = 20;          // EdgesGeometry 二面角阈值（度）
const EDGE_MAX_VERTICES = 400000;   // 高画质棱线上限（超过跳过，防卡顿）
const EDGE_MAX_VERTICES_STD = 150000; // 标准画质上限
const SMOOTH_MAX_VERTICES = 800000;  // 高于此值不做 crease 平滑（退普通法线）
const DPR_MAX = 2;
const QUALITY_KEY = "mechcad_viewport_quality";

function readStoredQuality(): Quality {
  try {
    return localStorage.getItem(QUALITY_KEY) === "standard" ? "standard" : "high";
  } catch {
    return "high";
  }
}

function readStoredProjection(): Projection {
  try {
    return localStorage.getItem("mechcad_viewport_projection") === "perspective" ? "perspective" : "ortho";
  } catch {
    return "ortho";
  }
}

export default function Viewport({ objUrl, stlUrl, breadcrumb, statusLabel, models, hidden, selected }: Props) {
  const t = useT();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const boundsRef = useRef<THREE.Box3 | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const clipPlanesRef = useRef<THREE.Plane[]>([]);
  // viewMode 存 ref：切线框不重建场景（旧实现的依赖数组会导致重下载模型）
  const wireframeRef = useRef(false);
  const [status, setStatus] = useState<ViewStatus>("waiting");
  const [viewMode, setViewMode] = useState<"shaded" | "wireframe">("shaded");
  const [projection, setProjection] = useState<Projection>(readStoredProjection);
  const [quality, setQuality] = useState<Quality>(readStoredQuality);
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionAxis, setSectionAxis] = useState<"x" | "y" | "z">("y");
  const [sectionOffset, setSectionOffset] = useState(0);
  const [sectionFlip, setSectionFlip] = useState(false);
  const modelsKey = useMemo(() => JSON.stringify(models || []), [models]);
  const loaderKey = useMemo(() => `${objUrl || ""}:${stlUrl || ""}:${modelsKey}`, [objUrl, stlUrl, modelsKey]);

  // ---------------- 场景搭建（几何加载 + 相机 + 光照） ----------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const width = Math.max(1, mount.clientWidth);
    const height = Math.max(1, mount.clientHeight);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    sceneRef.current = scene;

    const perspective = new THREE.PerspectiveCamera(40, width / height, 0.1, 8000);
    perspective.position.set(110, 90, 110);
    cameraRef.current = perspective;
    // 正交相机（工程视图默认）：frustum 由 fitCamera 依据模型尺寸设定
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 8000);
    ortho.position.copy(perspective.position);
    orthoCameraRef.current = ortho;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_MAX));
    renderer.setSize(width, height);
    renderer.setClearColor(BACKGROUND, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;  // 压缩高光，避免白件过曝
    renderer.toneMappingExposure = 1.15;
    renderer.localClippingEnabled = true;            // 剖切
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const activeCamera = (): THREE.Camera =>
      readStoredProjection() === "ortho" ? ortho : perspective;

    const controls = new OrbitControls(activeCamera(), renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controlsRef.current = controls;

    // CAD 光棚：半球环境光 + 主光 + 冷色补光（不做阴影/反射，保证读图清晰）
    const hemi = new THREE.HemisphereLight(CAD_SKY, CAD_GROUND, 1.35);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xdfe7f0, 0.28);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(CAD_KEY, 1.9);
    key.position.set(1, 1.6, 0.9);
    scene.add(key);
    const fill = new THREE.DirectionalLight(CAD_FILL, 0.85);
    fill.position.set(-0.9, 0.5, -0.7);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(CAD_FILL, 0.55);
    rim.position.set(0.2, -0.8, 0.6);
    scene.add(rim);

    const grid = new THREE.GridHelper(400, 40, 0x3c516b, 0x28384a);
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    let disposed = false;
    let frameId = 0;

    const animate = () => {
      if (disposed) {
        return;
      }
      controls.update();
      renderer.render(scene, activeCamera());
      frameId = window.requestAnimationFrame(animate);
    };
    animate();

    const fitCamera = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 20);
      const distance = maxDim * 1.9;
      boundsRef.current = box;
      perspective.near = Math.max(0.1, maxDim / 100);
      perspective.far = Math.max(4000, distance * 10);
      perspective.updateProjectionMatrix();
      applyOrthoFrustum(center, size, distance);
      const cam = activeCamera();
      cam.position.set(center.x + distance, center.y + distance, center.z + distance);
      controls.target.copy(center);
      controls.update();
      cam.lookAt(center);
    };

    const applyOrthoFrustum = (center: THREE.Vector3, size: THREE.Vector3, distance: number) => {
      const maxDim = Math.max(size.x, size.y, size.z, 20);
      const half = maxDim * 0.75;
      const aspect = Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight);
      ortho.left = -half * aspect;
      ortho.right = half * aspect;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.near = -distance * 4;
      ortho.far = distance * 6;
      ortho.position.set(center.x + distance, center.y + distance, center.z + distance);
      ortho.updateProjectionMatrix();
    };

    const clearModel = () => {
      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeObject(modelRef.current);
        modelRef.current = null;
      }
    };

    const disposeObject = (root: THREE.Object3D) => {
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((material) => {
            // OBJ 可能带纹理，一并释放
            const anyMat = material as THREE.MeshStandardMaterial;
            if (anyMat.map) {
              anyMat.map.dispose();
            }
            if ((anyMat as unknown as { normalMap?: THREE.Texture }).normalMap) {
              (anyMat as unknown as { normalMap: THREE.Texture }).normalMap.dispose();
            }
            material.dispose();
          });
        }
      });
    };

    // STL 三角网顶点焊接 + crease 法线：曲面平滑、棱边保持锋利
    const smoothGeometry = (geometry: THREE.BufferGeometry) => {
      const position = geometry.getAttribute("position");
      if (!position || position.count > SMOOTH_MAX_VERTICES) {
        geometry.computeVertexNormals();
        return geometry;
      }
      try {
        return toCreasedNormals(geometry, CREASE_ANGLE);
      } catch {
        geometry.computeVertexNormals();
        return geometry;
      }
    };

    const makeCadMaterial = (color: number, roughness: number) => {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0,
        flatShading: false,
        clipShadows: false,
      });
      material.clippingPlanes = clipPlanesRef.current;
      material.wireframe = wireframeRef.current;
      return material;
    };

    const attachEdgeLines = (mesh: THREE.Mesh, maxVertices: number) => {
      const position = mesh.geometry?.getAttribute?.("position");
      if (!position || position.count > maxVertices) {
        return;
      }
      try {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD),
          new THREE.LineBasicMaterial({
            color: EDGE_COLOR,
            transparent: true,
            opacity: EDGE_OPACITY,
            clippingPlanes: clipPlanesRef.current,
          }),
        );
        edges.userData.isEdgeHelper = true;
        edges.renderOrder = 1;
        mesh.add(edges);
        mesh.userData.edges = edges;
      } catch {
        // 边线失败不影响主体渲染
      }
    };

    const loadModel = async () => {
      clearModel();
      const q = readStoredQuality();
      const edgeMax = q === "high" ? EDGE_MAX_VERTICES : EDGE_MAX_VERTICES_STD;

      // v0.14 F2a 装配预览：逐件加载、按位姿摆放（不做 center()——会摧毁位姿）
      if (models && models.length) {
        setStatus("loading_stl");
        const group = new THREE.Group();
        const loader = new STLLoader();
        try {
          for (let index = 0; index < models.length; index += 1) {
            const entry = models[index];
            // 并行无益（顺序建组 + 位姿）；逐件 await 保证失败可定位
            const raw = await loader.loadAsync(entry.url);
            const geometry = smoothGeometry(raw);
            geometry.computeBoundingBox();
            // v0.19：材质 —— 后端 manifest 权威（material + material_color）；
            // 缺失时按零件名回退推断，再回退中性灰。
            const key = entry.material || resolveCadMaterialFromName(entry.name);
            const cad = resolveCadMaterial(key);
            const color = colorFromRgb(entry.color ?? null, key);
            const mesh = new THREE.Mesh(geometry, makeCadMaterial(color, cad.roughness));
            mesh.userData.partName = entry.name;
            attachEdgeLines(mesh, edgeMax);
            const position = entry.position;
            if (Array.isArray(position) && position.length === 3) {
              mesh.position.set(position[0], position[1], position[2]);
            }
            const rotation = entry.rotationDeg;
            if (Array.isArray(rotation) && rotation.length === 2
                && Array.isArray(rotation[1]) && rotation[1].length === 3) {
              const axis = new THREE.Vector3(rotation[1][0], rotation[1][1], rotation[1][2]);
              if (axis.lengthSq() > 1e-9) {
                mesh.quaternion.setFromAxisAngle(axis.normalize(), (rotation[0] * Math.PI) / 180);
              }
            }
            group.add(mesh);
          }
          modelRef.current = group;
          scene.add(group);
          fitCamera(group);
          setStatus("stl_loaded");
          return;
        } catch {
          disposeObject(group);
          setStatus("load_failed");
          return;
        }
      }
      if (objUrl) {
        setStatus("loading_obj");
        try {
          const object = await new OBJLoader().loadAsync(objUrl);
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.userData.partName = "obj";
              attachEdgeLines(mesh, edgeMax);
            }
          });
          modelRef.current = object;
          scene.add(object);
          fitCamera(object);
          applyWireframe(object, wireframeRef.current);
          setStatus("obj_loaded");
          return;
        } catch {
          setStatus("obj_fallback");
        }
      }
      if (stlUrl) {
        setStatus("loading_stl");
        try {
          const raw = await new STLLoader().loadAsync(stlUrl);
          const geometry = smoothGeometry(raw);
          geometry.computeBoundingBox();
          geometry.center();
          const mesh = new THREE.Mesh(
            geometry,
            makeCadMaterial(resolveCadMaterial("steel").color, resolveCadMaterial("steel").roughness),
          );
          attachEdgeLines(mesh, edgeMax);
          modelRef.current = mesh;
          scene.add(mesh);
          fitCamera(mesh);
          setStatus("stl_loaded");
          return;
        } catch {
          setStatus("load_failed");
        }
      } else {
        setStatus("waiting");
      }
    };

    void loadModel();

    // ResizeObserver：IDE 面板宽度变化也要重设（旧实现只听 window resize）
    const onResize = () => {
      const nextWidth = Math.max(1, mount.clientWidth);
      const nextHeight = Math.max(1, mount.clientHeight);
      const aspect = nextWidth / nextHeight;
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
      if (ortho) {
        const half = (ortho.top - ortho.bottom) / 2;
        ortho.left = -half * aspect;
        ortho.right = half * aspect;
        ortho.updateProjectionMatrix();
      }
      renderer.setSize(nextWidth, nextHeight);
    };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    resizeObserver?.observe(mount);
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      window.cancelAnimationFrame(frameId);
      controls.dispose();
      clearModel();
      renderer.dispose();
      renderer.forceContextLoss?.();
      mount.innerHTML = "";
      cameraRef.current = null;
      orthoCameraRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      rendererRef.current = null;
      boundsRef.current = null;
    };
  }, [loaderKey, objUrl, stlUrl, modelsKey]);

  // ---------------- 质量档位变化：只调整 DPR，不重建 ----------------
  useEffect(() => {
    wireframeRef.current = false;
    setViewMode("shaded");
    const renderer = rendererRef.current;
    if (renderer) {
      const dpr = quality === "high" ? Math.min(window.devicePixelRatio || 1, DPR_MAX) : 1;
      renderer.setPixelRatio(dpr);
    }
    try {
      localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      /* 忽略存储失败 */
    }
  }, [quality]);

  // ---------------- 投影切换：重绑 OrbitControls，保留 target/视向 ----------------
  useEffect(() => {
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!controls || !renderer || !scene) {
      return;
    }
    const next = projection === "ortho" ? orthoCameraRef.current : cameraRef.current;
    if (!next) {
      return;
    }
    // 保留当前视向与目标
    const prev = controls.object as THREE.Camera;
    const dir = new THREE.Vector3().subVectors(prev.position, controls.target);
    next.position.copy(controls.target.clone().add(dir));
    if (next instanceof THREE.OrthographicCamera) {
      const box = boundsRef.current;
      const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
      const maxDim = Math.max(size.x, size.y, size.z, 20);
      const aspect = Math.max(1, (renderer.domElement.clientWidth || 1)) /
        Math.max(1, (renderer.domElement.clientHeight || 1));
      const half = maxDim * 0.75;
      next.left = -half * aspect;
      next.right = half * aspect;
      next.top = half;
      next.bottom = -half;
      next.near = -maxDim * 8;
      next.far = maxDim * 12;
      next.updateProjectionMatrix();
    }
    next.lookAt(controls.target);
    controls.object = next;
    controls.update();
    try {
      localStorage.setItem("mechcad_viewport_projection", projection);
    } catch {
      /* 忽略 */
    }
  }, [projection, status]);

  // ---------------- 剖切平面（clippingPlanes 直接改材质数组引用） ----------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    const box = boundsRef.current;
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
    const normal =
      sectionAxis === "x" ? new THREE.Vector3(-1, 0, 0)
        : sectionAxis === "z" ? new THREE.Vector3(0, 0, -1)
          : new THREE.Vector3(0, -1, 0);
    if (sectionFlip) {
      normal.negate();
    }
    const halfExtent = (sectionAxis === "x" ? size.x : sectionAxis === "z" ? size.z : size.y) / 2;
    const base = sectionAxis === "x" ? center.x : sectionAxis === "z" ? center.z : center.y;
    // three 裁剪保留 normal·p + constant >= 0 的一侧。
    // normal 指向"被切掉"的方向；constant = 切面在该轴上的坐标（翻转则取负）。
    const cut = base + sectionOffset * halfExtent;
    const plane = new THREE.Plane(normal, sectionFlip ? -cut : cut);
    clipPlanesRef.current = sectionOn ? [plane] : [];
    // 应用到所有零件材质与棱线材质（棱线同步被切）
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material) {
        return;
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((material) => {
        const anyMat = material as THREE.Material & { clippingPlanes?: THREE.Plane[] };
        anyMat.clippingPlanes = clipPlanesRef.current;
        anyMat.needsUpdate = true;
      });
    });
  }, [sectionOn, sectionAxis, sectionOffset, sectionFlip, status, modelsKey]);

  // ---------------- 装配显隐 + 点选高亮（不重载，只改材质/可见性） ----------------
  useEffect(() => {
    const root = modelRef.current;
    if (!root) {
      return;
    }
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.partName || mesh.userData.isEdgeHelper) {
        return;
      }
      mesh.visible = !(hidden || []).includes(String(mesh.userData.partName));
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isSelected = String(mesh.userData.partName) === (selected || "");
      materials.forEach((material) => {
        const standard = material as THREE.MeshStandardMaterial;
        if (standard && "emissive" in standard) {
          standard.emissive.setHex(isSelected ? 0x2fd8cf : 0x000000);
          standard.emissiveIntensity = isSelected ? 0.45 : 1;
        }
      });
    });
  }, [hidden, selected, status]);

  const setPreset = (preset: ViewPreset) => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }
    const camera = controls.object;
    const center = controls.target.clone();
    const bounds = boundsRef.current;
    const size = bounds ? bounds.getSize(new THREE.Vector3()) : new THREE.Vector3(120, 120, 120);
    const distance = Math.max(size.length(), 60) * 0.9;

    switch (preset) {
      case "front":
        camera.position.set(center.x, center.y - distance, center.z);
        break;
      case "top":
        camera.position.set(center.x, center.y, center.z + distance);
        break;
      case "right":
        camera.position.set(center.x + distance, center.y, center.z);
        break;
      case "iso":
        camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        break;
      case "fit":
        if (bounds) {
          const fitSize = bounds.getSize(new THREE.Vector3());
          const fitCenter = bounds.getCenter(new THREE.Vector3());
          const fitDistance = Math.max(fitSize.length(), 60) * 0.95;
          camera.position.set(fitCenter.x + fitDistance, fitCenter.y + fitDistance, fitCenter.z + fitDistance);
          controls.target.copy(fitCenter);
        }
        break;
    }
    controls.update();
    camera.lookAt(controls.target);
  };

  const applyWireframe = (root: THREE.Object3D, enabled: boolean) => {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (material && "wireframe" in material) {
          (material as THREE.MeshStandardMaterial).wireframe = enabled;
          material.needsUpdate = true;
        }
      });
    });
  };

  const toggleWireframe = () => {
    const root = modelRef.current;
    const next = !wireframeRef.current;
    wireframeRef.current = next;
    if (root) {
      applyWireframe(root, next);
    }
    setViewMode(next ? "wireframe" : "shaded");
  };

  const statusText = t(`viewport.${status}`);
  const showOverlay = status !== "obj_loaded" && status !== "stl_loaded";

  return (
    <div className="viewport-shell">
      <div className="viewport-toolbar">
        <button type="button" onClick={() => setPreset("fit")}>
          {t("viewport.fit")}
        </button>
        <button type="button" onClick={() => setPreset("iso")}>
          {t("viewport.iso")}
        </button>
        <button type="button" onClick={() => setPreset("front")}>
          {t("viewport.front")}
        </button>
        <button type="button" onClick={() => setPreset("top")}>
          {t("viewport.top")}
        </button>
        <button type="button" onClick={() => setPreset("right")}>
          {t("viewport.right")}
        </button>
        <button type="button" className={viewMode === "wireframe" ? "active" : ""} onClick={toggleWireframe}>
          {t("viewport.wireframe")}
        </button>
        <button
          type="button"
          className={projection === "ortho" ? "active" : ""}
          title={t("viewport.projection.title")}
          onClick={() => setProjection((p) => (p === "ortho" ? "perspective" : "ortho"))}
        >
          {projection === "ortho" ? t("viewport.projection.ortho") : t("viewport.projection.perspective")}
        </button>
        <button
          type="button"
          className={quality === "high" ? "active" : ""}
          title={t("viewport.quality.title")}
          onClick={() => setQuality((q) => (q === "high" ? "standard" : "high"))}
        >
          {quality === "high" ? t("viewport.quality.high") : t("viewport.quality.standard")}
        </button>
      </div>

      <div className="viewport-breadcrumb">{breadcrumb || t("viewport.breadcrumb")}</div>
      <div className="view-cube" aria-label="ViewCube">
        <button type="button" title={t("viewport.iso.title")} onClick={() => setPreset("iso")}>{t("viewport.face.iso")}</button>
        <div className="cube-face-row">
          <button type="button" title={t("viewport.top.title")} onClick={() => setPreset("top")}>{t("viewport.face.top")}</button>
          <button type="button" title={t("viewport.front.title")} onClick={() => setPreset("front")}>{t("viewport.face.front")}</button>
          <button type="button" title={t("viewport.right.title")} onClick={() => setPreset("right")}>{t("viewport.face.right")}</button>
        </div>
        <button type="button" title={t("viewport.fit.title")} onClick={() => setPreset("fit")}>{t("viewport.fit")}</button>
      </div>

      <div className="viewport-canvas" ref={mountRef} />

      <div className="viewport-section">
        <label className="section-toggle">
          <input type="checkbox" checked={sectionOn} onChange={(e) => setSectionOn(e.target.checked)} />
          {t("viewport.section")}
        </label>
        {sectionOn && (
          <div className="section-controls">
            {(["y", "x", "z"] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                className={sectionAxis === axis ? "active" : ""}
                onClick={() => setSectionAxis(axis)}
              >
                {axis.toUpperCase()}
              </button>
            ))}
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={sectionOffset}
              aria-label={t("viewport.section.offset")}
              onChange={(e) => setSectionOffset(Number(e.target.value))}
            />
            <button type="button" onClick={() => setSectionFlip((f) => !f)} title={t("viewport.section.flip")}>
              ⇄
            </button>
          </div>
        )}
      </div>

      <div className="viewport-axes" aria-label={t("viewport.axes")}>
        <span className="axis-x">X</span>
        <span className="axis-y">Y</span>
        <span className="axis-z">Z</span>
      </div>
      <div className="viewport-status">{statusLabel || statusText}</div>

      {showOverlay && (
        <div className="viewport-empty">
          <strong>{statusText}</strong>
          <span>{t("viewport.empty.hint")}</span>
        </div>
      )}
    </div>
  );
}
