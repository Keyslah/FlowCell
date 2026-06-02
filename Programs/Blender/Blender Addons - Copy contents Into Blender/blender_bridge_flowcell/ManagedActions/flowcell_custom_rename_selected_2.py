# Description: Rename all selected Blender objects in one prompt.

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import bpy


def _load_flowcell_bridge():
    module_names = ("flowcell_bridge", "flowcell_bridge")
    first_error = None
    for module_name in module_names:
        try:
            module = importlib.import_module(module_name)
            try:
                module = importlib.reload(module)
            except Exception:
                pass
            return module
        except Exception as exc:
            if first_error is None:
                first_error = exc

    search_roots = []
    user_scripts = bpy.utils.user_resource("SCRIPTS")
    if user_scripts:
        search_roots.append(Path(user_scripts) / "addons")
    for root in bpy.utils.script_paths():
        if root:
            search_roots.append(Path(root) / "addons")

    seen = set()
    for addon_root in search_roots:
        try:
            addon_root = addon_root.resolve()
        except Exception:
            continue
        addon_key = str(addon_root)
        if addon_key in seen or not addon_root.is_dir():
            continue
        seen.add(addon_key)
        addon_root_text = str(addon_root)
        if addon_root_text not in sys.path:
            sys.path.insert(0, addon_root_text)
        for module_name in module_names:
            try:
                module = importlib.import_module(module_name)
                try:
                    module = importlib.reload(module)
                except Exception:
                    pass
                return module
            except Exception:
                continue

    raise RuntimeError(
        "FlowCell Blender bridge module was not found. Reload the FlowCell add-on or restart Blender."
    ) from first_error


def _merge_payload(default_payload, override_payload):
    payload = dict(default_payload or {})
    if override_payload:
        payload.update(dict(override_payload))
    return payload

import bpy


def _ask_string(title, prompt, initial_value):
    root = None
    try:
        import tkinter as tk
        from tkinter import simpledialog

        root = tk.Tk()
        root.withdraw()
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass
        return simpledialog.askstring(title, prompt, initialvalue=initial_value, parent=root)
    except Exception:
        return None
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


def _prompt_rename_items(context):
    items = []
    for obj in list(context.selected_objects):
        current_name = str(getattr(obj, "name", "") or "")
        if not current_name:
            continue
        prompted = _ask_string("Rename Selected", f"New name for '{current_name}':", current_name)
        if prompted is None:
            return None
        new_name = prompted.strip() or current_name
        items.append({"current_name": current_name, "new_name": new_name})
    return items


def run_flowcell_action(context=None, data=None):
    ctx = context or bpy.context
    payload = _merge_payload({}, data)
    items = payload.get("items")
    if not items:
        items = _prompt_rename_items(ctx)
        if items is None:
            return {"message": "Cancelled rename."}
    bridge = _load_flowcell_bridge()
    message = bridge.perform_batch_rename_selected_objects(ctx, items)
    return {"message": message}
