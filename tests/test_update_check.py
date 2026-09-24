"""v0.23 phase 1: check-only update API tests. No test touches real GitHub."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["MECHCAD_STORE_PATH"] = str(Path(tempfile.mkdtemp(prefix="mechcad-update-test-")) / "projects.json")

import requests

import backend.main as main_module
from fastapi.testclient import TestClient


def release(
    tag: str,
    *,
    prerelease: bool = False,
    draft: bool = False,
    body: str = "Release notes",
    assets: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "tag_name": tag,
        "draft": draft,
        "prerelease": prerelease,
        "html_url": f"https://github.com/vanyu0710/Varen-AI-CAD/releases/tag/{tag}",
        "body": body,
        "assets": assets if assets is not None else [
            {
                "name": f"VarenCAD-win64-{tag.lstrip('v')}.zip",
                "browser_download_url": f"https://example.invalid/{tag}/VarenCAD-win64-{tag.lstrip('v')}.zip",
            },
            {
                "name": f"VarenCAD-win64-{tag.lstrip('v')}.sha256",
                "browser_download_url": f"https://example.invalid/{tag}/VarenCAD-win64-{tag.lstrip('v')}.sha256",
            },
        ],
    }


class UpdateCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        main_module._UPDATE_CHECK_CACHE.clear()
        self.client = TestClient(main_module.app)

    def test_version_parser_and_ordering(self) -> None:
        stable = main_module._parse_update_version("v0.22.2")
        beta = main_module._parse_update_version("0.22.2-beta")
        older_beta = main_module._parse_update_version("0.22.1-beta")
        self.assertEqual(stable, ((0, 22, 2), ()))
        self.assertEqual(beta, ((0, 22, 2), ("beta",)))
        self.assertGreater(main_module._compare_update_versions(stable, beta), 0)
        self.assertGreater(main_module._compare_update_versions(beta, older_beta), 0)
        self.assertIsNone(main_module._parse_update_version("not-a-version"))

    def test_invalid_numeric_settings_fall_back_to_safe_defaults(self) -> None:
        with patch.dict(os.environ, {"MECHCAD_UPDATE_TIMEOUT": "nan", "MECHCAD_UPDATE_CACHE_SECONDS": "1e999"}):
            self.assertEqual(main_module._update_timeout(), 4.0)
            self.assertEqual(main_module._update_cache_seconds(), 21600.0)

    def test_disabled_does_not_call_network(self) -> None:
        with patch.dict(os.environ, {"MECHCAD_UPDATE_CHECK": "false"}):
            with patch.object(main_module, "_fetch_update_releases") as fetch:
                response = self.client.get("/api/update/check")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "disabled")
        self.assertFalse(response.json()["update_available"])
        fetch.assert_not_called()

    def test_beta_channel_reports_new_release_and_assets(self) -> None:
        latest = release("v0.99.0-beta", prerelease=True)
        with patch.dict(os.environ, {"MECHCAD_UPDATE_CHANNEL": "beta"}):
            with patch.object(main_module, "_fetch_update_releases", return_value=[latest]) as fetch:
                response = self.client.get("/api/update/check")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["latest_version"], "0.99.0-beta")
        self.assertTrue(data["update_available"])
        self.assertEqual(data["release_url"], latest["html_url"])
        self.assertEqual([asset["name"] for asset in data["assets"]], [
            "VarenCAD-win64-0.99.0-beta.zip",
            "VarenCAD-win64-0.99.0-beta.sha256",
        ])
        fetch.assert_called_once()

    def test_stable_channel_excludes_prereleases(self) -> None:
        releases = [
            release("v0.99.0-beta", prerelease=True),
            release("v0.50.0"),
        ]
        with patch.dict(os.environ, {"MECHCAD_UPDATE_CHANNEL": "stable"}):
            with patch.object(main_module, "_fetch_update_releases", return_value=releases):
                data = self.client.get("/api/update/check").json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["latest_version"], "0.50.0")
        self.assertTrue(data["update_available"])

    def test_same_version_is_not_an_update(self) -> None:
        current = main_module.APP_VERSION.strip()
        with patch.object(main_module, "_fetch_update_releases", return_value=[release(f"v{current}", prerelease=current.endswith("-beta"))]):
            data = self.client.get("/api/update/check").json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["latest_version"], current)
        self.assertFalse(data["update_available"])

    def test_network_failure_degrades_to_unavailable_http_200(self) -> None:
        with patch.object(main_module, "_fetch_update_releases", side_effect=requests.RequestException("offline")):
            response = self.client.get("/api/update/check")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unavailable")
        self.assertFalse(response.json()["update_available"])

    def test_cache_and_force(self) -> None:
        with patch.object(main_module, "_fetch_update_releases", return_value=[release("v0.99.0-beta", prerelease=True)]) as fetch:
            first = self.client.get("/api/update/check").json()
            second = self.client.get("/api/update/check").json()
            self.client.get("/api/update/check?force=true")
        self.assertEqual(first, second)
        self.assertEqual(fetch.call_count, 2)

    def test_draft_and_invalid_tags_are_skipped(self) -> None:
        releases = [
            release("draft", draft=True),
            release("not-a-version"),
            release("v0.60.0-beta", prerelease=True),
        ]
        with patch.object(main_module, "_fetch_update_releases", return_value=releases):
            data = self.client.get("/api/update/check").json()
        self.assertEqual(data["latest_version"], "0.60.0-beta")
        self.assertTrue(data["update_available"])


if __name__ == "__main__":
    unittest.main()
