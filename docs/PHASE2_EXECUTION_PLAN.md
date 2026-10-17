# Phase 2 执行计划：工业 CAD 差距补齐

> 版本：Draft 1.0  
> 制定日期：2026-09-21  
> 覆盖周期：建议 4–6 周  
> 前置状态：前端已具备真实剖切封盖、Hatch 剖面线、点对点测量；测试 17 files / 130 cases 通过  
> 当前状态（2026-09-21 晚）：M1 语义选择主链路与语义 ID 反查已落地；M2 初版 BRep 测量已支持圆柱面/圆边直径、圆柱/圆轴距、平行平面面距、任意两个拓扑最小距离。完整测试：frontend 139、backend 52、kernel 478，`compileall` 通过。  
> 负责范围：`frontend/`、`backend/`、`mechcad-kernel/` 三层协同

---

## 1. 阶段起点与当前进展

计划制定时，产品已经解决了“看起来像 CAD”的基础问题：

- 视口有正交/透视、标准视角、ViewHelper。
- 装配有隐藏、透明、选中、悬停、干涉显示。
- 剖切不再使用假平面封盖，能生成真实截面、孔洞、轮廓线和 Hatch。
- 已有点对点测量和 ΔX/ΔY/ΔZ。

当时的核心差距不是视觉效果，而是：

1. **几何语义不足**：前端拾取的是三角形和点，不知道自己选中了哪个面、边、圆柱、平面或特征。
2. **测量不够专业**：缺少面到面、轴到轴、直径、半径、角度、最小距离、壁厚等工程测量。
3. **编辑闭环不完整**：用户不能直接选择 CAD 语义对象并修改参数。
4. **工程图数据模型缺失**：还没有可追溯的 DrawingDocument / View / Dimension 结构。
5. **前端基于 STL，后端才是 BRep 真值**：必须让前端从内核查询真实几何语义，而不是继续用网格推断。

截至 2026-09-21：

- M1 语义选择主链路已落地：面 / 边 / 顶点选择、稳定语义 ID、拓扑反查、BRep 级高亮、
  视口选择到特征树的单向联动。
- M2 测量初版已落地：圆柱面 / 圆边直径、圆柱/圆轴距、平行平面面距、任意两个拓扑最小距离，全部来自 OCC BRep 并带审计元数据。
- 剩余重点仍是：更多工程测量类型、特征树反向高亮、参数编辑事务、多零件语义坐标映射、
  工程图数据层与测量结果持久化。

因此后续仍不应优先叠加 UI 特效，而应继续建立：

> **BRep 语义查询 → 视口语义选择 → 工程测量 → 参数编辑 → 工程图数据模型**

---

## 2. 阶段目标

4–6 周后的目标状态：

1. 用户点击模型，不只是命中三角形，而是能知道：
   - 零件名；
   - 特征 ID；
   - 面 ID / 边 ID / 顶点 ID；
   - 几何类型：平面、圆柱面、圆锥面、球面、圆边、直线边、顶点；
   - 参数：半径、法线、轴向量、面积、长度。
2. 用户可以进行工程测量：
   - 点到点；
   - 点到面；
   - 面到面；
   - 轴到轴；
   - 圆柱直径 / 半径；
   - 两轴夹角；
   - 两平面夹角；
   - 最小距离。
3. 测量结果带元数据：
   - 来源是 BRep 还是网格近似；
   - 单位、精度、误差；
   - 稳定拓扑引用；
   - 可复制、锁定、加入聊天上下文。
4. 用户可以选择特征树节点、视口几何、聊天引用中的同一个对象。
5. 工程图先完成数据层，不急着做完整图纸 UI：
   - `DrawingDocument`
   - `Sheet`
   - `View`
   - `Dimension`
   - `Annotation`
   - 稳定引用到 BRep 对象。
6. 所有新增能力有自动化测试和典型模型验收样例。

---

## 3. 非目标

本阶段明确不做：

