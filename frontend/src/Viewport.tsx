import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useT } from "./i18n";
import type { SemanticPick, SemanticSelection } from "./api";
import { colorFromRgb, resolveCadMaterial, resolveCadMaterialFromName } from "./materials";
import {
  TRANSPARENCY_LEVELS,
  bodyOpacity,
  clampMenuPos,
  edgeOpacity,
  isPartHidden,
  mergeHiddenNames,
  pickPartName,
  type TransparencyLevel,
} from "./partVisual";
import { sectionPlane, type SectionAxis } from "./section";
import { buildSectionCapGeometry } from "./sectionMesh";
import { formatMeasureText, type MeasureResult, type Point3D } from "./measureTool";
import {
  VIEW_DIRECTIONS,
  fitDistance,
  gridSpec,
  orthoHalfHeight,
  type ViewDirection,
} from "./viewMath";

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
  /** 视口内改隐藏（右键菜单）后回传，让装配面板的勾选同步。 */
  onHiddenChange?: (names: string[]) => void;
  /** 视口内左键点选零件后回传（点空白处回传 null）。 */
  onSelectChange?: (name: string | null) => void;
  /** M1：Shift+点击模型时，把网格命中点/射线交给后端解析 BRep 面语义。 */
  semanticPickEnabled?: boolean;
  onSemanticPick?: (pick: SemanticPick) => void;
  semanticSelection?: SemanticSelection | null;
  semanticSelectionLoading?: boolean;
  semanticSelectionError?: string | null;
  onSemanticSelectionClear?: () => void;
  /** M2：测量模式由 App 控制，点击模型即解析 BRep 拓扑。 */
  measureMode?: boolean;
  onMeasureModeChange?: (enabled: boolean) => void;
  measureResult?: MeasureResult | null;
  measureSelectionCount?: number;
  measureError?: string | null;
  onMeasureClear?: () => void;
  /** 干涉件名（来自装配报告的 pairs）：以告警色标出，把"硬碰撞 N"落到具体几何上。 */
  interfering?: string[];
  /**
   * 该值变化时重新适配视角（切项目 / 换模型）。
   * 同一值下的几何更新（agent 逐步建模、零件改版）保留用户当前视角。
   */
  fitKey?: string;
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
const PROJECTION_KEY = "mechcad_viewport_projection";
// 剖切封盖色：暖调「新切金属」。冷色零件 + 深蓝背景上读作剖面，
// 不用纯灰以免与铸铁件混同、不用高饱和以免抢眼。
const SECTION_CAP_COLOR = 0xb0a693;
const SECTION_CAP_ROUGHNESS = 0.45;
const SELECT_EMISSIVE = 0x2fd8cf;   // 选中：青
const HOVER_EMISSIVE = 0x1d4a5c;    // 悬停：暗青（比选中弱，避免两者混淆）
const INTERFERENCE_EMISSIVE = 0xc4472e;  // 干涉件：告警红（仅未选中时生效）
const HOVER_THROTTLE_MS = 80;
const GRID_MAJOR = 0x3c516b;        // 网格主线
const GRID_MINOR = 0x28384a;        // 网格次线
const FOV_DEG = 40;                 // 透视相机视场角（取景计算要用同一个值）

function readStoredQuality(): Quality {
  try {
    return localStorage.getItem(QUALITY_KEY) === "standard" ? "standard" : "high";
  } catch {
    return "high";
  }
}

function readStoredProjection(): Projection {
  try {
    return localStorage.getItem(PROJECTION_KEY) === "perspective" ? "perspective" : "ortho";
  } catch {
    return "ortho";
  }
}

/** 缓存键：库零件 URL 自带版本号（vNNN_名.stl），实时预览带 ?rev=——都能区分内容。 */
type PreparedPart = {
  geometry: THREE.BufferGeometry;
  /** 已抽好的特征棱线，随几何一起缓存，省掉每次重载的 EdgesGeometry。 */
  edges: THREE.BufferGeometry | null;
};

