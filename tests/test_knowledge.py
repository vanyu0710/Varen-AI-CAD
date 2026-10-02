"""Evidence-first knowledge and research-plan API safety tests."""

from __future__ import annotations

import os
import unittest
import tempfile
from pathlib import Path

os.environ["MECHCAD_STORE_PATH"] = str(Path(tempfile.mkdtemp(prefix="mechcad-knowledge-store-")) / "projects.json")
os.environ["MECHCAD_KNOWLEDGE_DIR"] = tempfile.mkdtemp(prefix="mechcad-knowledge-root-")

import backend.main as main_module
from fastapi.testclient import TestClient


class KnowledgeApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main_module.app)

    def setUp(self):
        self.project_id = self.client.post("/api/projects", json={"name": "knowledge"}).json()["project_id"]
        main_module._knowledge_plans.clear()

    def test_catalog_contains_no_engineering_values(self):
        response = self.client.get(f"/api/projects/{self.project_id}/knowledge/catalog")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["policy"], "published evidence only; unresolved conflicts block CAD mutation")
        for domain in payload["domains"]:
            self.assertEqual(domain["status"], "scaffold")
            self.assertNotIn("values", domain)

    def test_upload_and_evidence_publication_flow(self):
        upload = self.client.post(
            f"/api/projects/{self.project_id}/knowledge/documents/upload",
            params={"filename": "vendor-o-ring.pdf"},
            content=b"%PDF-1.4 test",
            headers={"content-type": "application/octet-stream"},
        )
        self.assertEqual(upload.status_code, 200)
        document = upload.json()
        self.assertEqual(document["status"], "pending")
        self.assertEqual(len(document["sha256"]), 64)

        evidence = self.client.post(
            f"/api/projects/{self.project_id}/knowledge/evidence",
            json={
                "evidence_id": "evd-1",
                "document_id": document["document_id"],
                "original_text": "Vendor states cord cross-section 2.00 mm for this series.",
                "section": "4.2",
                "status": "pending",
            },
        )
        self.assertEqual(evidence.status_code, 200)

        fact = self.client.post(
            f"/api/projects/{self.project_id}/knowledge/facts",
            json={"fact_id": "fact-1", "domain": "sealing", "component": "o_ring", "parameter": "cord_cross_section", "value": 2.0, "unit": "mm", "evidence_ids": ["evd-1"], "status": "published"},
        )
        self.assertEqual(fact.status_code, 400)

        published = self.client.post(f"/api/projects/{self.project_id}/knowledge/evidence/evd-1/publish", params={"reviewer": "user"})
        self.assertEqual(published.status_code, 200)
        fact = self.client.post(
            f"/api/projects/{self.project_id}/knowledge/facts",
            json={"fact_id": "fact-1", "domain": "sealing", "component": "o_ring", "parameter": "cord_cross_section", "value": 2.0, "unit": "mm", "evidence_ids": ["evd-1"], "status": "published"},
        )
        self.assertEqual(fact.status_code, 200)
        search = self.client.post(f"/api/projects/{self.project_id}/knowledge/search", json={"query": "o_ring"})
        self.assertEqual(search.status_code, 200)
        self.assertTrue(search.json()["results"])

    def test_pending_is_hidden_from_default_search(self):
        upload = self.client.post(
            f"/api/projects/{self.project_id}/knowledge/documents/upload",
            params={"filename": "manual.txt"},
            content=b"pending material",
        )
        document_id = upload.json()["document_id"]
        self.client.post(
            f"/api/projects/{self.project_id}/knowledge/evidence",
            json={"evidence_id": "evd-pending", "document_id": document_id, "original_text": "pending material", "status": "pending"},
        )
        hidden = self.client.post(f"/api/projects/{self.project_id}/knowledge/search", json={"query": "pending material"})
        self.assertEqual(hidden.json()["results"], [])
        visible = self.client.post(f"/api/projects/{self.project_id}/knowledge/search", json={"query": "pending material", "include_pending": True})
        self.assertEqual(len(visible.json()["results"]), 1)

    def test_upload_validates_type_and_empty_content(self):
        empty = self.client.post(f"/api/projects/{self.project_id}/knowledge/documents/upload", params={"filename": "empty.pdf"}, content=b"")
        self.assertEqual(empty.status_code, 400)
        unsupported = self.client.post(f"/api/projects/{self.project_id}/knowledge/documents/upload", params={"filename": "tool.exe"}, content=b"bad")
        self.assertEqual(unsupported.status_code, 400)

    def test_research_plan_boundaries(self):
        created = self.client.post(f"/api/projects/{self.project_id}/research/plan", json={"goal": "设计一个静密封结构", "domains": ["sealing"], "include_experiments": True})
        self.assertEqual(created.status_code, 200)
        plan = created.json()
        roles = [task["role"] for task in plan["tasks"]]
        self.assertIn("requirements", roles)
        self.assertIn("sealing", roles)
        self.assertNotIn("fasteners", roles)
        self.assertIn("experiment", roles)
        validation = next(task for task in plan["tasks"] if task["role"] == "geometry_validation")
        self.assertTrue(validation["depends_on"])
        self.assertIn("published evidence only", plan["evidence_policy"])

        missing = self.client.get("/api/projects/missing/research/plan")
        self.assertEqual(missing.status_code, 404)


import unittest  # noqa: E402
