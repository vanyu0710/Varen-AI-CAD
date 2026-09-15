"""v0.19 零件材质推断（后端侧，零 CAD 依赖）。

权威来源是内核 `mech_kernel/materials.py`。后端不能 import 内核（内核依赖
OCC / build123d），所以这里复刻同一套「零件名 → 材质键 + 基色」规则，并由
`tests/test_material_consistency.py` 按路径加载内核文件做一致性断言，防止漂移。

归档零件时用它把 material / material_color 写进项目零件库 manifest，
前端视口据此按材质着色（工程 CAD 风格的哑光分色）。
"""

from __future__ import annotations

# 与内核 MATERIALS 的 base 色（0..1）一致。改这里必须同步内核并跑一致性测试。
MATERIAL_BASE: dict[str, tuple[float, float, float]] = {
    "steel": (0.55, 0.62, 0.72),
    "cast_iron": (0.47, 0.49, 0.51),
    "aluminum": (0.70, 0.73, 0.76),
    "bronze": (0.76, 0.55, 0.25),
    "copper": (0.72, 0.45, 0.30),
    "brass": (0.74, 0.62, 0.32),
    "titanium": (0.55, 0.55, 0.58),
    "dark_steel": (0.36, 0.38, 0.42),
    "nylon": (0.86, 0.86, 0.82),
    "rubber": (0.16, 0.16, 0.17),
}

# 与内核 _NAME_HINTS 同序、同关键词（顺序有意义：拨叉须先于「轴」匹配）。
_NAME_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("箱体", "箱盖", "壳", "盖", "housing", "case", "cover"), "cast_iron"),
    (("拨叉", "fork"), "bronze"),
    (("同步器", "接合套", "synchron"), "dark_steel"),
    (("轴承", "bearing", "铜", "bronze", "衬套", "bush"), "bronze"),
    (("齿轮", "gear", "惰轮", "idler", "轴", "shaft", "花键", "spline"), "steel"),
)


def resolve_material(name: str) -> str:
    """按零件名推断材质键；未命中返回 steel（与内核一致）。"""
    low = str(name).lower()
    for keys, mat in _NAME_HINTS:
        if any(k in low for k in keys):
            return mat
    return "steel"


def material_color(name: str) -> list[float]:
    """按零件名推断材质基色（0..1 RGB，manifest 序列化用 list）。"""
    base = MATERIAL_BASE.get(resolve_material(name), MATERIAL_BASE["steel"])
    return [float(c) for c in base]
