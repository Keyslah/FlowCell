# Description: Copy selected snapshot, trash, or archive objects into Live and move the current Live version to Trash first.

from __future__ import annotations

import importlib

import bpy


def _load_flowcell_actions():
    try:
        return importlib.import_module("flowcell_actions")
    except Exception as exc:
        raise RuntimeError(
            "FlowCell Blender actions module was not found. Reload the FlowCell add-on or restart Blender."
        ) from exc


def _selection_is_restore_only(actions, context):
    selected = list(getattr(context, "selected_objects", []) or [])
    if not selected:
        return True

    scene_root = context.scene.collection
    parent_map = actions.build_collection_parent_map(scene_root)
    restore_roots = tuple(
        root
        for name in ("Snapshots", "Trash", "Archive")
        if (root := scene_root.children.get(name)) is not None
    )
    return all(
        any(actions.object_is_in_root(obj, root, parent_map) for root in restore_roots)
        for obj in selected
    )


def run_flowcell_action(context=None, data=None):
    del data
    actions = _load_flowcell_actions()
    active_context = context if context is not None else bpy.context
    if not list(getattr(active_context, "selected_objects", []) or []):
        return {"message": "No selected objects to restore."}
    if not _selection_is_restore_only(actions, active_context):
        return {
            "message": "Restore cancelled: select only objects from Snapshots, Trash, or Archive."
        }
    return {"message": actions.perform_restore(active_context)}
