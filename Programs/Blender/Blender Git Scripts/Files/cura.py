# Description: Export the selected mesh objects as STL files and add them to Cura.
from __future__ import annotations

import ctypes
import importlib
import json
import os
import re
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path

import bpy

# This package launches the slicer itself. FlowCell core knows nothing about
# slicers: it installs the Button and dispatches the press, and everything about
# what "Cura" means lives here.
SLICER_DISPLAY_NAME = "UltiMaker Cura"
SLICER_EXECUTABLE_LABEL = "Cura EXE"
SLICER_SETTINGS_FILE_NAME = "cura_launcher.json"
SEARCH_PATTERNS = [
    r"UltiMaker Cura*/UltiMaker-Cura.exe",
    r"Programs/UltiMaker Cura*/UltiMaker-Cura.exe",
]

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


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


def _settings_path() -> Path:
    """`<ownerButtonId>/runtime/<settings file>` for this installed package.

    `runtime/` is the Button-owned mutable settings folder: Update preserves it
    and Delete recycles it with the owner.
    """
    return Path(__file__).resolve().parent.parent / "runtime" / SLICER_SETTINGS_FILE_NAME


def _validate_executable(path_text: str) -> Path | None:
    trimmed = str(path_text or "").strip().strip('"').strip()
    if not trimmed:
        return None
    executable = Path(trimmed)
    if not executable.is_file():
        return None
    if executable.suffix.casefold() != ".exe":
        return None
    return executable


def _read_settings() -> dict[str, object]:
    settings_path = _settings_path()
    if not settings_path.is_file():
        return {}
    try:
        raw = settings_path.read_text(encoding="utf-8-sig")
        payload = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    return dict(payload)


def _read_saved_executable() -> Path | None:
    return _validate_executable(_read_settings().get("executable", ""))


def _write_saved_executable(executable: Path) -> None:
    settings_path = _settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _read_settings()
    payload["executable"] = str(executable)
    settings_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _find_executable() -> Path | None:
    roots = []
    for env_name in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        value = os.environ.get(env_name, "").strip()
        if value:
            roots.append(Path(value))

    seen = set()
    candidates: list[Path] = []
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
                    candidates.append(candidate)

    if not candidates:
        return None

    def newest_key(candidate: Path) -> tuple[tuple[int, ...], int, str]:
        # Cura installations carry the version in the containing directory
        # (for example ``UltiMaker Cura 5.11.0``). A natural numeric tuple is
        # deliberate here: lexical ordering would consider 5.9 newer than 5.11.
        numbers = tuple(int(part) for part in re.findall(r"\d+", candidate.parent.name))
        try:
            modified = candidate.stat().st_mtime_ns
        except OSError:
            modified = 0
        return numbers, modified, str(candidate).casefold()

    return max(candidates, key=newest_key)


class _OPENFILENAMEW(ctypes.Structure):
    _fields_ = [
        ("lStructSize", wintypes.DWORD),
        ("hwndOwner", wintypes.HWND),
        ("hInstance", wintypes.HINSTANCE),
        ("lpstrFilter", wintypes.LPCWSTR),
        ("lpstrCustomFilter", wintypes.LPWSTR),
        ("nMaxCustFilter", wintypes.DWORD),
        ("nFilterIndex", wintypes.DWORD),
        ("lpstrFile", wintypes.LPWSTR),
        ("nMaxFile", wintypes.DWORD),
        ("lpstrFileTitle", wintypes.LPWSTR),
        ("nMaxFileTitle", wintypes.DWORD),
        ("lpstrInitialDir", wintypes.LPCWSTR),
        ("lpstrTitle", wintypes.LPCWSTR),
        ("Flags", wintypes.DWORD),
        ("nFileOffset", wintypes.WORD),
        ("nFileExtension", wintypes.WORD),
        ("lpstrDefExt", wintypes.LPCWSTR),
        ("lCustData", wintypes.LPARAM),
        ("lpfnHook", ctypes.c_void_p),
        ("lpTemplateName", wintypes.LPCWSTR),
        ("pvReserved", ctypes.c_void_p),
        ("dwReserved", wintypes.DWORD),
        ("FlagsEx", wintypes.DWORD),
    ]


