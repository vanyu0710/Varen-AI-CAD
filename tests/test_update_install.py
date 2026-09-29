"""v0.23 phase 2: user-confirmed update download/install tests. No real network."""

from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from typing import Any
from unittest.mock import patch
import importlib.util

import requests

import backend.main as main_module
from fastapi.testclient import TestClient

os.environ.setdefault("MECHCAD_STORE_PATH", str(Path(tempfile.mkdtemp(prefix="mechcad-update-install-")) / "projects.json"))

VERSION = "0.99.0-beta"
ZIP_NAME = f"VarenCAD-win64-{VERSION}.zip"
SHA_NAME = f"VarenCAD-win64-{VERSION}.sha256"


def make_release() -> dict[str, Any]:
    return {
        "tag_name": f"v{VERSION}",
        "draft": False,
        "prerelease": True,
        "html_url": f"https://github.com/vanyu0710/Varen-AI-CAD/releases/tag/v{VERSION}",
        "body": "Test notes",
        "assets": [
            {"name": ZIP_NAME, "browser_download_url": f"https://example.invalid/{ZIP_NAME}"},
            {"name": SHA_NAME, "browser_download_url": f"https://example.invalid/{SHA_NAME}"},
        ],
    }


def make_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"VarenCAD-win64-{VERSION}/VarenCAD.exe", "new-exe")
        archive.writestr(f"VarenCAD-win64-{VERSION}/_internal/app.py", "new-app")
        archive.writestr(f"VarenCAD-win64-{VERSION}/.env.example", "MODEL=\n")
    return buffer.getvalue()


class FakeResponse:
    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int):
        for chunk in self._chunks:
            yield chunk

    def close(self) -> None:
        return None


class CancelableResponse:
    def __init__(self, event: threading.Event):
        self._event = event

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int):
        self._event.wait(timeout=2)
        yield b"partial"

    def close(self) -> None:
        return None


import threading


def wait_for_job(client: TestClient, job_id: str, terminal: set[str]) -> dict[str, Any]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"/api/update/install/{job_id}")
        assert response.status_code == 200, response.text
        data = response.json()
        if data["status"] in terminal:
            return data
        time.sleep(0.01)
    raise AssertionError("update job did not reach terminal status")


def make_app_root(root: Path) -> Path:
    app = root / "VarenCAD"
    (app / "_internal").mkdir(parents=True)
    (app / "_internal" / "app.py").write_text("old-app")
    (app / "work").mkdir()
    (app / "VarenCAD.exe").write_text("old-exe")
    (app / ".env").write_text("API_KEY=secret\n")
    return app


