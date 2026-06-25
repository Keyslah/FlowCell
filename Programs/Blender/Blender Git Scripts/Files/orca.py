# Description: Export the selected mesh objects as STL files and add them to Orca.

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
    r'OrcaSlicer*/orca-slicer.exe',
    r'Programs/OrcaSlicer*/orca-slicer.exe',
]
ORCA_SINGLE_INSTANCE_ARG = "--single-instance"
CREATE_NO_WINDOW = 0x08000000


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


def _is_orca_running(executable):
    if os.name != "nt":
        return False
    try:
        completed = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {executable.name}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            creationflags=CREATE_NO_WINDOW,
            check=False,
        )
    except Exception:
        return False
    output = f"{completed.stdout}\n{completed.stderr}".lower()
    return executable.name.lower() in output and "no tasks" not in output


def _launch_orca(executable, exported_paths, export_message=""):
    was_running = _is_orca_running(executable)
    args = [str(executable)]
    if was_running:
        args.append(ORCA_SINGLE_INSTANCE_ARG)
    args.extend(exported_paths)

    try:
        subprocess.Popen(args, cwd=str(executable.parent))
    except Exception as exc:
        prefix = f"{export_message} " if export_message else ""
        return {
            "message": f"{prefix}OrcaSlicer launch failed: {exc}",
            "exported_paths": exported_paths,
            "launch_failed": True,
        }

    count = len(exported_paths)
    file_label = "file" if count == 1 else "files"
    action = "Sent" if was_running else "Launched"
    target = "to the open OrcaSlicer window" if was_running else "with OrcaSlicer"
    prefix = f"{export_message} " if export_message else ""
    return {"message": f"{prefix}{action} {count} STL {file_label} {target}.", "exported_paths": exported_paths}


def run_flowcell_action(context=None, data=None):
    del context
    bridge = _load_flowcell_bridge()
    result = bridge.execute_bridge_operator("save_selected_stl_to_assets", _merge_payload({}, data))
    exported_paths = [str(path) for path in result.get("exported_paths", []) if str(path).strip()]
    if not exported_paths:
        raise ValueError("STL export did not return any file paths.")

    executable = _find_executable()
    if executable is None:
        message = str(result.get("message", "Saved STL files."))
        return {"message": f"{message} Could not find OrcaSlicer.", "exported_paths": exported_paths}

    return _launch_orca(executable, exported_paths, str(result.get("message", "Saved STL files.")))
