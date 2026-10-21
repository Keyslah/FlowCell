from __future__ import annotations

import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    core = types.ModuleType("adsk.core")
    fusion = types.ModuleType("adsk.fusion")

    class Application:
        @staticmethod
        def get():
            return None

    class ValueInput:
        @staticmethod
        def createByReal(value):
            return float(value)

    class ObjectCollection(list):
        @staticmethod
        def create():
            return ObjectCollection()

        def add(self, value):
            self.append(value)

    class BRepBody:
        @staticmethod
        def cast(value):
            return value if getattr(value, "_is_body", False) else None

    core.Application = Application
    core.ValueInput = ValueInput
    core.ObjectCollection = ObjectCollection
    fusion.BRepBody = BRepBody
    fusion.Design = type("Design", (), {"cast": staticmethod(lambda value: value)})
    fusion.DesignTypes = types.SimpleNamespace(ParametricDesignType="parametric")
    fusion.MoveFeatureTranslateXYZDefinition = type(
        "MoveFeatureTranslateXYZDefinition", (), {"cast": staticmethod(lambda value: value)}
    )
    adsk.core = core
    adsk.fusion = fusion
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = core
    sys.modules["adsk.fusion"] = fusion


_install_fake_adsk()
HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("flowcell_fusion_scale", HERE / "scale.py")
SCALE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(SCALE)


def _box(minimum, maximum):
    return types.SimpleNamespace(
        minPoint=types.SimpleNamespace(x=minimum[0], y=minimum[1], z=minimum[2]),
        maxPoint=types.SimpleNamespace(x=maximum[0], y=maximum[1], z=maximum[2]),
    )


class ScaleTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((HERE / "flowcell.toolset.json").read_text(encoding="utf-8"))

    def test_union_bounding_box_reports_exact_dimensions(self):
        bodies = [
            types.SimpleNamespace(preciseBoundingBox=_box((0, 0, 0), (2, 3, 4))),
            types.SimpleNamespace(preciseBoundingBox=_box((-1, 1, 2), (1, 5, 6))),
        ]
        bounds = SCALE._bounds(bodies)
        self.assertEqual(bounds["min"], (-1.0, 0.0, 0.0))
        self.assertEqual(bounds["max"], (2.0, 5.0, 6.0))
        self.assertEqual(bounds["dimensions"], (3.0, 5.0, 6.0))

    def test_flat_selection_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "nonzero size"):
            SCALE._bounds([types.SimpleNamespace(preciseBoundingBox=_box((0, 0, 0), (2, 3, 0)))])

    def test_locked_sides_land_on_their_targets(self):
        start = SCALE._bounds([types.SimpleNamespace(preciseBoundingBox=_box((2, 4, 6), (6, 8, 10)))])
        modes = {"X": "MIN", "Y": "NONE", "Z": "MAX"}
        factors = {"X": 2.0, "Y": 0.5, "Z": 1.5}
        group = {"offset": (0.0, 0.0, 0.0)}
        plan = SCALE._side_plan(start, modes, None)
        self.assertEqual(plan, {"X": (2.0, 2.0), "Y": (6.0, 6.0), "Z": (10.0, 10.0)})
        translation = SCALE._pin_translation(group, factors, plan)
        for index, axis in enumerate("XYZ"):
            side, target = plan[axis]
            self.assertAlmostEqual(side * factors[axis] + translation[index], target)

    def test_base_moves_a_locked_side_to_the_stored_edge(self):
        start = SCALE._bounds([types.SimpleNamespace(preciseBoundingBox=_box((0, 0, 5), (2, 2, 9)))])
        baseline = {"min": (0.0, 0.0, 0.0), "max": (2.0, 2.0, 4.0)}
        plan = SCALE._side_plan(start, {"X": "NONE", "Y": "NONE", "Z": "MIN"}, baseline)
        self.assertEqual(plan["Z"], (5.0, 0.0))
        translation = SCALE._pin_translation({"offset": (0.0, 0.0, 0.0)}, {"X": 1.0, "Y": 1.0, "Z": 2.0}, plan)
        self.assertAlmostEqual(5.0 * 2.0 + translation[2], 0.0)

    def test_component_offsets_use_component_space(self):
        plan = {"X": (12.0, 12.0), "Y": (3.0, 3.0), "Z": (-4.0, -4.0)}
        translation = SCALE._pin_translation({"offset": (10.0, 0.0, -5.0)}, {"X": 2.0, "Y": 1.0, "Z": 3.0}, plan)
        self.assertEqual(translation, (-2.0, 0.0, -2.0))

    def test_slider_percent_becomes_a_clamped_factor(self):
        factors = SCALE._slider_factors({"scale_x": 150, "scale_y": 0, "scale_z": "bad"})
        self.assertEqual(factors, {"X": 1.5, "Y": SCALE.MIN_FACTOR, "Z": 1.0})

    def test_modes_cycle_none_min_max(self):
        self.assertEqual(SCALE.NEXT_MODE, {"NONE": "MIN", "MIN": "MAX", "MAX": "NONE"})

    def test_manifest_matches_the_smart_axis_buttons_plus_sliders(self):
        manifest = self.manifest
        labels = [child["label"] for child in manifest["children"][:6]]
        self.assertEqual(labels, ["Base", "X", "Y", "Z", "Live", "Refresh"])
        self.assertEqual(manifest["stateQuery"], {"slot": "cycle_x", "payload": {"action": "status", "command": "status"}})
        fields = {field["id"]: field for field in manifest["layout"]["fields"]}
        behaviors = manifest["layout"]["childBehaviors"]
        slots = {child["slot"] for child in manifest["children"]}
        for axis in "xyz":
            slider = fields[f"scale_{axis}"]
            self.assertEqual(slider["kind"], "range")
            self.assertEqual(slider["linkToggleField"], f"link_{axis}")
            self.assertEqual(slider["serviceTrigger"], "input")
            self.assertEqual(slider["serviceTarget"]["payload"]["command"], "slide")
            self.assertEqual(behaviors[f"link_{axis}_button"], {"toggleFields": [f"link_{axis}"], "execute": False})
            self.assertNotIn(f"cycle_{axis}", behaviors)
        for field in fields.values():
            target = field.get("serviceTarget")
            if target:
                self.assertIn(target["command"], slots)

    def test_buttons_and_visible_fields_fit_without_overlapping(self):
        layout = self.manifest["layout"]
        rects = dict(layout["placements"])
        rects.update({
            field["id"]: field for field in layout["fields"] if not field.get("hidden", False)
        })
        for name, rect in rects.items():
            self.assertGreaterEqual(rect["x"], 0, name)
            self.assertGreaterEqual(rect["y"], 0, name)
            self.assertLessEqual(rect["x"] + rect["width"], layout["width"], name)
            self.assertLessEqual(rect["y"] + rect["height"], layout["height"], name)
        names = sorted(rects)
        for index, first in enumerate(names):
            for second in names[index + 1:]:
                a, b = rects[first], rects[second]
                overlap = (
                    a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]
                    and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]
                )
                self.assertFalse(overlap, f"{first} overlaps {second}")

    def test_unknown_command_is_cancelled_without_touching_fusion(self):
        original = SCALE._runtime
        SCALE._runtime = lambda: (object(), object())
        try:
            result = SCALE.run_flowcell_action(None, {"command": "nonsense"})
        finally:
            SCALE._runtime = original
        self.assertEqual(result["status"], "CANCELLED")

    def test_direct_design_fails_before_feature_creation(self):
        with self.assertRaisesRegex(ValueError, "Capture Design History"):
            SCALE._require_parametric_design(types.SimpleNamespace(designType="direct"))


if __name__ == "__main__":
    unittest.main()
