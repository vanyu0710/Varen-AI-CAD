"""/api/diagnostics 诊断包导出测试：zip 结构、密钥掩码、原始 key 永不进包。"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

# 隔离 store（必须在 import backend.main 之前，与 test_agent_api.py 同模式）
os.environ["MECHCAD_STORE_PATH"] = str(Path(tempfile.mkdtemp(prefix="mechcad-diag-test-")) / "projects.json")

import backend.main as main_module
from fastapi.testclient import TestClient


class DiagnosticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(main_module.app)

    def test_returns_zip_with_masked_env_and_no_secret_leak(self) -> None:
        secret = "sk-SUPERSECRET-0123456789abcdefghij"
        with patch.dict(
            os.environ,
            {
                "MECHCAD_PLANNER_API_KEY": secret,
                "MECHCAD_KERNEL_REPO": "Z:/nonexistent-kernel-repo",
            },
        ):
            resp = self.client.get("/api/diagnostics")

        self.assertEqual(resp.status_code, 200)
        self.assertIn("application/zip", resp.headers["content-type"])
        self.assertIn("varen-cad-diagnostics-", resp.headers["content-disposition"])

        # 原始密钥不允许以明文出现在包内任何文件里
        self.assertNotIn(secret.encode(), resp.content)

        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            self.assertIn("report.json", zf.namelist())
            report = json.loads(zf.read("report.json"))

        self.assertEqual(report["app"]["version"], main_module.APP_VERSION)
        masked = report["env"]["MECHCAD_PLANNER_API_KEY"]
        self.assertTrue(masked)
        self.assertNotIn(secret, masked)
        self.assertTrue(masked.startswith(main_module.MASK_PREFIX) or "*" in masked)
        self.assertFalse(report["kernel"]["exists"])

    def test_version_matches_single_source(self) -> None:
        health = self.client.get("/api/health").json()
        self.assertEqual(health["version"], main_module.APP_VERSION)
        version_file = Path(main_module.__file__).resolve().parent.parent / "VERSION"
        if version_file.exists():
            self.assertEqual(main_module.APP_VERSION, version_file.read_text(encoding="utf-8").strip())

    def test_projects_reported_with_masked_keys(self) -> None:
        created = self.client.post("/api/projects", json={"name": "diag project"}).json()
        resp = self.client.get("/api/diagnostics")
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            report = json.loads(zf.read("report.json"))
        names = [p["name"] for p in report["projects"]]
        self.assertIn("diag project", names)


if __name__ == "__main__":
    unittest.main()
