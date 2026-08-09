import importlib.util
import json
import math
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


PACKAGE_DIR = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Files"
    / "Import Illustrator SVG"
)
SCRIPT_PATH = PACKAGE_DIR / "import illustrator svg.py"
MANIFEST_PATH = PACKAGE_DIR / "flowcell.script.json"


def load_module(bpy_module, bmesh_module=None, bvh_tree=None):
    bmesh_module = bmesh_module or fake_bmesh()
    bvh_tree = bvh_tree or FakeBVHTree
    mathutils_module = types.ModuleType("mathutils")
    bvhtree_module = types.ModuleType("mathutils.bvhtree")
    bvhtree_module.BVHTree = bvh_tree
    previous = {
        name: sys.modules.get(name)
        for name in ("bpy", "bmesh", "mathutils", "mathutils.bvhtree")
    }
    sys.modules["bpy"] = bpy_module
    sys.modules["bmesh"] = bmesh_module
    sys.modules["mathutils"] = mathutils_module
    sys.modules["mathutils.bvhtree"] = bvhtree_module
    try:
        spec = importlib.util.spec_from_file_location("flowcell_import_illustrator_svg", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous_module in previous.items():
            if previous_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous_module


class DataList(list):
    def remove(self, value, do_unlink=False):
        del do_unlink
        super().remove(value)


class ObjectDataList(DataList):
    def remove(self, value, do_unlink=False):
        del do_unlink
        for collection in list(value.users_collection):
            collection.objects.unlink(value)
        list.remove(self, value)


class CollectionObjects(list):
    def __init__(self, collection):
        super().__init__()
        self.collection = collection

    def link(self, obj):
        if obj not in self:
            self.append(obj)
        if self.collection not in obj.users_collection:
            obj.users_collection.append(self.collection)

    def unlink(self, obj):
        list.remove(self, obj)
        if self.collection in obj.users_collection:
            obj.users_collection.remove(self.collection)


class CollectionChildren(list):
    def link(self, collection):
        if collection not in self:
            self.append(collection)

    def unlink(self, collection):
        list.remove(self, collection)


class CollectionDataList(DataList):
    def __init__(self, values=(), roots=()):
        super().__init__(values)
        self.roots = list(roots)

    def get(self, name):
        return next((collection for collection in self if collection.name == name), None)

    def new(self, name):
        collection = FakeCollection(name)
        self.append(collection)
        return collection

    def remove(self, value, do_unlink=False):
        del do_unlink
        for parent in [*self.roots, *self]:
            if value in parent.children:
                parent.children.unlink(value)
        for obj in list(value.objects):
            value.objects.unlink(obj)
        for child in list(value.children):
            value.children.unlink(child)
        list.remove(self, value)


class ViewObjects:
    def __init__(self, state):
        self._state = state
        self.active = None

    def __contains__(self, name):
        return any(obj.name == name for obj in self._state.objects)

    def __iter__(self):
        return iter(self._state.objects)


class FakePoint:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x = x
        self.y = y
        self.z = z


class FakeBMeshElementList(list):
    def ensure_lookup_table(self):
        pass

    def index_update(self):
        for index, element in enumerate(self):
            element.index = index


class FakeBMeshVertex:
    def __init__(self, index, coordinate):
        self.index = index
        self.co = FakePoint(*coordinate)


class FakeBMeshEdge:
    def __init__(self, is_boundary=False, is_manifold=True, length=1.0):
        self.is_boundary = is_boundary
        self.is_manifold = is_manifold
        self.length = length

    def calc_length(self):
        return self.length


class FakeBMeshFace:
    def __init__(self, vertices, area=1.0):
        self.verts = vertices
        self.area = area
        self.index = -1

    def calc_area(self):
        return self.area


class FakeBMesh:
    def __init__(self):
        self.verts = FakeBMeshElementList()
        self.edges = FakeBMeshElementList()
        self.faces = FakeBMeshElementList()
        self.overlap_pairs = []
        self.normals_recalculated = False
        self.remove_doubles_distance = None
        self.post_weld_integrity = None
        self.post_dissolve_integrity = None
        self.dissolved_vertex_indices = []
        self.dissolve_options = None
        self.freed = False

    def _load_integrity(self, integrity):
        face_specs = integrity.get("faces")
        if face_specs is None:
            face_specs = [
                ((0, 1, 2), 1.0),
                ((0, 3, 1), 1.0),
                ((1, 3, 2), 1.0),
                ((0, 2, 3), 1.0),
            ]
        self.verts.clear()
        self.edges.clear()
        self.faces.clear()
        vertex_count = 1 + max(
            (vertex for vertices, _area in face_specs for vertex in vertices),
            default=-1,
        )
        vertex_coordinates = integrity.get("vertices")
        if vertex_coordinates is None:
            vertex_coordinates = [
                (0.0, 0.0, 0.0),
                (1.0, 0.0, 0.0),
                (0.0, 1.0, 0.0),
                (0.0, 0.0, 1.0),
            ]
            vertex_coordinates.extend(
                (float(index), float((index * index) % 3), float(index % 2))
                for index in range(len(vertex_coordinates), vertex_count)
            )
        self.verts.extend(
            FakeBMeshVertex(index, vertex_coordinates[index]) for index in range(vertex_count)
        )
        self.faces.extend(
            FakeBMeshFace([self.verts[index] for index in vertices], area)
            for vertices, area in face_specs
        )
        edge_specs = integrity.get("edges")
        if edge_specs is None:
            edge_specs = [(False, True, 1.0)] * 6
        self.edges.extend(FakeBMeshEdge(*spec) for spec in edge_specs)
        self.overlap_pairs = list(integrity.get("overlaps") or [])

    def from_mesh(self, mesh_data):
        self._load_integrity(
            {
                "faces": getattr(mesh_data, "integrity_faces", None),
                "edges": getattr(mesh_data, "integrity_edges", None),
                "overlaps": getattr(mesh_data, "integrity_overlaps", None),
                "vertices": getattr(mesh_data, "integrity_vertices", None),
            }
        )
        self.post_weld_integrity = getattr(mesh_data, "integrity_post_weld", None)
        self.post_dissolve_integrity = getattr(mesh_data, "integrity_post_dissolve", None)

    def remove_doubles(self, distance):
        self.remove_doubles_distance = distance
        if self.post_weld_integrity is not None:
            self._load_integrity(self.post_weld_integrity)

    def dissolve_verts(self, vertices, use_face_split, use_boundary_tear):
        self.dissolved_vertex_indices = [vertex.index for vertex in vertices]
        self.dissolve_options = (use_face_split, use_boundary_tear)
        if self.post_dissolve_integrity is not None:
            self._load_integrity(self.post_dissolve_integrity)

    def normal_update(self):
        pass

    def to_mesh(self, mesh_data):
        mesh_data.normals_recalculated = self.normals_recalculated
        mesh_data.remove_doubles_distance = self.remove_doubles_distance
        mesh_data.dissolved_vertex_indices = self.dissolved_vertex_indices
        mesh_data.dissolve_options = self.dissolve_options

    def free(self):
        self.freed = True


class FakeBVH:
    def __init__(self, bm):
        self.bm = bm

    def overlap(self, other):
        del other
        return list(self.bm.overlap_pairs)


class FakeBVHTree:
    @classmethod
    def FromBMesh(cls, bm, epsilon=0.0):
        del epsilon
        return FakeBVH(bm)


def fake_bmesh():
    module = types.ModuleType("bmesh")
    module.new = FakeBMesh

    def recalc_face_normals(bm, faces):
        if not faces:
            raise RuntimeError("no faces")
        bm.normals_recalculated = True

    def remove_doubles(bm, verts, dist):
        if not verts:
            raise RuntimeError("no vertices")
        bm.remove_doubles(dist)

    def dissolve_verts(bm, verts, use_face_split, use_boundary_tear):
        bm.dissolve_verts(verts, use_face_split, use_boundary_tear)

    module.ops = types.SimpleNamespace(
        recalc_face_normals=recalc_face_normals,
        remove_doubles=remove_doubles,
        dissolve_verts=dissolve_verts,
    )
    return module


class FakeMatrix:
    def __init__(self, obj):
        self.obj = obj

    def __matmul__(self, point):
        return FakePoint(
            point.x + self.obj.location.x,
            point.y + self.obj.location.y,
            point.z + self.obj.location.z,
        )


class FakeCollection:
    _next_pointer = 1000

    def __init__(self, name, pointer=None):
        self.name = name
        self._pointer = pointer if pointer is not None else type(self)._next_pointer
        type(self)._next_pointer += 1
        self.objects = CollectionObjects(self)
        self.children = CollectionChildren()

    def as_pointer(self):
        return self._pointer


class FakeObject:
    _next_pointer = 1

    def __init__(
        self,
        name,
        object_type="CURVE",
        selected=False,
        pointer=None,
        curve_extrude_world_scale=1.0,
    ):
        self.name = name
        self.type = object_type
        self.mode = "OBJECT"
        self.selected = selected
        self._pointer = pointer if pointer is not None else type(self)._next_pointer
        type(self)._next_pointer += 1
        self.location = types.SimpleNamespace(x=0.0, y=0.0, z=0.0)
        self.scale = types.SimpleNamespace(x=1.0, y=1.0, z=1.0)
        self.dimensions = types.SimpleNamespace(x=2.0, y=3.0, z=0.0)
        self.parent = None
        self.curve_extrude_world_scale = curve_extrude_world_scale
        self.users_collection = []
        self.matrix_world = FakeMatrix(self)
        self.data = types.SimpleNamespace(
            name=f"{name} Data",
            dimensions=None,
            fill_mode=None,
            resolution_u=12,
            splines=[],
            offset=4.0,
            bevel_depth=3.0,
            extrude=0.0,
            vertices=[],
            normals_recalculated=False,
            users=1,
        )
        self.data.update = lambda: setattr(self.data, "mesh_updated", True)

    def select_set(self, selected):
        self.selected = bool(selected)

    def as_pointer(self):
        return self._pointer


def fake_bpy(
    fail_on_import=None,
    scene_scale=1.0,
    svg_extrude_world_scale=1.0,
    mesh_integrity=None,
    retain_orphan_curves=False,
    retained_converted_curve_users=0,
):
    original = FakeObject("Existing", object_type="MESH", selected=True)
    original_collection = FakeCollection("Existing Collection")
    scene_collection = FakeCollection("Scene Collection")
    scene_collection.children.link(original_collection)
    original_collection.objects.link(original)
    state = types.SimpleNamespace(
        objects=ObjectDataList([original]),
        collections=CollectionDataList([original_collection], roots=[scene_collection]),
        curves=DataList(),
        meshes=DataList([original.data]),
        scene_collection=scene_collection,
        import_calls=[],
        transform_calls=[],
        transform_scale_snapshots=[],
        import_number=0,
    )
    view_objects = ViewObjects(state)
    view_objects.active = original

    def update_view_layer():
        for obj in state.objects:
            if obj.type == "CURVE":
                obj.dimensions.z = (
                    obj.data.extrude * 2.0 * obj.curve_extrude_world_scale
                )

    class FakeContext:
        scene = types.SimpleNamespace(
            unit_settings=types.SimpleNamespace(scale_length=scene_scale),
            collection=scene_collection,
        )
        view_layer = types.SimpleNamespace(objects=view_objects, update=update_view_layer)

        @property
        def selected_objects(self):
            return [obj for obj in state.objects if obj.selected]

    context = FakeContext()

    def select_all(action):
        if action == "DESELECT":
            for obj in state.objects:
                obj.selected = False
        return {"FINISHED"}

    def mode_set(mode):
        if view_objects.active is not None:
            view_objects.active.mode = mode
        return {"FINISHED"}

    def transform_apply(**kwargs):
        state.transform_calls.append(kwargs)
        state.transform_scale_snapshots.append(
            [
                (obj.name, obj.scale.x, obj.scale.y, obj.scale.z)
                for obj in state.objects
                if obj.selected
            ]
        )
        if kwargs.get("scale"):
            for obj in state.objects:
                if obj.selected:
                    obj.dimensions.x *= abs(obj.scale.x)
                    obj.dimensions.y *= abs(obj.scale.y)
                    obj.dimensions.z *= abs(obj.scale.z)
                    obj.scale.x = 1.0
                    obj.scale.y = 1.0
                    obj.scale.z = 1.0
        return {"FINISHED"}

    def join():
        selected = [obj for obj in state.objects if obj.selected]
        active = view_objects.active
        for obj in selected:
            if obj is not active:
                obj.data.users = 0
                if not retain_orphan_curves and obj.data in state.curves:
                    state.curves.remove(obj.data)
                state.objects.remove(obj)
        active.selected = True
        return {"FINISHED"}

    def convert(target):
        active = view_objects.active
        curve_data = active.data
        half = curve_data.extrude * active.curve_extrude_world_scale
        curve_data.users = retained_converted_curve_users if retain_orphan_curves else 0
        if not retain_orphan_curves and curve_data in state.curves:
            state.curves.remove(curve_data)
        mesh_data = types.SimpleNamespace(
            name=f"{active.name} Mesh Data",
            dimensions=curve_data.dimensions,
            fill_mode=curve_data.fill_mode,
            source_curve_resolution_u=curve_data.resolution_u,
            offset=curve_data.offset,
            bevel_depth=curve_data.bevel_depth,
            extrude=curve_data.extrude,
            vertices=[],
            normals_recalculated=False,
            users=1,
        )
        mesh_data.update = lambda: setattr(mesh_data, "mesh_updated", True)
        active.data = mesh_data
        state.meshes.append(mesh_data)
        active.type = target
        half_x = active.dimensions.x / 2.0
        half_y = active.dimensions.y / 2.0
        active.data.vertices = [
            types.SimpleNamespace(co=FakePoint(x, y, z))
            for x in (-half_x, half_x)
            for y in (-half_y, half_y)
            for z in (-half, half)
        ]
        for attribute, value in (mesh_integrity or {}).items():
            setattr(active.data, attribute, value)
        return {"FINISHED"}

    def import_svg(filepath):
        state.import_number += 1
        state.import_calls.append(filepath)
        collection = FakeCollection(f"Imported {state.import_number}")
        state.collections.append(collection)
        scene_collection.children.link(collection)
        first = FakeObject(
            f"Path {state.import_number}A",
            curve_extrude_world_scale=svg_extrude_world_scale,
        )
        second = FakeObject(
            f"Path {state.import_number}B",
            curve_extrude_world_scale=svg_extrude_world_scale,
        )
        state.objects.extend([first, second])
        state.curves.extend([first.data, second.data])
        collection.objects.link(first)
        collection.objects.link(second)
        if fail_on_import == state.import_number:
            raise RuntimeError("simulated SVG importer failure")
        return {"FINISHED"}

    bpy_module = types.ModuleType("bpy")
    bpy_module.context = context
    bpy_module.data = types.SimpleNamespace(
        objects=state.objects,
        collections=state.collections,
        curves=state.curves,
        meshes=state.meshes,
    )
    bpy_module.ops = types.SimpleNamespace(
        object=types.SimpleNamespace(
            select_all=select_all,
            mode_set=mode_set,
            transform_apply=transform_apply,
            join=join,
            convert=convert,
        ),
        import_curve=types.SimpleNamespace(svg=import_svg),
    )
    return bpy_module, state, context, original, original_collection


class IllustratorSvgImportTests(unittest.TestCase):
    def test_manifest_points_to_package_source(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(manifest["id"], "blender.import-illustrator-svg")
        self.assertEqual(manifest["program"], "Blender")
        self.assertEqual(manifest["source"], SCRIPT_PATH.name)

    def test_only_leading_parenthesized_filename_number_sets_thickness(self):
        bpy_module, *_ = fake_bpy()
        module = load_module(bpy_module)

        self.assertEqual(module.thickness_mm_from_filepath("(9) V9 display.svg"), 9.0)
        self.assertEqual(module.thickness_mm_from_filepath("(2.5) Part.svg"), 2.5)
        self.assertEqual(module.thickness_mm_from_filepath("V9 display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("9 display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("Part (7).svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath(" (9) display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("(abc) display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("(-2) display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("(.5) display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("(2.) display.svg"), 1.0)
        self.assertEqual(module.thickness_mm_from_filepath("(1e2) display.svg"), 1.0)

    def test_matched_leading_parenthesized_value_must_be_positive(self):
        bpy_module, *_ = fake_bpy()
        module = load_module(bpy_module)

        with self.assertRaises(ValueError):
            module.thickness_mm_from_filepath("(0) Part.svg")

    def test_blender_pointer_identity_survives_fresh_proxy_wrappers(self):
        bpy_module, *_ = fake_bpy()
        module = load_module(bpy_module)
        original_proxy = FakeObject("Existing", pointer=4242)
        fresh_proxy = FakeObject("Existing", pointer=4242)
        new_object = FakeObject("New", pointer=4343)

        before = module._identity_ids([original_proxy])
        self.assertEqual(module._new_since([fresh_proxy, new_object], before), [new_object])
        self.assertTrue(module._contains_identity([fresh_proxy], original_proxy))

    def test_unit_scale_converts_millimeters_to_blender_units(self):
        bpy_module, *_ = fake_bpy()
        module = load_module(bpy_module)

        meter_scene = types.SimpleNamespace(unit_settings=types.SimpleNamespace(scale_length=1.0))
        millimeter_scene = types.SimpleNamespace(unit_settings=types.SimpleNamespace(scale_length=0.001))
        self.assertAlmostEqual(module.millimeters_to_blender_units(meter_scene, 2.5), 0.0025)
        self.assertAlmostEqual(module.millimeters_to_blender_units(millimeter_scene, 2.5), 2.5)
        self.assertAlmostEqual(module.millimeter_offset_to_blender_units(meter_scene, -2.5), -0.0025)
        self.assertAlmostEqual(module.millimeter_offset_to_blender_units(millimeter_scene, -2.5), -2.5)
        self.assertEqual(module.millimeter_offset_to_blender_units(meter_scene, 0.0), 0.0)

    def test_curve_tessellation_raises_data_and_splines_without_lowering_higher_resolution(self):
        bpy_module, *_ = fake_bpy()
        module = load_module(bpy_module)
        curve = FakeObject("Curved SVG")
        curve.data.resolution_u = 24
        curve.data.splines = [types.SimpleNamespace(resolution_u=12)]

        module._raise_curve_tessellation_resolution(curve)

        self.assertEqual(curve.data.resolution_u, 24)
        self.assertEqual(curve.data.splines[0].resolution_u, 24)

    def test_batch_imports_one_mesh_per_svg_and_ignores_extrude_field(self):
        bpy_module, state, context, original, _ = fake_bpy()
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            first_path = Path(temp_dir) / "(2.5) Alpha.svg"
            second_path = Path(temp_dir) / "V9 display.svg"
            first_path.write_text("<svg/>", encoding="utf-8")
            second_path.write_text("<svg/>", encoding="utf-8")

            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(first_path),
                            "layerName": "  (2.5) Alpha  ",
                            "extrudeMm": 999,
                            "widthMm": 25.4,
                            "heightMm": 12.7,
                            "offsetXmm": -12.7,
                            "offsetYmm": 5.0,
                        },
                        {
                            "filepath": str(second_path),
                            "layerName": "V9 display",
                            "extrudeMm": 9,
                            "widthMm": 50.8,
                            "heightMm": 25.4,
                            "offsetXmm": 25.4,
                            "offsetYmm": -10.0,
                        },
                    ]
                },
            )

        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(result["importedCount"], 2)
        self.assertTrue(result["dimensionsPreserved"])
        self.assertTrue(result["relativePositionsPreserved"])
        self.assertEqual(result["imported_objects"], ["  (2.5) Alpha  ", "V9 display"])
        self.assertEqual(
            [item["thicknessMm"] for item in result["results"]],
            [2.5, 1.0],
        )
        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(len(imported), 2)
        self.assertTrue(all(obj.type == "MESH" for obj in imported))
        self.assertTrue(
            all(
                obj.data.source_curve_resolution_u == module.SVG_CURVE_RESOLUTION_U
                for obj in imported
            )
        )
        self.assertTrue(all(obj.data.normals_recalculated for obj in imported))
        self.assertTrue(all(obj.data.remove_doubles_distance is not None for obj in imported))
        self.assertTrue(all(obj.data.mesh_updated for obj in imported))
        self.assertTrue(all(obj.selected for obj in imported))
        self.assertFalse(original.selected)
        self.assertAlmostEqual(imported[0].location.z, 0.00125)
        self.assertAlmostEqual(imported[1].location.z, 0.0005)
        self.assertAlmostEqual(imported[0].dimensions.x, 0.0254)
        self.assertAlmostEqual(imported[0].dimensions.y, 0.0127)
        self.assertAlmostEqual(imported[1].dimensions.x, 0.0508)
        self.assertAlmostEqual(imported[1].dimensions.y, 0.0254)
        first_x, first_y, _ = module._world_xyz_bounds(imported[0])
        second_x, second_y, _ = module._world_xyz_bounds(imported[1])
        self.assertAlmostEqual((first_x[0] + first_x[1]) / 2.0, -0.0127)
        self.assertAlmostEqual((first_y[0] + first_y[1]) / 2.0, 0.005)
        self.assertAlmostEqual((second_x[0] + second_x[1]) / 2.0, 0.0254)
        self.assertAlmostEqual((second_y[0] + second_y[1]) / 2.0, -0.01)
        self.assertEqual(
            [(item["offsetXmm"], item["offsetYmm"]) for item in result["results"]],
            [(-12.7, 5.0), (25.4, -10.0)],
        )
        live_collection = state.collections.get("Live")
        self.assertIsNotNone(live_collection)
        self.assertIn(live_collection, state.scene_collection.children)
        self.assertTrue(all(obj.users_collection == [live_collection] for obj in imported))
        self.assertEqual([collection.name for collection in state.collections], ["Existing Collection", "Live"])
        self.assertEqual(list(state.curves), [])
        self.assertEqual(list(state.meshes), [original.data, imported[0].data, imported[1].data])
        self.assertEqual(state.import_calls, [str(first_path), str(second_path)])
        self.assertEqual(len(state.transform_calls), 4)
        first_fit = state.transform_scale_snapshots[1][0]
        second_fit = state.transform_scale_snapshots[3][0]
        self.assertAlmostEqual(first_fit[1], 0.0254 / 2.0)
        self.assertAlmostEqual(first_fit[2], 0.0127 / 3.0)
        self.assertEqual(first_fit[3], 1.0)
        self.assertAlmostEqual(second_fit[1], 0.0508 / 2.0)
        self.assertAlmostEqual(second_fit[2], 0.0254 / 3.0)
        self.assertEqual(second_fit[3], 1.0)
        self.assertTrue(all(obj.scale.z == 1.0 for obj in imported))

    def test_adjacent_face_contacts_do_not_count_as_self_intersections(self):
        bpy_module, state, context, original, _ = fake_bpy(
            mesh_integrity={
                "integrity_faces": [
                    ((0, 1, 2), 1.0),
                    ((0, 2, 3), 1.0),
                ],
                "integrity_overlaps": [(0, 0), (0, 1), (1, 0)],
            }
        )
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "Part",
                            "widthMm": 10.0,
                            "heightMm": 5.0,
                            "offsetXmm": 0.0,
                            "offsetYmm": 0.0,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(len(imported), 1)
        self.assertTrue(imported[0].data.normals_recalculated)

    def test_curve_conversion_seams_are_welded_before_integrity_checks(self):
        bpy_module, state, context, original, _ = fake_bpy(
            mesh_integrity={
                "integrity_edges": [(True, False, 1.0)] * 8,
                "integrity_post_weld": {
                    "edges": [(False, True, 1.0)] * 6,
                },
            }
        )
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "Part",
                            "widthMm": 10.0,
                            "heightMm": 5.0,
                            "offsetXmm": 0.0,
                            "offsetYmm": 0.0,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(len(imported), 1)
        self.assertAlmostEqual(imported[0].data.remove_doubles_distance, 1e-11)
        self.assertTrue(imported[0].data.normals_recalculated)

    def test_exact_collinear_cap_vertices_are_safely_dissolved(self):
        bpy_module, state, context, original, _ = fake_bpy(
            mesh_integrity={
                "integrity_vertices": [
                    (0.0, 0.0, 0.0),
                    (1.0, 0.0, 0.0),
                    (2.0, 0.0, 0.0),
                    (0.0, 0.0, 1.0),
                    (1.0, 0.0, 1.0),
                    (2.0, 0.0, 1.0),
                ],
                "integrity_faces": [
                    ((0, 1, 2), 0.0),
                    ((3, 4, 5), 0.0),
                ],
                "integrity_post_dissolve": {},
            }
        )
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "Part",
                            "widthMm": 10.0,
                            "heightMm": 5.0,
                            "offsetXmm": 0.0,
                            "offsetYmm": 0.0,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(imported[0].data.dissolved_vertex_indices, [1, 4])
        self.assertEqual(imported[0].data.dissolve_options, (False, False))

    def test_tiny_positive_cap_face_is_not_treated_as_degenerate(self):
        bpy_module, state, context, original, _ = fake_bpy(
            mesh_integrity={
                "integrity_faces": [
                    ((0, 1, 2), 7.94e-15),
                    ((0, 3, 1), 1.0),
                    ((1, 3, 2), 1.0),
                    ((0, 2, 3), 1.0),
                ],
            }
        )
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "Part",
                            "widthMm": 10.0,
                            "heightMm": 5.0,
                            "offsetXmm": 0.0,
                            "offsetYmm": 0.0,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(imported[0].data.dissolved_vertex_indices, [])

    def test_zero_area_cap_cleanup_is_unit_scale_invariant(self):
        bpy_module, state, context, original, _ = fake_bpy(
            scene_scale=0.001,
            mesh_integrity={
                "integrity_vertices": [
                    (78.3700256, 24.4402046, 0.0),
                    (78.3700562, 24.4402390, 0.0),
                    (78.3700790, 24.4402733, 0.0),
                ],
                "integrity_faces": [((0, 1, 2), 0.0)],
                "integrity_post_dissolve": {},
            },
        )
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "Part",
                            "widthMm": 106.6,
                            "heightMm": 80.0,
                            "offsetXmm": 0.0,
                            "offsetYmm": 0.0,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(imported[0].data.dissolved_vertex_indices, [1])
        self.assertAlmostEqual(imported[0].data.remove_doubles_distance, 1.066e-7)
        points = [
            (78.3700256, 24.4402046, 0.0),
            (78.3700562, 24.4402390, 0.0),
            (78.3700790, 24.4402733, 0.0),
        ]
        edge_lengths = [
            math.dist(points[0], points[1]),
            math.dist(points[1], points[2]),
            math.dist(points[2], points[0]),
        ]
        longest = max(edge_lengths)
        edge_sum_error = abs(longest - (sum(edge_lengths) - longest))
        self.assertGreater(edge_sum_error, imported[0].data.remove_doubles_distance)
        self.assertLess(edge_sum_error, imported[0].data.remove_doubles_distance * 3.0)

    def test_success_removes_only_new_zero_user_curve_data(self):
        bpy_module, state, context, original, _ = fake_bpy(retain_orphan_curves=True)
        existing_curve = types.SimpleNamespace(name="Existing Curve Data", users=0)
        state.curves.append(existing_curve)
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "Part",
                            "widthMm": 10.0,
                            "heightMm": 5.0,
                            "offsetXmm": 0.0,
                            "offsetYmm": 0.0,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(list(state.curves), [existing_curve])
        self.assertEqual(list(state.meshes), [original.data, imported[0].data])

    def test_new_curve_data_with_users_fails_closed_and_rolls_back(self):
        bpy_module, state, context, original, original_collection = fake_bpy(
            retain_orphan_curves=True,
            retained_converted_curve_users=1,
        )
        existing_curve = types.SimpleNamespace(name="Existing Curve Data", users=0)
        state.curves.append(existing_curve)
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "Curve data with active users"):
                module.run_flowcell_action(
                    context=context,
                    data={
                        "items": [
                            {
                                "filepath": str(svg_path),
                                "layerName": "Part",
                                "widthMm": 10.0,
                                "heightMm": 5.0,
                                "offsetXmm": 0.0,
                                "offsetYmm": 0.0,
                            }
                        ]
                    },
                )

        self.assertEqual(list(state.objects), [original])
        self.assertEqual(list(state.collections), [original_collection])
        self.assertEqual(list(state.curves), [existing_curve])
        self.assertEqual(list(state.meshes), [original.data])
        self.assertEqual(list(state.scene_collection.children), [original_collection])
        self.assertTrue(original.selected)
        self.assertIs(context.view_layer.objects.active, original)

    def test_unsafe_mesh_integrity_rolls_back_the_entire_batch(self):
        cases = {
            "boundary": (
                {"integrity_edges": [(True, False, 1.0)]},
                "boundary edge",
            ),
            "non_manifold": (
                {"integrity_edges": [(False, False, 1.0)]},
                "non-manifold edge",
            ),
            "zero_length": (
                {"integrity_edges": [(False, True, 0.0)]},
                "zero-length edge",
            ),
            "unsafe_zero_face": (
                {
                    "integrity_faces": [
                        ((0, 1, 2), 0.0),
                        ((0, 3, 1), 1.0),
                    ]
                },
                "degenerate face",
            ),
            "duplicate": (
                {
                    "integrity_faces": [
                        ((0, 1, 2), 1.0),
                        ((2, 1, 0), 1.0),
                    ]
                },
                "duplicate face",
            ),
            "intersection": (
                {
                    "integrity_faces": [
                        ((0, 1, 2), 1.0),
                        ((3, 4, 5), 1.0),
                    ],
                    "integrity_overlaps": [(0, 1), (1, 0)],
                },
                "intersecting face pair",
            ),
        }

        for case_name, (mesh_integrity, expected_error) in cases.items():
            with self.subTest(case=case_name):
                bpy_module, state, context, original, original_collection = fake_bpy(
                    mesh_integrity=mesh_integrity
                )
                module = load_module(bpy_module)
                with tempfile.TemporaryDirectory() as temp_dir:
                    svg_path = Path(temp_dir) / "Part.svg"
                    svg_path.write_text("<svg/>", encoding="utf-8")
                    with self.assertRaisesRegex(RuntimeError, expected_error):
                        module.run_flowcell_action(
                            context=context,
                            data={
                                "items": [
                                    {
                                        "filepath": str(svg_path),
                                        "layerName": "Part",
                                        "widthMm": 10.0,
                                        "heightMm": 5.0,
                                        "offsetXmm": 0.0,
                                        "offsetYmm": 0.0,
                                    }
                                ]
                            },
                        )

                self.assertEqual(list(state.objects), [original])
                self.assertEqual(list(state.collections), [original_collection])
                self.assertEqual(list(state.curves), [])
                self.assertEqual(list(state.meshes), [original.data])
                self.assertEqual(list(state.scene_collection.children), [original_collection])
                self.assertTrue(original.selected)
                self.assertIs(context.view_layer.objects.active, original)

    def test_physical_dimensions_follow_scene_unit_scale_without_scaling_z(self):
        bpy_module, state, context, original, _ = fake_bpy(
            scene_scale=0.001,
            svg_extrude_world_scale=1020.78875,
        )
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "V9 display.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            result = module.run_flowcell_action(
                context=context,
                data={
                    "items": [
                        {
                            "filepath": str(svg_path),
                            "layerName": "V9 display",
                            "extrudeMm": 999,
                            "widthMm": 50.0,
                            "heightMm": 25.0,
                            "offsetXmm": 12.5,
                            "offsetYmm": -7.5,
                        }
                    ]
                },
            )

        imported = [obj for obj in state.objects if obj is not original]
        self.assertEqual(result["results"][0]["thicknessMm"], 1.0)
        self.assertAlmostEqual(imported[0].dimensions.x, 50.0)
        self.assertAlmostEqual(imported[0].dimensions.y, 25.0)
        self.assertAlmostEqual(imported[0].location.z, 0.5)
        self.assertAlmostEqual(imported[0].data.extrude, 0.5 / 1020.78875)
        x_bounds, y_bounds, _ = module._world_xyz_bounds(imported[0])
        self.assertAlmostEqual((x_bounds[0] + x_bounds[1]) / 2.0, 12.5)
        self.assertAlmostEqual((y_bounds[0] + y_bounds[1]) / 2.0, -7.5)
        live_collection = state.collections.get("Live")
        self.assertEqual(imported[0].users_collection, [live_collection])
        self.assertIn(live_collection, state.scene_collection.children)
        self.assertEqual([collection.name for collection in state.collections], ["Existing Collection", "Live"])

    def test_position_validation_allows_mesh_precision_noise_at_world_zero(self):
        bpy_module, _, context, _, _ = fake_bpy()
        module = load_module(bpy_module)
        mesh = FakeObject("Noisy SVG", object_type="MESH")

        with mock.patch.object(
            module,
            "_world_xyz_bounds",
            side_effect=[
                ((-49.0, 51.0), (-25.0, 25.0), (0.0, 1.0)),
                ((-49.999999, 50.000001), (-25.0, 25.0), (0.0, 1.0)),
            ],
        ):
            module._set_mesh_world_xy_center(context, mesh, 0.0, 0.0)

        self.assertAlmostEqual(mesh.location.x, -1.0)

    def test_failure_rolls_back_new_objects_collections_and_geometry_data(self):
        bpy_module, state, context, original, original_collection = fake_bpy(fail_on_import=2)
        existing_curve = types.SimpleNamespace(name="Existing Curve Data")
        state.curves.append(existing_curve)
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            first_path = Path(temp_dir) / "(3) First.svg"
            second_path = Path(temp_dir) / "(4) Second.svg"
            first_path.write_text("<svg/>", encoding="utf-8")
            second_path.write_text("<svg/>", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "batch was rolled back"):
                module.run_flowcell_action(
                    context=context,
                    data={
                        "items": [
                            {
                                "filepath": str(first_path),
                                "layerName": "(3) First",
                                "widthMm": 30.0,
                                "heightMm": 20.0,
                                "offsetXmm": -15.0,
                                "offsetYmm": 0.0,
                            },
                            {
                                "filepath": str(second_path),
                                "layerName": "(4) Second",
                                "widthMm": 40.0,
                                "heightMm": 25.0,
                                "offsetXmm": 20.0,
                                "offsetYmm": 0.0,
                            },
                        ]
                    },
                )

        self.assertEqual(list(state.objects), [original])
        self.assertEqual(list(state.collections), [original_collection])
        self.assertEqual(list(state.curves), [existing_curve])
        self.assertEqual(list(state.meshes), [original.data])
        self.assertEqual(list(state.scene_collection.children), [original_collection])
        self.assertTrue(original.selected)
        self.assertIs(context.view_layer.objects.active, original)

    def test_failure_restores_existing_live_collection_to_its_prior_linkage(self):
        bpy_module, state, context, original, original_collection = fake_bpy(fail_on_import=1)
        existing_live = FakeCollection("Live")
        state.collections.append(existing_live)
        original_collection.children.link(existing_live)
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "batch was rolled back"):
                module.run_flowcell_action(
                    context=context,
                    data={
                        "items": [
                            {
                                "filepath": str(svg_path),
                                "layerName": "Part",
                                "widthMm": 10.0,
                                "heightMm": 5.0,
                                "offsetXmm": 0.0,
                                "offsetYmm": 0.0,
                            }
                        ]
                    },
                )

        self.assertEqual(list(state.objects), [original])
        self.assertEqual(list(state.collections), [original_collection, existing_live])
        self.assertEqual(list(state.scene_collection.children), [original_collection])
        self.assertEqual(list(original_collection.children), [existing_live])
        self.assertTrue(original.selected)
        self.assertIs(context.view_layer.objects.active, original)

    def test_offsets_are_required_and_must_be_finite(self):
        bpy_module, state, context, original, original_collection = fake_bpy()
        module = load_module(bpy_module)

        with tempfile.TemporaryDirectory() as temp_dir:
            svg_path = Path(temp_dir) / "Part.svg"
            svg_path.write_text("<svg/>", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "offsetXmm must be a millimeter number"):
                module.run_flowcell_action(
                    context=context,
                    data={
                        "items": [
                            {
                                "filepath": str(svg_path),
                                "layerName": "Part",
                                "widthMm": 10.0,
                                "heightMm": 5.0,
                                "offsetYmm": 0.0,
                            }
                        ]
                    },
                )

        self.assertEqual(list(state.objects), [original])
        self.assertEqual(list(state.collections), [original_collection])
        self.assertEqual(list(state.scene_collection.children), [original_collection])

    def test_missing_items_raises_a_clear_error_without_scene_changes(self):
        bpy_module, state, context, original, original_collection = fake_bpy()
        module = load_module(bpy_module)

        with self.assertRaisesRegex(RuntimeError, "requires at least one item"):
            module.run_flowcell_action(context=context, data={})

        self.assertEqual(list(state.objects), [original])
        self.assertEqual(list(state.collections), [original_collection])


if __name__ == "__main__":
    unittest.main()
