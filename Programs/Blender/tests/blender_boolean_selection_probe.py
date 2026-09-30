"""Check Boolean result selection in a disposable factory-startup Blender process."""

import importlib.util
from pathlib import Path
import sys

import bpy


arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
target = Path(arguments[0]) if arguments else (
    Path(__file__).resolve().parents[1] / "Blender Git Scripts/Toolsets/boolean/boolean.py"
)
spec = importlib.util.spec_from_file_location("boolean_selection_probe_target", target)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module._ensure_quick_boolean_scene_props()
bpy.utils.register_class(module.OBJECT_OT_qb_run_auto)


def scene_setup(cutter_count):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    active = bpy.context.object
    cutters = []
    for index in range(cutter_count):
        bpy.ops.mesh.primitive_cube_add(size=0.8, location=(0.8 if index == 0 else -0.8, 0, 0))
        cutters.append(bpy.context.object)
    for obj in [active, *cutters]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    return active, cutters


cases = 0
for native in (False, True):
    for operation in ("DIFFERENCE", "UNION", "INTERSECT"):
        for hide in (False, True):
            for remesh in (False, True):
                active, cutters = scene_setup(2 if remesh else 1)
                cutter_meshes = {obj.name: tuple(tuple(v.co) for v in obj.data.vertices) for obj in cutters}
                scene = bpy.context.scene
                scene.qb_operation = operation
                scene.qb_solver = "EXACT"
                scene.qb_backup_active = False
                scene.qb_hide_cutter = hide
                scene.qb_use_remesh = remesh
                scene.qb_remesh_mode = "VOXEL"
                scene.qb_remesh_voxel_size = 0.25
                if native:
                    assert bpy.ops.object.qb_run_auto() == {"FINISHED"}
                else:
                    result = module.run_flowcell_action(bpy.context, {"command": "run_boolean"})
                    assert result["status"] == "ok", result
                assert list(bpy.context.selected_objects) == [active]
                assert bpy.context.view_layer.objects.active == active
                assert len(active.data.polygons) > 0, (native, operation, hide, remesh)
                assert not active.modifiers
                for cutter in cutters:
                    assert not cutter.select_get(), "Hidden cutters must also be deselected"
                    assert cutter.hide_get() == hide
                    assert cutter.hide_render == hide
                    assert tuple(tuple(v.co) for v in cutter.data.vertices) == cutter_meshes[cutter.name]
                    cutter.hide_set(False)
                assert list(bpy.context.selected_objects) == [active]
                assert not any(obj.name.startswith("FlowCell_Boolean_Cutters") for obj in bpy.data.objects)
                cases += 1

# Validation errors and settings/status actions must not collapse the selection.
active, cutters = scene_setup(1)
before = set(bpy.context.selected_objects)
for command in ("status", "operation_union", "toggle_self_intersection"):
    module.run_flowcell_action(bpy.context, {"command": command})
    assert set(bpy.context.selected_objects) == before
bpy.ops.object.empty_add()
empty = bpy.context.object
active.select_set(True)
bpy.context.view_layer.objects.active = active
before = set(bpy.context.selected_objects)
result = module.run_flowcell_action(bpy.context, {"command": "run_boolean"})
assert result["status"] == "error"
assert set(bpy.context.selected_objects) == before
assert bpy.context.view_layer.objects.active == active
print(f"FLOWCELL_BOOLEAN_SELECTION_PROBE_OK cases={cases} target={target}", flush=True)