- 不做完整 GD&T 标注系统。
- 不做自动生成完整工程图纸。
- 不做通用自由拖拽建模。
- 不做复杂装配约束求解器。
- 不做标准件库商城。
- 不做“看起来专业但没有 BRep 依据”的假功能。

原因：这些能力依赖稳定的拓扑 ID、测量语义和工程图数据模型。先做上层 UI 会造成后续返工。

---

## 4. 总体技术架构

建议新增一条“语义几何查询链路”：

```text
Frontend Viewport
    ↓ ray hit / selection request
Backend REST or WebSocket
    ↓ resolve part + local point + face candidate
mechcad-kernel BRep Query API
    ↓ OCC topology query
SemanticSelection JSON
    ↓
Frontend selection store / feature tree / measurement tool
```

关键原则：

1. **后端是几何真值来源**
   - 前端 STL 只用于渲染。
   - 语义、尺寸、拓扑引用一律以后端 OCC 查询结果为准。

2. **前端不做几何猜测**
   - 前端可以显示网格近似结果，但必须标注 `source: "mesh"`。
   - 专业测量必须优先请求 BRep。

3. **拓扑引用必须稳定**
   - 不能返回一次性数组下标。
   - 应使用稳定 face ID / edge ID / vertex ID，并配合几何指纹 rebind。

4. **所有测量可审计**
   - 保存输入引用、算法、单位、误差和结果。
   - 后续可进入设计审查报告。

---

## 5. 数据契约设计

### 5.1 SemanticSelection

建议 API 返回：

```json
{
  "selection_id": "sel_123",
  "project_id": "p_001",
  "part_id": "part_flange",
  "feature_id": "feat_hole_1",
  "topology": {
    "type": "face",
    "id": "face_023",
    "kind": "cylinder",
    "fingerprint": "sha256:..."
  },
  "geometry": {
    "origin": [0, 0, 10],
    "axis": [0, 0, 1],
    "radius_mm": 12.5,
    "area_mm2": 785.39,
    "range": {
      "u": [-3.1415, 3.1415],
      "v": [0, 20]
    }
  },
  "source": "brep",
  "units": "mm",
  "accuracy": 0.001
}
```

支持类型：

```text
topology.type = face | edge | vertex | feature | part
geometry.kind =
  plane | cylinder | cone | sphere | torus | line | circle | ellipse | point
```

### 5.2 MeasureRequest（当前已落地契约）

请求端点：

```text
POST /api/projects/{project_id}/geometry/measure
```

```json
{
  "topology_ids": [
    "face:sha256:...",
    "edge:sha256:..."
  ]
}
```

约束：

- `topology_ids` 长度为 1 或 2。
- 只允许 `face:` / `edge:` / `vertex:` 语义 ID，不允许 `F00` / `E12` 数组下标。
- 当前 1 个 ID 支持圆柱面或圆边直径；2 个圆柱/圆返回轴到轴距离，2 个平行平面返回面到面距离，其他组合返回任意两个 BRep 拓扑最小距离。
- 测量类型由 kernel 根据拓扑几何类型推断，后续再演进为显式 `measure_type`。

### 5.3 MeasureResult（当前响应形状）

```json
{
  "ok": true,
  "matched": true,
  "measurement": {
    "topology_ids": ["edge:sha256:..."],
    "metric": "diameter",
    "result": {
      "p1": [-5, 0, 10],
      "p2": [5, 0, 10],
      "distance": 10,
      "dx": 10,
      "dy": 0,
      "dz": 0
    },
    "algorithm": "occ_analytic_brep",
    "source": "brep",
    "units": "mm",
    "accuracy": 0.001,
    "geometry_revision": 12
  },
  "reason": null,
  "geometry_revision": 12,
  "source": "brep"
}
```

两拓扑最小距离使用 OCC `BRepExtrema_DistShapeShape`，并返回 `p1` / `p2` 证据点；重建后旧拓扑 ID 必须返回结构化 `topology_not_found` miss，不得伪造结果。

---

## 6. 开发任务拆解

### Sprint 1：语义选择地基

