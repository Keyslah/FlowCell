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
        with self.assertRaisesRegex(ValueError, "last selection"):
            ROTATE._object_mode_targets([records[-1]])

    def test_manifest_exposes_transform_controls_without_distribute(self):
        manifest = json.loads((HERE / "flowcell.toolset.json").read_text(encoding="utf-8"))
        slots = {child["slot"] for child in manifest["children"]}
        self.assertIn("center_pick", slots)
        self.assertIn("mode_transform", slots)
        self.assertIn("value_input", slots)
        self.assertNotIn("mode_distribute", slots)
        self.assertFalse(any("distribute" in slot.lower() for slot in slots))
        behaviors = manifest["layout"]["childBehaviors"]
        self.assertEqual(behaviors["value_input"], {"inlineEditField": "value", "execute": False})
        self.assertEqual(
            behaviors["apply_negative"]["payloadTemplate"]["direction"],
            "negative",
        )
        self.assertEqual(
            behaviors["apply_positive"]["payloadTemplate"]["direction"],
            "positive",
        )

    def test_design_history_and_component_body_boundaries_fail_closed(self):
        root = object()
        ROTATE._require_parametric_design(types.SimpleNamespace(designType="parametric"))
        with self.assertRaisesRegex(ValueError, "Capture Design History"):
            ROTATE._require_parametric_design(types.SimpleNamespace(designType="direct"))

        safe_body = types.SimpleNamespace(assemblyContext=None, parentComponent=root)
        ROTATE._require_instance_safe_bodies([{"kind": "body", "entity": safe_body}], types.SimpleNamespace(rootComponent=root))
        proxy_body = types.SimpleNamespace(assemblyContext=object(), parentComponent=root)
        with self.assertRaisesRegex(ValueError, "Select the occurrence"):
            ROTATE._require_instance_safe_bodies([{"kind": "body", "entity": proxy_body}], types.SimpleNamespace(rootComponent=root))
        component_body = types.SimpleNamespace(assemblyContext=None, parentComponent=object())
        with self.assertRaisesRegex(ValueError, "root-component"):
            ROTATE._require_instance_safe_bodies([{"kind": "body", "entity": component_body}], types.SimpleNamespace(rootComponent=root))

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
