"""Fact-first engineering material / critical part / assembly review tests."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("MECHCAD_STORE_PATH", str(Path(tempfile.mkdtemp(prefix="mechcad-eng-store-")) / "projects.json"))

from fastapi.testclient import TestClient

from backend import storage
from backend.engineering_review import build_engineering_review
import backend.main as main_module


class EngineeringReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_root = storage.PROJECT_PARTS_ROOT
        self._tmp = tempfile.TemporaryDirectory(prefix="mechcad-eng-review-")
        storage.PROJECT_PARTS_ROOT = Path(self._tmp.name) / "project_parts"
        self.project_id = "engineering-review-test"
        self.lib = storage.project_parts_dir(self.project_id)
        self.lib.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        storage.PROJECT_PARTS_ROOT = self._old_root
        self._tmp.cleanup()

    def _write_files(self, *names: str) -> None:
        for name in names:
            (self.lib / name).write_text("test artifact", encoding="utf-8")

    def test_empty_manifest_is_no_data(self) -> None:
        review = build_engineering_review(self.project_id, {"parts": [], "assembly": None})
        self.assertEqual(review["status"], "NO_DATA")
        self.assertEqual(review["materials"], [])
        self.assertFalse(review["assembly"]["available"])

    def test_groups_active_viewport_materials_and_excludes_superseded(self) -> None:
        self._write_files("v001_gear.step", "v001_gear.stl", "v001_housing.step", "v001_housing.stl")
        manifest = {
            "parts": [
                {
                    "name": "gear", "version": 1, "status": "active", "material": "steel",
                    "role": "drive", "depends_on": ["housing"], "validation_status": "PASS",
                    "contract_passed": True, "step_file": "v001_gear.step", "stl_file": "v001_gear.stl",
                    "volume_mm3": 100.0, "pose": {"position": [0, 0, 0]},
                },
                {
                    "name": "housing", "version": 1, "status": "active", "material": "cast_iron",
                    "role": "structure", "depends_on": [], "validation_status": "PASS",
                    "contract_passed": True, "step_file": "v001_housing.step", "stl_file": "v001_housing.stl",
                    "volume_mm3": 900.0, "pose": {"position": [0, 0, 0]},
                },
                {"name": "old gear", "version": 1, "status": "superseded", "material": "rubber"},
            ],
            "assembly": None,
        }
        review = build_engineering_review(self.project_id, manifest)
        materials = {item["material"]: item for item in review["materials"]}
        self.assertEqual(set(materials), {"steel", "cast_iron"})
        self.assertEqual(materials["steel"]["parts"], ["gear"])
        self.assertEqual(materials["cast_iron"]["basis"], "manifest")
        self.assertEqual(review["status"], "WARNING")  # assembly not exported
        self.assertTrue(any(part["name"] == "old gear" for part in manifest["parts"]))
        self.assertFalse(any(part["part"] == "old gear" for part in review["critical_parts"]))

    def test_missing_artifacts_and_contract_block_part_review(self) -> None:
        manifest = {
            "parts": [{
                "name": "gear", "version": 1, "status": "active", "material": "steel",
                "contract_passed": False, "step_file": "missing.step", "stl_file": "missing.stl",
            }],
            "assembly": None,
        }
        review = build_engineering_review(self.project_id, manifest)
        part = review["critical_parts"][0]
        codes = {issue["code"] for issue in part["blocking_issues"]}
        self.assertEqual(review["status"], "BLOCKED")
        self.assertIn("contract_not_passed", codes)
        self.assertIn("step_file_missing", codes)
        self.assertIn("stl_file_missing", codes)

    def test_assembly_hard_collision_blocks_while_exemptions_warn(self) -> None:
        self._write_files("assembly_001.step", "assembly_001_report.json")
        manifest = {
            "parts": [{
                "name": "gear", "version": 1, "status": "active", "material": "steel",
                "contract_passed": True, "step_file": "v001_gear.step", "stl_file": "v001_gear.stl",
                "validation_status": "PASS", "role": "drive", "depends_on": [], "pose": {"position": [0, 0, 0]},
            }],
            "assembly": {
                "step_file": "assembly_001.step", "report_file": "assembly_001_report.json",
                "parts_count": 1, "total_pairs": 1, "interfering_count": 1, "exempted_count": 1,
                "hard_collision_count": 1, "expected_fit_count": 1, "expected_mesh_count": 0,
                "pairs": [{"name_a": "gear", "name_b": "gear", "interfering": True, "volume_mm3": 1.0}],
            },
        }
        review = build_engineering_review(self.project_id, manifest)
        assembly_codes = {issue["code"] for issue in review["assembly"]["blocking_issues"]}
        part_codes = {issue["code"] for issue in review["critical_parts"][0]["blocking_issues"]}
        self.assertEqual(review["status"], "BLOCKED")
        self.assertIn("hard_collision", assembly_codes)
        self.assertIn("hard_collision", part_codes)
        self.assertTrue(any(issue["code"] == "expected_fit" for issue in review["assembly"]["warning_issues"]))

    def test_assembly_count_mismatch_blocks_and_no_fake_material_fields(self) -> None:
        self._write_files("assembly_001.step", "assembly_001_report.json")
        self._write_files("v001_gear.step", "v001_gear.stl")
        manifest = {
            "parts": [{
                "name": "gear", "version": 1, "status": "active", "material": "steel",
                "contract_passed": True, "step_file": "v001_gear.step", "stl_file": "v001_gear.stl",
                "validation_status": "PASS", "role": "drive", "depends_on": [],
            }],
            "assembly": {
                "step_file": "assembly_001.step", "report_file": "assembly_001_report.json",
                "parts_count": 3, "hard_collision_count": 0, "total_pairs": 0,
            },
        }
        review = build_engineering_review(self.project_id, manifest)
        self.assertEqual(review["status"], "BLOCKED")
        self.assertIn(
            "assembly_parts_count_mismatch",
            {issue["code"] for issue in review["assembly"]["blocking_issues"]},
        )
        serialized = str(review)
        for forbidden in ("6061", "45 steel", "yield", "tensile", "hardness", "density"):
            self.assertNotIn(forbidden.lower(), serialized.lower())


class EngineeringReviewApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(main_module.app)

    def setUp(self) -> None:
        self._old_root = storage.PROJECT_PARTS_ROOT
        self._tmp = tempfile.TemporaryDirectory(prefix="mechcad-eng-api-")
        storage.PROJECT_PARTS_ROOT = Path(self._tmp.name) / "project_parts"
        self.project_id = self.client.post("/api/projects", json={"name": "engineering"}).json()["project_id"]
        self.lib = storage.project_parts_dir(self.project_id)
        self.lib.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        storage.PROJECT_PARTS_ROOT = self._old_root
        self._tmp.cleanup()

    def test_api_returns_schema_and_missing_project_404(self) -> None:
        (self.lib / "v001_gear.step").write_text("step", encoding="utf-8")
        (self.lib / "v001_gear.stl").write_text("stl", encoding="utf-8")
        storage.write_manifest(self.project_id, {
            "parts": [{
                "name": "gear", "version": 1, "status": "active", "material": "steel",
                "contract_passed": True, "step_file": "v001_gear.step", "stl_file": "v001_gear.stl",
                "validation_status": "PASS", "role": "drive", "depends_on": [],
            }],
            "assembly": None,
        })
        response = self.client.get(f"/api/projects/{self.project_id}/engineering/review")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "WARNING")
        self.assertEqual(payload["materials"][0]["material"], "steel")
        self.assertEqual(payload["critical_parts"][0]["part"], "gear")
        self.assertTrue(payload["assembly"]["warning_issues"])
        missing = self.client.get("/api/projects/missing-project/engineering/review")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