**目标：让前端知道用户选中的到底是什么。**

> **当前实施状态（2026-09-21）**：面 / 边 / 顶点选择主链路已落地——`select_topology_at_point` 已接入
> kernel/server/backend/FastAPI，前端 Shift+点击可返回真实 BRep 拓扑、feature、稳定语义 ID；面返回面积、
> 圆柱直径/轴线，边返回 line/circle 等类型、长度、圆心、半径、方向，顶点返回坐标。内核使用相机射线做面
> 正面/背面消歧，并返回 face triangulation / edge polyline / vertex point 供视口做拓扑级高亮。
> 当前范围仍是单零件。`query_topology/{id}` 反查与“视口选择 → 特征树定位”的单向联动已落地；仍需补 edge/vertex
> 人工视觉验收、特征树节点反向高亮其产生的全部拓扑、以及装配多零件位姿映射，进入 Sprint 2 前优先完成前两项。

#### 6.1 内核侧

新增或补全：

- `query_topology_at_point(part_id, point, direction, tolerance)`（已落地，当前单零件）
- `query_topology(face_id | edge_id | vertex_id)`（已落地：语义 ID 反查 + geometry revision）
- `query_feature_geometry(feature_id)`（待实现）

返回稳定 ID、类型、几何参数和指纹。

#### 6.2 后端侧

新增 API：

```text
POST /geometry/select
POST /geometry/topology/{id}
GET  /geometry/parts/{part_id}/topology-summary
```

要求：

- 输入输出类型严格校验。
- 失败返回结构化错误码。
- 不允许返回裸 Python 异常字符串。

#### 6.3 前端侧

- Raycast 后把：
  - 零件名；
  - 命中世界坐标；
  - 相机方向；
  - 容差；
  发给后端解析。
- 新增 `selectionStore`。
- 视口显示当前选择：
  - 面高亮；
  - 边高亮；
  - 顶点高亮。
- 特征树节点能接收同一个 selection ID（已实现单向：视口选择 → feature_id → 特征树定位）。
- 点击特征树节点时高亮该 feature 产生的 BRep 拓扑（待实现）。

#### 6.4 验收

- 点击圆柱孔壁，返回：
  - cylinder face；
  - radius；
  - axis；
  - feature_id。
- 点击平面，返回：
  - plane face；
  - normal；
  - area。
- 点击圆边，返回：
  - circle edge；
  - radius；
  - center。
- 点击直线边，返回：
  - line edge；
  - length；
  - direction。
- 前端、特征树、聊天引用可以互相定位。

---

### Sprint 2：专业测量系统

**目标：从“点对点显示”升级为工业测量。**

> **当前实施状态（2026-09-21）**：M2 初版已落地。kernel 新增 `measure_topology` RPC，backend 暴露
> `POST /geometry/measure`；前端测量模式不再用 STL 点对点猜测工程尺寸，而是通过语义选择取得稳定拓扑 ID 后
> 请求 OCC BRep 测量。当前支持圆柱面 / 圆边直径、两个圆柱/圆的轴到轴距离、两个平行平面的面到面距离、
> 任意两个拓扑最小距离，并返回算法、单位、精度、证据点与 geometry revision。连续测量、结果锁定、持久化、
> 加入聊天上下文、夹角/壁厚仍待实现。

#### 7.1 内核测量 API

已落地：

- `measure_cylinder_diameter`（以 `measure_topology` + 1 个 cylinder face 实现）
- `measure_circle_diameter`（以 `measure_topology` + 1 个 circle edge 实现）
- `measure_axis_to_axis`（以 `measure_topology` + 2 个 cylinder/circle 实现）
- `measure_face_to_face`（以 `measure_topology` + 2 个 parallel plane face 实现）
- `measure_minimum_distance`（以 `measure_topology` + 2 个任意拓扑实现）

第一批待实现：

- `measure_point_to_point`
- `measure_point_to_face`
- `measure_angle_between_planes`
- `measure_angle_between_edges`

第二批：

