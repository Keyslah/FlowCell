import importlib.util
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
    def test_each_child_returns_only_its_labeled_axis(self):
        module = load_module(fake_context())

        for command, axis_key, axis_label, expected_value in (
            ("dimension_x", "x", "X", 3.937007874015748),
            ("dimension_y", "y", "Y", 7.874015748031496),
            ("dimension_z", "z", "Z", 11.811023622047244),
        ):
            with self.subTest(command=command):
                result = module.run_flowcell_action(data={"command": command})

                self.assertEqual(result["status"], "ok")
                self.assertEqual(result["command"], command)
                self.assertEqual(result["axis"], axis_label)
                self.assertEqual(result["axisKey"], axis_key)
                self.assertEqual(result["label"], axis_label)
                self.assertAlmostEqual(result["dimensionInches"], expected_value)
                self.assertEqual(set(result["dimensionsInches"]), {axis_key})
                self.assertEqual(set(result["displayDimensions"]), {axis_key})
                self.assertEqual(result["data"]["label"], axis_label)
                self.assertEqual(result["message"], f"Cube: {result['display']}")

    def test_action_falls_back_when_command_is_missing(self):
        module = load_module(fake_context())
        result = module.run_flowcell_action(data={"action": "dimension_y"})

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["command"], "dimension_y")
        self.assertEqual(result["axis"], "Y")

    def test_missing_and_unknown_commands_are_safe_errors(self):
        module = load_module(fake_context())

        missing = module.run_flowcell_action(data=None)
        unknown = module.run_flowcell_action(data={"command": "dimension_q"})

        self.assertEqual(missing["status"], "error")
        self.assertIn("Missing dimensions command", missing["message"])
        self.assertEqual(unknown["status"], "error")
        self.assertIn("Unknown dimensions command 'dimension_q'", unknown["message"])

    def test_no_selection_response_still_matches_requested_axis(self):
        module = load_module(fake_context(selected=False))
        result = module.run_flowcell_action(data={"command": "dimension_z"})

        self.assertEqual(result["status"], "ok")
        self.assertFalse(result["selected"])
        self.assertEqual(result["axis"], "Z")
        self.assertEqual(result["display"], "Z -- in")
        self.assertEqual(result["dimensionsInches"], {"z": None})


if __name__ == "__main__":
    unittest.main()
