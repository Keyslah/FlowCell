import importlib.util
import json
import math
import pathlib
import sys
import types
import unittest


HERE = pathlib.Path(__file__).resolve().parent


def _load_module():
    adsk = types.ModuleType("adsk")
    core = types.ModuleType("adsk.core")
    fusion = types.ModuleType("adsk.fusion")

    class BRepBody:
        @staticmethod
        def cast(entity):
            return entity if getattr(entity, "fake_kind", "") == "body" else None

    class Occurrence:
        @staticmethod
        def cast(entity):
            return entity if getattr(entity, "fake_kind", "") == "occurrence" else None

    fusion.BRepBody = BRepBody
    fusion.Occurrence = Occurrence
    fusion.Design = type("Design", (), {"cast": staticmethod(lambda value: value)})
    fusion.DesignTypes = types.SimpleNamespace(ParametricDesignType="parametric")
    adsk.core = core
    adsk.fusion = fusion
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = core
    sys.modules["adsk.fusion"] = fusion

    spec = importlib.util.spec_from_file_location("flowcell_fusion_rotate", HERE / "rotate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROTATE = _load_module()


class RotateTests(unittest.TestCase):
    def test_positive_and_negative_buttons_own_the_sign(self):
        self.assertEqual(ROTATE._signed_angle_degrees(-30, "positive"), 30.0)
        self.assertEqual(ROTATE._signed_angle_degrees(30, "negative"), -30.0)
        self.assertEqual(ROTATE._signed_angle_degrees(-45, "+"), 45.0)
        self.assertEqual(ROTATE._signed_angle_degrees(45, "-"), -45.0)
        with self.assertRaisesRegex(ValueError, "finite"):
            ROTATE._signed_angle_degrees(math.inf, "positive")

    def test_world_axis_vectors_are_exact(self):
        self.assertEqual(ROTATE._axis_values("x"), ("X", (1.0, 0.0, 0.0)))
        self.assertEqual(ROTATE._axis_values("Y"), ("Y", (0.0, 1.0, 0.0)))
        self.assertEqual(ROTATE._axis_values("z"), ("Z", (0.0, 0.0, 1.0)))
        with self.assertRaisesRegex(ValueError, "Unsupported rotation axis"):
            ROTATE._axis_values("Q")

    def test_object_pivot_uses_last_selection_as_reference(self):
        records = [{"label": "one"}, {"label": "two"}, {"label": "reference"}]
        targets, reference = ROTATE._object_mode_targets(records)
        self.assertEqual([record["label"] for record in targets], ["one", "two"])
        self.assertEqual(reference["label"], "reference")
        with self.assertRaisesRegex(ValueError, "pivot body/component last"):
            ROTATE._object_mode_targets([records[-1]])

    def test_manifest_exposes_transform_and_distribute_like_blender(self):
        manifest = json.loads((HERE / "flowcell.toolset.json").read_text(encoding="utf-8"))
        slots = [child["slot"] for child in manifest["children"]]
        self.assertEqual(len(slots), 18)
        self.assertIn("center_pick", slots)
        self.assertIn("mode_transform", slots)
        self.assertIn("mode_distribute", slots)
        self.assertIn("value_input", slots)
        layout = manifest["layout"]
        self.assertEqual(set(layout["placements"]), set(slots))
        self.assertTrue(layout["updatePolicy"]["appendMissingChildSlots"])
        behaviors = layout["childBehaviors"]
        self.assertEqual(behaviors["value_input"], {"inlineEditField": "value", "execute": False})
        self.assertEqual(behaviors["mode_distribute"]["fieldPatch"], {"operation_mode": "DISTRIBUTE"})
        self.assertEqual(behaviors["mode_distribute"]["activationPatch"], {"value": 3})
        for slot in ("apply_negative", "apply_positive"):
            template = behaviors[slot]["payloadTemplate"]
            self.assertEqual(template["distribute_count"], {"$field": "value"})
            self.assertEqual(template["direction"], slot.split("_")[1])
        modes = next(field for field in layout["fields"] if field["id"] == "operation_mode")
        self.assertEqual([option["value"] for option in modes["options"]], ["TRANSFORM", "DISTRIBUTE"])

    def test_distribute_count_is_bounded(self):
        self.assertEqual(ROTATE._distribute_count("3"), 3)
        self.assertEqual(ROTATE._distribute_count(4.4), 4)
        with self.assertRaisesRegex(ValueError, "at least 1"):
            ROTATE._distribute_count(0)
        with self.assertRaisesRegex(ValueError, "360 or fewer"):
            ROTATE._distribute_count(1000)

    def test_precise_bounds_are_preferred(self):
        precise = types.SimpleNamespace(
            minPoint=types.SimpleNamespace(x=-1, y=-2, z=-3),
            maxPoint=types.SimpleNamespace(x=4, y=5, z=6),
        )
        coarse = types.SimpleNamespace(
            minPoint=types.SimpleNamespace(x=-9, y=-9, z=-9),
            maxPoint=types.SimpleNamespace(x=9, y=9, z=9),
        )
        self.assertEqual(
            ROTATE._raw_bounds(types.SimpleNamespace(preciseBoundingBox=precise, boundingBox=coarse)),
            ((-1.0, -2.0, -3.0), (4.0, 5.0, 6.0)),
        )

    def test_selection_is_restored_in_original_order(self):
        class Selections:
            def __init__(self):
                self.entities = [object()]

            @property
            def count(self):
                return len(self.entities)

            def clear(self):
                self.entities.clear()
                return True

            def add(self, entity):
                self.entities.append(entity)
                return True

        first = types.SimpleNamespace(isValid=True)
        second = types.SimpleNamespace(isValid=True)
        selections = Selections()
        records = [
            {"kind": "body", "entity": first, "token": "first"},
            {"kind": "occurrence", "entity": second, "token": "second"},
        ]
        restored = ROTATE._restore_selection(
            types.SimpleNamespace(activeSelections=selections), object(), records
        )
        self.assertTrue(restored)
        self.assertEqual([first, second], selections.entities)


if __name__ == "__main__":
    unittest.main()