- `measure_min_wall_thickness`
- `measure_hole_depth`
- `measure_bounding_box`

#### 7.2 前端测量模式

测量模式已从单一点选升级为 BRep 多对象选择：

```text
点 / 面 / 边 / 顶点 → 后端语义选择 → 测量请求 → 结果展示
```

已支持：

- 点击圆柱面或圆边立即显示 `Ø`；
- 选择两个圆柱/圆显示轴距 `A`；
- 选择两个平行平面显示面距 `F`；
- 选择其他两个拓扑组合显示最小距离 `L`；
- 绘制后端返回的 `p1` / `p2` 证据点和连线；
- 显示 BRep 错误与第二对象等待状态；
- 模型版本变化时清理选择和结果，避免过期引用。

待支持：

- 连续测量；
- 锁定结果；
- 复制结果；
- 清除结果；
- 将结果加入当前 AI 对话上下文。

#### 7.3 数据持久化

- 测量结果进入项目状态。
- 每条测量保存：
  - 对象引用；
  - 时间；
  - 结果；
  - 来源；
  - 精度；
  - 模型版本。
- 换模型或模型重建后：
  - 若拓扑引用有效，恢复；
  - 若失效，标记“引用过期”，不自动伪造。

#### 7.4 验收

已自动化验收：

- cylinder face 直径来自 OCC BRep；
- circle edge 直径来自 OCC BRep；
- 两个平行圆柱孔轴距离为轴线距离，不因半径加减而失真；
- 两个平行平面距离来自解析面方程；
- 两个非解析组合最小距离来自 `BRepExtrema_DistShapeShape`；
- 前端不再使用 STL 点对点冒充工程测量；
- 结果包含 `source=brep`、算法、单位、精度、证据点和 `geometry_revision`。

人工验收清单：

- 点击圆柱面立即显示 `Ø`；
- 点击圆边立即显示 `Ø`；
- 点击两个圆柱面显示轴距；
- 点击上下两个平行平面显示面距；
- 点击其他两个平面 / 边 / 顶点组合显示最小距离；
- 修改参数重建后旧测量结果清空，旧 ID 反查返回结构化 miss；
- 点击空白清除测量状态。

后续对典型法兰模型继续补：

- 圆柱孔直径与 OCC 查询一致。
- 法兰上下面距离正确。
- 两个孔轴距离正确。
- 两平面夹角正确。
- 结果显示 `source=brep`。
- 网格近似测量必须显示 `source=mesh`，不得冒充 BRep。

---

### Sprint 3：特征树与参数编辑闭环

**目标：让用户直接修改模型，而不是只看模型。**

#### 8.1 选择联动

打通：

```text
视口几何 → 特征树节点
特征树节点 → 视口高亮
聊天引用 → 视口高亮
```

#### 8.2 安全参数编辑

第一批只允许修改：

- 孔直径；
- 孔深度；
- 拉伸长度；
- 旋转角度；
- 圆角半径；
- 倒角距离；
- 阵列数量；
- 阵列间距。

流程：

```text
选择特征 → 显示参数面板 → 修改值 → 预览 diff → 验证 → 重建 → 快照
```

#### 8.3 编辑事务

所有前端编辑必须转为标准命令：

```json
{
  "op": "edit_feature_param",
  "feature_id": "feat_hole_1",
  "params": {
    "diameter_mm": 25
  }
}
```

禁止：

- 前端直接改 Three.js 网格；
- 修改后不重建；
- 修改失败却显示成功；
- 无法撤销。

#### 8.4 验收

- 修改孔直径后：
  - 3D 模型重建；
  - 特征树状态更新；
  - 测量引用自动 rebind 或明确标记过期；
  - 可撤销；
  - 过程记录可审计。

---

### Sprint 4：工程图数据层

**目标：先冻结图纸数据结构，不做截图式假图纸。**

#### 9.1 核心对象

建立：

```text
DrawingDocument
Sheet
View
ViewReference
SectionView
Dimension
Annotation
TitleBlock
```

#### 9.2 引用规则

