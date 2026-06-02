# Description: Prompt for a name and create a new child collection near the selected object.

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


def run_flowcell_action(context=None, data=None):
    del context
    payload = _merge_payload({}, data)
    name = str(payload.get("name", "") or "").strip()
    if not name:
        prompted = _ask_string("New Collection", "Name for the new collection:", "Collection")
        if prompted is None:
            return {"message": "Cancelled new collection."}
        name = prompted.strip() or "Collection"
    payload["name"] = name
    bridge = _load_flowcell_bridge()
    return bridge.execute_bridge_operator("new_collection", payload)
