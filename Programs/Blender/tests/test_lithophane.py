import importlib.util
import math
import sys
import types
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Utility"
    / "lithophane.py"
)


def load_module():
    bmesh_module = types.ModuleType("bmesh")
    bpy_module = types.ModuleType("bpy")
    props_module = types.ModuleType("bpy.props")
    props_module.CollectionProperty = lambda **_kwargs: None
    props_module.FloatProperty = lambda **_kwargs: None
    props_module.StringProperty = lambda **_kwargs: None

    types_module = types.ModuleType("bpy.types")
    types_module.OperatorFileListElement = type("OperatorFileListElement", (), {})
    types_module.Operator = type("Operator", (), {})
    bpy_module.props = props_module
    bpy_module.types = types_module

    io_utils_module = types.ModuleType("bpy_extras.io_utils")
    io_utils_module.ImportHelper = type("ImportHelper", (), {})
    bpy_extras_module = types.ModuleType("bpy_extras")
    bpy_extras_module.io_utils = io_utils_module

    replacements = {
        "bmesh": bmesh_module,
        "bpy": bpy_module,
        "bpy.props": props_module,
        "bpy.types": types_module,
        "bpy_extras": bpy_extras_module,
        "bpy_extras.io_utils": io_utils_module,
    }
    previous = {name: sys.modules.get(name) for name in replacements}
    sys.modules.update(replacements)
    try:
        spec = importlib.util.spec_from_file_location("flowcell_lithophane_test", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, prior in previous.items():
            if prior is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior


def fake_context(scale_length=1.0):
    return types.SimpleNamespace(
        scene=types.SimpleNamespace(
            unit_settings=types.SimpleNamespace(scale_length=scale_length),
        ),
    )


class FakePixels(list):
    def foreach_get(self, target):
        for index, value in enumerate(self):
            target[index] = value


def fake_image(alpha_values):
    pixels = FakePixels()
    for alpha in alpha_values:
        pixels.extend((0.25, 0.5, 0.75, alpha))
    return types.SimpleNamespace(
        name="selected.png",
        size=(2, 2),
        channels=4,
        pixels=pixels,
    )


class LithophaneExplicitDimensionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_explicit_millimeters_convert_through_scene_scale(self):
        target = self.module._resolve_explicit_target_xy(
            fake_context(scale_length=0.001),
            {"width_mm": 50, "height_mm": 25},
        )

        self.assertTrue(math.isclose(target[0], 50.0))
        self.assertTrue(math.isclose(target[1], 25.0))

    def test_explicit_dimensions_require_a_complete_positive_pair(self):
        for data in (
            {"width_mm": 50},
            {"height_mm": 25},
            {"width_mm": "wide", "height_mm": 25},
            {"width_mm": 0, "height_mm": 25},
            {"width_mm": 50, "height_mm": -1},
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.module._resolve_explicit_target_xy(fake_context(), data)

    def test_explicit_dimensions_override_path_derived_size(self):
        calls = []

        def record_create(context, image_path, dpi, target_xy=None, object_name=None):
            calls.append((context, image_path, dpi, target_xy, object_name))
            return {
                "message": "created",
                "object": "Lithophane",
                "image": "selected.png",
            }

        original = self.module._create_lithophane_from_path
        self.module._create_lithophane_from_path = record_create
        try:
            result = self.module.perform_create_lithophane_from_images(
                context=fake_context(),
                data={
                    "image_path": "C:/art/selected.png",
                    "width_mm": 50,
                    "height_mm": 25,
                    "object_name": "  (9) Main Stencil  ",
                    "dpi": 72,
                },
            )
        finally:
            self.module._create_lithophane_from_path = original

        self.assertEqual(result["changed"], 1)
        self.assertEqual(calls[0][1], "C:/art/selected.png")
        self.assertEqual(calls[0][2], 72.0)
        self.assertTrue(math.isclose(calls[0][3][0], 0.05))
        self.assertTrue(math.isclose(calls[0][3][1], 0.025))
        self.assertEqual(calls[0][4], "  (9) Main Stencil  ")

    def test_explicit_object_name_preserves_the_owning_sublayer_name(self):
        self.assertEqual(
            self.module._resolve_explicit_object_name(
                {"object_name": "  (9) Main Stencil  "}
            ),
            "  (9) Main Stencil  ",
        )
        self.assertIsNone(self.module._resolve_explicit_object_name({}))
        for value in (None, "", "   ", "bad\x00name", 12):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.module._resolve_explicit_object_name({"object_name": value})

    def test_object_name_uses_the_first_free_unpadded_numeric_suffix(self):
        original_data = getattr(self.module.bpy, "data", None)
        try:
            for existing_names, expected in (
                ((), "New Dust"),
                (("New Dust",), "New Dust1"),
                (("New Dust", "New Dust1"), "New Dust2"),
                (("New Dust", "New Dust2"), "New Dust1"),
            ):
                with self.subTest(existing_names=existing_names):
                    self.module.bpy.data = types.SimpleNamespace(
                        objects={name: object() for name in existing_names},
                    )
                    self.assertEqual(
                        self.module._resolve_available_object_name("New Dust"),
                        expected,
                    )
        finally:
            if original_data is None:
                del self.module.bpy.data
            else:
                self.module.bpy.data = original_data

    def test_explicit_dimensions_reject_multiple_images(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.module.perform_create_lithophane_from_images(
                context=fake_context(),
                data={
                    "image_paths": ["C:/art/one.png", "C:/art/two.png"],
                    "width_mm": 50,
                    "height_mm": 25,
                },
            )

    def test_alpha_reader_skips_opaque_images(self):
        self.assertIsNone(self.module._read_image_alpha(fake_image([1.0, 1.0, 1.0, 1.0])))

    def test_alpha_reader_and_sampler_use_the_cutout_threshold(self):
        alpha_data = self.module._read_image_alpha(fake_image([0.0, 0.49, 0.5, 1.0]))

        self.assertIsNotNone(alpha_data)
        self.assertEqual(self.module._sample_alpha(alpha_data, 0.0, 0.0), 0.0)
        self.assertAlmostEqual(self.module._sample_alpha(alpha_data, 1.0, 0.0), 0.49)
        self.assertEqual(self.module._sample_alpha(alpha_data, 0.0, 1.0), 0.5)
        self.assertEqual(self.module._sample_alpha(alpha_data, 1.0, 1.0), 1.0)

    def test_alpha_reader_rejects_a_fully_transparent_image_before_mesh_expansion(self):
        with self.assertRaisesRegex(ValueError, "no visible pixels"):
            self.module._read_image_alpha(fake_image([0.0, 0.0, 0.0, 0.0]))

    def test_established_depth_settings_are_not_reinterpreted(self):
        source = SCRIPT_PATH.read_text(encoding="utf-8")

        self.assertNotIn("DISPLACE_STRENGTH_METERS", source)
        self.assertNotIn("modifier.strength", source)
        self.assertEqual(
            source.count("solidify_modifier.thickness = SOLIDIFY_THICKNESS_METERS"),
            2,
        )


if __name__ == "__main__":
    unittest.main()
