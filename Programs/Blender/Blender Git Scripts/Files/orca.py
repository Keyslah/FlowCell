# Description: Export the selected mesh objects as STL files and add them to Orca.
from __future__ import annotations

import ctypes
import hashlib
import importlib
import json
import os
import re
import subprocess
import sys
import tempfile
from ctypes import wintypes
from pathlib import Path

import bpy

# This package launches the slicer itself. FlowCell core knows nothing about
# slicers: it installs the Button and dispatches the press, and everything about
# what "Orca" means lives here.
SLICER_DISPLAY_NAME = "OrcaSlicer"
SLICER_EXECUTABLE_LABEL = "Orca EXE"
SLICER_SETTINGS_FILE_NAME = "orca_launcher.json"
ORCA_SINGLE_INSTANCE_LABEL = "Allow only one OrcaSlicer instance"
ORCA_SINGLE_INSTANCE_DESCRIPTION = (
    "If this is turned off, a new OrcaSlicer instance will be created every time you add a file."
)
ORCA_CONFIG_FILE_NAME = "OrcaSlicer.conf"
SEARCH_PATTERNS = [
    r"OrcaSlicer*/orca-slicer.exe",
    r"Programs/OrcaSlicer*/orca-slicer.exe",
]

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000


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


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        try:
            temporary_path.unlink(missing_ok=True)
        except Exception:
            pass


def _write_settings(payload: dict[str, object]) -> None:
    settings_path = _settings_path()
    encoded = (json.dumps(payload, indent=2) + "\n").encode("utf-8")
    _atomic_write_bytes(settings_path, encoded)


def _read_saved_executable() -> Path | None:
    return _validate_executable(_read_settings().get("executable", ""))


def _write_saved_executable(executable: Path) -> None:
    payload = _read_settings()
    payload["executable"] = str(executable)
    _write_settings(payload)


def _find_executable() -> Path | None:
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


def _is_orca_executable(executable: Path) -> bool:
    return executable.name.casefold() in {"orca-slicer.exe", "orcaslicer.exe"}


def _orca_config_path() -> Path:
    roaming_root = str(os.environ.get("APPDATA", "") or "").strip()
    if not roaming_root:
        raise ValueError("Windows APPDATA is unavailable, so FlowCell cannot locate OrcaSlicer.conf.")
    return Path(roaming_root) / "OrcaSlicer" / ORCA_CONFIG_FILE_NAME


def _orca_config_parts(config_path: Path | None = None) -> tuple[Path, bytes, str, bool, str]:
    path = config_path or _orca_config_path()
    if not path.is_file():
        raise ValueError(
            f"OrcaSlicer settings were not found at {path}. Open OrcaSlicer once, close it, and try again."
        )

    original_bytes = path.read_bytes()
    has_utf8_bom = original_bytes.startswith(b"\xef\xbb\xbf")
    try:
        text = original_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(f"OrcaSlicer settings are not valid UTF-8: {path}") from exc

    last_brace = text.rfind("}")
    if last_brace < 0:
        raise ValueError(f"OrcaSlicer settings are not valid JSON: {path}")
    json_text = text[: last_brace + 1]
    checksum_tail = text[last_brace + 1 :]

    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"OrcaSlicer settings are not valid JSON: {path}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("app"), dict):
        raise ValueError(f"OrcaSlicer settings do not contain the app section: {path}")

    checksum_match = re.fullmatch(
        r"\s*# MD5 checksum ([0-9A-Fa-f]{32})\s*",
        checksum_tail,
    )
    checksum_source = json_text.replace("\r\n", "\n").replace("\r", "\n")
    expected_checksum = hashlib.md5(checksum_source.encode("utf-8")).hexdigest().upper()
    if checksum_match is None or checksum_match.group(1).upper() != expected_checksum:
        raise ValueError(
            f"OrcaSlicer settings have an invalid MD5 checksum: {path}. "
            "Open OrcaSlicer and close it normally before trying again."
        )

    single_instance = payload["app"].get("single_instance")
    if not isinstance(single_instance, bool):
        raise ValueError(f"OrcaSlicer app.single_instance is missing or invalid in {path}.")
    newline = "\r\n" if "\r\n" in text else "\n"
    return path, original_bytes, json_text, has_utf8_bom, newline


