import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Toolsets"
    / "xyz-dimensions"
    / "xyz dimensions.py"
)


def load_module(context):
    spec = importlib.util.spec_from_file_location("flowcell_xyz_dimensions", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    previous_bpy = sys.modules.get("bpy")
    sys.modules["bpy"] = types.SimpleNamespace(context=context)
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_bpy is None:
            sys.modules.pop("bpy", None)
        else:
            sys.modules["bpy"] = previous_bpy
    return module


def fake_context(selected=True):
    obj = types.SimpleNamespace(
        name="Cube",
        dimensions=types.SimpleNamespace(x=1.0, y=2.0, z=3.0),
    )
    return types.SimpleNamespace(
        active_object=obj if selected else None,
        selected_objects=[obj] if selected else [],
        scene=types.SimpleNamespace(
            unit_settings=types.SimpleNamespace(scale_length=0.1)
        ),
        view_layer=types.SimpleNamespace(update=lambda: None),
    )


class XyzDimensionsTests(unittest.TestCase):
    def test_every_packaged_child_returns_the_original_all_axis_status(self):
        module = load_module(fake_context())
        manifest = json.loads(SCRIPT_PATH.with_name("flowcell.toolset.json").read_text())
        self.assertEqual([child["slot"] for child in manifest["children"]],
                         ["dimension_x", "dimension_y", "dimension_z"])
        for child in manifest["children"]:
            with self.subTest(command=child["slot"]):
                result = module.run_flowcell_action(data=child["payload"])
                self.assertEqual(result["status"], "ok")
                self.assertTrue(result["selected"])
                self.assertEqual(result["objectName"], "Cube")
                self.assertEqual(result["changed"], 0)
                for axis, expected in (("x", 3.937007874015748), ("y", 7.874015748031496),
                                       ("z", 11.811023622047244)):
                    self.assertAlmostEqual(result["dimensionsInches"][axis], expected)
                self.assertEqual(result["displayDimensions"],
                                 {"x": "3.937 in", "y": "7.874 in", "z": "11.811 in"})
                self.assertEqual(result["message"], "Cube: X 3.937 in, Y 7.874 in, Z 11.811 in")
                self.assertNotIn("fieldPatch", result)

    def test_status_and_unspecified_commands_retain_original_status_behavior(self):
        module = load_module(fake_context())
        expected = module.perform_dimensions_status()
        for data in (None, {"command": "status"}, {"command": "dimension_q"}, {"action": "dimension_y"}):
            with self.subTest(data=data):
                self.assertEqual(module.run_flowcell_action(data=data), expected)

    def test_every_child_reports_all_three_empty_readouts_without_selection(self):
        module = load_module(fake_context(selected=False))
        for command in ("dimension_x", "dimension_y", "dimension_z"):
            with self.subTest(command=command):
                result = module.run_flowcell_action(data={"command": command})
                self.assertEqual(result["status"], "ok")
                self.assertFalse(result["selected"])
                self.assertIsNone(result["dimensionsInches"])
                self.assertEqual(result["displayDimensions"], {"x": "-- in", "y": "-- in", "z": "-- in"})
                self.assertEqual(result["message"], "Select an object.")
                self.assertNotIn("fieldPatch", result)

    def test_physical_twenty_millimeters_updates_readout_without_mutation(self):
        for scale, size in ((1.0, 0.02), (0.001, 20.0)):
            with self.subTest(scale=scale):
                context = fake_context()
                context.scene.unit_settings.scale_length = scale
                context.active_object.dimensions.x = size
                before = vars(context.active_object.dimensions).copy()
                module = load_module(context)

                result = module.run_flowcell_action(data={"command": "dimension_x"})

                self.assertEqual(result["displayDimensions"]["x"], "0.787 in")
                self.assertEqual(result["changed"], 0)
                self.assertEqual(vars(context.active_object.dimensions), before)
                self.assertEqual(context.scene.unit_settings.scale_length, scale)

    def test_unselected_active_object_does_not_replace_the_first_selected_object(self):
        context = fake_context()
        context.active_object = types.SimpleNamespace(name="Unselected", dimensions=None)
        result = load_module(context).run_flowcell_action(data={"command": "dimension_x"})
        self.assertEqual(result["objectName"], "Cube")
        self.assertEqual(result["displayDimensions"]["z"], "11.811 in")


if __name__ == "__main__":
    unittest.main()
