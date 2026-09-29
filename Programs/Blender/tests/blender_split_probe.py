"""Run with Blender --background --factory-startup --python-exit-code 1 --python this.py -- split.py."""
import runpy
import sys
import bpy
from mathutils import Vector

action = runpy.run_path(sys.argv[sys.argv.index('--') + 1])['run_flowcell_action']


def clear():
    if bpy.context.object and bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def joined(distance=4):
    objects = []
    for x in (0, distance):
        bpy.ops.mesh.primitive_cube_add(location=(x, 0, 0))
        objects.append(bpy.context.object)
    select(objects)
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = 'SplitProbe'
    return obj


def split(expected=2):
    result = action()
    assert result['status'] == 'FINISHED', result
    parts = list(bpy.context.selected_objects)
    assert len(parts) == expected, (result, len(parts))
    assert result['changed'] == expected, result
    assert set(result['created_objects']) == {o.name for o in parts}
    return parts


def repeated():
    joined()
    for _ in range(4):
        parts = split()
        assert sorted(len(o.data.vertices) for o in parts) == [8, 8]
        bpy.ops.object.join()


def duplicate_and_collisions():
    original = joined()
    duplicate = original.copy()
    duplicate.data = original.data.copy()
    bpy.context.collection.objects.link(duplicate)
    split()
    select([duplicate])
    split()
    assert len(bpy.data.objects) == 4


def touching():
    joined(2)
    assert sum(len(o.data.vertices) for o in split()) == 16


def coincident():
    joined(0)
    assert sum(len(o.data.vertices) for o in split()) == 16


def linked_duplicate():
    obj = joined()
    twin = obj.copy()
    bpy.context.collection.objects.link(twin)
    mesh = twin.data
    before = [tuple(v.co) for v in mesh.vertices]
    parts = split()
    assert twin.data == mesh and [tuple(v.co) for v in mesh.vertices] == before
    assert all(o.data != mesh for o in parts)


def data_and_selection():
    obj = joined()
    uv = obj.data.uv_layers.new(name='KeepUV')
    for item in uv.data:
        item.uv = (0.25, 0.75)
    attr = obj.data.attributes.new('keep_float', 'FLOAT', 'POINT')
    for item in attr.data:
        item.value = 7.5
    group = obj.vertex_groups.new(name='KeepGroup')
    group.add(list(range(16)), 0.5, 'REPLACE')
    obj.modifiers.new('KeepBevel', 'BEVEL').width = 0.02
    obj['keep_property'] = 'yes'
    material = bpy.data.materials.new('KeepMaterial')
    obj.data.materials.append(material)
    before = sorted(tuple(round(c, 5) for c in obj.matrix_world @ v.co) for v in obj.data.vertices)
    bpy.ops.mesh.primitive_cube_add(location=(20, 0, 0))
    unrelated = bpy.context.object
    select([obj, unrelated])
    parts = split()
    assert unrelated not in parts and len(unrelated.data.vertices) == 8
    after = sorted(tuple(round(c, 5) for c in o.matrix_world @ v.co) for o in parts for v in o.data.vertices)
    assert before == after
    for part in parts:
        assert 'KeepUV' in part.data.uv_layers
        assert all((v.uv - Vector((0.25, 0.75))).length < 1e-6 for v in part.data.uv_layers['KeepUV'].data)
        assert all(abs(v.value - 7.5) < 1e-6 for v in part.data.attributes['keep_float'].data)
        assert part.vertex_groups['KeepGroup'] and part.modifiers['KeepBevel']
        assert part['keep_property'] == 'yes' and part.data.materials[0] == material
        assert (sum((v.co for v in part.data.vertices), Vector()) / len(part.data.vertices)).length < 1e-5


def loose_edges():
    mesh = bpy.data.meshes.new('Edges')
    mesh.from_pydata([(0,0,0),(1,0,0),(4,0,0),(5,0,0)], [(0,1),(2,3)], [])
    obj = bpy.data.objects.new('Edges', mesh)
    bpy.context.collection.objects.link(obj)
    select([obj])
    assert sorted(len(o.data.edges) for o in split()) == [1, 1]


def edit_mode():
    joined()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    split()
    assert bpy.context.mode == 'OBJECT'


def connected_noop():
    bpy.ops.mesh.primitive_cube_add()
    obj = bpy.context.object
    mesh = obj.data
    result = action()
    assert result['status'] == 'CANCELLED' and result['changed'] == 0
    assert bpy.context.object == obj and obj.data == mesh and len(mesh.vertices) == 8


failures = []
for test in (repeated, duplicate_and_collisions, touching, coincident, linked_duplicate, data_and_selection, loose_edges, edit_mode, connected_noop):
    clear()
    try:
        test()
        print('PASS', test.__name__)
    except Exception as exc:
        failures.append((test.__name__, str(exc)))
        print('FAIL', test.__name__, repr(exc))
assert not failures, failures
print('SPLIT_PROBE_OK: 9 cases')
