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

    class EventHandler:
        pass

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

    class Matrix3D:
        @staticmethod
        def create():
            return Matrix3D()

        def setWithCoordinateSystem(self, origin, x_axis, y_axis, z_axis):
            self.coordinate_system = (origin, x_axis, y_axis, z_axis)
            return True

    class Point3D:
        @staticmethod
        def create(*values):
            return tuple(values)

    class Vector3D(Point3D):
        pass

    class DropDownStyles:
        TextListDropDownStyle = 1

    class BRepBody:
        @staticmethod
        def cast(value):
            return value if getattr(value, "_is_body", False) else None

    class Design:
        @staticmethod
        def cast(value):
            return value

    core.Application = Application
    core.ValueInput = ValueInput
    core.ObjectCollection = ObjectCollection
    core.Matrix3D = Matrix3D
    core.Point3D = Point3D
    core.Vector3D = Vector3D
    core.DropDownStyles = DropDownStyles
    core.InputChangedEventHandler = EventHandler
    core.CommandEventHandler = EventHandler
    core.ValidateInputsEventHandler = EventHandler
    core.CommandCreatedEventHandler = EventHandler
    fusion.BRepBody = BRepBody
    fusion.Design = Design
    fusion.DesignTypes = types.SimpleNamespace(ParametricDesignType="parametric")
    adsk.core = core
    adsk.fusion = fusion
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = core
    sys.modules["adsk.fusion"] = fusion


def _load_scale_module():
    _install_fake_adsk()
    source = Path(__file__).resolve().parents[1] / "scale.py"
    spec = importlib.util.spec_from_file_location("flowcell_fusion_scale_test", source)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class Point:
    def __init__(self, x, y, z):
        self.x, self.y, self.z = x, y, z


class Box:
    def __init__(self, low, high):
        self.minPoint = Point(*low)
        self.maxPoint = Point(*high)


class Body:
    _is_body = True

    def __init__(self, low, high):
        self.preciseBoundingBox = Box(low, high)


class ScaleInput:
    def __init__(self):
        self.non_uniform = None

    def setToNonUniform(self, x, y, z):
        self.non_uniform = (x, y, z)
        return True


class Feature:
    pass


class ScaleFeatures:
    def __init__(self):
        self.input = None

    def createInput(self, entities, point, factor):
        self.entities = entities
        self.point = point
        self.factor = factor
        self.input = ScaleInput()
        return self.input

    def add(self, scale_input):
        self.added = scale_input
        return Feature()


class MoveInput:
    def defineAsTranslateXYZ(self, x, y, z, is_design_space):
        self.translation = (x, y, z)
        self.is_design_space = is_design_space
        return True


class MoveFeatures:
    def createInput2(self, entities):
        self.entities = entities
        self.input = MoveInput()
        return self.input

    def add(self, move_input):
        self.added = move_input
        return Feature()


class StrictTriad:
    __slots__ = (
        "isXScalingInXYVisible",
        "isYScalingInXYVisible",
        "isZScalingInXZVisible",
        "transform",
        "xScaleFactor",
        "yScaleFactor",
        "zScaleFactor",
        "isEnabled",
        "isVisible",
        "isValidExpressions",
    )

    def __init__(self):
        self.isXScalingInXYVisible = False
        self.isYScalingInXYVisible = False
        self.isZScalingInXZVisible = False
        self.transform = None
        self.xScaleFactor = 1.0
        self.yScaleFactor = 1.0
        self.zScaleFactor = 1.0
        self.isEnabled = False
        self.isVisible = False
        self.isValidExpressions = True

    def hideAll(self):
        self.isXScalingInXYVisible = False
        self.isYScalingInXYVisible = False
        self.isZScalingInXZVisible = False
        return True


