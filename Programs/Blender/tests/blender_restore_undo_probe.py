"""Run the Collections Restore -> Undo transaction in an isolated Blender process.

Usage:
    blender --background --factory-startup --python blender_restore_undo_probe.py -- owner <bridge-action>
    blender --background --factory-startup --python blender_restore_undo_probe.py -- direct
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


ADDON_SOURCE = (
    Path(__file__).resolve().parent.parent
    / "Blender Addons - Copy contents Into Blender"
)


def _probe_arguments() -> tuple[str, str | None]:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    mode = str(arguments[0] if arguments else "direct").strip().lower()
    owner_action = str(arguments[1]).strip() if len(arguments) > 1 else None
    return mode, owner_action


def _clear_scene() -> None:
    scene_root = bpy.context.scene.collection
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(scene_root.children):
        scene_root.children.unlink(child)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)


def _new_mesh_object(name: str, z_offset: float) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        [(0.0, 0.0, z_offset), (1.0, 0.0, z_offset), (0.0, 1.0, z_offset)],
        [],
        [(0, 1, 2)],
    )
    mesh.update()
    return bpy.data.objects.new(name, mesh)


def _scene_state() -> dict[str, object]:
    return {
        "objects": sorted(obj.name for obj in bpy.data.objects),
        "selected": sorted(obj.name for obj in bpy.context.selected_objects),
        "active": getattr(bpy.context.view_layer.objects.active, "name", None),
    }


def main() -> None:
    mode, owner_action = _probe_arguments()
    if mode not in {"owner", "direct", "owner-live", "direct-live"}:
        raise ValueError(f"Unsupported probe mode: {mode}")
    if mode.startswith("owner") and not owner_action:
        raise ValueError("Owner probe modes require the installed Restore bridge action after the mode.")

    sys.path.insert(0, str(ADDON_SOURCE))
    import flowcell_actions as actions

    bpy.context.preferences.edit.use_global_undo = True
    actions.register()
    bridge_module = None
    bridge_timer = None
    live_tool_registry = None
    lifecycle_registry = None
    if mode.startswith("owner"):
        import flowcell_bridge

        bridge_module = flowcell_bridge
        bridge_timer = flowcell_bridge._live_tool_timer_loop
        live_tool_registry = flowcell_bridge.LIVE_TOOL_REGISTRY
        lifecycle_registry = flowcell_bridge.CUSTOM_ACTION_LIFECYCLE_REGISTRY
    _clear_scene()

    roots = actions.ensure_root_structure(bpy.context.scene.collection)
    live_obj = _new_mesh_object("Probe", 0.0)
    roots["Live"].objects.link(live_obj)

    snapshot_bucket = actions.ensure_named_bucket(roots["Snapshots"], "Probe")
    source_obj = _new_mesh_object("(s1)Probe", 2.0)
    source_obj[actions.TARGET_NAME_PROP] = "Probe"
    snapshot_bucket.objects.link(source_obj)

    selected_obj = live_obj if mode.endswith("-live") else source_obj
    selected_obj.select_set(True)
    bpy.context.view_layer.objects.active = selected_obj
    bpy.context.view_layer.update()
    bpy.ops.ed.undo_push(message="Restore probe baseline")

    action = owner_action if mode.startswith("owner") else "restore"
    before = _scene_state()
    print("FLOWCELL_PROBE before", json.dumps(before, sort_keys=True), flush=True)
    result = actions.execute_bridge_operator(action, {})
    bpy.context.view_layer.update()
    after = _scene_state()
    print("FLOWCELL_PROBE restore", json.dumps(result, sort_keys=True), flush=True)
    print("FLOWCELL_PROBE after", json.dumps(after, sort_keys=True), flush=True)

    if bridge_module is not None:
        assert sys.modules.get("flowcell_bridge") is bridge_module
        assert bridge_module._live_tool_timer_loop is bridge_timer
        assert bridge_module.LIVE_TOOL_REGISTRY is live_tool_registry
        assert bridge_module.CUSTOM_ACTION_LIFECYCLE_REGISTRY is lifecycle_registry
        print("FLOWCELL_PROBE bridge identities stable", flush=True)

    if mode.endswith("-live"):
        assert str(result.get("message", "")).startswith("Restore cancelled:")
        assert before == after
    else:
        assert str(result.get("message", "")) == "Restored 1 object(s) into Live."
        assert sorted(obj.name for obj in bpy.data.objects) == ["(s1)Probe", "(t1)Probe", "Probe"]

    if not bpy.ops.ed.undo.poll():
        print("FLOWCELL_PROBE undo SKIPPED: Blender background mode has no window context", flush=True)
        return

    undo_result = bpy.ops.ed.undo()
    bpy.context.view_layer.update()
    print("FLOWCELL_PROBE undo", sorted(undo_result), flush=True)
    print("FLOWCELL_PROBE undone", json.dumps(_scene_state(), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
