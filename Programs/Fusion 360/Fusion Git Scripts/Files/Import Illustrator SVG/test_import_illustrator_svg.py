import ast
import importlib.util
import json
import math
import pathlib
import random
import sys
import tempfile
import types
import unittest


HERE = pathlib.Path(__file__).resolve().parent


def _load_module():
    adsk = types.ModuleType("adsk")
    core = types.ModuleType("adsk.core")
    fusion = types.ModuleType("adsk.fusion")
    core.Application = types.SimpleNamespace(get=lambda: None)
    core.DocumentTypes = types.SimpleNamespace(FusionDesignDocumentType="design")
    fusion.Design = types.SimpleNamespace(cast=lambda value: value)
    fusion.DesignTypes = types.SimpleNamespace(ParametricDesignType=1, DirectDesignType=0)
    adsk.core = core
    adsk.fusion = fusion
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = core
    sys.modules["adsk.fusion"] = fusion

    spec = importlib.util.spec_from_file_location(
        "flowcell_fusion_import_illustrator_svg", HERE / "import_illustrator_svg.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


IMPORTER = _load_module()


def _square(left, bottom, size):
    corners = [
        (left, bottom),
        (left + size, bottom),
        (left + size, bottom + size),
        (left, bottom + size),
    ]
    segments = list(zip(corners, corners[1:] + corners[:1]))
    samples = [
        ((first[0] + second[0]) / 2.0, (first[1] + second[1]) / 2.0)
        for first, second in segments[:3]
    ]
    return {"segments": segments, "samples": samples}


class _Entity:
    def __init__(self, label, log):
        self.objectType = label
        self.isValid = True
        self._log = log

    def deleteMe(self):
        self._log.append(self.objectType)
        self.isValid = False
        return True


class ImportIllustratorSvgTests(unittest.TestCase):
    def test_package_manifest_names_the_bridge_entrypoint_source(self):
        manifest = json.loads((HERE / "flowcell.script.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["id"], "fusion-360.import-illustrator-svg")
        self.assertEqual(manifest["program"], "Fusion 360")
        source_path = HERE / manifest["source"]
        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
        functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
        self.assertIn("run_flowcell_action", functions)

    def test_leading_layer_number_matches_the_illustrator_and_blender_rules(self):
        self.assertEqual(IMPORTER.thickness_mm_from_name("(9) Name"), 9.0)
        self.assertEqual(IMPORTER.thickness_mm_from_name("(2.5) Name"), 2.5)
        self.assertEqual(IMPORTER.thickness_mm_from_name("14Main stencil"), 14.0)
        self.assertEqual(IMPORTER.thickness_mm_from_name("3.25Part"), 3.25)
        for name in (" (9) Name", "V9 Name", "Name (9)", "(.5) Name", "( 2) Name", ""):
            self.assertEqual(IMPORTER.thickness_mm_from_name(name), 1.0, name)
        with self.assertRaises(ValueError):
            IMPORTER.thickness_mm_from_name("(0) Name")

    def test_request_items_are_validated_like_the_blender_importer(self):
        with tempfile.TemporaryDirectory() as folder:
            svg = pathlib.Path(folder) / "(2.5) Base.svg"
            svg.write_text("<svg/>", encoding="utf-8")
            item = {
                "filepath": str(svg),
                "layerName": "(2.5) Base",
                "extrudeMm": 2.5,
                "widthMm": 25.4,
                "heightMm": 12.7,
                "offsetXmm": -3.5,
                "offsetYmm": 7.25,
            }
            validated = IMPORTER._validated_items({"items": [item]})
            self.assertEqual(validated[0]["thicknessMm"], 2.5)
            self.assertEqual(validated[0]["layerName"], "(2.5) Base")
            self.assertEqual(validated[0]["offsetXmm"], -3.5)

            for patch in (
                {"filepath": "relative.svg"},
                {"filepath": str(pathlib.Path(folder) / "missing.svg")},
                {"widthMm": 0},
                {"heightMm": True},
                {"offsetYmm": float("nan")},
            ):
                with self.assertRaises(ValueError, msg=patch):
                    IMPORTER._validated_items({"items": [{**item, **patch}]})
            with self.assertRaises(ValueError):
                IMPORTER._validated_items({"items": []})

    def test_import_plan_turns_fusion_96_dpi_import_into_physical_size_and_center(self):
        # Fusion measured a 72 x 36 pt Illustrator triangle at 96 px per inch.
        native = (0.0, -0.9525, 1.905, 0.0)
        width_cm, height_cm = 2.54, 1.27
        center = (1.0, -2.0)
        scale, position_x, position_y = IMPORTER.physical_import_plan(native, width_cm, height_cm, *center)
        self.assertAlmostEqual(scale, 4.0 / 3.0, places=12)
        placed = (
            scale * native[0] + position_x,
            scale * native[1] + position_y,
            scale * native[2] + position_x,
            scale * native[3] + position_y,
        )
        IMPORTER.validate_placement(placed, width_cm, height_cm, *center, "Triangle")
        with self.assertRaises(RuntimeError):
            IMPORTER.physical_import_plan((0.0, 0.0, 0.0, 1.0), 1.0, 1.0, 0.0, 0.0)

    def test_placement_validation_rejects_wrong_size_or_position(self):
        exact = (-1.0, -0.5, 1.0, 0.5)
        IMPORTER.validate_placement(exact, 2.0, 1.0, 0.0, 0.0, "Layer")
        for bounds, label in (
            ((-1.0, -0.5, 1.01, 0.5), "width"),
            ((-1.0, -0.5, 1.0, 0.52), "height"),
            ((-0.98, -0.5, 1.02, 0.5), "X position"),
        ):
            with self.assertRaisesRegex(RuntimeError, label):
                IMPORTER.validate_placement(bounds, 2.0, 1.0, 0.0, 0.0, "Layer")

    def test_even_odd_nesting_keeps_outlines_and_islands_and_leaves_holes_open(self):
        outline = _square(0.0, 0.0, 10.0)
        hole = _square(2.0, 2.0, 6.0)
        island = _square(4.0, 4.0, 2.0)
        separate = _square(20.0, 0.0, 3.0)
        loops = [hole, separate, island, outline]
        self.assertEqual(IMPORTER.even_depth_indices(loops), [1, 2, 3])

        shuffled = loops[:]
        random.Random(7).shuffle(shuffled)
        filled = {id(shuffled[index]) for index in IMPORTER.even_depth_indices(shuffled)}
        self.assertEqual(filled, {id(outline), id(island), id(separate)})

    def test_ray_cast_accepts_unordered_and_reversed_boundary_segments(self):
        square = _square(0.0, 0.0, 4.0)["segments"]
        scrambled = [(second, first) for first, second in reversed(square)]
        for segments in (square, scrambled):
            self.assertTrue(IMPORTER.point_inside_segments((1.0, 1.0), segments))
            self.assertFalse(IMPORTER.point_inside_segments((5.0, 1.0), segments))
        self.assertFalse(IMPORTER.point_inside_segments((1.0, 1.0), square, (2.0, 2.0, 4.0, 4.0)))

    def test_names_stay_unique_and_fall_back_to_safe_text(self):
        self.assertEqual(IMPORTER.unique_name("(2) Text", ["Body1"]), "(2) Text")
        self.assertEqual(IMPORTER.unique_name("(2) Text", ["(2) Text", "(2) Text (2)"]), "(2) Text (3)")
        self.assertEqual(IMPORTER.clean_name('(2.5) First:Part/"A"'), "(2.5) First_Part__A_")
        self.assertEqual(IMPORTER.clean_name("  "), "Illustrator SVG")

    def test_failed_batch_deletes_every_new_entity_in_reverse_and_reports_rollback(self):
        log = []
        design = types.SimpleNamespace(designType=0, activeComponent=object())
        app = types.SimpleNamespace(activeProduct=design)
        calls = []

        def fake_import(_component, item, created):
            calls.append(item["layerName"])
            name = item["layerName"]
            created.append((_Entity(f"{name} sketch", log), ()))
            created.append((_Entity(f"{name} extrude", log), (_Entity(f"{name} body", log),)))
            if len(calls) == 2:
                raise RuntimeError("second layer failed")
            return {"bodies": [], "result": {"bodyNames": [name]}}

        original_import = IMPORTER._import_one_svg
        original_get = IMPORTER.adsk.core.Application.get
        IMPORTER._import_one_svg = fake_import
        IMPORTER.adsk.core.Application.get = lambda: app
        try:
            with tempfile.TemporaryDirectory() as folder:
                items = []
                for name in ("(1) A", "(2) B"):
                    svg = pathlib.Path(folder) / f"{name}.svg"
                    svg.write_text("<svg/>", encoding="utf-8")
                    items.append({
                        "filepath": str(svg), "layerName": name, "widthMm": 1.0,
                        "heightMm": 1.0, "offsetXmm": 0.0, "offsetYmm": 0.0,
                    })
                with self.assertRaisesRegex(RuntimeError, "rolled back: second layer failed"):
                    IMPORTER.run_flowcell_action(None, {"items": items})
        finally:
            IMPORTER._import_one_svg = original_import
            IMPORTER.adsk.core.Application.get = original_get

        # The extrude goes first so parametric bodies vanish with their feature;
        # a body that a direct-modeling delete left behind is removed after it.
        self.assertEqual(log, [
            "(2) B extrude", "(2) B body", "(2) B sketch",
            "(1) A extrude", "(1) A body", "(1) A sketch",
        ])

    def test_successful_batch_reports_counts_selects_bodies_and_skips_direct_timeline(self):
        selected = []
        selections = types.SimpleNamespace(clear=selected.clear, add=selected.append)
        design = types.SimpleNamespace(
            designType=0,
            activeComponent=types.SimpleNamespace(name="Part"),
            activeOccurrence=None,
        )
        app = types.SimpleNamespace(
            activeProduct=design,
            userInterface=types.SimpleNamespace(activeSelections=selections),
        )

        def fake_import(_component, item, _created):
            name = item["layerName"]
            return {"bodies": [f"{name} body"], "result": {"bodyNames": [name]}}

        original_import = IMPORTER._import_one_svg
        original_get = IMPORTER.adsk.core.Application.get
        IMPORTER._import_one_svg = fake_import
        IMPORTER.adsk.core.Application.get = lambda: app
        try:
            with tempfile.TemporaryDirectory() as folder:
                svg = pathlib.Path(folder) / "a.svg"
                svg.write_text("<svg/>", encoding="utf-8")
                item = {
                    "filepath": str(svg), "layerName": "(1) A", "widthMm": 1.0,
                    "heightMm": 1.0, "offsetXmm": 0.0, "offsetYmm": 0.0,
                }
                result = IMPORTER.run_flowcell_action(None, {"items": [item, {**item, "layerName": "(2) B"}]})
        finally:
            IMPORTER._import_one_svg = original_import
            IMPORTER.adsk.core.Application.get = original_get

        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(result["importedCount"], 2)
        self.assertEqual(result["component"], "Part")
        self.assertEqual(result["imported_bodies"], ["(1) A", "(2) B"])
        self.assertEqual(result["timelineGroup"], "")
        self.assertEqual(selected, ["(1) A body", "(2) B body"])
        self.assertTrue(math.isfinite(result["changed"]))


if __name__ == "__main__":
    unittest.main()