class ScaleTests(unittest.TestCase):
    def setUp(self):
        self.scale = _load_scale_module()

    def test_union_bounding_box_reports_exact_dimensions(self):
        bounds = self.scale._bounding_box_for_bodies(
            [Body((2, -1, 4), (5, 3, 9)), Body((-2, 1, 0), (4, 8, 6))]
        )
        self.assertEqual((-2.0, -1.0, 0.0), bounds["min"])
        self.assertEqual((5.0, 8.0, 9.0), bounds["max"])
        self.assertEqual((7.0, 9.0, 9.0), bounds["dimensions"])
        self.assertTrue(bounds["precise"])

    def test_pin_translation_holds_min_max_and_center(self):
        baseline = {
            "min": (2.0, 10.0, -4.0),
            "max": (6.0, 14.0, 2.0),
            "center": (4.0, 12.0, -1.0),
            "dimensions": (4.0, 4.0, 6.0),
        }
        state = {"x_pin": "MIN", "y_pin": "MAX", "z_pin": "NONE"}
        plan = self.scale._scale_plan(baseline, {"X": 8.0, "Y": 2.0, "Z": 12.0}, state)
        self.assertAlmostEqual(2.0, plan["factors"]["X"])
        self.assertAlmostEqual(-2.0, plan["translations"]["X"])
        self.assertAlmostEqual(7.0, plan["translations"]["Y"])
        self.assertAlmostEqual(1.0, plan["translations"]["Z"])
        self.assertAlmostEqual(2.0, 2.0 * 2.0 + plan["translations"]["X"])
        self.assertAlmostEqual(14.0, 0.5 * 14.0 + plan["translations"]["Y"])
        self.assertAlmostEqual(-1.0, 2.0 * -1.0 + plan["translations"]["Z"])

    def test_scale_and_pin_correction_use_native_features(self):
        scale_features = ScaleFeatures()
        move_features = MoveFeatures()
        features = types.SimpleNamespace(scaleFeatures=scale_features, moveFeatures=move_features)
        component = types.SimpleNamespace(features=features, originConstructionPoint=object())
        design = types.SimpleNamespace(rootComponent=component)
        baseline = {
            "min": (2.0, 0.0, 0.0),
            "max": (6.0, 4.0, 4.0),
            "center": (4.0, 2.0, 2.0),
            "dimensions": (4.0, 4.0, 4.0),
        }
        state = {"x_pin": "MIN", "y_pin": "NONE", "z_pin": "NONE"}
        result = self.scale._apply_scale_features(
            design,
            [object()],
            baseline,
            {"X": 8.0, "Y": 8.0, "Z": 8.0},
            state,
        )
        self.assertTrue(result["changed"])
        self.assertEqual((2.0, 2.0, 2.0), scale_features.input.non_uniform)
        self.assertEqual((-2.0, -2.0, -2.0), move_features.input.translation)
        self.assertFalse(move_features.input.is_design_space)

    def test_manifest_exposes_visible_axis_and_pin_state_controls(self):
        manifest_path = Path(__file__).resolve().parents[1] / "flowcell.toolset.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        behaviors = manifest["layout"]["childBehaviors"]
        self.assertEqual("x", behaviors["x_dimension"]["inlineEditField"])
        self.assertEqual("x_pin", behaviors["pin_x"]["selectField"])
        children = {child["slot"]: child for child in manifest["children"]}
        self.assertEqual("Lock Aspect", children["aspect_lock"]["label"])
        self.assertEqual("Scale / Drag", children["apply"]["label"])
        fields = {field["id"]: field for field in manifest["layout"]["fields"]}
        self.assertEqual(["Free X", "Free Y", "Free Z"], [item["label"] for item in fields["free_axis"]["options"]])
        self.assertEqual(["X Center", "X Min", "X Max"], [item["label"] for item in fields["x_pin"]["options"]])
        self.assertEqual({"action": "status", "command": "status"}, manifest["stateQuery"]["payload"])

    def test_explicit_button_placements_are_inside_the_popout_and_do_not_overlap(self):
        manifest_path = Path(__file__).resolve().parents[1] / "flowcell.toolset.json"
        layout = json.loads(manifest_path.read_text(encoding="utf-8"))["layout"]
        rectangles = []
        for slot, placement in layout["placements"].items():
            left = placement["x"]
            top = placement["y"]
            right = left + placement["width"]
            bottom = top + placement["height"]
            self.assertLessEqual(right, layout["width"], slot)
            self.assertLessEqual(bottom, layout["height"], slot)
            for other_slot, other_left, other_top, other_right, other_bottom in rectangles:
                overlaps = left < other_right and right > other_left and top < other_bottom and bottom > other_top
                self.assertFalse(overlaps, f"{slot} overlaps {other_slot}")
            rectangles.append((slot, left, top, right, bottom))

    def test_every_used_triad_member_exists_for_each_free_axis(self):
        baseline = {
            "min": (0.0, 0.0, 0.0),
            "max": (2.0, 3.0, 4.0),
            "center": (1.0, 1.5, 2.0),
            "dimensions": (2.0, 3.0, 4.0),
        }
        session = object.__new__(self.scale._ScaleCommandSession)
        session.baseline = baseline
        session.inputs = {
            "x": types.SimpleNamespace(value=2.0),
            "y": types.SimpleNamespace(value=3.0),
            "z": types.SimpleNamespace(value=4.0),
            "triad": StrictTriad(),
        }
        session.state = {
            "free_axis": "X",
            "x_pin": "NONE",
            "y_pin": "NONE",
            "z_pin": "NONE",
        }
        for axis, visible_property in (
            ("X", "isXScalingInXYVisible"),
            ("Y", "isYScalingInXYVisible"),
            ("Z", "isZScalingInXZVisible"),
        ):
            session.state["free_axis"] = axis
            session._configure_triad()
            triad = session.inputs["triad"]
            self.assertTrue(getattr(triad, visible_property))
            self.assertTrue(triad.isEnabled)
            self.assertTrue(triad.isVisible)
            self.assertTrue(triad.isValidExpressions)

    def test_initial_triad_factor_is_deferred_until_command_activation(self):
        session = object.__new__(self.scale._ScaleCommandSession)
        session.baseline = {
            "min": (0.0, 0.0, 0.0),
            "max": (2.0, 3.0, 4.0),
            "center": (1.0, 1.5, 2.0),
            "dimensions": (2.0, 3.0, 4.0),
        }
        session.inputs = {
            "x": types.SimpleNamespace(value=4.0),
            "y": types.SimpleNamespace(value=3.0),
            "z": types.SimpleNamespace(value=4.0),
            "triad": StrictTriad(),
        }
        session.state = {
            "free_axis": "X",
            "x_pin": "NONE",
            "y_pin": "NONE",
            "z_pin": "NONE",
        }

        session._configure_triad(apply_factor=False)
        self.assertEqual(1.0, session.inputs["triad"].xScaleFactor)

        self.scale._ActivateHandler(session).notify(types.SimpleNamespace())
        self.assertEqual(2.0, session.inputs["triad"].xScaleFactor)

    def test_direct_design_fails_before_feature_creation(self):
        self.scale._require_parametric_design(types.SimpleNamespace(designType="parametric"))
        with self.assertRaisesRegex(ValueError, "Capture Design History"):
            self.scale._require_parametric_design(types.SimpleNamespace(designType="direct"))

    def test_execute_failure_aborts_the_fusion_transaction(self):
        session = types.SimpleNamespace(execute=lambda: (_ for _ in ()).throw(RuntimeError("late failure")))
        handler = self.scale._ExecuteHandler(session)
        args = types.SimpleNamespace(executeFailed=False, executeFailedMessage="")
        handler.notify(args)
        self.assertTrue(args.executeFailed)
        self.assertEqual("late failure", args.executeFailedMessage)


if __name__ == "__main__":
    unittest.main()
