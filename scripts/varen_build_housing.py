"""用 Varen CAD（真实 LLM agent + MechKernel worker）设计并生成变速器壳体。

背景：上一轮 agent 的 BOM 漏掉了壳体。这里把已归档的 24 件传动件迁入新项目、
把 BOM 补上「下壳体 + 端盖」两条，再让 agent 只用内核公开 op 把壳体建出来。
"""
from __future__ import annotations

import json
import shutil
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from backend.agent.approvals import ApprovalBroker  # noqa: E402
from backend.agent.loop import _normalize_bom, build_task_message, run_agent_loop  # noqa: E402
from backend.agent.session import AgentSession  # noqa: E402
from backend.kernel_worker import get_worker_manager  # noqa: E402
from backend.mechcad_ai.client import chat_completion_with_tools, has_configured_model, resolve_role_config  # noqa: E402
from backend.mechcad_ai.prompts import get_prompt  # noqa: E402
from backend.schemas import ModelConfig  # noqa: E402
from backend.storage import ARTIFACT_ROOT, PROJECT_PARTS_ROOT  # noqa: E402

SRC = ROOT / "work/project_parts/llm-trans-1789208362"

TASK = (
    "变速器壳体（下壳体 + 端盖）还没做，现在请你设计并建模，用 MechKernel 公开 op 完成。\n"
    "\n"
    "【已归档的内部传动件（在项目零件库里，无需重做）】\n"
    "三轴式布置：输入轴/中间轴/输出轴轴线均沿 Z，轴心 (x,y) = (0,0)/(75,0)/(150,0)；"
    "倒挡轴轴心 (129.375,-72)。内部件总包络 X -32.5..240、Y -97..68、Z -129..534（mm）。"
    "各轴端轴颈半径：输入轴 r16.5（-Z 端）、中间轴 r21.5（两端）、输出轴 r23.5（+Z 端）、倒挡轴 r15.5（两端）。\n"
    "\n"
    "【壳体设计要求（真实变速箱箱体，不要简单方盒）】\n"
    "1. 下壳体：铸件式箱体，内腔容纳上述内部件（留 ≥5mm 间隙），壁厚约 10mm；"
    "剖分面（分箱面）带一圈螺栓法兰（法兰宽 ~14mm，M8 螺栓孔均布，孔距 ~60~70mm）。\n"
    "2. 轴承座：**4 根轴 × 两端共 8 处**都要有轴承座凸台 + 轴承孔（孔径按上面各轴颈半径 +2~4mm 配合），"
    "轴承座做成外凸圆柱台（凸出壁面 ~12mm，外径 = 孔径 +16mm）以安装轴承与油封。\n"
    "3. 端盖/上盖：盖住剖分开口，对应位置做轴承孔或让位，带与下壳体配对的螺栓孔。\n"
    "4. 加强筋：外壁与轴承座之间加铸造加强筋（厚 6~8mm），提高刚度。\n"
    "5. 功能孔：底部放油塞孔（M12）、侧面油面检查孔/加油孔（M16）各一处，做成凸台 + 螺纹底孔。\n"
    "6. 安装底脚：底部两处安装脚，各 2 个安装孔。\n"
    "7. **壳体与所有内部件不得干涉**（装配干涉检查会验证）。\n"
    "\n"
    "零件名固定为「下壳体」「端盖」，用 run_build_script 一次成型；"
    "每件 finish_part 时传 feature_contract（轴承孔用 {type:'through_hole'/'blind_hole', diameter_mm, count} 或 "
    "{radius_mm, count}）证明孔位真实存在。两件都归档后 export_assembly，"
    "expected_overlaps 里把「轴承孔×轴颈」的过盈配合按 {a,b,max_volume_mm3,category:'fit'} 声明。"
)
AUTO_ANSWER = "按常规乘用车变速器壳体设计取值即可"


def auto_approve(broker: ApprovalBroker, max_wait: float = 7200.0) -> None:
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
                print(f"  [auto] 批准 ask_user {aid}", flush=True)
                broker.resolve(aid, "edit", {"answers": answers})
            else:
                print(f"  [auto] 批准 {kind} {aid}", flush=True)
                broker.resolve(aid, "approve")
        except Exception as exc:  # noqa: BLE001
            print(f"  [auto] resolve 失败 {aid}: {exc}", flush=True)
        time.sleep(0.3)