def _read_orca_single_instance(config_path: Path | None = None) -> bool:
    _, _, json_text, _, _ = _orca_config_parts(config_path)
    payload = json.loads(json_text)
    return bool(payload["app"]["single_instance"])


def _is_orca_running() -> bool:
    if os.name != "nt":
        return False
    try:
        completed = subprocess.run(
            ["tasklist.exe", "/FO", "CSV", "/NH"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as exc:
        raise ValueError(f"FlowCell could not verify whether OrcaSlicer is closed: {exc}") from exc
    if completed.returncode != 0:
        detail = str(completed.stderr or "").strip() or f"tasklist exited with {completed.returncode}"
        raise ValueError(f"FlowCell could not verify whether OrcaSlicer is closed: {detail}")
    process_list = str(completed.stdout or "").casefold()
    return '"orca-slicer.exe"' in process_list or '"orcaslicer.exe"' in process_list


def _write_orca_single_instance(
    enabled: bool,
    config_path: Path | None = None,
) -> bool:
    path, original_bytes, json_text, has_utf8_bom, newline = _orca_config_parts(config_path)
    current = bool(json.loads(json_text)["app"]["single_instance"])
    if current == enabled:
        return False
    if _is_orca_running():
        raise ValueError(
            "Close OrcaSlicer before FlowCell changes 'Allow only one OrcaSlicer instance'."
        )

    matches = list(
        re.finditer(
            r'(?m)^([ \t]*"single_instance"[ \t]*:[ \t]*)(true|false)([ \t]*,?[ \t\r]*)$',
            json_text,
        )
    )
    if len(matches) != 1:
        raise ValueError(
            f"FlowCell could not safely locate OrcaSlicer app.single_instance in {path}."
        )
    match = matches[0]
    updated_json = (
        json_text[: match.start()]
        + match.group(1)
        + ("true" if enabled else "false")
        + match.group(3)
        + json_text[match.end() :]
    )
    updated_payload = json.loads(updated_json)
    if updated_payload.get("app", {}).get("single_instance") is not enabled:
        raise ValueError("FlowCell could not validate the updated OrcaSlicer setting.")

    checksum_source = updated_json.replace("\r\n", "\n").replace("\r", "\n")
    checksum = hashlib.md5(checksum_source.encode("utf-8")).hexdigest().upper()
    updated_text = f"{updated_json}{newline}# MD5 checksum {checksum}{newline}"
    updated_bytes = ((b"\xef\xbb\xbf" if has_utf8_bom else b"") + updated_text.encode("utf-8"))

    # Orca itself keeps a valid .bak before replacing the primary file. Keep the
    # pre-edit bytes there so Orca can recover the exact prior settings if the
    # replacement is interrupted or rejected by a future Orca version.
    backup_path = path.with_name(f"{path.name}.bak")
    _atomic_write_bytes(backup_path, original_bytes)
    _atomic_write_bytes(path, updated_bytes)

    if _read_orca_single_instance(path) is not enabled:
        raise ValueError("FlowCell wrote OrcaSlicer.conf, but its setting did not verify.")
    return True


def _prompt_orca_single_instance(initial_value: bool) -> bool | None:
    if os.name != "nt":
        raise ValueError("The OrcaSlicer settings dialog is only available on Windows.")

    MB_YESNOCANCEL = 0x00000003
    MB_ICONQUESTION = 0x00000020
    MB_DEFBUTTON2 = 0x00000100
    MB_SETFOREGROUND = 0x00010000
    IDYES = 6
    IDNO = 7
    IDCANCEL = 2

    current_state = "on" if initial_value else "off"
    content = (
        f"{ORCA_SINGLE_INSTANCE_LABEL}\n\n"
        f"{ORCA_SINGLE_INSTANCE_DESCRIPTION}\n\n"
        f"The current setting is {current_state}.\n\n"
        "Choose Yes to allow only one instance, No to allow a new instance each time, "
        "or Cancel to stop."
    )
    flags = MB_YESNOCANCEL | MB_ICONQUESTION | MB_SETFOREGROUND
    if not initial_value:
        flags |= MB_DEFBUTTON2
    try:
        message_box = ctypes.WinDLL("user32", use_last_error=True).MessageBoxW
        message_box.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT]
        message_box.restype = ctypes.c_int
        result = message_box(None, content, "FlowCell - OrcaSlicer settings", flags)
    except Exception as exc:
        raise ValueError(f"FlowCell could not open the OrcaSlicer settings dialog: {exc}") from exc
    if result == IDYES:
        return True
    if result == IDNO:
        return False
    if result == IDCANCEL:
        return None
    raise ValueError(
        f"FlowCell could not read the OrcaSlicer settings choice (Windows response {result})."
    )


def _ensure_orca_settings_confirmed(executable: Path) -> None:
    settings = _read_settings()
    if settings.get("settingsConfirmed") is True:
        return

    current = _read_orca_single_instance()
    selected = _prompt_orca_single_instance(current)
    if selected is None:
        raise ValueError("OrcaSlicer settings were canceled, so no file was exported or launched.")
    _write_orca_single_instance(selected)
    settings = _read_settings()
    settings["executable"] = str(executable)
    settings["settingsConfirmed"] = True
    _write_settings(settings)


def _required_bool(value: object, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise ValueError(f"{field_name} must be true or false.")


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
    payload = _merge_payload({}, data)
    command = str(payload.get("command", "") or "").strip().casefold()

    if command == "get_settings":
        executable = _resolve_executable()
        if executable is None:
            raise ValueError("Orca EXE selection was canceled.")
        current = _read_orca_single_instance()
        settings = _read_settings()
        return {
            "message": "Loaded OrcaSlicer settings.",
            "executable": str(executable),
            "settingsConfirmed": settings.get("settingsConfirmed") is True,
            "allowSingleInstance": current,
            "orcaRunning": _is_orca_running(),
            "singleInstanceLabel": ORCA_SINGLE_INSTANCE_LABEL,
            "singleInstanceDescription": ORCA_SINGLE_INSTANCE_DESCRIPTION,
            "configPath": str(_orca_config_path()),
        }

    if command == "set_single_instance":
        enabled = _required_bool(payload.get("allow_single_instance"), "allow_single_instance")
        changed = _write_orca_single_instance(enabled)
        settings = _read_settings()
        settings["settingsConfirmed"] = True
        _write_settings(settings)
        return {
            "message": (
                f"{ORCA_SINGLE_INSTANCE_LABEL} is now {'on' if enabled else 'off'}."
                if changed
                else f"{ORCA_SINGLE_INSTANCE_LABEL} was already {'on' if enabled else 'off'}."
            ),
            "allowSingleInstance": enabled,
            "settingsConfirmed": True,
            "singleInstanceLabel": ORCA_SINGLE_INSTANCE_LABEL,
            "singleInstanceDescription": ORCA_SINGLE_INSTANCE_DESCRIPTION,
        }

    executable = _resolve_executable()
    if executable is None:
        raise ValueError("Orca EXE selection was canceled, so no file was exported or launched.")
    _ensure_orca_settings_confirmed(executable)

    bridge = _load_flowcell_bridge()
    result = bridge.execute_bridge_operator("save_selected_stl_to_assets", payload)
    exported_paths = [str(path) for path in result.get("exported_paths", []) if str(path).strip()]
    if not exported_paths:
        raise ValueError("STL export did not return any file paths.")

    export_message = str(result.get("message", "Saved STL files."))
    launch_message = _launch(executable, exported_paths)
    return {
        "message": f"{export_message} {launch_message}",
        "exported_paths": exported_paths,
    }
