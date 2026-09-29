from __future__ import annotations

import os
import pytest
from unittest.mock import MagicMock

from backend.agent.loop import _validate_modeling_script_safety
from backend.mechcad_ai.client import (
    ApiCallError,
    chat_completion,
    chat_completion_with_tools,
    is_safe_endpoint_url,
    list_role_models,
    test_model_connection as run_test_model_connection,
)
from backend.storage import artifact_path
from backend.main import _is_allowed_origin


def test_test_model_connection_does_not_leak_env_api_key_to_custom_base_url(monkeypatch):
    monkeypatch.setenv("MECHCAD_PLANNER_API_KEY", "secret-super-key-12345")
    monkeypatch.setenv("MECHCAD_PLANNER_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("MECHCAD_PLANNER_MODEL", "gpt-4o")

    # Custom attacker base_url with empty api_key -> MUST NOT send request with env key!
    settings_custom = MagicMock(
        planner_protocol="openai",
        planner_base_url="https://attacker-controlled-server.com/v1",
        planner_api_key="",
        planner_model="custom-model",
    )
    result = run_test_model_connection(settings_custom, "planner")
    assert not result["ok"]
    assert "禁止" in result["message"] or "forbidden" in result["message"]

    list_result = list_role_models(settings_custom, "planner")
    assert not list_result["ok"]
    assert "禁止" in list_result["message"] or "forbidden" in list_result["message"]


def test_is_safe_endpoint_url():
    assert is_safe_endpoint_url("https://api.openai.com/v1")
    assert is_safe_endpoint_url("http://127.0.0.1:8000/v1")
    assert not is_safe_endpoint_url("http://169.254.169.254/latest/meta-data")
    assert not is_safe_endpoint_url("http://metadata.google.internal/computeMetadata/v1")
    assert not is_safe_endpoint_url("ftp://example.com/file")
    assert not is_safe_endpoint_url("file:///etc/passwd")


def test_artifact_path_traversal_blocked(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.storage.ARTIFACT_ROOT", tmp_path)
    with pytest.raises(KeyError):
        artifact_path("../../../etc/passwd", "report")
    with pytest.raises(KeyError):
        artifact_path("valid_run/../../secret", "report")
    with pytest.raises(KeyError):
        artifact_path("invalid space id", "report")


def test_modeling_script_safety_validation():
    # PoC 1: generator frame inspection
    poc_gen = """
holder = []
def gen():
    yield holder.append(g.gi_frame)
g = gen()
for _ in g:
    pass
"""
    err = _validate_modeling_script_safety(poc_gen)
    assert err is not None
    assert "禁止" in err

    # PoC 2: direct forbidden attribute access
    poc_attr = "frame = x.f_back.f_builtins"
    err2 = _validate_modeling_script_safety(poc_attr)
    assert err2 is not None
    assert "禁止" in err2

    # PoC 3: class definition
    poc_class = "class Evil:\n    pass"
    err3 = _validate_modeling_script_safety(poc_class)
    assert err3 is not None
    assert "class" in err3

    # Benign modeling script with math and operations
    benign = """
import math
r = 10.0
theta = math.pi / 4
k.box(10, 20, 30)
"""
    assert _validate_modeling_script_safety(benign) is None


def test_websocket_origin_check(monkeypatch):
    assert _is_allowed_origin("http://localhost:5173")
    assert _is_allowed_origin("http://127.0.0.1:8001")
    assert not _is_allowed_origin("https://evil-hacker.com")
    assert not _is_allowed_origin("http://phishing.site:8001")


def test_real_model_calls_do_not_leak_env_key_to_custom_base_url(monkeypatch):
    monkeypatch.setenv("MECHCAD_PLANNER_API_KEY", "secret-super-key-12345")
    monkeypatch.setenv("MECHCAD_PLANNER_BASE_URL", "https://api.openai.com/v1")
    settings = MagicMock(
        planner_protocol="openai",
        planner_base_url="https://attacker-controlled-server.com/v1",
        planner_api_key="",
        planner_model="custom-model",
    )
    post = MagicMock()
    monkeypatch.setattr("backend.mechcad_ai.client.requests.post", post)

    with pytest.raises(ApiCallError) as chat_error:
        chat_completion(settings, "planner", [{"role": "user", "content": "hi"}])
    assert "own API key" in str(chat_error.value)

    with pytest.raises(ApiCallError) as tool_error:
        chat_completion_with_tools(settings, "planner", [{"role": "user", "content": "hi"}], [])
    assert "own API key" in str(tool_error.value)
    post.assert_not_called()


def test_safe_endpoint_url_rejects_trailing_dot_metadata_host():
    assert not is_safe_endpoint_url("http://169.254.169.254./latest/meta-data")
    assert not is_safe_endpoint_url("http://metadata.google.internal./computeMetadata/v1")
