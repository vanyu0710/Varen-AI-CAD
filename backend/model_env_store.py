from __future__ import annotations

"""Persistent model configuration for the UI.

The project store remains the per-project override. This module adds an explicit,
merge-preserving ``.env`` writer so the model console can save global defaults and
provider profiles without asking users to edit a text file by hand.

Secrets are written only to the local ignored ``.env`` file. API responses use
``_safe_role`` and never include full keys.
"""

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from dotenv import dotenv_values

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
ROLES = ("vision", "planner")
ROLE_FIELDS = ("api_key", "base_url", "model", "protocol", "provider")
REQUIRED_FIELDS = ("api_key", "base_url", "model")
MASK_PREFIX = "***configured"
_PROVIDER_RE = re.compile(r"^[a-z0-9-]{1,64}$")
_PROFILE_RE = re.compile(r"^MECHCAD_MODEL_PROFILE__(VISION|PLANNER)__([A-Z0-9-]+)__API_KEY$")
_ASSIGNMENT_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*=")


def normalize_provider(provider: str) -> str:
    value = str(provider or "").strip().lower()
    if not _PROVIDER_RE.fullmatch(value):
        raise ValueError("provider must contain only lowercase letters, digits, and hyphens")
    return value


def _active_key(role: str, field: str) -> str:
    return f"MECHCAD_{role.upper()}_{field.upper()}"


def _profile_key(role: str, provider: str, field: str) -> str:
    return f"MECHCAD_MODEL_PROFILE__{role.upper()}__{provider.upper()}__{field.upper()}"


def _read_env() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    return {
        str(key): "" if value is None else str(value)
        for key, value in dotenv_values(ENV_PATH, verbose=False).items()
    }


def _tail(value: str) -> str:
    return value[-4:] if len(value) >= 12 else ""


def _safe_role(role: str, values: dict[str, str]) -> dict[str, Any]:
    configured = all(values.get(field, "") for field in REQUIRED_FIELDS)
    missing = [field for field in REQUIRED_FIELDS if not values.get(field, "")]
    return {
        "role": role,
        "provider": values.get("provider", ""),
        "configured": configured,
        "source": "env" if configured else "none",
        "model": values.get("model", ""),
        "base_url": values.get("base_url", ""),
        "protocol": values.get("protocol", ""),
        "api_key_tail": _tail(values.get("api_key", "")),
        "missing": missing,
    }


def read_active_env() -> dict[str, dict[str, Any]]:
    raw = _read_env()
    return {
        role: _safe_role(role, {field: raw.get(_active_key(role, field), "") for field in ROLE_FIELDS})
        for role in ROLES
    }


def read_profiles() -> dict[str, list[dict[str, Any]]]:
    raw = _read_env()
    providers: dict[str, set[str]] = {role: set() for role in ROLES}
    for key in raw:
        match = _PROFILE_RE.fullmatch(key)
        if match:
            providers[match.group(1).lower()].add(match.group(2).lower())

    result: dict[str, list[dict[str, Any]]] = {}
    for role in ROLES:
        profiles = []
        for provider in sorted(providers[role]):
            values = {
                field: raw.get(_profile_key(role, provider, field), "")
                for field in ROLE_FIELDS
            }
            values["provider"] = provider
            item = _safe_role(role, values)
            item["source"] = "profile"
            profiles.append(item)
        result[role] = profiles
    return result


def _format_line(key: str, value: str) -> str:
    # json.dumps gives dotenv-compatible double quoting and escaping.
    return f"{key}={json.dumps(value, ensure_ascii=False)}"


def _write_env(updates: dict[str, str]) -> None:
    if not updates:
        return
    ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    output: list[str] = []
    seen: set[str] = set()
    for line in lines:
        match = _ASSIGNMENT_RE.match(line)
        if match and match.group(1) in updates:
            key = match.group(1)
            if key in seen:
                # dotenv uses the last definition; dropping duplicates avoids stale values.
                continue
            output.append(_format_line(key, updates[key]))
            seen.add(key)
            continue
        output.append(line)

    missing = [key for key in updates if key not in seen]
    if missing:
        if output and output[-1].strip():
            output.append("")
        output.append("# Varen CAD model console profiles (managed by the UI)")
        output.extend(_format_line(key, updates[key]) for key in missing)

    temporary = ENV_PATH.with_name(f".{ENV_PATH.name}.tmp-{uuid.uuid4().hex}")
    temporary.write_text("\n".join(output) + ("\n" if output else ""), encoding="utf-8", newline="\n")
    os.replace(temporary, ENV_PATH)


def _sync_process_env(updates: dict[str, str]) -> None:
    for key, value in updates.items():
        if value:
            os.environ[key] = value
        else:
            os.environ.pop(key, None)


def _resolve_key(incoming: str, *, existing: str, project: str) -> str:
    value = str(incoming or "").strip()
    if value.startswith(MASK_PREFIX):
        # A project mask means “copy the stored project key”; if that field is empty,
        # preserve an existing .env/profile key instead of writing the mask itself.
        return project or existing
    return value


def save_model_env(
    config, fallback_settings, role: str | None = None
) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Save the draft as active .env values and as per-role provider profiles.

    The write is additive: unrelated variables and comments in ``.env`` are kept.
    When the UI saves one role, the other role's existing ``.env`` values are left
    untouched instead of being cleared by blank project-override fields.
    """
    if role is None:
        selected_roles = ROLES
    elif role in ROLES:
        selected_roles = (role,)
    else:
        raise ValueError(f"unsupported model role: {role}")

    raw = _read_env()
    updates: dict[str, str] = {}
    for role in selected_roles:
        provider = normalize_provider(getattr(config, f"{role}_provider", "custom"))
        for field in ROLE_FIELDS:
            attr = f"{role}_{field}"
            incoming = str(getattr(config, attr, "") or "").strip()
            active_key = _active_key(role, field)
            profile_key = _profile_key(role, provider, field)
            if field == "provider":
                active_value = provider
                profile_value = provider
            elif field == "api_key":
                project_value = str(getattr(fallback_settings, attr, "") or "")
                active_value = _resolve_key(incoming, existing=raw.get(active_key, ""), project=project_value)
                profile_value = _resolve_key(incoming, existing=raw.get(profile_key, ""), project=project_value)
            else:
                active_value = incoming
                profile_value = incoming
            updates[active_key] = active_value
            updates[profile_key] = profile_value

    _write_env(updates)
    _sync_process_env(updates)
    return read_active_env(), read_profiles()


def apply_model_env_profile(role: str, provider: str) -> dict[str, Any]:
    """Make a saved provider profile the active .env configuration for one role."""
    if role not in ROLES:
        raise ValueError(f"unsupported model role: {role}")
    provider = normalize_provider(provider)
    raw = _read_env()
    profile = {
        field: raw.get(_profile_key(role, provider, field), "")
        for field in ROLE_FIELDS
    }
    if not any(profile.values()):
        raise KeyError(provider)
    missing = [field for field in REQUIRED_FIELDS if not profile[field]]
    if missing:
        raise ValueError(f"incomplete profile, missing: {', '.join(missing)}")

    updates = {_active_key(role, field): profile[field] for field in ROLE_FIELDS}
    updates[_active_key(role, "provider")] = provider
    _write_env(updates)
    _sync_process_env(updates)
    return read_active_env()[role]
