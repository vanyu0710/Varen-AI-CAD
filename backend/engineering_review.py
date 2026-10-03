"""Fact-first engineering review of the project parts library.

This module never invents engineering material specifications. The ``material``
field in the manifest is a viewport rendering proxy; this review only groups and
labels that provenance. All other findings are derived from manifest evidence
and from the geometry/assembly results already recorded by the CAD workflow.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from backend import storage
from backend.agent.materials import resolve_material

_PASS_VALIDATION = {"pass", "passed", "valid", "verified", "ok"}


def _issue(code: str, message: str, parts: list[str] | None = None) -> dict[str, Any]:
    return {"code": code, "message": message, "parts": parts or []}


def _issue_code(issue: dict[str, Any]) -> str:
    return str(issue.get("code") or "")


def _active_parts(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    parts = manifest.get("parts")
    if not isinstance(parts, list):
        return []
    return [part for part in parts if isinstance(part, dict) and part.get("status") != "superseded"]


def _part_name(part: dict[str, Any]) -> str:
    return str(part.get("name") or "").strip()


def _file_available(project_id: str, filename: Any) -> bool:
    name = str(filename or "")
    if not name:
        return False
    try:
        return (storage.project_parts_dir(project_id) / name).is_file()
    except OSError:
        return False


def _pair_part_names(pair: dict[str, Any]) -> list[str]:
    return [str(pair.get("name_a") or ""), str(pair.get("name_b") or "")]


def _is_calculation_error(pair: dict[str, Any]) -> bool:
    return str(pair.get("diagnostic_status") or "") == "calculation_error" or bool(pair.get("error"))


def _material_review(project_id: str, parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for part in parts:
        name = _part_name(part)
        if not name:
            continue
        recorded = part.get("material")
        if isinstance(recorded, str) and recorded.strip():
            material = recorded.strip()
            basis = "manifest"
        else:
            material = resolve_material(name)
            basis = "name_hint"
        group = groups.setdefault(material, {"material": material, "basis": basis, "parts": []})
        group["parts"].append(name)
        # A single mixed group is an evidence inconsistency worth surfacing.
        if group["basis"] != basis:
            group["basis"] = "mixed"
    result: list[dict[str, Any]] = []
    for material in sorted(groups):
        group = groups[material]
        result.append({
            "material": material,
            "part_count": len(group["parts"]),
            "parts": sorted(set(group["parts"])),
            "basis": group["basis"],
        })
    result.sort(key=lambda item: (-item["part_count"], item["material"]))
    return result


def _assembly_review(
    project_id: str,
    parts: list[dict[str, Any]],
    assembly: Any,
) -> tuple[dict[str, Any], dict[str, dict[str, list[str]]]]:
    pair_findings: dict[str, dict[str, list[str]]] = {
        "hard_collision": {},
        "calculation_error": {},
    }
    if not isinstance(assembly, dict):
        return {
            "available": False,
            "exported_at": None,
            "step_file": None,
            "render_file": None,
            "report_file": None,
            "parts_count": 0,
            "active_parts_count": len(parts),
            "total_pairs": 0,
            "interfering_count": 0,
            "exempted_count": 0,
            "hard_collision_count": 0,
            "expected_fit_count": 0,
            "expected_mesh_count": 0,
            "excluded_superseded": [],
            "blocking_issues": [],
            "warning_issues": [_issue("assembly_not_exported", "Assembly has not been exported.")],
        }, pair_findings

    pairs = [pair for pair in (assembly.get("pairs") or []) if isinstance(pair, dict)]
    hard_pairs = [pair for pair in pairs if pair.get("interfering")]
    error_pairs = [pair for pair in pairs if _is_calculation_error(pair)]
    for pair in hard_pairs:
        for name in _pair_part_names(pair):
            pair_findings["hard_collision"].setdefault(name, []).append(
                f"{pair.get('name_a')} × {pair.get('name_b')}")
    for pair in error_pairs:
        for name in _pair_part_names(pair):
            pair_findings["calculation_error"].setdefault(name, []).append(
                f"{pair.get('name_a')} × {pair.get('name_b')}")

    def _count(key: str) -> int:
        value = assembly.get(key)
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    hard_count = max(_count("hard_collision_count"), len(hard_pairs))
    blocking: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if hard_count:
        blocking.append(_issue(
            "hard_collision", f"Assembly report contains {hard_count} hard collision pair(s)."))
    if error_pairs:
        warnings.append(_issue(
            "calculation_error", "Interference details contain calculation error pair(s)."))
    step_file = str(assembly.get("step_file") or "")
    report_file = str(assembly.get("report_file") or "")
    if not step_file or not _file_available(project_id, step_file):
        blocking.append(_issue("assembly_step_missing", "Assembly STEP file is missing from the parts library."))
    parts_count = _count("parts_count")
    if parts_count != len(parts):
        blocking.append(_issue(
            "assembly_parts_count_mismatch",
            f"Assembly recorded {parts_count} part(s), but manifest has {len(parts)} active part(s).",
        ))
    if not report_file or not _file_available(project_id, report_file):
        warnings.append(_issue("assembly_report_missing", "Assembly JSON report is missing from the parts library."))
    if _count("expected_fit_count"):
        warnings.append(_issue(
            "expected_fit", f"Assembly report contains {_count('expected_fit_count')} expected fit exemption(s)."))
    if _count("expected_mesh_count"):
        warnings.append(_issue(
            "expected_mesh", f"Assembly report contains {_count('expected_mesh_count')} expected mesh exemption(s)."))
    excluded = [str(name) for name in (assembly.get("excluded_superseded") or []) if str(name)]
    if excluded:
        warnings.append(_issue(
            "excluded_superseded", "Assembly export excluded superseded or non-BOM part(s).", excluded))

    return {
        "available": True,
        "exported_at": str(assembly.get("exported_at") or "") or None,
        "step_file": step_file or None,
        "render_file": str(assembly.get("render_file") or "") or None,
        "report_file": report_file or None,
        "parts_count": parts_count,
        "active_parts_count": len(parts),
        "total_pairs": _count("total_pairs"),
        "interfering_count": _count("interfering_count"),
        "exempted_count": _count("exempted_count"),
        "hard_collision_count": hard_count,
        "expected_fit_count": _count("expected_fit_count"),
        "expected_mesh_count": _count("expected_mesh_count"),
        "excluded_superseded": excluded,
        "blocking_issues": blocking,
        "warning_issues": warnings,
    }, pair_findings


def build_engineering_review(project_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    """Build a material / critical-part / assembly review without external claims."""
    parts = _active_parts(manifest)
    generated_at = datetime.now().isoformat(timespec="seconds")
    if not parts:
        assembly, _ = _assembly_review(project_id, parts, manifest.get("assembly"))
        return {
            "project_id": project_id,
            "generated_at": generated_at,
            "status": "NO_DATA",
            "active_parts_count": 0,
            "materials": [],
            "critical_parts": [],
            "assembly": assembly,
            "limitations": [
                "No active parts were found in the project parts library.",
            ],
        }

    volumes = []
    for part in parts:
        try:
            volume = float(part.get("volume_mm3"))
            if volume >= 0:
                volumes.append(volume)
        except (TypeError, ValueError):
            continue
    max_volume = max(volumes, default=0.0)

    assembly, pair_findings = _assembly_review(project_id, parts, manifest.get("assembly"))
    critical_parts: list[dict[str, Any]] = []
    for part in parts:
        name = _part_name(part)
        if not name:
            continue
        recorded_material = str(part.get("material") or "").strip()
        material = recorded_material or resolve_material(name)
        material_basis = "manifest" if recorded_material else "name_hint"
        blocking: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        reasons: list[str] = []

        if part.get("contract_passed") is not True:
            blocking.append(_issue("contract_not_passed", "Geometry contract is not recorded as passed."))
        step_missing = not _file_available(project_id, part.get("step_file"))
        stl_missing = not _file_available(project_id, part.get("stl_file"))
        if step_missing:
            blocking.append(_issue("step_file_missing", "STEP artifact is missing from the parts library."))
        if stl_missing:
            blocking.append(_issue("stl_file_missing", "STL artifact is missing from the parts library."))

        hard_pairs = pair_findings["hard_collision"].get(name, [])
        if hard_pairs:
            blocking.append(_issue("hard_collision", "Part participates in hard collision pair(s)."))
        error_pairs = pair_findings["calculation_error"].get(name, [])
        if error_pairs:
            blocking.append(_issue("calculation_error", "Part participates in calculation error pair(s)."))

        validation_status = str(part.get("validation_status") or "").strip()
        if validation_status.lower() not in _PASS_VALIDATION:
            warnings.append(_issue(
                "validation_unconfirmed", "Geometry validation status is not recorded as passed."))
        if material_basis == "name_hint":
            warnings.append(_issue(
                "material_inferred", "Viewport material was inferred from the part name."))
        role = str(part.get("role") or "").strip()
        if not role:
            warnings.append(_issue("part_role_missing", "Functional role is not recorded."))
        else:
            reasons.append("functional_role_recorded")
        dependencies = [str(item) for item in (part.get("depends_on") or []) if str(item)]
        if dependencies:
            reasons.append("dependency_recorded")
        else:
            warnings.append(_issue("dependencies_not_recorded", "Design dependencies are not recorded."))
        if assembly["available"] and not isinstance(part.get("pose"), dict):
            warnings.append(_issue("assembly_pose_missing", "Assembly pose is not recorded."))
        try:
            volume = float(part.get("volume_mm3"))
        except (TypeError, ValueError):
            volume = None
        if volume is not None and max_volume > 0 and volume == max_volume:
            reasons.append("largest_geometric_volume")

        if blocking:
            reasons.insert(0, "blocking_issue")
        if assembly["warning_issues"]:
            reasons.append("assembly_warning")
        if warnings:
            reasons.append("review_warning")
        # Remove duplicates while preserving priority order.
        reasons = list(dict.fromkeys(reasons))

        try:
            version = int(part.get("version"))
        except (TypeError, ValueError):
            version = None
        critical_parts.append({
            "part": name,
            "version": version,
            "material": material,
            "material_basis": material_basis,
            "role": role or None,
            "depends_on": dependencies,
            "validation_status": validation_status or None,
            "volume_mm3": volume,
            "criticality_reasons": reasons,
            "blocking_issues": blocking,
            "warning_issues": warnings,
            "is_critical": bool(blocking or hard_pairs or error_pairs or role or dependencies),
        })

    critical_parts.sort(key=lambda item: (
        -len(item["blocking_issues"]),
        -len(item["warning_issues"]),
        -float(item.get("volume_mm3") or 0.0),
        item["part"],
    ))
    blocking_count = sum(len(part["blocking_issues"]) for part in critical_parts) + len(assembly["blocking_issues"])
    warning_count = sum(len(part["warning_issues"]) for part in critical_parts) + len(assembly["warning_issues"])
    if blocking_count:
        status = "BLOCKED"
    elif warning_count:
        status = "WARNING"
    else:
        status = "PASS"
    return {
        "project_id": project_id,
        "generated_at": generated_at,
        "status": status,
        "active_parts_count": len(parts),
        "materials": _material_review(project_id, parts),
        "critical_parts": critical_parts,
        "assembly": assembly,
        "limitations": [
            "Material keys are viewport rendering proxies, not engineering material specifications.",
            "Geometry volume is measured data and is used only as a review ordering clue.",
            "Assembly findings summarize the last recorded export, not a new interference calculation.",
        ],
    }