所有尺寸、剖视、标注必须引用：

```text
part_id + feature_id + topology_id + fingerprint
```

不允许只保存：

- 屏幕坐标；
- 像素坐标；
- 三角形下标。

#### 9.3 第一批 API

```text
POST /drawings
GET  /drawings/{id}
POST /drawings/{id}/views
POST /drawings/{id}/dimensions
```

先支持：

- 主视图；
- 俯视图；
- 左视图；
- 等轴测视图；
- 简单全剖。

#### 9.4 验收

- 一条直径尺寸能反查到 3D 圆柱面。
- 修改特征参数后，图纸对象知道需要更新。
- 引用失效时显示“过期引用”，不自动连到错误几何。
- 屏幕预览、导出数据、三维模型使用同一个语义引用。

---

## 7. 关键技术风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 拓扑 ID 不稳定 | 修改特征后面 ID 变化 | 使用稳定 ID + 几何指纹 rebind，不允许裸下标 |
| 前后端坐标不一致 | 点击位置解析错误 | 建立统一单位、坐标系和变换矩阵契约 |
| STL 与 BRep 偏差 | 测量结果不一致 | 所有专业测量优先走 OCC，网格结果必须标注 |
| 大模型查询慢 | 点击卡顿 | 查询缓存、topology summary、异步加载 |
| 编辑失败不透明 | 用户以为成功但模型没变 | 统一执行报告、错误码、快照状态 |
| 工程图过早 UI 化 | 做成截图编辑器 | 先冻结数据模型，后做 UI |
| 前端直接改网格 | 破坏 CAD 真值 | 一切修改走标准命令和内核事务 |

---

## 8. 建议里程碑

### M1：语义选择可用

- 点击面 / 边 / 顶点返回真实 BRep 信息。
- 视口高亮对应拓扑。
- 特征树与视口选择联动。

### M2：工程测量可用

- 支持直径、面距、轴距、角度、最小距离。
- 测量结果可持久化、复制、进入聊天上下文。
- BRep 与 mesh 来源明确区分。

### M3：参数编辑闭环

- 修改孔径、深度、拉伸长度等基础参数。
- 重建、验证、撤销、重做。
- 特征树、视口、聊天引用一致。

### M4：工程图数据模型冻结

- DrawingDocument / View / Dimension 数据结构确定。
- 图纸对象可反查三维拓扑。
- 后续才进入完整图纸 UI 和 PDF / DXF 导出。

---

## 9. 测试策略

### 单元测试

- 测量计算。
- 语义选择数据结构。
- 拓扑引用转换。
- 工程图对象引用。
- 参数编辑命令。

### 集成测试

- 前端点击 → 后端解析 → 内核查询 → 前端显示。
- 修改特征 → 重建 → 测量引用恢复。
- 工程图尺寸 → 三维几何反查。

### 回归测试

- 剖切封盖；
- Hatch；
- 孔洞不被填死；
- 点对点测量；
- 隐藏 / 透明 / 选中状态；
- 装配变换。

### 典型样例

必须长期保留：

1. 法兰：孔、圆柱、平面、圆边。
2. 阶梯轴：圆柱、端面、倒角。
3. 带腔体箱体：内腔、壁厚、孔深。
4. 齿轮：轴孔、齿面、阵列。
5. 装配体：多零件间距、轴对齐、干涉。

---

## 10. 下一步建议

按顺序执行：

1. **先做 M1 语义选择**
   - 没有语义选择，专业测量和参数编辑都没有可靠基础。
2. **再做 M2 工程测量**
   - 把现有点对点工具升级为多对象 BRep 测量。
3. **然后做 M3 参数编辑**
   - 建立安全编辑事务和撤销链路。
4. **最后做 M4 工程图数据层**
   - 不做截图式假图纸，先冻结可追溯数据结构。

最优先开工项：

```text
内核 topology query API
后端 /geometry/select
前端 selectionStore + 语义高亮
```

这一步完成后，产品才会真正从“三维查看器”进入“工程 CAD 语义交互”阶段。