class UpdateInstallTests(unittest.TestCase):
    def setUp(self) -> None:
        main_module._UPDATE_CHECK_CACHE.clear()
        main_module._UPDATE_JOBS.clear()
        main_module._UPDATE_JOB_CANCELS.clear()
        self.client = TestClient(main_module.app)
        self.temp = tempfile.TemporaryDirectory(prefix="varen-update-test-")
        self.root = Path(self.temp.name)
        self.app = make_app_root(self.root)
        self.zip_data = make_zip()
        self.zip_hash = hashlib.sha256(self.zip_data).hexdigest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def fake_downloads(self, chunks: list[bytes] | None = None, sha: str | None = None):
        zip_response = FakeResponse([self.zip_data] if chunks is None else chunks)
        sha_text = self.zip_hash if sha is None else sha
        sha_response = FakeResponse([(sha_text + f"  {ZIP_NAME}\n").encode()])

        def getter(url: str, **kwargs: Any):
            if url.endswith(ZIP_NAME):
                return zip_response
            if url.endswith(SHA_NAME):
                return sha_response
            raise AssertionError(f"unexpected URL: {url}")

        return getter

    def start_job(self) -> dict[str, Any]:
        response = self.client.post("/api/update/install", json={"version": VERSION, "confirm": True})
        assert response.status_code == 202, response.text
        return response.json()

    def test_user_confirmed_download_hash_and_stage_update(self) -> None:
        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", self.fake_downloads()), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})

        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(result["version"], VERSION)
        state = json.loads((self.app / "work" / "update-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["version"], VERSION)
        self.assertEqual(state["status"], "ready")
        self.assertTrue(Path(state["staging_root"]).exists())
        self.assertTrue((Path(state["staging_root"]) / "VarenCAD.exe").read_text() == "new-exe")
        self.assertTrue(Path(state["apply_script"]).exists())
        # Nothing is overwritten while VarenCAD is still running.
        self.assertEqual((self.app / "VarenCAD.exe").read_text(), "old-exe")
        self.assertEqual((self.app / ".env").read_text(), "API_KEY=secret\n")

    def test_hash_mismatch_stops_and_preserves_current_app(self) -> None:
        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", self.fake_downloads(sha="0" * 64)), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "hash_mismatch")
        self.assertFalse((self.app / "work" / "update-state.json").exists())
        self.assertEqual((self.app / "VarenCAD.exe").read_text(), "old-exe")

    def test_interrupted_download_fails_and_preserves_current_app(self) -> None:
        def getter(url: str, **kwargs: Any):
            if url.endswith(ZIP_NAME):
                raise requests.RequestException("connection reset")
            return FakeResponse([b"unused"])

        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", getter), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "download_failed")
        self.assertFalse((self.app / "work" / "update-state.json").exists())
        self.assertEqual((self.app / "VarenCAD.exe").read_text(), "old-exe")

    def test_user_cancel_during_download_stops_install(self) -> None:
        event = threading.Event()
        response = CancelableResponse(event)
        sha_response = FakeResponse([(self.zip_hash + f"  {ZIP_NAME}\n").encode()])

        def getter(url: str, **kwargs: Any):
            return response if url.endswith(ZIP_NAME) else sha_response

        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", getter), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            time.sleep(0.05)
            cancel = self.client.post(f"/api/update/install/{job['job_id']}/cancel")
            self.assertEqual(cancel.status_code, 200, cancel.text)
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})

        self.assertEqual(result["status"], "cancelled")
        self.assertFalse((self.app / "work" / "update-state.json").exists())
        self.assertEqual((self.app / "VarenCAD.exe").read_text(), "old-exe")

    def test_user_can_cancel_prepared_update_before_restart(self) -> None:
        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", self.fake_downloads()), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            ready = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})
            self.assertEqual(ready["status"], "ready", ready)
            staging_root = Path(
                json.loads((self.app / "work" / "update-state.json").read_text(encoding="utf-8"))["staging_root"]
            )
            cancel = self.client.post(f"/api/update/install/{job['job_id']}/cancel")
            self.assertEqual(cancel.status_code, 200, cancel.text)
            self.assertEqual(cancel.json()["status"], "cancelled")

        self.assertFalse((self.app / "work" / "update-state.json").exists())
        self.assertFalse(staging_root.exists())
        self.assertEqual((self.app / "VarenCAD.exe").read_text(), "old-exe")

    def test_launcher_hands_transaction_to_external_script(self) -> None:
        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", self.fake_downloads()), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})
        self.assertEqual(result["status"], "ready", result)

        spec = importlib.util.spec_from_file_location(
            "varen_launcher_test", Path(__file__).resolve().parents[1] / "packaging" / "varen_launcher.py"
        )
        assert spec is not None and spec.loader is not None
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)
        with patch.object(launcher.subprocess, "Popen") as popen:
            self.assertTrue(launcher.apply_pending_update(self.app))
            command = popen.call_args.args[0]
            self.assertEqual(command[0], "powershell.exe")
            self.assertIn("-AppRoot", command)
            self.assertIn(str(self.app), command)
            self.assertIn("-StagingRoot", command)
            self.assertIn("-BackupRoot", command)
            self.assertIn("-PreserveRoot", command)
            self.assertIn("-ProcessId", command)
            self.assertIn("-ManifestPath", command)
            self.assertIn(str(self.app / "work" / "update-state.json"), command)

        state = json.loads((self.app / "work" / "update-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["status"], "applying")
        self.assertIn("preserve_root", state)
        self.assertEqual((self.app / "VarenCAD.exe").read_text(), "old-exe")

    def write_user_data(self) -> None:
        (self.app / "work" / "projects.json").write_text('{"projects":["engine"]}\n', encoding="utf-8")
        (self.app / "projects" / "engine").mkdir(parents=True)
        (self.app / "projects" / "engine" / "engine.varen").write_text('{"name":"engine"}\n', encoding="utf-8")
        (self.app / "parts").mkdir()
        (self.app / "parts" / "library.json").write_text('{"parts":["crankcase"]}\n', encoding="utf-8")
        (self.app / "recent-files.json").write_text('["engine.varen"]\n', encoding="utf-8")
        (self.app / "settings.json").write_text('{"language":"zh-CN","theme":"dark"}\n', encoding="utf-8")
        (self.app / "_internal" / "user-config.json").write_text('{"nested":true}\n', encoding="utf-8")

    def assert_user_data_unchanged(self) -> None:
        self.assertEqual((self.app / ".env").read_text(encoding="utf-8"), "API_KEY=secret\n")
        self.assertEqual(
            (self.app / "work" / "projects.json").read_text(encoding="utf-8"),
            '{"projects":["engine"]}\n',
        )
        self.assertEqual(
            (self.app / "projects" / "engine" / "engine.varen").read_text(encoding="utf-8"),
            '{"name":"engine"}\n',
        )
        self.assertEqual((self.app / "parts" / "library.json").read_text(encoding="utf-8"), '{"parts":["crankcase"]}\n')
        self.assertEqual((self.app / "recent-files.json").read_text(encoding="utf-8"), '["engine.varen"]\n')
        self.assertEqual(
            (self.app / "settings.json").read_text(encoding="utf-8"),
            '{"language":"zh-CN","theme":"dark"}\n',
        )
        self.assertEqual((self.app / "_internal" / "user-config.json").read_text(encoding="utf-8"), '{"nested":true}\n')

    def prepare_ready_update(self) -> dict[str, Any]:
        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", self.fake_downloads()), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})
        self.assertEqual(result["status"], "ready", result)
        return json.loads((self.app / "work" / "update-state.json").read_text(encoding="utf-8"))

    def run_apply_script(self, state: dict[str, Any]) -> None:
        waiter = subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-Command", "Start-Sleep -Milliseconds 300"],
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            result = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    str(Path(state["apply_script"])),
                    "-AppRoot",
                    str(self.app),
                    "-StagingRoot",
                    str(state["staging_root"]),
                    "-BackupRoot",
                    str(state["backup_root"]),
                    "-PreserveRoot",
                    str(state["preserve_root"]),
                    "-ProcessId",
                    str(waiter.pid),
                    "-ManifestPath",
                    str(self.app / "work" / "update-state.json"),
                ],
                capture_output=True,
                text=True,
                timeout=20,
            )
        finally:
            waiter.wait(timeout=5)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def run_rollback_script(self, state: dict[str, Any]) -> None:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                str(Path(state["rollback_script"])),
                "-AppRoot",
                str(self.app),
                "-BackupRoot",
                str(state["backup_root"]),
                "-StagingRoot",
                str(state["staging_root"]),
                "-PreserveRoot",
                str(state["preserve_root"]),
                "-ManifestPath",
                str(self.app / "work" / "update-state.json"),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipIf(os.name != "nt", "Windows x64 update transaction")
    def test_apply_update_preserves_all_user_data(self) -> None:
        self.write_user_data()
        state = self.prepare_ready_update()
        self.assertIn("package_files", state)
        self.assertIn(".env.example", state["package_files"])

        self.run_apply_script(state)
        self.assertEqual((self.app / "VarenCAD.exe").read_text(encoding="utf-8"), "new-exe")
        self.assertEqual((self.app / "_internal" / "app.py").read_text(encoding="utf-8"), "new-app")
        self.assert_user_data_unchanged()
        self.assertEqual(
            json.loads((self.app / "work" / "update-state.json").read_text(encoding="utf-8"))["status"],
            "applied",
        )
        self.assertFalse(Path(state["preserve_root"]).exists())
        self.assertNotIn("Start-Process", Path(state["apply_script"]).read_text(encoding="utf-8"))

    @unittest.skipIf(os.name != "nt", "Windows x64 update transaction")
    def test_rollback_preserves_current_user_data(self) -> None:
        self.write_user_data()
        state = self.prepare_ready_update()
        self.run_apply_script(state)
        self.assertEqual((self.app / "VarenCAD.exe").read_text(encoding="utf-8"), "new-exe")

        self.run_rollback_script(state)
        self.assertEqual((self.app / "VarenCAD.exe").read_text(encoding="utf-8"), "old-exe")
        self.assertEqual((self.app / "_internal" / "app.py").read_text(encoding="utf-8"), "old-app")
        self.assert_user_data_unchanged()
        self.assertEqual(
            json.loads((self.app / "work" / "update-state.json").read_text(encoding="utf-8"))["status"],
            "rolled_back",
        )
        self.assertFalse(Path(state["preserve_root"]).exists())

    def test_failed_install_preserves_user_data(self) -> None:
        self.write_user_data()
        with patch.object(main_module, "APP_VERSION", "0.22.3-beta"), patch.object(
            main_module, "_fetch_update_releases", return_value=[make_release()]
        ), patch.object(main_module.requests, "get", self.fake_downloads(sha="0" * 64)), patch.dict(
            os.environ, {"MECHCAD_UPDATE_INSTALL_ROOT": str(self.app)}
        ):
            job = self.start_job()
            result = wait_for_job(self.client, job["job_id"], {"ready", "failed", "cancelled"})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "hash_mismatch")
        self.assertEqual((self.app / "VarenCAD.exe").read_text(encoding="utf-8"), "old-exe")
        self.assert_user_data_unchanged()
        self.assertFalse((self.app / "work" / "update-state.json").exists())

    def test_install_requires_explicit_confirmation(self) -> None:
        response = self.client.post("/api/update/install", json={"version": VERSION, "confirm": False})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "confirmation_required")


if __name__ == "__main__":
    unittest.main()
