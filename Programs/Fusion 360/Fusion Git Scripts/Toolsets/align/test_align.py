import importlib.util
import json
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

    spec = importlib.util.spec_from_file_location("flowcell_fusion_align", HERE / "align.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ALIGN = _load_module()


class AlignTests(unittest.TestCase):
    def test_manifest_mirrors_all_seventeen_blender_actions(self):
        manifest = json.loads((HERE / "flowcell.toolset.json").read_text(encoding="utf-8"))
        slots = [child["slot"] for child in manifest["children"]]
        self.assertEqual(len(slots), 17)
        self.assertEqual(set(slots), set(ALIGN.SLOT_PAYLOADS))
        self.assertEqual(manifest["program"], "Fusion 360")

    def test_min_center_max_and_origin_deltas(self):
        target = ((1.0, 3.0, 5.0), (5.0, 9.0, 13.0))
        reference = ((20.0, 30.0, 40.0), (30.0, 50.0, 70.0))
        origin = (2.0, 4.0, 6.0)
        self.assertEqual(
            ALIGN._alignment_translation(target, reference, origin, "X", "MIN", ""),
            (19.0, 0.0, 0.0),
        )
        self.assertEqual(
            ALIGN._alignment_translation(target, reference, origin, "Y", "CENTER", ""),
            (0.0, 34.0, 0.0),
        )
        self.assertEqual(
            ALIGN._alignment_translation(target, reference, origin, "Z", "MAX", ""),
            (0.0, 0.0, 57.0),
        )
        self.assertEqual(
            ALIGN._alignment_translation(target, reference, origin, "X", "CENTER", "ORIGIN"),
            (23.0, 0.0, 0.0),
        )

    def test_surface_places_target_against_opposing_reference_face(self):
        reference = ((0.0, 0.0, 0.0), (10.0, 10.0, 10.0))
        below = ((-4.0, 2.0, 2.0), (-2.0, 4.0, 4.0))
        above = ((12.0, 2.0, 2.0), (14.0, 4.0, 4.0))
        self.assertEqual(
            ALIGN._alignment_translation(below, reference, (0, 0, 0), "X", "CENTER", "SURFACE"),
            (2.0, 0.0, 0.0),
        )
        self.assertEqual(
            ALIGN._alignment_translation(above, reference, (0, 0, 0), "X", "CENTER", "SURFACE"),
            (-2.0, 0.0, 0.0),
        )

    def test_slot_payload_cannot_override_canonical_axis_or_mode(self):
        payload = ALIGN._normalize_payload({"command": "x_min", "axis": "Z", "mode": "MAX"})
        self.assertEqual(payload["command"], "align_axis")
        self.assertEqual(payload["axis"], "X")
        self.assertEqual(payload["mode"], "MIN")

    def test_design_history_and_component_body_boundaries_fail_closed(self):
        root = object()
        ALIGN._require_parametric_design(types.SimpleNamespace(designType="parametric"))
        with self.assertRaisesRegex(ValueError, "Capture Design History"):
            ALIGN._require_parametric_design(types.SimpleNamespace(designType="direct"))

        safe_body = types.SimpleNamespace(assemblyContext=None, parentComponent=root)
        ALIGN._require_instance_safe_bodies([{"kind": "body", "entity": safe_body}], types.SimpleNamespace(rootComponent=root))
        proxy_body = types.SimpleNamespace(assemblyContext=object(), parentComponent=root)
        with self.assertRaisesRegex(ValueError, "Select the occurrence"):
            ALIGN._require_instance_safe_bodies([{"kind": "body", "entity": proxy_body}], types.SimpleNamespace(rootComponent=root))
        component_body = types.SimpleNamespace(assemblyContext=None, parentComponent=object())
        with self.assertRaisesRegex(ValueError, "root-component"):
            ALIGN._require_instance_safe_bodies([{"kind": "body", "entity": component_body}], types.SimpleNamespace(rootComponent=root))

    def test_precise_bounds_are_preferred(self):
        precise = types.SimpleNamespace(
            minPoint=types.SimpleNamespace(x=1, y=2, z=3),
            maxPoint=types.SimpleNamespace(x=4, y=5, z=6),
        )
        coarse = types.SimpleNamespace(
            minPoint=types.SimpleNamespace(x=0, y=0, z=0),
            maxPoint=types.SimpleNamespace(x=9, y=9, z=9),
        )
        self.assertEqual(
            ALIGN._raw_bounds(types.SimpleNamespace(preciseBoundingBox=precise, boundingBox=coarse)),
            ((1.0, 2.0, 3.0), (4.0, 5.0, 6.0)),
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
        restored = ALIGN._restore_selection(
            types.SimpleNamespace(activeSelections=selections), object(), records
        )
        self.assertTrue(restored)
        self.assertEqual([first, second], selections.entities)


if __name__ == "__main__":
    unittest.main()
