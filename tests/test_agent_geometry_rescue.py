"""Failed-run geometry recovery regressions.

A crashed/failed agent must not erase real kernel geometry: when the LLM dies after
successful CAD operations, the already-built BRep should still be exported for the
viewport while the run itself remains failed.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.agent.loop import AgentLoop, AgentLoopResult
from backend.main import _agent_execution_report, _result_artifact_set
from backend.mechcad_ai.client import ApiCallError
from backend.schemas import ArtifactSet, AssemblySummary, PartArtifact


class _RescueWorker:
    def __init__(self, *, volume=None, bbox=None, fail_step=False):
        self.volume = volume
        self.bbox = bbox
        self.fail_step = fail_step
        self.queries = []

    def capabilities(self):
        return {"public": []}

    def feature_tree(self):
        return {"graph": {"nodes": {"F1": {}}}, "op_history": [{"op": "box"}], "narrative": []}

    def execute(self, op, args=None, **kwargs):
        args = args or {}
        if op == "query":
            self.queries.append((args.get("target"), args.get("what")))
            if args.get("what") == "volume":
                return {"success": self.volume is not None, "value": self.volume}
            if args.get("what") == "bounding_box":
                return {"success": self.bbox is not None, "value": self.bbox}
        if op == "validate_geometry":
            return {"success": True, "geometry_validation": {"valid": True, "status": "valid"}}
        return {"success": True}

    def export_mesh(self, path):
        Path(path).write_bytes(b"stl")
        return {"ok": True, "size": 3}

    def export_step(self, path):
        if self.fail_step:
            raise RuntimeError("step exporter failed")
        Path(path).write_bytes(b"step")
        return {"ok": True, "size": 4}


def _loop(worker, run_dir):
    return AgentLoop(
        worker=worker,
        chat_with_tools=lambda *args, **kwargs: (_ for _ in ()).throw(
            ApiCallError("HTTP 400 code 10013")
        ),
        protocol="openai",
        emit=lambda *args: None,
        run_dir=Path(run_dir),
        system_prompt="test",
        max_steps=2,
    )


def _run_rescue(worker):
    with tempfile.TemporaryDirectory() as td:
        run_dir = Path(td)
        result = _loop(worker, run_dir).run()
        return (
            result,
            (run_dir / "model.stl").read_bytes() if (run_dir / "model.stl").exists() else None,
            (run_dir / "model.step").read_bytes() if (run_dir / "model.step").exists() else None,
            json.loads((run_dir / "execution_report.json").read_text(encoding="utf-8")),
        )


class FailedRunGeometryRescueTests(unittest.TestCase):
    def test_llm_failure_exports_recovered_stl_and_step_without_marking_success(self):
        result, stl, step, report = _run_rescue(
            _RescueWorker(volume=125.0, bbox=[0, 0, 0, 5, 5, 5])
        )
        self.assertFalse(result.ok)
        self.assertEqual(result.status, "PARTIAL")
        self.assertIn("LLM 调用失败", result.error)
        self.assertAlmostEqual(result.volume, 125.0)
        self.assertTrue(result.geometry_rescued)
        self.assertEqual(stl, b"stl")
        self.assertEqual(step, b"step")
        self.assertFalse(report["ok"])
        self.assertEqual(report["status"], "PARTIAL")
        self.assertTrue(report["geometry_rescued"])

    def test_invalid_geometry_evidence_is_rejected(self):
        for bad in (float("nan"), float("inf"), -1.0, 0.0, "12", True, None):
            result, stl, step, _ = _run_rescue(
                _RescueWorker(volume=bad, bbox=[0, 0, 0, 1, 1, 1])
            )
            self.assertFalse(result.ok)
            self.assertEqual(result.status, "FAILED")
            self.assertIsNone(result.volume)
            self.assertFalse(result.geometry_rescued)
            self.assertIsNone(stl)
            self.assertIsNone(step)

    def test_export_failure_keeps_existing_artifact_and_original_error(self):
        with tempfile.TemporaryDirectory() as td:
            run_dir = Path(td)
            existing = run_dir / "model.stl"
            existing.write_bytes(b"old-stl")
            result = _loop(
                _RescueWorker(volume=64.0, bbox=[0, 0, 0, 4, 4, 4], fail_step=True),
                run_dir,
            ).run()
            self.assertFalse(result.ok)
            self.assertTrue(result.geometry_rescued)
            self.assertEqual(result.artifacts["stl"], str(existing))
            self.assertEqual(existing.read_bytes(), b"old-stl")
            self.assertNotIn("step", result.artifacts)
            self.assertEqual(result.rescue_export_errors, ["STEP:EXPORT_FAILED"])
            self.assertTrue(any("STEP" in line and "失败" in line for line in result.logs))

    def test_execution_report_separates_failed_execution_from_valid_geometry(self):
        result = AgentLoopResult(ok=False, error="LLM down", volume=10.0, geometry_rescued=True)
        result.artifacts["stl"] = "model.stl"
        report = _agent_execution_report(result)
        self.assertFalse(report.execution_ok)
        self.assertTrue(report.geometry_valid)
        self.assertFalse(report.production_ready)

    def test_failed_result_artifact_set_carries_prior_parts_and_assembly(self):
        result = AgentLoopResult(ok=False, error="LLM down")
        prior = ArtifactSet(
            run_id="old",
            parts=[PartArtifact(part="thrust_chamber", index=1, volume_mm3=10.0)],
        )
        merged = _result_artifact_set("new", result, prior=prior)
        self.assertEqual([p.part for p in merged.parts], ["thrust_chamber"])
        self.assertIsNone(merged.assembly)

        prior.assembly = AssemblySummary(step_file="assembly_001.step")
        merged = _result_artifact_set("new", result, prior=prior)
        self.assertEqual(merged.assembly, prior.assembly)

        result.parts = [{"part": "thrust_chamber", "index": 2, "volume_mm3": 11.0}]
        merged = _result_artifact_set("new", result, prior=prior)
        self.assertEqual(len(merged.parts), 1)
        self.assertEqual(merged.parts[0].index, 2)


if __name__ == "__main__":
    unittest.main()

