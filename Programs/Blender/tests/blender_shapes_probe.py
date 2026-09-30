"""Blender --background --factory-startup --python-exit-code 1 --python this.py -- Shapes-folder-or-registry.json."""
import json
from pathlib import Path
import runpy
import sys

import bpy


source = Path(sys.argv[sys.argv.index("--") + 1])
names = ("Cube", "Sphere", "Cone", "Cylinder", "Triangle")
if source.is_file():
    registry = json.loads(source.read_text(encoding="utf-8-sig"))
    paths = {
        Path(entry["sourcePythonPath"]).stem: Path(entry["pythonPath"])
        for entry in registry["actions"]
        if Path(entry.get("sourcePythonPath", "")).stem in names
    }
else:
    paths = {name: source / f"{name}.py" for name in names}


def clear():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


cases = 0
for name in names:
    action = runpy.run_path(str(paths[name]))["run_flowcell_action"]

    def create(expected):
        before = {obj.as_pointer(): obj.name for obj in bpy.data.objects}
        result = action()
        obj = bpy.context.active_object
        assert result["status"] == "FINISHED", result
        assert result["object_name"] == obj.name == expected, (expected, result)
        assert obj.type == "MESH" and len(obj.data.polygons) > 0
        assert obj.select_get() and obj.mode == "OBJECT"
        assert len(bpy.data.objects) == len(before) + 1
        assert all(obj.name == before[obj.as_pointer()] for obj in bpy.data.objects if obj.as_pointer() in before)
        return obj

    clear()
    for index in range(12):
        create(name if index == 0 else f"{name}{index}")
    cases += 1

    bpy.data.objects.remove(bpy.data.objects[f"{name}1"], do_unlink=True)
    create(f"{name}1")
    cases += 1

    clear()
    # Names belonging to unlinked objects still collide in Blender's global data.
    for occupied in (name, f"{name}1", f"{name}.001"):
        bpy.data.objects.new(occupied, None)
    create(f"{name}2")
    cases += 1

    bpy.ops.object.mode_set(mode="EDIT")
    create(f"{name}3")
    cases += 1

print(f"SHAPES_PROBE_OK: {cases} cases")
