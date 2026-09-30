"""Factory-startup Blender probe; pass Fill Gear.py and extra_mesh_objects folder after --."""
from pathlib import Path
import importlib
import runpy
import sys

import bmesh
import bpy


arguments = sys.argv[sys.argv.index("--") + 1:]
source = Path(arguments[0]).resolve()
extension = Path(arguments[1]).resolve()
sys.path.insert(0, str(extension.parent))
gears = importlib.import_module(f"{extension.name}.add_mesh_gears")
bpy.utils.register_class(gears.AddGear)
action = runpy.run_path(str(source))["run_flowcell_action"]


def select(*objects):
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0] if objects else None


def gear(**kwargs):
    select()
    bpy.ops.mesh.primitive_gear(**kwargs)
    return bpy.context.object


def snapshot(obj):
    return (tuple(tuple(v.co) for v in obj.data.vertices),
            tuple(tuple(row) for row in obj.matrix_world),
            tuple((g.name, g.index) for g in obj.vertex_groups))


def topology(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    result = (sum(edge.is_boundary for edge in bm.edges),
              sum(not edge.is_manifold for edge in bm.edges),
              bm.calc_volume(signed=True))
    bm.free()
    return result


cases = 0
for params in ({}, {"number_of_teeth": 8}, {"number_of_teeth": 48},
               {"skew": 0.2}, {"conangle": 0.15}, {"crown": 0.2}):
    obj = gear(**params)
    before = snapshot(obj)
    faces = len(obj.data.polygons)
    assert topology(obj)[0] > 0
    result = action()
    assert result["changed"] == 1, result
    assert len(obj.data.polygons) == faces + 2
    assert snapshot(obj) == before
    boundary, nonmanifold, volume = topology(obj)
    assert boundary == nonmanifold == 0 and volume > 0, (params, boundary, nonmanifold, volume)
    assert action()["changed"] == 0
    assert len(obj.data.polygons) == faces + 2
    cases += 1

# Multiple selections, arbitrary object transforms, attributes and unrelated mesh.
one, two = gear(), gear(number_of_teeth=18)
one.location = (2, 3, 4)
one.rotation_euler = (0.7, 0.2, 0.5)
one.scale = (2, 0.5, 3)
one.data.uv_layers.new(name="Keep UV")
for index, datum in enumerate(one.data.uv_layers.active.data):
    datum.uv = (index * 0.001, 0.25)
uv_before = [tuple(datum.uv) for datum in one.data.uv_layers.active.data]
one.data.materials.append(bpy.data.materials.new("Keep Material"))
one.modifiers.new("Keep Bevel", "BEVEL")
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.object
select(one, two, cube)
bpy.context.view_layer.update()
before = snapshot(one)
cube_before = snapshot(cube)
assert action()["changed"] == 2
assert set(bpy.context.selected_objects) == {one, two, cube}
assert bpy.context.object == one and snapshot(one) == before
assert snapshot(cube) == cube_before and len(cube.data.polygons) == 6
assert len(one.modifiers) == 1 and one.data.materials[0].name == "Keep Material"
assert [tuple(datum.uv) for datum in one.data.uv_layers.active.data][:len(uv_before)] == uv_before
cases += 1

# Linked duplicates are independent, including an unselected sibling.
original = gear()
duplicate = original.copy()
bpy.context.collection.objects.link(duplicate)
select(duplicate)
assert action()["changed"] == 1
assert duplicate.data != original.data
assert topology(original)[0] > 0 and topology(duplicate)[0] == 0
cases += 1

# Multi-object Edit Mode restores mode, selection and active object.
one, two = gear(), gear()
select(one, two)
bpy.ops.object.mode_set(mode="EDIT")
assert action()["changed"] == 2
assert bpy.context.mode == "EDIT_MESH"
assert set(bpy.context.objects_in_mode) == {one, two}
assert bpy.context.object == one
bpy.ops.object.mode_set(mode="OBJECT")
assert topology(one)[0] == topology(two)[0] == 0
cases += 1

# No selection, non-gear and damaged rims are safe no-ops.
select()
assert action()["changed"] == 0
select(cube)
assert action()["changed"] == 0
damaged = gear()
bm = bmesh.new()
bm.from_mesh(damaged.data)
edge = next(edge for edge in bm.edges if edge.is_boundary)
edge.verts[0].co.z += 0.13
bm.to_mesh(damaged.data)
bm.free()
before = snapshot(damaged)
assert action()["changed"] == 0
assert snapshot(damaged) == before
cases += 1

# Production bridge operator: one Undo restores the open gear and Redo fills it.
addon = Path(__file__).resolve().parents[1] / "Blender Addons - Copy contents Into Blender"
sys.path.insert(0, str(addon))
import flowcell_actions as actions
actions.register()
actions.load_custom_actions_registry = lambda: [{
    "action": "flowcell_probe_fill_gear", "pythonPath": str(source),
    "functionName": "run_flowcell_action"}]
obj = gear()
name = obj.name
before = snapshot(obj)
bpy.context.preferences.edit.use_global_undo = True
bpy.ops.ed.undo_push(message="Gear fill baseline")
result = actions.execute_bridge_operator("flowcell_probe_fill_gear", {})
assert result["changed"] == 1, result
assert topology(bpy.data.objects[name])[0] == 0
assert bpy.ops.ed.undo() == {"FINISHED"}
assert topology(bpy.data.objects[name])[0] > 0
assert snapshot(bpy.data.objects[name]) == before
assert bpy.ops.ed.redo() == {"FINISHED"}
assert topology(bpy.data.objects[name])[0] == 0
cases += 1
print(f"FILL_GEAR_PROBE_OK: {cases} cases; real generator, manifold caps, selection, attributes, links, Edit Mode, bridge Undo/Redo")