export default function Viewport({
  objUrl,
  stlUrl,
  breadcrumb,
  statusLabel,
  models,
  hidden,
  selected,
  onHiddenChange,
  onSelectChange,
  semanticPickEnabled = false,
  onSemanticPick,
  semanticSelection = null,
  semanticSelectionLoading = false,
  semanticSelectionError = null,
  onSemanticSelectionClear,
  measureMode,
  onMeasureModeChange,
  measureResult = null,
  measureSelectionCount = 0,
  measureError = null,
  onMeasureClear,
  interfering,
  fitKey = "",
}: Props) {
  const t = useT();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const boundsRef = useRef<THREE.Box3 | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const sectionCapsRef = useRef<THREE.Group | null>(null);
  const semanticHighlightRef = useRef<THREE.Object3D | null>(null);
  const viewHelperRef = useRef<ViewHelper | null>(null);
  const clipPlanesRef = useRef<THREE.Plane[]>([]);
  // 已应用到材质的裁剪面数量。three 把 NUM_CLIPPING_PLANES 编进 shader，
  // 只有数量变化才需要 needsUpdate（否则拖动滑块每帧重编译）。
  const clipCountRef = useRef(0);
  // 相机是否已由用户视角接管：模型更新时不再夺走视角，只在首次加载适配。
  const fittedRef = useRef(false);
  // 场景重建会新建相机，视角必须显式带过去，否则每次几何更新都回到默认位姿。
  const viewRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>(null);
  // viewMode 存 ref：切线框不重建场景（旧实现的依赖数组会导致重下载模型）
  const wireframeRef = useRef(false);
  // 几何缓存跨重载复用（内核算完 STL 就是不变的真值，没必要每次重下重算）
  const cacheRef = useRef<Map<string, PreparedPart>>(new Map());
  const [status, setStatus] = useState<ViewStatus>("waiting");
  const [viewMode, setViewMode] = useState<"shaded" | "wireframe">("shaded");
  const [projection, setProjection] = useState<Projection>(readStoredProjection);
  const [quality, setQuality] = useState<Quality>(readStoredQuality);
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionAxis, setSectionAxis] = useState<SectionAxis>("y");
  const [sectionOffset, setSectionOffset] = useState(0);
  const [sectionFlip, setSectionFlip] = useState(false);
  const [measureModeLocal, setMeasureModeLocal] = useState(false);
  const measureOn = measureMode ?? measureModeLocal;
  const measureGroupRef = useRef<THREE.Group | null>(null);
  // Pointer listeners are intentionally mounted only once per model. Refs prevent
  // the measurement handler from capturing stale mode while avoiding a costly
  // listener teardown on every click.
  const measureOnRef = useRef(false);
  measureOnRef.current = measureOn;
  const toggleMeasure = () => {
    const next = !measureOn;
    if (onMeasureModeChange) {
      onMeasureModeChange(next);
    } else {
      setMeasureModeLocal(next);
    }
    if (!next) {
      onMeasureClear?.();
    }
  };
  // v0.21 SW 式右键：逐零件透明度 / 本地隐藏（叠加在 App 传入的 hidden 之上）+ 上下文菜单
  const [partVisuals, setPartVisuals] = useState<Record<string, { opacity: TransparencyLevel; hidden: boolean }>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; partName: string } | null>(null);
  // 悬停是声明式状态：与选中/透明度由同一个 effect 统一写材质，
  // 避免「命令式改 emissive 又被 effect 覆盖、之后再不恢复」的失效。
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadFailures, setLoadFailures] = useState<string[]>([]);
  // 显示上下文丢失 → 覆盖层提示（three 自己会在 webglcontextrestored 后重建 GL 状态）
  const [contextLost, setContextLost] = useState(false);
  const projectionRef = useRef<Projection>(projection);
  const qualityRef = useRef<Quality>(quality);
  const hoveredRef = useRef<string | null>(null);
  const modelsKey = useMemo(() => JSON.stringify(models || []), [models]);
  const loaderKey = useMemo(() => `${objUrl || ""}:${stlUrl || ""}:${modelsKey}`, [objUrl, stlUrl, modelsKey]);
  // 指针事件里要用最新的回调，但不该因此重挂监听（重挂会丢悬停态）
  const onSelectChangeRef = useRef(onSelectChange);
  onSelectChangeRef.current = onSelectChange;
  const onSemanticPickRef = useRef(onSemanticPick);
  onSemanticPickRef.current = onSemanticPick;
  const onSemanticSelectionClearRef = useRef(onSemanticSelectionClear);
  onSemanticSelectionClearRef.current = onSemanticSelectionClear;
  const semanticPickEnabledRef = useRef(semanticPickEnabled);
  semanticPickEnabledRef.current = semanticPickEnabled;
  const interferingKey = useMemo(() => (interfering || []).join("\u0000"), [interfering]);
  const interferingSet = useMemo(() => new Set(interfering || []), [interferingKey]);

  // ---------------- 换项目/换模型 → 重新适配视角 ----------------
  // 声明在场景 effect 之前：React 按声明顺序跑 effect，场景重建时要先看到这个复位。
  useEffect(() => {
    fittedRef.current = false;
    viewRef.current = null;
  }, [fitKey]);

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

    const perspective = new THREE.PerspectiveCamera(FOV_DEG, width / height, 0.1, 8000);
    perspective.position.set(110, 90, 110);
    // Z 向上：数据（内核渲染器 + BOM 位姿）是 Z-up，轨道球的极轴与
    // 「俯视」也要跟着是 Z。留着默认的 +Y 会让正视视图落在轨道极点上
    // （gimbal lock），且环绕时绕的是竖直数据里的横轴。
    perspective.up.set(0, 0, 1);
    cameraRef.current = perspective;
    // 正交相机（工程视图默认）：frustum 由取景函数依据模型尺寸与视向设定
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 8000);
    ortho.position.copy(perspective.position);
    ortho.up.set(0, 0, 1);
    orthoCameraRef.current = ortho;

    // stencil 必须显式开启：three 的 WebGLRenderer 默认不带模板缓冲，
    // 剖切封盖依赖它（否则封盖会静默消失）。
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      stencil: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_MAX));
    renderer.setSize(width, height);
    renderer.setClearColor(BACKGROUND, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;  // 压缩高光，避免白件过曝
    renderer.toneMappingExposure = 1.15;
    renderer.localClippingEnabled = true;            // 剖切
    // ViewHelper 在右上角用 setViewport 叠加绘制：若 autoClear 为真，
    // 它内部那次 render 会把整帧清掉，主场景直接消失。改为手动 clear()。
    renderer.autoClear = false;
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 投影模式存 ref：animate 每帧都要选相机，不能再读 localStorage
    projectionRef.current = readStoredProjection();
    qualityRef.current = readStoredQuality();
    clipCountRef.current = 0;
    const activeCamera = (): THREE.Camera =>
      projectionRef.current === "ortho" ? ortho : perspective;

    const controls = new OrbitControls(activeCamera(), renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    // 缩放限位：没有上下限时可以一路飞进无穷远或把模型翻个底朝天
    controls.minDistance = 1;
    controls.maxDistance = 1e6;
    controls.minZoom = 0.02;
    controls.maxZoom = 200;
    // 光标锚定缩放：滚轮朝指针下的位置放大，而不是永远朝屏幕中心
    controls.zoomToCursor = true;
    controlsRef.current = controls;

    // 真 ViewCube 替代品：three 的 ViewHelper 是带坐标轴与可点击标签的
    // 三维指示器（点击即带动画转到该视向），比之前那个静态按钮格真实。
    const viewHelper = new ViewHelper(activeCamera() as THREE.PerspectiveCamera, renderer.domElement);
    viewHelper.setLabels("X", "Y", "Z");
    viewHelper.center.copy(controls.target);
    viewHelperRef.current = viewHelper;

    // 视角跨场景重建保留：相机是本 effect 新建的，不搬过来就每次都回默认位姿
    if (fittedRef.current && viewRef.current) {
      const saved = viewRef.current;
      const cam = activeCamera();
      cam.position.copy(saved.position);
      if (cam instanceof THREE.OrthographicCamera) {
        cam.zoom = saved.zoom;
        cam.updateProjectionMatrix();
      }
      controls.target.copy(saved.target);
      controls.update();
    }

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

    // ---------------- 地面网格：Z-up，按模型自适应 ----------------
    const updateGrid = (box: THREE.Box3 | null) => {
      const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(400, 400, 400);
      const spec = gridSpec(Math.hypot(size.x, size.y, size.z));
      const previous = gridRef.current;
      if (previous) {
        scene.remove(previous);
        previous.geometry.dispose();
        (previous.material as THREE.Material).dispose();
        gridRef.current = null;
      }
      const next = new THREE.GridHelper(spec.size, spec.divisions, GRID_MAJOR, GRID_MINOR);
      // three 的 GridHelper 默认铺在 XZ 平面（Y 向上），而内核渲染器与相机预设
      // 都是 Z 向上——不转这一下，网格会竖直穿过模型而不是衬在模型底下。
      next.rotation.x = Math.PI / 2;
      const material = next.material as THREE.Material;
      material.opacity = 0.5;
      material.transparent = true;
      if (box) {
        // 衬在模型底面并跟随其水平位置，避免模型悬空或网格跑到视野外
        const center = box.getCenter(new THREE.Vector3());
        next.position.set(center.x, center.y, box.min.z);
      }
      scene.add(next);
      gridRef.current = next;
    };
    updateGrid(null);

    // ---------------- 剖切封盖（真实截面面） ----------------
    // 不再用一块覆盖整个模型的大平面/模板缓冲伪造封盖：那种方案会把孔洞、
    // 凹腔和多零件截面填成实心。这里的 group 由真实三角网格-平面交线生成，
    // 每个零件都有自己的截面轮廓，孔洞保持为空。
    const sectionCaps = new THREE.Group();
    sectionCaps.userData.isSectionCapGroup = true;
    sectionCaps.visible = false;
    scene.add(sectionCaps);
    sectionCapsRef.current = sectionCaps;

    const measureGroup = new THREE.Group();
    measureGroup.userData.isMeasureGroup = true;
    scene.add(measureGroup);
    measureGroupRef.current = measureGroup;

    let disposed = false;
    let frameId = 0;
    let lastFrameAt = performance.now();

    const animate = (now: number) => {
      if (disposed) {
        return;
      }
      // ViewHelper 的转向动画按真实时间推进（它内部按秒计速）
      const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      controls.update();
      // ViewHelper 在右上角用 setViewport 叠加绘制，需要自己清深度而不是整帧清屏，
      // 因此主渲染关掉 autoClear、由它接管（three 官方 ViewHelper 示例的用法）。
      renderer.clear();
      renderer.render(scene, activeCamera());
      if (viewHelper.animating) {
        viewHelper.update(delta);
        // 动画期间要同步轨道球目标与取景，否则动画结束位置会跳
        controls.target.copy(viewHelper.center);
      }
      viewHelper.render(renderer);
      frameId = window.requestAnimationFrame(animate);
    };
    frameId = window.requestAnimationFrame(animate);

    /** 只更新近远平面（模型尺寸会变），不移动相机。 */
    const updateClipRange = (size: THREE.Vector3, distance: number) => {
      const maxDim = Math.max(size.x, size.y, size.z, 20);
      perspective.near = Math.max(0.1, maxDim / 100);
      perspective.far = Math.max(4000, distance * 10);
      perspective.updateProjectionMatrix();
      ortho.near = -distance * 4;
      ortho.far = distance * 6;
      ortho.updateProjectionMatrix();
    };

    const viewportAspect = () =>
      Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight);

    /**
     * 按当前相机视向取景：逐视向算所需距离与正交视锥。
     * 旧实现按包围盒对径一刀切，细长件在正视图里会小得看不清。
     */
    const frameToward = (box: THREE.Box3, direction: [number, number, number]) => {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const sizeArr: [number, number, number] = [size.x, size.y, size.z];
      const aspect = viewportAspect();
      const distance = fitDistance(sizeArr, direction, FOV_DEG, aspect);

      // 正交：显式给视锥半高，并让相机退到 far 之内
      const halfH = orthoHalfHeight(sizeArr, direction, aspect);
      ortho.top = halfH;
      ortho.bottom = -halfH;
      ortho.left = -halfH * aspect;
      ortho.right = halfH * aspect;
      ortho.zoom = 1;
      ortho.near = -distance * 4;
      ortho.far = distance * 6;
      ortho.updateProjectionMatrix();

      const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
      for (const cam of [perspective, ortho]) {
        cam.position.copy(center).addScaledVector(dir, distance);
      }
      controls.target.copy(center);
      controls.update();
      perspective.lookAt(center);
      ortho.lookAt(center);
      viewHelper.center.copy(center);
    };

    /**
     * 记录新包围盒。视角在模型更新时保持不变——agent 每产出一版几何就夺走
     * 一次视角的话，用户没法盯住一个位置看它长出来。
     */
    const applyBounds = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 20);
      const distance = maxDim * 1.9;
      boundsRef.current = box;
      updateClipRange(size, distance);
      if (!fittedRef.current) {
        frameToward(box, VIEW_DIRECTIONS.iso);
        fittedRef.current = true;
      } else {
        // 保留视角，但视锥仍要跟上新尺寸，否则放大后落到 far 外被裁掉
        const halfH = orthoHalfHeight([size.x, size.y, size.z], VIEW_DIRECTIONS.iso, viewportAspect());
        const keepZoom = ortho.zoom;
        ortho.top = halfH;
        ortho.bottom = -halfH;
        ortho.left = -halfH * viewportAspect();
        ortho.right = halfH * viewportAspect();
        ortho.zoom = keepZoom;
        ortho.updateProjectionMatrix();
        viewHelper.center.copy(box.getCenter(new THREE.Vector3()));
      }
      updateGrid(box);
    };

    const clearModel = () => {
      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeObject(modelRef.current);
        modelRef.current = null;
      }
    };

    /** 缓存内的几何不随场景销毁——下次重载直接复用，省掉重下与重算。 */
    const cachedGeometries = () => {
      const keep = new Set<THREE.BufferGeometry>();
      cacheRef.current.forEach((entry) => {
        keep.add(entry.geometry);
        if (entry.edges) {
          keep.add(entry.edges);
        }
      });
      return keep;
    };

    const disposeObject = (root: THREE.Object3D) => {
      const keep = cachedGeometries();
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry && !keep.has(mesh.geometry)) {
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
        const smoothed = toCreasedNormals(geometry, CREASE_ANGLE);
        // toCreasedNormals 返回新几何，入参已无人引用，顺手释放（卫生，非泄漏）
        geometry.dispose();
        return smoothed;
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

    /** 背面递减模板的辅助网格材质（与主体的正面递增配对）。 */
    const makeStencilBackMaterial = () => {
      const material = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
      });
      material.clippingPlanes = clipPlanesRef.current;
      material.stencilWrite = true;
      material.stencilFunc = THREE.AlwaysStencilFunc;
      material.stencilRef = 0;
      material.stencilFuncMask = 0xff;
      material.stencilFail = THREE.DecrementWrapStencilOp;
      material.stencilZFail = THREE.DecrementWrapStencilOp;
      material.stencilZPass = THREE.DecrementWrapStencilOp;
      material.stencilWriteMask = 0xff;
      return material;
    };

    const buildEdges = (geometry: THREE.BufferGeometry, maxVertices: number) => {
      const position = geometry.getAttribute("position");
      if (!position || position.count > maxVertices) {
        return null;
      }
      try {
        return new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD);
      } catch {
        return null;   // 边线失败不影响主体渲染
      }
    };

    const attachEdgeLines = (mesh: THREE.Mesh, edgesGeometry: THREE.BufferGeometry | null) => {
      if (!edgesGeometry) {
        return;
      }
      const edges = new THREE.LineSegments(
        edgesGeometry,
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
    };

    /** 取（或算）一个零件的几何与棱线；命中缓存则完全跳过下载与三角化。 */
    const preparePart = async (url: string, edgeMax: number): Promise<PreparedPart> => {
      const cached = cacheRef.current.get(url);
      if (cached) {
        return cached;
      }
      const raw = await new STLLoader().loadAsync(url);
      const geometry = smoothGeometry(raw);
      geometry.computeBoundingBox();
      const prepared: PreparedPart = { geometry, edges: buildEdges(geometry, edgeMax) };
      cacheRef.current.set(url, prepared);
      return prepared;
    };

    /** 挂载一个零件：主体 + 棱线 + 模板辅助网格；返回可见的 partName 网格。 */
    const buildPartMesh = (url: string, prepared: PreparedPart, entry?: AssemblyModel) => {
      const key = entry?.material || resolveCadMaterialFromName(entry?.name || url);
      const cad = resolveCadMaterial(key);
      const color = colorFromRgb(entry?.color ?? null, key);
      const mesh = new THREE.Mesh(prepared.geometry, makeCadMaterial(color, cad.roughness));
      mesh.userData.partName = entry?.name || "model";
      attachEdgeLines(mesh, prepared.edges);
      // 封盖计数用的背面 pass：只写模板，不写颜色/深度，且不可拾取
      const stencilBack = new THREE.Mesh(prepared.geometry, makeStencilBackMaterial());
      stencilBack.userData.isStencilHelper = true;
      stencilBack.renderOrder = 2;
      stencilBack.visible = false;
      stencilBack.raycast = () => {};
      mesh.add(stencilBack);
      mesh.userData.stencilBack = stencilBack;
      return mesh;
    };

    const loadModel = async () => {
      clearModel();
      setLoadProgress(null);
      setLoadFailures([]);
      const q = qualityRef.current;
      const edgeMax = q === "high" ? EDGE_MAX_VERTICES : EDGE_MAX_VERTICES_STD;

      // v0.14 F2a 装配预览：逐件加载、按位姿摆放（不做 center()——会摧毁位姿）
      if (models && models.length) {
        setStatus("loading_stl");
        setLoadProgress({ done: 0, total: models.length });
        const group = new THREE.Group();
        const failed: string[] = [];
        for (let index = 0; index < models.length; index += 1) {
          const entry = models[index];
          if (disposed) {
            return;
          }
          try {
            // 顺序 await：并行无益（要逐件摆姿），且失败可定位
            const prepared = await preparePart(entry.url, edgeMax);
            const mesh = buildPartMesh(entry.url, prepared, entry);
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
          } catch {
            // 单件失败不再拖垮整场：其余零件照常显示，失败清单单独报出
            failed.push(entry.name);
          }
          setLoadProgress({ done: index + 1, total: models.length });
        }
        setLoadFailures(failed);
        setLoadProgress(null);
        if (!group.children.length) {
          disposeObject(group);
          setStatus("load_failed");
          return;
        }
        modelRef.current = group;
        scene.add(group);
        applyBounds(group);
        setStatus("stl_loaded");
        return;
      }
      if (objUrl) {
        setStatus("loading_obj");
        try {
          const object = await new OBJLoader().loadAsync(objUrl);
          if (disposed) {
            disposeObject(object);
            return;
          }
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.userData.partName = "obj";
              attachEdgeLines(mesh, buildEdges(mesh.geometry, edgeMax));
            }
          });
          modelRef.current = object;
          scene.add(object);
          applyBounds(object);
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
          const geometry = smoothGeometry(await new STLLoader().loadAsync(stlUrl));
          if (disposed) {
            geometry.dispose();
            return;
          }
          geometry.computeBoundingBox();
          // Do not center single-part STL geometry.  M1 semantic picking sends
          // world mesh coordinates to the kernel; centering here would break the
          // mesh-to-BRep correspondence for parts modeled away from the origin.
          const mesh = new THREE.Mesh(geometry, makeCadMaterial(
            resolveCadMaterial("steel").color,
            resolveCadMaterial("steel").roughness,
          ));
          mesh.userData.partName = "model";
          attachEdgeLines(mesh, buildEdges(geometry, edgeMax));
          const stencilBack = new THREE.Mesh(geometry, makeStencilBackMaterial());
          stencilBack.userData.isStencilHelper = true;
          stencilBack.renderOrder = 2;
          stencilBack.visible = false;
          stencilBack.raycast = () => {};
          mesh.add(stencilBack);
          mesh.userData.stencilBack = stencilBack;
          modelRef.current = mesh;
          scene.add(mesh);
          applyBounds(mesh);
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

    // 混合显卡切换 / 驱动重置会让上下文丢失；不 preventDefault 浏览器永不恢复
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
      // three 在恢复时会重建内部 GL 状态，这里把尺寸/像素比重申一遍
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_MAX));
      onResize();
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.cancelAnimationFrame(frameId);
      // 先存视角再拆：下一次 effect 会新建相机，不存就回默认位姿
      const liveCamera = controls.object;
      viewRef.current = fittedRef.current
        ? {
            position: liveCamera.position.clone(),
            target: controls.target.clone(),
            zoom: liveCamera instanceof THREE.OrthographicCamera ? liveCamera.zoom : 1,
          }
        : null;
      controls.dispose();
      viewHelper.dispose();
      clearModel();
      const sectionCaps = sectionCapsRef.current;
      if (sectionCaps) {
        sectionCaps.traverse((child) => {
          const mesh = child as THREE.Mesh | THREE.LineSegments;
          if (mesh.geometry) {
            mesh.geometry.dispose();
          }
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => material.dispose());
          }
        });
        sectionCaps.clear();
        scene.remove(sectionCaps);
      }
      const measureGroup = measureGroupRef.current;
      if (measureGroup) {
        measureGroup.traverse((child) => {
          const mesh = child as THREE.Mesh | THREE.LineSegments;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => m.dispose());
          }
        });
        measureGroup.clear();
        scene.remove(measureGroup);
      }
      const grid = gridRef.current;
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss?.();
      mount.innerHTML = "";
      cameraRef.current = null;
      orthoCameraRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      rendererRef.current = null;
      gridRef.current = null;
      sectionCapsRef.current = null;
      measureGroupRef.current = null;
      viewHelperRef.current = null;
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
    projectionRef.current = projection;
    try {
      localStorage.setItem(PROJECTION_KEY, projection);
    } catch {
      /* 忽略 */
    }
  }, [projection, status]);

  // ---------------- 剖切平面 + 真实截面封盖 ----------------
  useEffect(() => {
    const scene = sceneRef.current;
    const sectionCaps = sectionCapsRef.current;
    if (!scene || !sectionCaps) {
      return;
    }
    const box = boundsRef.current;
    const centerVec = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const sizeVec = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(100, 100, 100);
    const plane = sectionPlane(
      sectionAxis,
      sectionOffset,
      sectionFlip,
      [centerVec.x, centerVec.y, centerVec.z],
      [sizeVec.x, sizeVec.y, sizeVec.z],
    );
    const threePlane = new THREE.Plane(
      new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
      plane.constant,
    );
    const nextPlanes = sectionOn ? [threePlane] : [];
    clipPlanesRef.current = nextPlanes;

    // three 把裁剪面数量编进 shader（NUM_CLIPPING_PLANES）。只有数量变化才要
    // needsUpdate——否则拖动滑块每一帧都在重编译所有零件材质。
    const countChanged = clipCountRef.current !== nextPlanes.length;
    clipCountRef.current = nextPlanes.length;

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material || mesh.userData.isSectionCap) {
        return;
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((material) => {
        const anyMat = material as THREE.Material & { clippingPlanes?: THREE.Plane[] };
        anyMat.clippingPlanes = nextPlanes;
        if (countChanged) {
          anyMat.needsUpdate = true;
        }
      });
    });

    // 清理上一次剖切产生的真实面和轮廓线。拖动滑块时重建是必要的，
    // 因为截面轮廓本身会变化；只更新一块 PlaneGeometry 会重新制造“空心”。
    sectionCaps.traverse((child) => {
      const object = child as THREE.Mesh | THREE.LineSegments;
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    sectionCaps.clear();
    sectionCaps.visible = false;

    const canBuildCaps = sectionOn && viewMode === "shaded" && status !== "waiting" && status !== "load_failed";
    if (!canBuildCaps) {
      return;
    }

    const root = modelRef.current;
    if (!root) {
      return;
    }
    root.updateWorldMatrix(true, true);
    const remoteHidden = hidden || [];
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !mesh.userData.partName
          || mesh.userData.isEdgeHelper || mesh.userData.isStencilHelper) {
        return;
      }
      const partName = String(mesh.userData.partName);
      const local = partVisuals[partName];
      if (isPartHidden(partName, local?.hidden, remoteHidden) || bodyOpacity(local?.opacity) < 1) {
        return;
      }
      mesh.updateWorldMatrix(true, false);
      // 专业 CAD 剖面线：多零件装配下错开角度（0号零件 45°，1号零件 135°，依次交替）
      const partIdx = Math.abs(partName.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 2;
      const hatchAngle = partIdx === 0 ? 45 : 135;
      const result = buildSectionCapGeometry(mesh.geometry, threePlane, mesh.matrixWorld, {
        angleDeg: hatchAngle,
      });
      if (!result) {
        return;
      }

      const capMaterial = new THREE.MeshStandardMaterial({
        color: SECTION_CAP_COLOR,
        roughness: SECTION_CAP_ROUGHNESS,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      capMaterial.clippingPlanes = [];
      const cap = new THREE.Mesh(result.geometry, capMaterial);
      cap.userData.isSectionCap = true;
      cap.userData.partName = partName;
      cap.renderOrder = 3;
      cap.raycast = () => {};

      // 截面外轮廓粗线（工程轮廓）
      const outline = new THREE.LineSegments(
        result.lineGeometry,
        new THREE.LineBasicMaterial({
          color: EDGE_COLOR,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          depthTest: true,
        }),
      );
      outline.userData.isSectionCap = true;
      outline.userData.partName = partName;
      outline.renderOrder = 4;
      outline.raycast = () => {};
      cap.add(outline);

      // 专业 CAD 剖面线（Hatch 纹理细实线）
      if (result.hatchGeometry) {
        const hatchLines = new THREE.LineSegments(
          result.hatchGeometry,
          new THREE.LineBasicMaterial({
            color: 0x5a6370,  // 工程剖面细线灰
            transparent: true,
            opacity: 0.75,
            depthWrite: false,
            depthTest: true,
          }),
        );
        hatchLines.userData.isSectionCap = true;
        hatchLines.userData.partName = partName;
        hatchLines.renderOrder = 4;
        hatchLines.raycast = () => {};
        cap.add(hatchLines);
      }

      sectionCaps.add(cap);
    });

    sectionCaps.visible = sectionCaps.children.length > 0;
  }, [sectionOn, sectionAxis, sectionOffset, sectionFlip, viewMode, status, modelsKey, hidden, partVisuals]);

  // ---------------- BRep 拓扑级高亮（M1.2） ----------------
  // 面板文字只是语义结果；工业 CAD 的选择反馈必须落在被选中的 BRep 拓扑上。
  // 内核返回 face triangulation / edge polyline / vertex point，前端只做渲染。
  useEffect(() => {
    const scene = sceneRef.current;
    const display = semanticSelection?.source === "brep" ? semanticSelection.display : null;
    if (!scene || !display) {
      return;
    }

    const partName = status === "obj_loaded" ? "obj" : "model";
    const clippingPlanes = clipPlanesRef.current;
    let object: THREE.Object3D | null = null;

    if (display.type === "triangles") {
      const vertexCount = display.vertices.length;
      const indexCount = display.indices.length;
      if (
        vertexCount < 3 ||
        indexCount < 3 ||
        indexCount % 3 !== 0 ||
        display.triangle_count !== indexCount / 3
      ) {
        return;
      }
      const positions = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i += 1) {
        const [x, y, z] = display.vertices[i];
        const px = Number(x);
        const py = Number(y);
        const pz = Number(z);
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
          return;
        }
        positions[i * 3] = px;
        positions[i * 3 + 1] = py;
        positions[i * 3 + 2] = pz;
      }
      if (display.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
        return;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(display.indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({
        color: SELECT_EMISSIVE,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        clippingPlanes,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 3;

      // EdgesGeometry removes coplanar triangulation edges, leaving the face
      // perimeter and significant boundary lines so the highlight reads as a CAD
      // face rather than a translucent triangle patch.
      const outlineGeometry = new THREE.EdgesGeometry(geometry, 20);
      const outline = new THREE.LineSegments(
        outlineGeometry,
        new THREE.LineBasicMaterial({
          color: SELECT_EMISSIVE,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          clippingPlanes,
        }),
      );
      outline.renderOrder = 4;
      outline.raycast = () => {};
      outline.userData.isSemanticHighlight = true;
      outline.userData.partName = partName;
      mesh.add(outline);
      object = mesh;
    } else if (display.type === "polyline") {
      if (display.vertices.length < 2) {
        return;
      }
      const points = display.vertices.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z))) {
        return;
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: SELECT_EMISSIVE,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        clippingPlanes,
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 5;
      object = line;
    } else {
      const [x, y, z] = display.point;
      const point = new THREE.Vector3(x, y, z);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
        return;
      }
      const diagonal = boundsRef.current?.getSize(new THREE.Vector3()).length() ?? 100;
      const radius = THREE.MathUtils.clamp(diagonal * 0.008, 0.25, 6);
      const geometry = new THREE.SphereGeometry(radius, 20, 20);
      const material = new THREE.MeshBasicMaterial({
        color: SELECT_EMISSIVE,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        clippingPlanes,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(point);
      mesh.renderOrder = 6;
      object = mesh;
    }

    object.raycast = () => {};
    object.userData.isSemanticHighlight = true;
    object.userData.partName = partName;
    object.visible = !isPartHidden(partName, partVisuals[partName]?.hidden, hidden || []);
    scene.add(object);
    semanticHighlightRef.current = object;

    return () => {
      if (semanticHighlightRef.current === object) {
        semanticHighlightRef.current = null;
      }
      scene.remove(object);
      object.traverse((child) => {
        const item = child as THREE.Mesh | THREE.LineSegments | THREE.Line;
        if (item.geometry) {
          item.geometry.dispose();
        }
        if (item.material) {
          const materials = Array.isArray(item.material) ? item.material : [item.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, [semanticSelection, status, hidden, partVisuals]);

  // ---------------- 工业 CAD 3D BRep 测量证据点与连线绘制 ----------------
  useEffect(() => {
    const group = measureGroupRef.current;
    if (!group) return;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh | THREE.LineSegments;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mats = mesh.material as THREE.Material | THREE.Material[];
        (Array.isArray(mats) ? mats : [mats]).forEach((m) => m.dispose());
      }
    });
    group.clear();

    if (!measureOn || !measureResult) {
      return;
    }

    const modelDiagonal = boundsRef.current?.getSize(new THREE.Vector3()).length() ?? 100;
    const markerRadius = THREE.MathUtils.clamp(modelDiagonal * 0.008, 0.4, 4);
    const dotGeo = new THREE.SphereGeometry(markerRadius, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false });
    for (const point of [measureResult.p1, measureResult.p2]) {
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(point[0], point[1], point[2]);
      dot.renderOrder = 10;
      group.add(dot);
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...measureResult.p1),
      new THREE.Vector3(...measureResult.p2),
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffcc00, linewidth: 2, depthTest: false });
    const line = new THREE.Line(lineGeo, lineMat);
    line.renderOrder = 11;
    group.add(line);
  }, [measureOn, measureResult]);

  // ---------------- 装配显隐 + 透明度 + 选中/悬停高亮 + 封盖参与 ----------------
  // 所有 emissive/opacity/模板的写入都收在这里：过去悬停是命令式改材质、选中是
  // 声明式，两者互相覆盖，悬停高亮一旦被覆盖就再也回不来（hovered ref 短路了重设）。
  useEffect(() => {
    const root = modelRef.current;
    if (!root) {
      return;
    }
    const remoteHidden = hidden || [];
    // 真实截面面已经由 sectionMesh 生成；旧模板封盖只保留为兼容字段，
    // 默认关闭，避免 stencil 计数给复杂网格带来额外开销和错误覆盖。
    const capping = false;
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.partName || mesh.userData.isEdgeHelper) {
        return;
      }
      const partName = String(mesh.userData.partName);
      const local = partVisuals[partName];
      mesh.visible = !isPartHidden(partName, local?.hidden, remoteHidden);
      const opacity = bodyOpacity(local?.opacity);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isSelected = partName === (selected || "");
      const isHovered = partName === hoveredPart;
      const isInterfering = interferingSet.has(partName);
      // 优先级：选中 > 悬停 > 干涉。干涉是"提示"不是"选中"，所以压在最底层；
      // 一旦用户选它或悬停它，应看到交互反馈而不是一直告警色。
      const emissive = isSelected
        ? SELECT_EMISSIVE
        : isHovered
          ? HOVER_EMISSIVE
          : isInterfering
            ? INTERFERENCE_EMISSIVE
            : 0x000000;
      // 主体面片累加模板计数（正面 +1），与背面辅助网格的 -1 配对。
      // AlwaysStencilFunc + ZPass/ZFail 同时递增 = 不看深度，被遮挡的截面也计入，
      // 正是封盖要的「沿视线进入次数 − 离开次数」。没有配对背面 pass 的网格
      // （OBJ 路径）不能写模板，否则计数只加不减、封盖会糊成一片。
      const stencilBack = mesh.userData.stencilBack as THREE.Mesh | undefined;
      const writeStencil =
        capping && mesh.visible && opacity >= 1 && Boolean(stencilBack);
      materials.forEach((material) => {
        const standard = material as THREE.MeshStandardMaterial;
        material.stencilWrite = writeStencil;
        if (writeStencil) {
          material.stencilFunc = THREE.AlwaysStencilFunc;
          material.stencilRef = 0;
          material.stencilFuncMask = 0xff;
          material.stencilFail = THREE.IncrementWrapStencilOp;
          material.stencilZFail = THREE.IncrementWrapStencilOp;
          material.stencilZPass = THREE.IncrementWrapStencilOp;
          material.stencilWriteMask = 0xff;
        }
        if (standard && "emissive" in standard) {
          standard.emissive.setHex(emissive);
          standard.emissiveIntensity = isSelected ? 0.45 : isInterfering && !isHovered ? 0.4 : 1;
          const transparent = opacity < 1 || isSelected;
          standard.transparent = transparent;
          standard.opacity = opacity;
          // 半透明件关闭深度写入，避免排序闪烁；棱线仍可读。
          standard.depthWrite = opacity >= 1;
          standard.needsUpdate = true;
        }
      });
      if (stencilBack) {
        stencilBack.visible = writeStencil;
      }
      const edges = mesh.userData.edges as THREE.LineSegments | undefined;
      if (edges) {
        const lineMat = edges.material as THREE.LineBasicMaterial;
        if (lineMat) {
          lineMat.opacity = edgeOpacity(local?.opacity, EDGE_OPACITY);
          lineMat.needsUpdate = true;
        }
      }
    });
  }, [hidden, selected, partVisuals, hoveredPart, interferingKey, interferingSet, sectionOn, viewMode, status]);

  // ---------------- 右键拾取 + 悬停高亮（v0.21 SW 式零件菜单） ----------------
  useEffect(() => {
    const canvas = mountRef.current?.querySelector("canvas") ?? null;
    if (!canvas || status === "waiting" || status === "load_failed") {
      return;
    }
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let rightDown: { x: number; y: number } | null = null;
    let leftDown: { x: number; y: number } | null = null;
    let lastHoverAt = 0;

    const isSelectableBody = (hit: THREE.Intersection): boolean => {
      const object = hit.object as THREE.Mesh;
      return Boolean(
        object?.isMesh &&
        object.visible !== false &&
        object.userData?.partName &&
        !object.userData.isEdgeHelper &&
        !object.userData.isStencilHelper &&
        !object.userData.isSectionCap,
      );
    };

    const pickHit = (clientX: number, clientY: number): SemanticPick | null => {
      const root = modelRef.current;
      const controls = controlsRef.current;
      if (!root || !controls) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, controls.object);
      const hit = raycaster.intersectObjects(root.children, true).find(isSelectableBody);
      if (!hit) {
        return null;
      }
      const partName = pickPartName([hit.object as unknown as Parameters<typeof pickPartName>[0][number]]);
      if (!partName) {
        return null;
      }
      return {
        partName,
        point: [hit.point.x, hit.point.y, hit.point.z],
        direction: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z],
      };
    };

    const pickName = (clientX: number, clientY: number): string | null => pickHit(clientX, clientY)?.partName ?? null;

    /** 悬停只改声明式状态；材质写入统一由视觉 effect 负责。 */
    const setHover = (name: string | null) => {
      if (hoveredRef.current === name) {
        return;
      }
      hoveredRef.current = name;
      canvas.style.cursor = name ? "pointer" : "";
      setHoveredPart(name);
    };

    const onPointerDown = (event: PointerEvent) => {
      // ViewHelper 先吃事件：点在坐标轴球上时它返回 true，交给它转视角。
      // 旋转中心取当前观察目标（而非模型中心），这样用户平移过视角后点击
      // 坐标轴不会突然跳回原点。
      const helper = viewHelperRef.current;
      if (helper) {
        const target = controlsRef.current?.target;
        if (target) {
          helper.center.copy(target);
        }
        if (helper.handleClick(event)) {
          return;
        }
      }
      if (event.button === 2) {
        rightDown = { x: event.clientX, y: event.clientY };
        return;
      }
      if (event.button !== 0) {
        return;
      }
      // 左键点选：记录按下位置，位移超过阈值视为拖拽旋转（OrbitControls 的
      // 左键动作），不当作点选——否则每次转视角都会误选零件。
      leftDown = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !leftDown) {
        return;
      }
      const moved = Math.hypot(event.clientX - leftDown.x, event.clientY - leftDown.y);
      leftDown = null;
      if (moved > 6) {
        return;   // 是拖拽旋转，不是点选
      }

      if (event.shiftKey && semanticPickEnabledRef.current) {
        const pick = pickHit(event.clientX, event.clientY);
        if (pick) {
          onSemanticPickRef.current?.(pick);
        } else {
          onSemanticSelectionClearRef.current?.();
        }
        return;
      }

      if (measureOnRef.current) {
        // M2：测量模式不再用 STL 交点算工程尺寸。点击仍然走 BRep 语义解析，
        // 由 App 收集拓扑 ID 后请求内核 OCC 测量。
        const pick = pickHit(event.clientX, event.clientY);
        if (pick) {
          onSemanticPickRef.current?.(pick);
        } else {
          onSemanticSelectionClearRef.current?.();
        }
        return;
      }

      onSemanticSelectionClearRef.current?.();
      onSelectChangeRef.current?.(pickName(event.clientX, event.clientY));
    };
    const onPointerMove = (event: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverAt < HOVER_THROTTLE_MS) {
        return; // 节流：装配大场景下射线开销可控
      }
      lastHoverAt = now;
      setHover(pickName(event.clientX, event.clientY));
    };
    const onPointerLeave = () => setHover(null);
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // 右键拖拽（平移）后不弹菜单
      if (rightDown && Math.hypot(event.clientX - rightDown.x, event.clientY - rightDown.y) > 6) {
        rightDown = null;
        return;
      }
      rightDown = null;
      const partName = pickName(event.clientX, event.clientY);
      if (!partName) {
        setContextMenu(null);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const pos = clampMenuPos(event.clientX - rect.left, event.clientY - rect.top, 216, 236, rect.width, rect.height);
      setContextMenu({ x: pos.left, y: pos.top, partName });
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.style.cursor = "";
      hoveredRef.current = null;
      setHoveredPart(null);   // 否则重新加载后旧零件仍留着悬停高亮
    };
  }, [status, modelsKey]);

  // 菜单外点击 / Escape 关闭；Escape 同时取消选中（CAD 惯例）
  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".part-context-menu")) {
        return;
      }
      setContextMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Escape 取消选中（无菜单时也要生效）。设置弹窗打开时不抢——它自己要用 Escape 关闭。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"]')) {
        return;
      }
      onSelectChangeRef.current?.(null);
      onSemanticSelectionClearRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 按视向取景（与 ViewHelper 点击共用同一套几何，避免两处取景不一致）。 */
  const frameTowardDirection = (direction: [number, number, number]) => {
    const controls = controlsRef.current;
    const box = boundsRef.current;
    const cam = controls?.object;
    if (!controls || !cam) {
      return;
    }
    if (!box) {
      // 还没有模型：只转向，不动距离
      const current = new THREE.Vector3().subVectors(cam.position, controls.target);
      const radius = Math.max(current.length(), 60);
      const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
      cam.position.copy(controls.target).addScaledVector(dir, radius);
      controls.update();
      cam.lookAt(controls.target);
      fittedRef.current = true;
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sizeArr: [number, number, number] = [size.x, size.y, size.z];
    const aspect = Math.max(1, (rendererRef.current?.domElement.clientWidth || 1)) /
      Math.max(1, (rendererRef.current?.domElement.clientHeight || 1));
    const distance = fitDistance(sizeArr, direction, FOV_DEG, aspect);
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();

    if (cam instanceof THREE.OrthographicCamera) {
      const halfH = orthoHalfHeight(sizeArr, direction, aspect);
      cam.top = halfH;
      cam.bottom = -halfH;
      cam.left = -halfH * aspect;
      cam.right = halfH * aspect;
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    }
    controls.target.copy(center);
    cam.position.copy(center).addScaledVector(dir, distance);
    controls.update();
    cam.lookAt(center);
    const helper = viewHelperRef.current;
    if (helper) {
      helper.center.copy(center);
    }
    // 用户已经选定视角：后续几何更新不再夺走它
    fittedRef.current = true;
  };

  /** 「适配」：沿当前视向重新取景，不改变观察角度。 */
  const fitCurrentDirection = () => {
    const controls = controlsRef.current;
    const cam = controls?.object;
    if (!controls || !cam) {
      return;
    }
    const dir = new THREE.Vector3().subVectors(cam.position, controls.target);
    if (dir.lengthSq() < 1e-9) {
      dir.copy(new THREE.Vector3(...VIEW_DIRECTIONS.iso));
    }
    dir.normalize();
    frameTowardDirection([dir.x, dir.y, dir.z]);
  };

  const setPreset = (preset: ViewPreset) => {
    switch (preset) {
      case "front":
        frameTowardDirection(VIEW_DIRECTIONS.front);
        break;
      case "top":
        frameTowardDirection(VIEW_DIRECTIONS.top);
        break;
      case "right":
        frameTowardDirection(VIEW_DIRECTIONS.right);
        break;
      case "iso":
        frameTowardDirection(VIEW_DIRECTIONS.iso);
        break;
      case "fit":
      default:
        fitCurrentDirection();
        break;
    }
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

  /** 隐藏零件：本地与上层同时写入，避免两份隐藏状态互相打架。 */
  const hidePart = (name: string) => {
    setPartVisuals((previous) => ({
      ...previous,
      [name]: { opacity: previous[name]?.opacity || "opaque", hidden: true },
    }));
    onHiddenChange?.(mergeHiddenNames([name], hidden));
  };

  /** 全部显示：只清本地会让面板勾选的零件继续隐藏，必须两边一起清。 */
  const showAllParts = () => {
    setPartVisuals({});
    onHiddenChange?.([]);
  };

  const hiddenNames = useMemo(() => {
    const local = Object.entries(partVisuals)
      .filter(([, value]) => value.hidden)
      .map(([name]) => name);
    return mergeHiddenNames(local, hidden);
  }, [partVisuals, hidden]);
  const fadedCount = Object.values(partVisuals).filter(
    (item) => item.opacity !== "opaque" && !item.hidden,
  ).length;
  const visualDirty = hiddenNames.length + fadedCount;
  const semanticGeometry = semanticSelection?.geometry || {};
  const semanticNumber = (key: string, digits = 3): string | null => {
    const value = semanticGeometry[key];
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : null;
  };
  const semanticVector = (key: string): string | null => {
    const value = semanticGeometry[key];
    if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== "number")) {
      return null;
    }
    return (value as number[]).map((item) => item.toFixed(3)).join(", ");
  };
  const semanticArea = semanticNumber("area_mm2");
  const semanticRadius = semanticNumber("radius_mm");
  const semanticNormal = semanticVector("normal");
  const semanticAxis = semanticVector("axis");
  const semanticLength = semanticNumber("length_mm");
  const semanticCenter = semanticVector("center");
  const semanticDirection = semanticVector("direction");
  const semanticPoint = semanticVector("point");
  const semanticTitleKey = semanticSelection
    ? `viewport.semantic.title.${semanticSelection.topology.type}`
    : "viewport.semantic.title.face";
  const statusText = t(`viewport.${status}`);
  const showOverlay = status !== "obj_loaded" && status !== "stl_loaded" && !loadProgress;

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
        <button
          type="button"
          className={measureOn ? "active" : ""}
          title={t("viewport.measure.hint")}
          onClick={toggleMeasure}
        >
          {t("viewport.measure")}
        </button>
      </div>

      {measureOn && (
        <div className="viewport-measure-badge">
          <span>
            {measureError
              ? measureError
              : measureResult
                ? formatMeasureText(measureResult)
                : measureSelectionCount === 1
                  ? t("viewport.measure.pending_second")
                  : t("viewport.measure.hint")}
          </span>
          {(measureResult || measureSelectionCount > 0) && (
            <button type="button" className="measure-clear-btn" onClick={onMeasureClear}>
              {t("viewport.measure.clear")}
            </button>
          )}
        </div>
      )}

      <div className="viewport-breadcrumb">{breadcrumb || t("viewport.breadcrumb")}</div>

      {semanticPickEnabled && !semanticSelection && !semanticSelectionLoading && !semanticSelectionError && (
        <div className="viewport-semantic-hint" role="status">
          {t("viewport.semantic.hint")}
        </div>
      )}
      {semanticSelectionLoading && (
        <div className="viewport-semantic-panel loading" role="status">
          {t("viewport.semantic.loading")}
        </div>
      )}
      {semanticSelectionError && (
        <div className="viewport-semantic-panel error" role="alert">
          <span>{semanticSelectionError}</span>
          <button type="button" onClick={onSemanticSelectionClear}>{t("viewport.semantic.clear")}</button>
        </div>
      )}
      {semanticSelection && (
        <div className="viewport-semantic-panel" role="status">
          <header>
            <strong>{t(semanticTitleKey)}</strong>
            <button type="button" onClick={onSemanticSelectionClear} title={t("viewport.semantic.clear")}>×</button>
          </header>
          <dl>
            <div>
              <dt>{t("viewport.semantic.kind")}</dt>
              <dd>{semanticSelection.topology.kind}</dd>
            </div>
            <div>
              <dt>{t("viewport.semantic.feature")}</dt>
              <dd>{semanticSelection.feature_id || "—"}</dd>
            </div>
            <div>
              <dt>{t("viewport.semantic.topology_id")}</dt>
              <dd>{semanticSelection.topology.id}</dd>
            </div>
            {semanticArea && (
              <div>
                <dt>{t("viewport.semantic.area")}</dt>
                <dd>{semanticArea} mm²</dd>
              </div>
            )}
            {semanticRadius && (
              <div>
                <dt>{t("viewport.semantic.radius")}</dt>
                <dd>Ø{(Number(semanticRadius) * 2).toFixed(3)} mm</dd>
              </div>
            )}
            {semanticNormal && (
              <div>
                <dt>{t("viewport.semantic.normal")}</dt>
                <dd>{semanticNormal}</dd>
              </div>
            )}
            {semanticAxis && (
              <div>
                <dt>{t("viewport.semantic.axis")}</dt>
                <dd>{semanticAxis}</dd>
              </div>
            )}
            {semanticLength && (
              <div>
                <dt>{t("viewport.semantic.length")}</dt>
                <dd>{semanticLength} mm</dd>
              </div>
            )}
            {semanticCenter && (
              <div>
                <dt>{t("viewport.semantic.center")}</dt>
                <dd>{semanticCenter}</dd>
              </div>
            )}
            {semanticDirection && (
              <div>
                <dt>{t("viewport.semantic.direction")}</dt>
                <dd>{semanticDirection}</dd>
              </div>
            )}
            {semanticPoint && (
              <div>
                <dt>{t("viewport.semantic.point")}</dt>
                <dd>{semanticPoint}</dd>
              </div>
            )}
            {typeof semanticSelection.geometry_revision === "number" && (
              <div>
                <dt>{t("viewport.semantic.revision")}</dt>
                <dd>R{semanticSelection.geometry_revision}</dd>
              </div>
            )}
            <div>
              <dt>{t("viewport.semantic.source")}</dt>
              <dd>{semanticSelection.source.toUpperCase()} · ±{semanticSelection.accuracy.toFixed(3)} mm</dd>
            </div>
          </dl>
        </div>
      )}
      {/* 视向指示与转向由 three 的 ViewHelper 直接画在画布右上角（真三维、
          可点击、带动画）——因此这里不再有静态的假 ViewCube 按钮格，
          左下角的静态 "X Y Z" 徽章也一并去掉（同一信息，但 ViewHelper 是活的）。
          工具条仍保留前/俯/右/等轴的文字入口。 */}

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

      <div className="viewport-status">{statusLabel || statusText}</div>

      {(selected || (interfering?.length || 0) > 0) && (
        <div className="viewport-selection-chip">
          {selected && (
            <span className="vsc-selected">
              {t("viewport.selected", { name: selected })}
              <button type="button" onClick={() => onSelectChange?.(null)} title={t("viewport.selected.clear")}>
                ×
              </button>
            </span>
          )}
          {(interfering?.length || 0) > 0 && (
            <span className="vsc-interference" role="status">
              {t("viewport.interference", { count: interfering!.length })}
            </span>
          )}
        </div>
      )}

      {contextMenu && (
        <div className="part-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} data-part={contextMenu.partName}>
          <div className="pcm-title" title={contextMenu.partName}>
            {contextMenu.partName}
          </div>
          <div className="pcm-group">{t("viewport.ctx.transparency")}</div>
          {TRANSPARENCY_LEVELS.map((level) => {
            const active = (partVisuals[contextMenu.partName]?.opacity || "opaque") === level;
            return (
              <button
                key={level}
                type="button"
                className={active ? "active" : ""}
                onClick={() => {
                  setPartVisuals((previous) => ({
                    ...previous,
                    [contextMenu.partName]: { opacity: level, hidden: false },
                  }));
                  setContextMenu(null);
                }}
              >
                <span className="pcm-check" aria-hidden>{active ? "✓" : ""}</span>
                {t(`viewport.ctx.${level}`)}
              </button>
            );
          })}
          <div className="pcm-sep" />
          <button
            type="button"
            onClick={() => {
              hidePart(contextMenu.partName);
              setContextMenu(null);
            }}
          >
            <span className="pcm-check" aria-hidden />
            {t("viewport.ctx.hide")}
          </button>
          <button
            type="button"
            onClick={() => {
              showAllParts();
              setContextMenu(null);
            }}
          >
            <span className="pcm-check" aria-hidden />
            {t("viewport.ctx.showAll")}
          </button>
        </div>
      )}

      {visualDirty > 0 && (
        <div className="viewport-visual-chip">
          <span>{t("viewport.ctx.dirty", { hidden: hiddenNames.length, faded: fadedCount })}</span>
          <button type="button" onClick={showAllParts}>
            {t("viewport.ctx.restore")}
          </button>
        </div>
      )}

      {loadProgress && (
        <div className="viewport-progress" role="status">
          <span className="viewport-progress-bar" aria-hidden>
            <i style={{ width: `${Math.round((loadProgress.done / Math.max(1, loadProgress.total)) * 100)}%` }} />
          </span>
          <span>
            {t("viewport.loading_progress", {
              done: loadProgress.done,
              total: loadProgress.total,
            })}
          </span>
        </div>
      )}

      {loadFailures.length > 0 && (
        <div className="viewport-notice warn" role="status">
          {t("viewport.load_partial", { count: loadFailures.length })}
          <span className="viewport-notice-detail" title={loadFailures.join("、")}>
            {loadFailures.slice(0, 3).join("、")}
            {loadFailures.length > 3 ? " …" : ""}
          </span>
        </div>
      )}

      {contextLost && (
        <div className="viewport-empty" role="alert">
          <strong>{t("viewport.context_lost")}</strong>
        </div>
      )}

      {showOverlay && (
        <div className="viewport-empty">
          <strong>{statusText}</strong>
          <span>{t("viewport.empty.hint")}</span>
        </div>
      )}
    </div>
  );
}
