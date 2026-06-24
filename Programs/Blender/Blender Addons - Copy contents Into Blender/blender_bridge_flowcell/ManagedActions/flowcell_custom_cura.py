# Description: Export the selected mesh objects as STL files and add them to Cura.

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

import os
import subprocess


SEARCH_PATTERNS = [
    r'UltiMaker Cura*/UltiMaker-Cura.exe',
    r'Programs/UltiMaker Cura*/UltiMaker-Cura.exe',
]


def _find_executable():
    roots = []
    for env_name in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        value = os.environ.get(env_name, "").strip()
        if value:
            roots.append(Path(value))

    seen = set()
    for root in roots:
        for pattern in SEARCH_PATTERNS:
            for candidate in root.glob(pattern):
                try:
                    candidate = candidate.resolve()
                except Exception:
                    continue
                key = str(candidate).lower()
                if key in seen:
                    continue
                seen.add(key)
                if candidate.is_file():
                    return candidate
    return None


def _request_flowcell_launch(executable, exported_paths, export_message=""):
    message = export_message or "Saved STL files."
    return {
        "message": f"{message} Confirm the Cura EXE in FlowCell to launch the exported STL files.",
        "requires_flowcell_slicer_launch": True,
        "requires_flowcell_orca_launch": False,
        "requires_flowcell_cura_launch": True,
        "slicer_id": "cura",
        "slicer_display_name": "UltiMaker Cura",
        "executable_label": "Cura EXE",
        "detected_executable": str(executable or ""),
        "exported_paths": exported_paths,
    }


def run_flowcell_action(context=None, data=None):
    del context
    bridge = _load_flowcell_bridge()
    result = bridge.execute_bridge_operator("save_selected_stl_to_assets", _merge_payload({}, data))
    exported_paths = [str(path) for path in result.get("exported_paths", []) if str(path).strip()]
    if not exported_paths:
        raise ValueError("STL export did not return any file paths.")

    export_message = str(result.get("message", "Saved STL files."))
    detected_executable = _find_executable()
    return _request_flowcell_launch(detected_executable, exported_paths, export_message)