def _prompt_for_executable() -> Path | None:
    """Native Windows open dialog, synchronous.

    Blender's own file browser is modal and would not return a value to this
    call, so the picker is the plain comdlg32 dialog.
    """
    if os.name != "nt":
        return None

    OFN_FILEMUSTEXIST = 0x00001000
    OFN_PATHMUSTEXIST = 0x00000800
    OFN_NOCHANGEDIR = 0x00000008
    OFN_EXPLORER = 0x00080000

    buffer_length = 32768
    file_buffer = ctypes.create_unicode_buffer(buffer_length)

    options = _OPENFILENAMEW()
    options.lStructSize = ctypes.sizeof(_OPENFILENAMEW)
    options.hwndOwner = None
    options.lpstrFilter = "Applications\0*.exe\0All Files\0*.*\0\0"
    options.lpstrFile = ctypes.cast(file_buffer, wintypes.LPWSTR)
    options.nMaxFile = buffer_length
    options.lpstrTitle = f"Choose the {SLICER_DISPLAY_NAME} executable"
    options.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER

    try:
        chosen = ctypes.windll.comdlg32.GetOpenFileNameW(ctypes.byref(options))
    except Exception as exc:
        raise ValueError(f"FlowCell could not open the {SLICER_EXECUTABLE_LABEL} picker: {exc}") from exc
    if not chosen:
        error_code = int(ctypes.windll.comdlg32.CommDlgExtendedError())
        if error_code:
            raise ValueError(
                f"The {SLICER_EXECUTABLE_LABEL} picker failed with Windows error 0x{error_code:04X}."
            )
        return None
    return _validate_executable(file_buffer.value)


def _resolve_executable() -> Path | None:
    saved = _read_saved_executable()
    if saved is not None:
        return saved

    detected = _find_executable()
    if detected is not None:
        _write_saved_executable(detected)
        return detected

    chosen = _prompt_for_executable()
    if chosen is not None:
        _write_saved_executable(chosen)
        return chosen
    return None


def _launch(executable: Path, exported_paths: list[str]) -> str:
    model_paths = []
    for raw_path in exported_paths:
        trimmed = str(raw_path or "").strip().strip('"').strip()
        if trimmed:
            model_paths.append(Path(trimmed))

    if not model_paths:
        raise ValueError(f"No model files were exported for {SLICER_DISPLAY_NAME}.")

    for model_path in model_paths:
        if not model_path.is_file():
            raise ValueError(f"Exported model file was not found: {model_path}")

    # Hand the model files to the slicer by launching its own executable with the
    # file paths as arguments, and let the slicer's own single-instance setting
    # decide where they land (its running window when single-instance is enabled,
    # otherwise a new window) - either way the model loads. Do NOT force a
    # `--single-instance` flag: when the user's slicer has that option turned off,
    # forcing it makes the launch try to hand off to a window that is not
    # listening, so the files are silently dropped and nothing loads.
    creation_flags = 0
    if os.name == "nt":
        creation_flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP

    try:
        subprocess.Popen(
            [str(executable), *[str(path) for path in model_paths]],
            cwd=str(executable.parent),
            creationflags=creation_flags,
            close_fds=True,
        )
    except Exception as exc:
        retained = ", ".join(str(path) for path in model_paths)
        raise ValueError(
            f"Failed to launch {SLICER_DISPLAY_NAME} at {executable}: {exc}. "
            f"The exported model files remain at: {retained}"
        ) from exc

    count = len(model_paths)
    file_label = "file" if count == 1 else "files"
    return f"Sent {count} model {file_label} to {SLICER_DISPLAY_NAME}."


def run_flowcell_action(context=None, data=None):
    del context
    executable = _resolve_executable()
    if executable is None:
        raise ValueError("Cura EXE selection was canceled, so no file was exported or launched.")

    bridge = _load_flowcell_bridge()
    result = bridge.execute_bridge_operator("save_selected_stl_to_assets", _merge_payload({}, data))
    exported_paths = [str(path) for path in result.get("exported_paths", []) if str(path).strip()]
    if not exported_paths:
        raise ValueError("STL export did not return any file paths.")

    export_message = str(result.get("message", "Saved STL files."))
    launch_message = _launch(executable, exported_paths)
    return {
        "message": f"{export_message} {launch_message}",
        "exported_paths": exported_paths,
    }
