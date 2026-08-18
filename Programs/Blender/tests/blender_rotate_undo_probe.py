"""Run Rotate Distribute -> Undo in an isolated Blender process.

Usage:
    blender --background --factory-startup --python blender_rotate_undo_probe.py
    blender --background --factory-startup --python blender_rotate_undo_probe.py -- deployed
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


PROBE_ACTION = "flowcell_probe_rotate"
BLENDER_ROOT = Path(__file__).resolve().parent.parent
ADDON_SOURCE = BLENDER_ROOT / "Blender Addons - Copy contents Into Blender"
ROTATE_SOURCE = BLENDER_ROOT / "Blender Git Scripts" / "Toolsets" / "rotate" / "rotate.py"


def _clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def _new_mesh_object(name: str) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        [(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (0.0, 0.5, 0.0)],
        [],
        [(0, 1, 2)],
    )
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def _scene_state() -> dict[str, object]:
    return {
        "objects": sorted(obj.name for obj in bpy.data.objects),
        "selected": sorted(obj.name for obj in bpy.context.selected_objects),
        "active": getattr(bpy.context.view_layer.objects.active, "name", None),
    }


def _probe_mode() -> str:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return str(arguments[0] if arguments else "source").strip().lower()


def main() -> None:
    mode = _probe_mode()
    if mode not in {"source", "deployed"}:
        raise ValueError(f"Unsupported probe mode: {mode}")
    if mode == "source":
        sys.path.insert(0, str(ADDON_SOURCE))
    import flowcell_actions as actions

    print("FLOWCELL_ROTATE module", actions.__file__, flush=True)

    bpy.context.preferences.edit.use_global_undo = True
    actions.register()
    actions.load_custom_actions_registry = lambda: [
        {
            "action": PROBE_ACTION,
            "pythonPath": str(ROTATE_SOURCE),
            "functionName": "run_flowcell_action",
        }
    ]

    _clear_scene()
    _new_mesh_object("Rotate Probe")
    bpy.context.view_layer.update()
    bpy.ops.ed.undo_push(message="Rotate probe baseline")

    before = _scene_state()
    result = actions.execute_bridge_operator(
        PROBE_ACTION,
        {
            "command": "apply",
            "axis": "Y",
            "center_mode": "WORLD",
            "operation_mode": "DISTRIBUTE",
            "angle_deg": 15.0,
            "direction": "positive",
            "distribute_count": 3,
        },
    )
    bpy.context.view_layer.update()
    after = _scene_state()

    print("FLOWCELL_ROTATE before", json.dumps(before, sort_keys=True), flush=True)
    print("FLOWCELL_ROTATE result", json.dumps(result, sort_keys=True), flush=True)
    print("FLOWCELL_ROTATE after", json.dumps(after, sort_keys=True), flush=True)

    assert str(result.get("message", "")).startswith("Distributed 1 selected object(s) into 3")
    assert len(bpy.data.objects) == 3
    assert bpy.ops.ed.undo.poll()

    undo_result = bpy.ops.ed.undo()
    bpy.context.view_layer.update()
    undone = _scene_state()
    print("FLOWCELL_ROTATE undo", sorted(undo_result), flush=True)
    print("FLOWCELL_ROTATE undone", json.dumps(undone, sort_keys=True), flush=True)

    assert "FINISHED" in undo_result
    assert undone == before


if __name__ == "__main__":
    main()
