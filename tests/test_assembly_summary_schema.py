"""Export classifications must survive the frontend projection without inventing legacy evidence."""
import unittest
from backend.schemas import AssemblySummary


class AssemblySummarySchemaTests(unittest.TestCase):
    def test_program_classifications_survive_roundtrip(self):
        values = dict(parts_count=26, total_pairs=325, hard_collision_count=0,
                      expected_fit_count=2, expected_mesh_count=3)
        result = AssemblySummary.model_validate(values).model_dump()
        for key, value in values.items():
            self.assertEqual(result[key], value)

    def test_old_manifest_has_unknown_classifications(self):
        result = AssemblySummary.model_validate(dict(interfering_count=4, exempted_count=4))
        self.assertIsNone(result.hard_collision_count)
        self.assertIsNone(result.expected_fit_count)
        self.assertIsNone(result.expected_mesh_count)
