"""Bounded subagent planning contracts.

The first slice plans and audits specialist work; it does not allow a specialist
to mutate the primary CAD session directly.
"""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any
from uuid import uuid4

ROLES = ("requirements", "sealing", "fasteners", "profiles", "manufacturing", "geometry_validation", "experiment")
STATUSES = ("queued", "running", "waiting_user", "completed", "failed", "cancelled")


@dataclass
class SubagentFinding:
    finding_id: str = field(default_factory=lambda: uuid4().hex[:12])
    task_id: str = ""
    kind: str = "observation"
    summary: str = ""
    evidence_ids: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    proposed_parameters: dict[str, Any] = field(default_factory=dict)
    requires_confirmation: bool = False
    created_at: float = field(default_factory=time.time)


@dataclass
class SubagentTask:
    task_id: str = field(default_factory=lambda: uuid4().hex[:12])
    role: str = "requirements"
    title: str = ""
    objective: str = ""
    status: str = "queued"
    depends_on: list[str] = field(default_factory=list)
    evidence_query: str = ""
    context_refs: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    error: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


@dataclass
class ResearchPlan:
    plan_id: str = field(default_factory=lambda: uuid4().hex[:12])
    project_id: str = ""
    goal: str = ""
    status: str = "draft"
    tasks: list[dict[str, Any]] = field(default_factory=list)
    evidence_policy: str = "published evidence only; unresolved conflicts block CAD mutation"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


def build_research_plan(project_id: str, goal: str, domains: list[str] | None = None, include_experiments: bool = False) -> dict[str, Any]:
    goal = str(goal or "").strip()
    if not goal:
        raise ValueError("research goal is required")
    requested = {str(item).lower() for item in (domains or [])}
    selected: list[tuple[str, str, str, str]] = []
    selected.append(("requirements", "需求与约束分析", "提取功能、尺寸、工况、材料和缺失信息，不生成未经证实的数值。", goal))
    if not requested or "sealing" in requested or "o_ring" in requested:
        selected.append(("sealing", "密封设计调研", "检索已审核的 O 型圈/密封证据，输出候选方案、适用条件和风险。", "O 型圈 密封 沟槽 " + goal))
    if not requested or "fasteners" in requested or "screw" in requested:
        selected.append(("fasteners", "紧固件设计调研", "检索已审核的螺钉、螺纹、通孔、强度等级和连接条件证据。", "螺钉 螺纹 紧固件 " + goal))
    if not requested or "profiles" in requested or "aluminum" in requested:
        selected.append(("profiles", "铝型材/框架调研", "仅使用具体厂商或用户资料，输出型材和连接件候选，不泛化承载结论。", "铝型材 框架 连接件 " + goal))
    selected.append(("manufacturing", "可制造性审查", "检查倒角、圆角、刀具可达性、装配空间和制造约束。", goal))
    selected.append(("geometry_validation", "几何验证", "检查干涉、壁厚、孔槽连通性、特征依赖和可回滚性。", goal))
    if include_experiments:
        selected.append(("experiment", "参数实验", "对已确认参数进行可重复的参数扫描或几何实验，记录输入、输出和局限。", goal))
    tasks: list[dict[str, Any]] = []
    for index, (role, title, objective, query) in enumerate(selected):
        deps = [tasks[-1]["task_id"]] if role == "manufacturing" and tasks else []
        if role == "geometry_validation":
            deps = [task["task_id"] for task in tasks if task["role"] in {"sealing", "fasteners", "profiles", "manufacturing"}]
        if role == "experiment":
            deps = [task["task_id"] for task in tasks if task["role"] == "geometry_validation"]
        tasks.append(asdict(SubagentTask(role=role, title=title, objective=objective, evidence_query=query, depends_on=deps)))
    return asdict(ResearchPlan(project_id=project_id, goal=goal, tasks=tasks))
