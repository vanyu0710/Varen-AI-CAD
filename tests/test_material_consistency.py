"""v0.19 材质一致性 + manifest 字段测试。

后端 `backend/agent/materials.py` 是内核 `mech_kernel/materials.py` 的镜像
（后端不能 import 内核：内核依赖 OCC/build123d）。这里按路径加载内核文件，
断言两者对同一批零件名解析出相同材质键与基色，防止漂移。
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from backend.agent.materials import MATERIAL_BASE, material_color, resolve_material

KERNEL_MATERIALS = (
    Path(__file__).resolve().parents[2].parent / "mechcad-kernel" / "mech_kernel" / "materials.py"
)

SAMPLE_NAMES = [
    "箱体", "下壳体", "端盖", "箱体盖",
    "输入轴", "中间轴", "输出轴", "倒挡轴", "拨叉轴_1",
    "主动齿轮_1挡_z18", "从动齿轮_5挡_z21", "倒挡惰轮",
    "同步器毂_1", "同步器接合套_2",
    "housing", "gear_1", "shaft_II", "cover",
    "未知零件", "",
]


def _load_kernel_materials():
    if not KERNEL_MATERIALS.exists():
        return None
    spec = importlib.util.spec_from_file_location("_kernel_materials_probe", KERNEL_MATERIALS)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MaterialMirrorTests(unittest.TestCase):
    def test_local_resolution_rules(self) -> None:
        # 拨叉须先于「轴」匹配
        self.assertEqual(resolve_material("拨叉轴_1"), "bronze")
        self.assertEqual(resolve_material("输入轴"), "steel")
        self.assertEqual(resolve_material("下壳体"), "cast_iron")
        self.assertEqual(resolve_material("端盖"), "cast_iron")
        self.assertEqual(resolve_material("同步器毂_1"), "dark_steel")
        self.assertEqual(resolve_material("从动齿轮_1挡_z42"), "steel")
        self.assertEqual(resolve_material("未知零件"), "steel")

    def test_color_is_unit_rgb(self) -> None:
        for rgb in (material_color("steel"), material_color("bronze")):
            self.assertEqual(len(rgb), 3)
            for channel in rgb:
                self.assertGreaterEqual(channel, 0.0)
                self.assertLessEqual(channel, 1.0)

    def test_matches_kernel_module(self) -> None:
        """镜像一致性：与内核逐名解析结果必须相同（内核缺失则跳过）。"""
        kernel = _load_kernel_materials()
        if kernel is None:
            self.skipTest(f"内核 materials.py 不存在: {KERNEL_MATERIALS}")
        for name in SAMPLE_NAMES:
            with self.subTest(name=name):
                key = resolve_material(name)
                self.assertEqual(key, kernel.resolve_material(name))
                # 内核 material_color 接收材质键；后端接收零件名（内部先 resolve）
                ours = material_color(name)
                theirs = [float(c) for c in kernel.material_color(key)]
                self.assertEqual(ours, theirs)

    def test_base_table_matches_kernel_keys(self) -> None:
        kernel = _load_kernel_materials()
        if kernel is None:
            self.skipTest("内核 materials.py 不存在")
        self.assertEqual(set(MATERIAL_BASE.keys()), set(kernel.UI_MATERIAL_KEYS))
        for key in MATERIAL_BASE:
            self.assertEqual(
                MATERIAL_BASE[key],
                tuple(float(c) for c in kernel.MATERIALS[key][0]),
                f"材质 {key} 基色与内核不一致",
            )


class PartArtifactMaterialFieldTests(unittest.TestCase):
    """PartArtifact 必须显式携带材质字段（无 extra=allow，漏字段会被静默丢弃）。"""

    def test_schema_exposes_material_fields(self) -> None:
        from backend.schemas import PartArtifact

        artifact = PartArtifact(part="b", index=1, material="cast_iron", material_color=[0.47, 0.49, 0.51])
        self.assertEqual(artifact.material, "cast_iron")
        self.assertEqual(artifact.material_color, [0.47, 0.49, 0.51])
        # 旧数据无材质字段也应可用
        self.assertIsNone(PartArtifact(part="a", index=1).material)


if __name__ == "__main__":
    unittest.main()
