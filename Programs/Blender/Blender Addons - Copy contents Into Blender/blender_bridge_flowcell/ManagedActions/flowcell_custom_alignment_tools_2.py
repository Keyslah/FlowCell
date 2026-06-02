# Description: Open FlowCell alignment controls for active-object min, center, max, surface, and origin alignment.




# FLOWCELL_CHILD: z_min | Z Min | Align the active object to the minimum Z bound of the selection.
# FLOWCELL_CHILD: z_center | Z Center | Align the active object to the center Z position of the selection.
# FLOWCELL_CHILD: z_max | Z Max | Align the active object to the maximum Z bound of the selection.
# FLOWCELL_CHILD: z_surface | Z Surface | Align the active object using the saved Z surface modifier.
# FLOWCELL_CHILD: z_geo | Z Origin | Align the active object using the saved Z origin modifier.
# FLOWCELL_CHILD: y_min | Y Min | Align the active object to the minimum Y bound of the selection.
# FLOWCELL_CHILD: y_center | Y Center | Align the active object to the center Y position of the selection.
# FLOWCELL_CHILD: y_max | Y Max | Align the active object to the maximum Y bound of the selection.
# FLOWCELL_CHILD: y_surface | Y Surface | Align the active object using the saved Y surface modifier.
# FLOWCELL_CHILD: y_geo | Y Origin | Align the active object using the saved Y origin modifier.
# FLOWCELL_CHILD: x_min | X Min | Align the active object to the minimum X bound of the selection.
# FLOWCELL_CHILD: x_center | X Center | Align the active object to the center X position of the selection.
# FLOWCELL_CHILD: x_max | X Max | Align the active object to the maximum X bound of the selection.
# FLOWCELL_CHILD: x_surface | X Surface | Align the active object using the saved X surface modifier.
# FLOWCELL_CHILD: x_geo | X Origin | Align the active object using the saved X origin modifier.
# FLOWCELL_CHILD: center_everything | Center Everything | Center the full selection across all supported axes.

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

ACTION_NAME = "alignment_tools"
DEFAULT_DATA = json.loads(r'''{}''')


def run_flowcell_action(context=None, data=None):
    del context
    bridge = _load_flowcell_bridge()
    payload = _merge_payload(DEFAULT_DATA, data)
    return bridge.execute_bridge_operator(ACTION_NAME, payload)