def seed_project(project_id: str) -> int:
    """把源项目 24 件复制进新项目，写 manifest。返回件数。"""
    src_man = json.loads((SRC / "parts_manifest.json").read_text(encoding="utf-8"))
    dst = PROJECT_PARTS_ROOT / project_id
    dst.mkdir(parents=True, exist_ok=True)
    parts = []
    for e in src_man["parts"]:
        if e.get("status") != "active" or e["name"] in ("箱体", "箱体盖", "箱体半壳"):
            continue
        src_file = SRC / e["step_file"]
        if not src_file.exists():
            continue
        shutil.copyfile(src_file, dst / e["step_file"])
        parts.append({k: v for k, v in e.items()})
    (dst / "parts_manifest.json").write_text(
        json.dumps({"schema_version": 1, "project_id": project_id, "parts": parts,
                    "assembly": None}, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(parts)


def main() -> int:
    if not has_configured_model(ModelConfig(), "planner"):
        print("未配置 planner 模型")
        return 1
    cfg = resolve_role_config(ModelConfig(), "planner")
    print(f"planner = {cfg['model']} @ {cfg['base_url']}", flush=True)

    project_id = f"llm-housing-{int(time.time())}"
    n = seed_project(project_id)
    print(f"seeded {n} transmission parts into {project_id}", flush=True)
    if n < 20:
        print("seed 太少，中止")
        return 1

    manager = get_worker_manager()
    worker = manager.get_or_start(project_id)
    caps = worker.capabilities()
    run_dir = ARTIFACT_ROOT / f"llm_housing_{int(time.time())}"
    run_dir.mkdir(parents=True, exist_ok=True)

    def emit(ev, msg, payload):
        if ev == "agent_step":
            print(f"  [step {payload.get('step')}] {payload.get('op')}: "
                  f"{str(payload.get('summary') or msg)[:90]}", flush=True)
        elif ev == "plan_updated":
            print(f"  [plan] {str(payload.get('summary',''))[:70]} | steps "
                  f"{len(payload.get('steps') or [])} | BOM {len(payload.get('bom') or [])}", flush=True)
        elif ev == "artifact_ready":
            print(f"  [artifact] {msg[:70]}", flush=True)

    broker = ApprovalBroker(timeout=7200)
    threading.Thread(target=auto_approve, args=(broker,), daemon=True).start()
    session = AgentSession(project_id=project_id,
                           path=ROOT / "work/agent_sessions" / f"{project_id}.json")

    # 预置 BOM：24 件已归档（步骤标 completed）+ 下壳体/端盖待建
    bom = [{"part": e["name"], "role": "已归档", "key_params": {"status": "archived"},
            "pose": e.get("pose")} for e in
           json.loads((PROJECT_PARTS_ROOT / project_id / "parts_manifest.json").read_text(encoding="utf-8"))["parts"]]
    bom += [{"part": "下壳体", "role": "铸件式箱体，含剖分面螺栓法兰/8 处轴承座/加强筋/放油塞/加油孔/安装底脚",
             "key_params": {"壁厚": "10mm", "包络": "X-42..250 Y-110..80 Z-140..545", "轴承座": "4轴×2端=8处",
                            "剖分面法兰": "14mm", "螺栓": "M8 均布", "加强筋": "6-8mm"},
             "pose": {"position": [0.0, 0.0, 0.0], "rotation_deg": [0.0, [0.0, 0.0, 1.0]]}},
            {"part": "端盖", "role": "剖分面端盖，配对螺栓孔 + 轴承让位",
             "key_params": {"厚度": "10mm", "螺栓": "M8 与下壳体配对"},
             "pose": {"position": [0.0, 0.0, 0.0], "rotation_deg": [0.0, [0.0, 0.0, 1.0]]}}]
    steps = [{"id": f"s{i+1}", "title": f"{b['part']} 已完成", "part": b["part"], "status": "completed"}
             for i, b in enumerate(bom[:-2])]
    steps += [{"id": f"h{i+1}", "title": f"建 {b['part']}", "part": b["part"], "status": "pending"}
              for i, b in enumerate(bom[-2:])]
    session.set_plan("变速器壳体设计（下壳体 + 端盖），24 件传动件已归档", steps, approved=True, bom=bom)
    session.plan["steps"] = steps  # 确保 pending 状态落盘

    def chat(messages, tools, on_text_delta=None):
        return chat_completion_with_tools(
            ModelConfig(), "planner", messages, tools,
            max_tokens=int(__import__("os").getenv("MECHCAD_PLANNER_MAX_TOKENS", "32768")),
            on_text_delta=on_text_delta)

    t0 = time.time()
    result = run_agent_loop(
        worker=worker, chat_with_tools=chat, protocol=cfg["protocol"], emit=emit,
        run_dir=run_dir, system_prompt=get_prompt("agent_modeling", "zh"), language="zh",
        max_steps=200, approvals=broker, session=session,
        initial_user_message=build_task_message(TASK, worker, caps),
        mode="plan", project_id=project_id,
    )
    dt = time.time() - t0
    print(f"\n=== ok={result.ok} status={result.status} steps={result.steps} "
          f"parts={len(result.parts)} {dt:.0f}s ===", flush=True)
    for p in result.parts:
        print(f"  archived {p['part']} via={p.get('built_via')} {p['step_file']}", flush=True)
    if result.assembly:
        a = result.assembly
        print(f"assembly: {a.get('step_file')} parts={a.get('parts_count')} "
              f"hard={a.get('hard_collision_count')} exempt={a.get('exempted_count')}", flush=True)
    if result.error:
        print("error:", str(result.error)[:300], flush=True)
    manager.stop(project_id)
    print("HOUSING-RUN", "PASS" if result.ok else "FAIL", "| project", project_id)
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
