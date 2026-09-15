"""v0.20 模型配置台后端链路：参数解析、拉模型列表、密钥尾号、诊断字段。"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ["MECHCAD_STORE_PATH"] = str(Path(tempfile.mkdtemp(prefix="mechcad-console-")) / "projects.json")

from fastapi.testclient import TestClient

import backend.main as main_module
from backend.mechcad_ai import client as client_module
from backend.mechcad_ai.client import _extract_model_ids, list_role_models, resolve_role_params, test_model_connection
from backend.schemas import ArtifactSet

FAKE_ARTIFACTS = ArtifactSet(
    run_id="r", step="/tmp/m.step", stl="/tmp/m.stl", obj="/tmp/m.obj",
    report="/tmp/r.md", execution_report="/tmp/e.json",
)


def _fake_worker(plan, timeout: int = 45, language: str = "zh", on_step=None):
    return FAKE_ARTIFACTS, ["ok"], True


def _settings(**overrides) -> SimpleNamespace:
    base = {
        "vision_provider": "custom", "vision_model": "v-model", "vision_base_url": "https://vision.test/v1",
        "vision_api_key": "sk-vision-secret", "vision_protocol": "openai",
        "planner_provider": "custom", "planner_model": "p-model", "planner_base_url": "https://planner.test",
        "planner_api_key": "sk-planner-secret", "planner_protocol": "openai",
        "vision_temperature": None, "vision_max_tokens": None, "vision_timeout_s": None, "vision_max_retries": None,
        "planner_temperature": None, "planner_max_tokens": None, "planner_timeout_s": None, "planner_max_retries": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


# 测试期间中和 .env 的 MECHCAD_* 兜底，保证默认值路径确定。
CLEAR_PARAMS_ENV = {
    "MECHCAD_VISION_TEMPERATURE": "", "MECHCAD_VISION_MAX_TOKENS": "", "MECHCAD_VISION_TIMEOUT": "",
    "MECHCAD_VISION_MAX_RETRIES": "", "MECHCAD_PLANNER_TEMPERATURE": "", "MECHCAD_PLANNER_MAX_TOKENS": "",
    "MECHCAD_PLANNER_TIMEOUT": "", "MECHCAD_PLANNER_MAX_RETRIES": "",
}


class ResolveRoleParamsTests(unittest.TestCase):
    def test_settings_beat_env(self) -> None:
        settings = _settings(vision_temperature=0.85, vision_max_tokens=2048, vision_timeout_s=45, vision_max_retries=3)
        with patch.dict(os.environ, {**CLEAR_PARAMS_ENV, "MECHCAD_VISION_MAX_TOKENS": "111", "MECHCAD_VISION_TIMEOUT": "7"}):
            params = resolve_role_params(settings, "vision")
        self.assertEqual(params, {"temperature": 0.85, "max_tokens": 2048, "timeout": 45, "max_retries": 3})

    def test_env_beats_default(self) -> None:
        with patch.dict(os.environ, {**CLEAR_PARAMS_ENV, "MECHCAD_PLANNER_MAX_TOKENS": "32000", "MECHCAD_PLANNER_TEMPERATURE": "0.4", "MECHCAD_PLANNER_TIMEOUT": "120", "MECHCAD_PLANNER_MAX_RETRIES": "2"}):
            params = resolve_role_params(_settings(), "planner")
        self.assertEqual(params, {"temperature": 0.4, "max_tokens": 32000, "timeout": 120, "max_retries": 2})

    def test_defaults_and_call_site_default_budget(self) -> None:
        with patch.dict(os.environ, CLEAR_PARAMS_ENV):
            params = resolve_role_params(_settings(), "vision")
            self.assertEqual(params, {"temperature": 0.1, "max_tokens": 4096, "timeout": 90, "max_retries": 1})
            agent = resolve_role_params(_settings(), "planner", default_max_tokens=32768)
            self.assertEqual(agent["max_tokens"], 32768)

    def test_bad_env_falls_back(self) -> None:
        with patch.dict(os.environ, {**CLEAR_PARAMS_ENV, "MECHCAD_VISION_MAX_TOKENS": "abc"}):
            self.assertEqual(resolve_role_params(_settings(), "vision")["max_tokens"], 4096)

    def test_unsupported_role_raises(self) -> None:
        with self.assertRaises(ValueError):
            resolve_role_params(_settings(), "executor")


class FakeHTTPResponse:
    def __init__(self, payload=None, status_code=200, content_type="application/json", text=""):
        self._payload = payload
        self.ok = status_code < 400
        self.status_code = status_code
        self.headers = {"content-type": content_type}
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class ListRoleModelsTests(unittest.TestCase):
    def test_openai_shape_success_dedup(self) -> None:
        settings = _settings()
        response = FakeHTTPResponse({"data": [{"id": "gpt-a"}, {"id": "gpt-b"}, {"id": "gpt-a"}]})
        with patch.object(client_module.requests, "get", return_value=response) as get:
            result = list_role_models(settings, "vision")
        self.assertTrue(result["ok"])
        self.assertEqual(result["model_ids"], ["gpt-a", "gpt-b"])
        self.assertIsNotNone(result["elapsed_ms"])
        self.assertEqual(get.call_args.args[0], "https://vision.test/v1/models")

    def test_double_probe_when_first_url_404s(self) -> None:
        settings = _settings(vision_base_url="https://gw.test")
        urls = []

        def fake_get(url, headers=None, timeout=None):
            urls.append(url)
            if url.endswith("/v1/models"):
                return FakeHTTPResponse({"data": [{"id": "m1"}]})
            return FakeHTTPResponse(status_code=404, content_type="text/plain")

        with patch.object(client_module.requests, "get", side_effect=fake_get):
            result = list_role_models(settings, "vision")
        self.assertTrue(result["ok"])
        self.assertEqual(urls, ["https://gw.test/models", "https://gw.test/v1/models"])
        self.assertEqual(result["endpoint"], "https://gw.test/v1/models")

    def test_short_circuits_on_first_success(self) -> None:
        settings = _settings(vision_base_url="https://gw.test")
        urls = []

        def fake_get(url, headers=None, timeout=None):
            urls.append(url)
            return FakeHTTPResponse({"data": [{"id": "m1"}]})

        with patch.object(client_module.requests, "get", side_effect=fake_get):
            result = list_role_models(settings, "vision")
        self.assertTrue(result["ok"])
        self.assertEqual(urls, ["https://gw.test/models"])

    def test_401_reports_auth_without_leaking_key(self) -> None:
        settings = _settings()
        with patch.object(client_module.requests, "get", return_value=FakeHTTPResponse(status_code=401, content_type="text/plain", text="bad key")):
            result = list_role_models(settings, "vision")
        self.assertFalse(result["ok"])
        self.assertIn("401", result["message"])
        self.assertNotIn("sk-vision-secret", result["message"])

    def test_incomplete_config_no_network(self) -> None:
        settings = _settings(vision_api_key="", vision_base_url="")
        env = {"MECHCAD_VISION_API_KEY": "", "MECHCAD_VISION_BASE_URL": ""}
        with patch.dict(os.environ, env), patch.object(client_module.requests, "get") as get:
            result = list_role_models(settings, "vision")
        self.assertFalse(result["ok"])
        self.assertEqual(result["model_ids"], [])
        get.assert_not_called()

    def test_anthropic_path_uses_v1_models(self) -> None:
        settings = _settings(vision_protocol="anthropic", vision_base_url="https://api.anthropic.test")
        response = FakeHTTPResponse({"data": [{"type": "model", "id": "claude-x"}]})
        with patch.object(client_module.requests, "get", return_value=response) as get:
            result = list_role_models(settings, "vision")
        self.assertTrue(result["ok"])
        self.assertEqual(result["model_ids"], ["claude-x"])
        self.assertEqual(get.call_args.args[0], "https://api.anthropic.test/v1/models")

    def test_extract_model_ids_string_items(self) -> None:
        self.assertEqual(_extract_model_ids({"data": ["a", "b", "a"]}), ["a", "b"])
        self.assertEqual(_extract_model_ids({"models": [{"name": "m"}]}), ["m"])
        self.assertEqual(_extract_model_ids(None), [])


class TestModelConnectionDiagnosticsTests(unittest.TestCase):
    def test_elapsed_and_echo(self) -> None:
        settings = _settings()
        response = FakeHTTPResponse({"choices": [{"message": {"content": "OK"}}]})
        with patch.object(client_module.requests, "post", return_value=response):
            result = test_model_connection(settings, "vision")
        self.assertTrue(result["ok"])
        self.assertIsInstance(result["elapsed_ms"], int)
        self.assertEqual(result["echo"], "OK")
        self.assertFalse(result["echo_truncated"])

    def test_long_echo_truncated_to_60(self) -> None:
        settings = _settings()
        long_text = "x" * 100
        response = FakeHTTPResponse({"choices": [{"message": {"content": long_text}}]})
        with patch.object(client_module.requests, "post", return_value=response):
            result = test_model_connection(settings, "vision")
        self.assertEqual(result["echo"], "x" * 60)
        self.assertTrue(result["echo_truncated"])


class MaskKeyTests(unittest.TestCase):
    def test_tail_exposed_for_long_keys(self) -> None:
        self.assertEqual(main_module._mask_key("sk-abcdefgcret"), "***configured:cret***")
        self.assertEqual(main_module._mask_key(""), "")
        # 短密钥不带尾号，避免几乎完全暴露。
        self.assertEqual(main_module._mask_key("short-key"), "***configured***")

    def test_mask_values_treated_as_unchanged(self) -> None:
        self.assertTrue(main_module._is_mask_value("***configured:abcd***"))
        self.assertTrue(main_module._is_mask_value("***configured***"))
        self.assertTrue(main_module._is_mask_value(""))
        self.assertFalse(main_module._is_mask_value("sk-real-new-key"))


class ModelConsoleApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(main_module.app)

    def _project(self) -> str:
        return self.client.post("/api/projects", json={"name": "console"}).json()["project_id"]

    def test_settings_param_round_trip(self) -> None:
        project_id = self._project()
        payload = {
            "vision_temperature": 0.5, "vision_max_tokens": 1024, "planner_timeout_s": 180,
            "planner_max_retries": 4,
        }
        response = self.client.patch(f"/api/projects/{project_id}/settings", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        settings = response.json()["settings"]
        self.assertEqual(settings["vision_temperature"], 0.5)
        self.assertEqual(settings["vision_max_tokens"], 1024)
        self.assertEqual(settings["planner_timeout_s"], 180)
        self.assertEqual(settings["planner_max_retries"], 4)
        self.assertIsNone(settings["planner_temperature"])

    def test_out_of_range_param_rejected(self) -> None:
        project_id = self._project()
        response = self.client.patch(f"/api/projects/{project_id}/settings", json={"vision_temperature": 9.0})
        self.assertEqual(response.status_code, 422)

    def test_masked_key_round_trip_preserves_secret(self) -> None:
        project_id = self._project()
        secret = "sk-super-secret-value"
        self.client.patch(f"/api/projects/{project_id}/settings", json={"vision_api_key": secret})
        public = self.client.get(f"/api/projects/{project_id}").json()
        self.assertEqual(public["settings"]["vision_api_key"], "***configured:alue***")
        # 提交掩码值不覆盖真实密钥；提交新密钥则替换。
        self.client.patch(f"/api/projects/{project_id}/settings", json={"vision_api_key": "***configured:alue***"})
        self.assertEqual(main_module.store.get_project(project_id).settings.vision_api_key, secret)
        self.client.patch(f"/api/projects/{project_id}/settings", json={"vision_api_key": "sk-replaced-key-1234"})
        self.assertEqual(main_module.store.get_project(project_id).settings.vision_api_key, "sk-replaced-key-1234")

    def test_generate_with_masked_settings_cannot_wipe_secret(self) -> None:
        """v0.20 回归：generate 携带掩码 key 也不得覆盖已存真实密钥（session 兜底）。"""
        project_id = self._project()
        secret = "sk-keep-me-12345"
        self.client.patch(f"/api/projects/{project_id}/settings", json={"vision_api_key": secret})
        body = {
            "description": "40mm x 20mm 平板",
            "model_config": {
                "vision_api_key": "***configured:2345***",
                "planner_api_key": "***configured***",
            },
        }
        with patch.object(main_module, "run_freecad_worker", side_effect=_fake_worker):
            response = self.client.post(f"/api/projects/{project_id}/generate", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        stored = main_module.store.get_project(project_id).settings
        self.assertEqual(stored.vision_api_key, secret)

    def test_model_list_endpoint_ok_and_no_key_leak(self) -> None:
        response = FakeHTTPResponse({"data": [{"id": "model-a"}]})
        body = {
            "role": "vision",
            "config": {
                "vision_base_url": "https://list.test/v1", "vision_api_key": "sk-list-secret",
                "vision_model": "model-a", "vision_protocol": "openai",
            },
            "language": "en",
        }
        with patch.object(client_module.requests, "get", return_value=response):
            result = self.client.post("/api/model/list", json=body).json()
        self.assertTrue(result["ok"])
        self.assertEqual(result["model_ids"], ["model-a"])
        self.assertIsNotNone(result["elapsed_ms"])

    def test_model_list_endpoint_failure_message_no_key(self) -> None:
        body = {
            "role": "planner",
            "config": {
                "planner_base_url": "https://list.test", "planner_api_key": "sk-leak-check-9999",
                "planner_model": "m", "planner_protocol": "openai",
            },
            "language": "zh",
        }
        env = {"MECHCAD_PLANNER_API_KEY": "", "MECHCAD_PLANNER_BASE_URL": ""}
        with patch.dict(os.environ, env), patch.object(client_module.requests, "get", return_value=FakeHTTPResponse(status_code=401, content_type="text/plain")):
            response = self.client.post("/api/model/list", json=body)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertFalse(result["ok"])
        self.assertNotIn("sk-leak-check-9999", response.text)


if __name__ == "__main__":
    unittest.main()
