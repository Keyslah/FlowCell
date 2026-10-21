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
    def test_manifest_mirrors_the_blender_align_layout(self):
        manifest = json.loads((HERE / "flowcell.toolset.json").read_text(encoding="utf-8"))
        slots = [child["slot"] for child in manifest["children"]]
        self.assertEqual(len(slots), 18)
        self.assertEqual(set(slots) - {"group"}, set(ALIGN.SLOT_PAYLOADS))
        self.assertEqual(manifest["program"], "Fusion 360")
        labels = [child["label"] for child in manifest["children"]]
        self.assertEqual(labels[:5], ["X Min", "Center", "X Max", "Surface", "Origin"])
        self.assertEqual(labels[-3:], ["All", "X-Y", "Group"])
        layout = manifest["layout"]
        self.assertEqual(layout["childBehaviors"]["group"], {"toggleFields": ["group"], "execute": False})
        self.assertTrue(layout["updatePolicy"]["appendMissingChildSlots"])
        self.assertEqual(set(layout["placements"]), set(slots))

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
        # Origin sends the origin to the opposite Min/Max face, like Blender.
        self.assertEqual(
            ALIGN._alignment_translation(target, reference, origin, "X", "CENTER", "GEOCENTER"),
            (28.0, 0.0, 0.0),
        )
        above = (40.0, 4.0, 6.0)
        self.assertEqual(
            ALIGN._alignment_translation(target, reference, above, "X", "CENTER", "GEOCENTER"),
            (-20.0, 0.0, 0.0),
        )

    def test_alt_center_aligns_origins(self):
        target = ((1.0, 3.0, 5.0), (5.0, 9.0, 13.0))
        reference = ((20.0, 30.0, 40.0), (30.0, 50.0, 70.0))
        self.assertEqual(
            ALIGN._alignment_translation(
                target, reference, (2.0, 4.0, 6.0), "Z", "CENTER", "",
                reference_origin=(21.0, 31.0, 41.0), origin_center=True,
            ),
            (0.0, 0.0, 35.0),
        )

    def test_surface_crosses_to_the_opposite_reference_face(self):
        reference = ((0.0, 0.0, 0.0), (10.0, 10.0, 10.0))
        below = ((-4.0, 2.0, 2.0), (-2.0, 4.0, 4.0))
        above = ((12.0, 2.0, 2.0), (14.0, 4.0, 4.0))
        self.assertEqual(
            ALIGN._alignment_translation(below, reference, (0, 0, 0), "X", "CENTER", "SURFACE"),
            (14.0, 0.0, 0.0),
        )
        self.assertEqual(
            ALIGN._alignment_translation(above, reference, (0, 0, 0), "X", "CENTER", "SURFACE"),
            (-14.0, 0.0, 0.0),
        )

    def test_slot_payload_cannot_override_canonical_axis_or_mode(self):
        payload = ALIGN._normalize_payload({"command": "x_min", "axis": "Z", "mode": "MAX", "group": True})
        self.assertEqual(payload["command"], "align_axis")
        self.assertEqual(payload["axis"], "X")
        self.assertEqual(payload["mode"], "MIN")
        self.assertTrue(payload["group"])

    def test_combined_bounds_cover_every_group_member(self):
        self.assertEqual(
            ALIGN._combined_bounds([((0, 1, 2), (3, 4, 5)), ((-1, 2, 0), (1, 9, 4))]),
            ((-1, 1, 0), (3, 9, 5)),
        )

    def test_faces_count_as_their_body_and_the_last_pick_is_the_reference(self):
        fusion = sys.modules["adsk.fusion"]
        fusion.BRepFace = type("BRepFace", (), {"cast": staticmethod(
            lambda entity: entity if getattr(entity, "fake_kind", "") == "face" else None)})
        try:
            body_a = types.SimpleNamespace(fake_kind="body", entityToken="A", name="A")
            body_b = types.SimpleNamespace(fake_kind="body", entityToken="B", name="B")
            face = lambda body, token: types.SimpleNamespace(fake_kind="face", body=body, entityToken=token, name=token)
            picks = [face(body_b, "fb1"), face(body_a, "fa1"), face(body_a, "fa2"), face(body_b, "fb2")]

            class Selections:
                count = len(picks)

                def item(self, index):
                    return types.SimpleNamespace(entity=picks[index])

            records = ALIGN._selected_records(types.SimpleNamespace(activeSelections=Selections()))
            self.assertEqual([record["token"] for record in records], ["A", "B"])
            self.assertTrue(all(record["kind"] == "body" for record in records))
        finally:
            del fusion.BRepFace

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
