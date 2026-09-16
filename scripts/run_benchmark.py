"""Varen Assembly Reliability Benchmark — 可复现的公开运行记录 runner。

用与真实使用完全相同的 harness（run_agent_loop + ApprovalBroker 自动批准 + 真实
MechKernel worker）驱动 benchmark/tasks.yaml 中的任务，逐任务记录：prompt、模型、
版本、耗时、步数、结果、失败类型与门控事件（自修复/契约拒绝/干涉阻断），
写入 benchmark/results/<UTC 时间戳>/<task>.json + summary.md。失败样本同样收录——
失败透明是本产品的公开立场。

运行（aicad venv，需 .env 配好 MECHCAD_PLANNER_*）：
  .\\.venv\\Scripts\\python.exe scripts/run_benchmark.py --list
  .\\.venv\\Scripts\\python.exe scripts/run_benchmark.py --dry-run
  .\\.venv\\Scripts\\python.exe scripts/run_benchmark.py --task flange-basic
  .\\.venv\\Scripts\\python.exe scripts/run_benchmark.py --group smoke
  .\\.venv\\Scripts\\python.exe scripts/run_benchmark.py --all
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import yaml
from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

TASKS_FILE = ROOT / "benchmark" / "tasks.yaml"
RESULTS_ROOT = ROOT / "benchmark" / "results"

AUTO_ANSWER = "按常规机械设计取值即可"
# 门控事件关键词（出现在事件流/日志即视为该门已触发）
GATE_TOKENS = {
    "孔语义": ("FEATURE_CONTRACT_MISMATCH", "through_hole", "孔语义"),
    "INTERFERENCE_BLOCKED": ("INTERFERENCE_BLOCKED",),
}


def load_tasks() -> list[dict]:
    data = yaml.safe_load(TASKS_FILE.read_text(encoding="utf-8"))
    assert int(data.get("version", 0)) >= 1, "tasks.yaml 缺少 version"
    ids = [t["id"] for t in data["tasks"]]
    assert len(ids) == len(set(ids)), f"任务 id 重复: {ids}"
    return data["tasks"]


def auto_approve(broker, max_wait: float = 7200.0) -> None:
    """后台线程：自动批准 plan_review / ask_user（与 real_llm_gearbox.py 同策略）。"""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        with broker._lock:
            if not broker._requests:
                time.sleep(0.5)
                continue
            aid = next(iter(broker._requests))
            req = broker._requests[aid]
        kind = getattr(req, "kind", "")
        args = getattr(req, "args", {}) or {}
        try:
            if kind == "ask_user":
                answers = {}
                for q in args.get("questions") or []:
                    qid, qtype = q.get("id"), q.get("type", "text")
                    opts = q.get("options") or []
                    if qtype == "multi":
                        answers[qid] = [opts[0]["label"]] if opts else [AUTO_ANSWER]
                    elif qtype == "single":
                        answers[qid] = opts[0]["label"] if opts else AUTO_ANSWER
                    else:
                        answers[qid] = AUTO_ANSWER
                broker.resolve(aid, "edit", {"answers": answers})
            else:
                broker.resolve(aid, "approve")
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.3)


def judge(task: dict, result, events_blob: str, run_dir: Path) -> dict:
    """程序判定任务结果。返回 {passed, reasons}。"""
    reasons: list[str] = []
    expect = task.get("expect") or {}
    passed = True

    gate = expect.get("gate_must_fire")
    if gate:
        tokens = GATE_TOKENS.get(gate, (gate,))
        fired = any(tok in events_blob for tok in tokens)
        if not fired:
            passed = False
            reasons.append(f"GATE_NOT_FIRED: 期望 {gate} 拦截，未在事件/日志中出现")
        else:
            reasons.append(f"GATE_FIRED: {gate}")
        # 负例允许 ok true（模型修复后合规交付）——门触发本身就是判据
        return {"passed": passed, "reasons": reasons}

    if expect.get("refuses"):
        if bool(getattr(result, "ok", False)) and (getattr(result, "parts", None) or getattr(result, "artifacts", None)):
            passed = False
            reasons.append("EXPECTED_REFUSAL: 不支持的能力被谎称为已交付")
        else:
            reasons.append("REFUSED_HONESTLY")
        return {"passed": passed, "reasons": reasons}

    if expect.get("step_outputs"):
        n = len(list(run_dir.glob("**/*.step"))) if run_dir.is_dir() else 0
        if n < int(expect["step_outputs"]):
            passed = False
            reasons.append(f"STEP_OUTPUTS_SHORT: {n} < {expect['step_outputs']}")
    if expect.get("ok") and not result.ok:
        passed = False
        reasons.append(f"NOT_OK: status={result.status} error_kind={result.error_kind} error={result.error}")
    min_parts = int(expect.get("min_parts") or 0)
    if len(result.parts or []) < min_parts:
        passed = False
        reasons.append(f"PARTS_SHORT: {len(result.parts or [])} < {min_parts}")
    if expect.get("assembly") and not result.assembly:
        passed = False
        reasons.append("NO_ASSEMBLY")
    return {"passed": passed, "reasons": reasons or ["OK"]}


def run_task(task: dict, out_dir: Path) -> dict:
    from backend.agent.approvals import ApprovalBroker
    from backend.agent.loop import build_task_message, run_agent_loop
    from backend.agent.session import AgentSession
    from backend.kernel_worker import get_worker_manager
    from backend.mechcad_ai.client import (
        chat_completion_with_tools,
        has_configured_model,
        resolve_role_config,
    )
    from backend.mechcad_ai.prompts import get_prompt
    from backend.schemas import ModelConfig
    from backend.storage import ARTIFACT_ROOT
    from backend.version import APP_VERSION

    record = {
        "task_id": task["id"],
        "name": task.get("name", ""),
        "group": task.get("group", ""),
        "prompt": task["prompt"].strip(),
        "app_version": APP_VERSION,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    if not has_configured_model(ModelConfig(), "planner"):
        record.update(verdict="SKIPPED", reasons=["NO_PLANNER_MODEL（检查 .env）"])
        return record

    cfg = resolve_role_config(ModelConfig(), "planner")
    record["model"] = {"name": cfg["model"], "base_url": cfg.get("base_url", ""), "protocol": cfg.get("protocol")}

    manager = get_worker_manager()
    project_id = f"bench-{task['id']}-{int(time.time())}"
    t0 = time.time()
    try:
        worker = manager.get_or_start(project_id)
        caps = worker.capabilities()
        run_dir = ARTIFACT_ROOT / project_id
        run_dir.mkdir(parents=True, exist_ok=True)

        events: list[list] = []

        def emit(ev, msg, payload):
            events.append([ev, str(msg)[:400], payload if isinstance(payload, dict) else {}])

        broker = ApprovalBroker(timeout=3600)
        threading.Thread(target=auto_approve, args=(broker,), daemon=True).start()
        session = AgentSession(project_id=project_id,
                               path=ROOT / "work" / "agent_sessions" / f"{project_id}.json")

        def chat(messages, tools, on_text_delta=None):
            return chat_completion_with_tools(
                ModelConfig(), "planner", messages, tools,
                max_tokens=int(os.getenv("MECHCAD_PLANNER_MAX_TOKENS", "32768")),
                on_text_delta=on_text_delta,
            )

        result = run_agent_loop(
            worker=worker,
            chat_with_tools=chat,
            protocol=cfg["protocol"],
            emit=emit,
            run_dir=run_dir,
            system_prompt=get_prompt("agent_modeling", "zh"),
            language="zh",
            max_steps=int(task.get("max_steps", 60)),
            approvals=broker,
            session=session,
            initial_user_message=build_task_message(record["prompt"], worker, caps),
            mode=task.get("mode", "auto"),
            project_id=project_id,
        )
        dt = time.time() - t0

        try:
            events_blob = json.dumps(events, ensure_ascii=False) + "\n" + "\n".join(result.logs or [])
        except (TypeError, ValueError):
            events_blob = str(events)

        verdict = judge(task, result, events_blob, run_dir)
        record.update(
            duration_s=round(dt, 1),
            steps=result.steps,
            status=result.status,
            ok=bool(result.ok),
            error=result.error,
            error_kind=result.error_kind,
            parts_count=len(result.parts or []),
            parts=[{k: v for k, v in (p or {}).items() if k != "plan"} for p in (result.parts or [])],
            assembly=result.assembly,
            design_calculations=len(result.design_calculations or []),
            step_files=sorted(f.name for f in run_dir.glob("**/*.step")),
            artifacts=result.artifacts,
            events_captured=len(events),
            run_dir=str(run_dir),
            verdict="PASS" if verdict["passed"] else "FAIL",
            reasons=verdict["reasons"],
            final_text_excerpt=(result.final_text or "")[:600],
        )
    finally:
        manager.stop(project_id)

    (out_dir / f"{task['id']}.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def write_summary(out_dir: Path, records: list[dict], tasks_file_version: int) -> Path:
    lines = [
        "# Varen Benchmark 运行记录",
        "",
        f"- 时间：{datetime.now(timezone.utc).isoformat()}",
        f"- 任务集：tasks.yaml v{tasks_file_version} · 本次 {len(records)} 个任务",
        f"- 判定为程序判定（runner 脚本 judge()），失败样本原样收录",
        "",
        "| 任务 | 组 | 结果 | 步数 | 零件 | 耗时(s) | 备注 |",
        "|---|---|---|---:|---:|---:|---|",
    ]
    for r in records:
        lines.append(
            f"| {r['task_id']} | {r.get('group','')} | {r.get('verdict','')} | {r.get('steps','')} "
            f"| {r.get('parts_count','')} | {r.get('duration_s','')} | {'; '.join(r.get('reasons') or [])[:90]} |")
    path = out_dir / "summary.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description="Varen benchmark runner")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="校验任务文件与配置，不调模型")
    ap.add_argument("--task", help="只跑指定任务 id")
    ap.add_argument("--group", help="只跑指定组（smoke/standard/assembly/negative/boundary）")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    tasks = load_tasks()
    if args.list:
        for t in tasks:
            print(f"[{t.get('group','?'):10}] {t['id']:26} {t.get('name','')}")
        return 0

    if args.dry_run:
        from backend.version import APP_VERSION
        print(f"tasks.yaml OK — {len(tasks)} 任务 · app {APP_VERSION}")
        print("planner configured:", _planner_configured())
        return 0

    if args.task:
        selected = [t for t in tasks if t["id"] == args.task]
        assert selected, f"未知任务 id: {args.task}"
    elif args.group:
        selected = [t for t in tasks if t.get("group") == args.group]
        assert selected, f"未知组: {args.group}"
    elif args.all:
        selected = tasks
    else:
        ap.error("需要 --list / --dry-run / --task / --group / --all")
        return 2

    out_dir = RESULTS_ROOT / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for t in selected:
        print(f"\n=== {t['id']} ({t.get('name','')}) ===", flush=True)
        r = run_task(t, out_dir)
        print(f"-> {r.get('verdict')} {r.get('reasons')}", flush=True)
        records.append(r)
    summary = write_summary(out_dir, records, 1)
    print(f"\n结果目录: {out_dir}\n摘要: {summary}")
    return 0 if all(r.get("verdict") in ("PASS", "SKIPPED") for r in records) else 1


def _planner_configured() -> bool:
    try:
        from backend.mechcad_ai.client import has_configured_model
        from backend.schemas import ModelConfig
        return has_configured_model(ModelConfig(), "planner")
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    sys.exit(main())
