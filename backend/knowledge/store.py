"""Evidence-first engineering knowledge store.

This module deliberately stores provenance separately from model output. A fact is
never considered usable for automated CAD until every referenced evidence item is
published and traceable to a document or an explicitly uploaded user source.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg", ".step", ".stp", ".stl"}
SOURCE_TIERS = ("normative", "manufacturer", "user", "derived")
PUBLISH_STATUSES = ("pending", "published", "rejected")


def _safe(value: str, fallback: str = "default") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", str(value))[:96]
    return cleaned or fallback


def _now() -> float:
    return time.time()


def _json_default(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    raise TypeError(f"not JSON serializable: {type(value)!r}")


@dataclass
class KnowledgeDocument:
    document_id: str
    project_id: str
    title: str
    issuer: str = ""
    document_type: str = "user_upload"
    standard_number: str = ""
    edition: str = ""
    revision: str = ""
    publication_date: str = ""
    effective_date: str = ""
    jurisdiction: str = ""
    language: str = ""
    source_url: str = ""
    filename: str = ""
    sha256: str = ""
    license_status: str = "unknown"
    source_tier: str = "user"
    status: str = "pending"
    created_at: float = field(default_factory=_now)
    notes: str = ""


@dataclass
class KnowledgeEvidence:
    evidence_id: str
    project_id: str
    document_id: str
    original_text: str
    normalized_text: str = ""
    page: str = ""
    section: str = ""
    table: str = ""
    extracted_values: dict[str, Any] = field(default_factory=dict)
    units: dict[str, str] = field(default_factory=dict)
    applicability: str = ""
    exclusions: str = ""
    confidence: float | None = None
    extraction_method: str = "manual"
    status: str = "pending"
    created_at: float = field(default_factory=_now)
    reviewer: str = ""


@dataclass
class EngineeringFact:
    fact_id: str
    project_id: str
    domain: str
    component: str
    parameter: str
    value: Any
    unit: str = ""
    valid_range: str = ""
    applicability: str = ""
    evidence_ids: list[str] = field(default_factory=list)
    status: str = "pending"
    created_at: float = field(default_factory=_now)
    notes: str = ""


@dataclass
class KnowledgeConflict:
    conflict_id: str
    project_id: str
    key: str
    evidence_ids: list[str]
    status: str = "unresolved"
    resolution: str = ""
    resolved_value: Any = None
    created_at: float = field(default_factory=_now)


class KnowledgeStore:
    """Small JSON-backed store for the first safe knowledge-library slice.

    It is intentionally dependency-free. A future vector index can be added as a
    read-optimized projection without becoming the source of truth.
    """

    def __init__(self, root: str | Path, project_id: str):
        self.project_id = str(project_id)
        self.root = Path(root) / _safe(self.project_id)
        self.files = {
            "documents": self.root / "documents.json",
            "evidence": self.root / "evidence.json",
            "facts": self.root / "facts.json",
            "conflicts": self.root / "conflicts.json",
        }
        self.uploads = self.root / "uploads"
        self.root.mkdir(parents=True, exist_ok=True)
        self.uploads.mkdir(parents=True, exist_ok=True)

    def _read(self, kind: str) -> list[dict[str, Any]]:
        path = self.files[kind]
        if not path.exists():
            return []
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, list) else []
        except (OSError, ValueError):
            return []

    def _write(self, kind: str, items: list[dict[str, Any]]) -> None:
        path = self.files[kind]
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2, default=_json_default), encoding="utf-8")
        tmp.replace(path)

    def documents(self) -> list[dict[str, Any]]:
        return self._read("documents")

    def evidence(self) -> list[dict[str, Any]]:
        return self._read("evidence")

    def facts(self) -> list[dict[str, Any]]:
        return self._read("facts")

    def conflicts(self) -> list[dict[str, Any]]:
        return self._read("conflicts")

    def register_document(self, document: KnowledgeDocument) -> dict[str, Any]:
        if document.project_id != self.project_id:
            raise ValueError("document project_id mismatch")
        if document.source_tier not in SOURCE_TIERS:
            raise ValueError(f"unsupported source tier: {document.source_tier}")
        items = self.documents()
        items = [item for item in items if item.get("document_id") != document.document_id]
        items.append(asdict(document))
        self._write("documents", items)
        return asdict(document)

    def store_upload(self, document: KnowledgeDocument, content: bytes) -> dict[str, Any]:
        if not content:
            raise ValueError("document is empty")
        if len(content) > MAX_DOCUMENT_BYTES:
            raise ValueError(f"document exceeds {MAX_DOCUMENT_BYTES} bytes")
        suffix = Path(document.filename).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            raise ValueError(f"unsupported document type: {suffix or '<none>'}")
        digest = hashlib.sha256(content).hexdigest()
        stored_name = f"{_safe(document.document_id)}-{digest[:16]}{suffix}"
        target = self.uploads / stored_name
        target.write_bytes(content)
        document.sha256 = digest
        document.status = "pending"
        document.filename = document.filename or stored_name
        self.register_document(document)
        return {**asdict(document), "stored_name": stored_name, "size_bytes": len(content)}

    def add_evidence(self, evidence: KnowledgeEvidence) -> dict[str, Any]:
        if evidence.project_id != self.project_id:
            raise ValueError("evidence project_id mismatch")
        if not evidence.original_text.strip():
            raise ValueError("evidence text is empty")
        if evidence.status not in PUBLISH_STATUSES:
            raise ValueError(f"unsupported evidence status: {evidence.status}")
        if evidence.status == "published" and not evidence.document_id:
            raise ValueError("published evidence requires a document")
        items = [item for item in self.evidence() if item.get("evidence_id") != evidence.evidence_id]
        items.append(asdict(evidence))
        self._write("evidence", items)
        return asdict(evidence)

    def publish_evidence(self, evidence_id: str, reviewer: str = "") -> dict[str, Any]:
        items = self.evidence()
        for item in items:
            if item.get("evidence_id") == evidence_id:
                if not item.get("document_id"):
                    raise ValueError("evidence must reference a document")
                item["status"] = "published"
                item["reviewer"] = reviewer
                self._write("evidence", items)
                return item
        raise KeyError(evidence_id)

    def add_fact(self, fact: EngineeringFact) -> dict[str, Any]:
        if fact.project_id != self.project_id:
            raise ValueError("fact project_id mismatch")
        evidence_by_id = {item.get("evidence_id"): item for item in self.evidence()}
        if fact.status == "published":
            if not fact.evidence_ids or any(evidence_by_id.get(eid, {}).get("status") != "published" for eid in fact.evidence_ids):
                raise ValueError("published fact requires published evidence")
        items = [item for item in self.facts() if item.get("fact_id") != fact.fact_id]
        items.append(asdict(fact))
        self._write("facts", items)
        return asdict(fact)

    def search(self, query: str, *, domain: str = "", component: str = "", limit: int = 20, include_pending: bool = False) -> list[dict[str, Any]]:
        q = str(query or "").strip().lower()
        if not q and not domain and not component:
            return []
        doc_by_id = {item.get("document_id"): item for item in self.documents()}
        results: list[dict[str, Any]] = []
        for fact in self.facts():
            if not include_pending and fact.get("status") != "published":
                continue
            haystack = " ".join(str(fact.get(key, "")) for key in ("domain", "component", "parameter", "value", "unit", "applicability", "notes")).lower()
            if q and q not in haystack:
                continue
            if domain and str(fact.get("domain", "")).lower() != domain.lower():
                continue
            if component and component.lower() not in str(fact.get("component", "")).lower():
                continue
            sources = [doc_by_id.get(eid, {}) for eid in fact.get("evidence_ids", [])]
            results.append({"kind": "fact", **fact, "sources": sources})
        for evidence in self.evidence():
            if not include_pending and evidence.get("status") != "published":
                continue
            haystack = " ".join(str(evidence.get(key, "")) for key in ("original_text", "normalized_text", "applicability", "exclusions", "section", "table")).lower()
            if q and q not in haystack:
                continue
            results.append({"kind": "evidence", **evidence, "source": doc_by_id.get(evidence.get("document_id"), {})})
        return results[: max(1, min(int(limit), 100))]

    def add_conflict(self, conflict: KnowledgeConflict) -> dict[str, Any]:
        items = [item for item in self.conflicts() if item.get("conflict_id") != conflict.conflict_id]
        items.append(asdict(conflict))
        self._write("conflicts", items)
        return asdict(conflict)

    def resolve_conflict(self, conflict_id: str, resolution: str, resolved_value: Any = None) -> dict[str, Any]:
        items = self.conflicts()
        for item in items:
            if item.get("conflict_id") == conflict_id:
                item.update(status="resolved", resolution=str(resolution), resolved_value=resolved_value)
                self._write("conflicts", items)
                return item
        raise KeyError(conflict_id)


def domain_catalog() -> list[dict[str, Any]]:
    """Safe catalog metadata; no unverified numeric engineering facts."""
    return [
        {"domain": "sealing", "component": "o_ring", "scope": "ISO 3601 family and verified manufacturer/user data", "status": "scaffold"},
        {"domain": "fasteners", "component": "metric_screw", "scope": "ISO fastener geometry/mechanical-property references and verified catalogs", "status": "scaffold"},
        {"domain": "profiles", "component": "aluminum_extrusion", "scope": "vendor-specific profile catalogs only; no generic load claim", "status": "scaffold"},
    ]
