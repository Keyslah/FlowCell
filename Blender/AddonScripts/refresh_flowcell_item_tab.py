import json
import os
import subprocess
import time
from pathlib import Path

import addon_utils
import bpy


bl_info = {
    "name": "Refresh FlowCell Item Tab",
    "author": "OpenAI Codex",
    "version": (1, 3, 0),
    "blender": (5, 0, 0),
    "location": "View3D > Sidebar > Item",
    "description": "Add Item-tab buttons that reload the FlowCell or FlowTest bridge add-on and restart the matching desktop UI.",
    "category": "Object",
}


BLENDER_CONFIG_RELATIVE_PATHS = (
    Path("FlowCell") / "local" / "private" / "blender.config.local.json",
    Path("Blender") / "config.json",
)
WORKSPACE_TARGETS = {
    "flowcell": {
        "display_name": "FlowCell",
        "root_envs": ("FLOWCELL_ROOT",),
        "root_hints": (Path(r"D:\Dev\workspace\Codex\flowcell"),),
        "fallback_modules": ("flowcell_actions", "flowcell_bridge", "flowcell"),
        "fallback_display_names": {"flowcell", "blender organizer"},
        "default_action_file": "flowcell_actions.py",
        "default_bridge_file": "flowcell_bridge.py",
    },
    "flowtest": {
        "display_name": "FlowTest",
        "root_envs": ("FLOWTEST_ROOT", "FLOWCELL_ROOT"),
        "root_hints": (Path(r"D:\Dev\workspace\Codex\FlowTest"),),
        "fallback_modules": ("flowtest_actions", "flowtest_bridge", "flowcell_actions", "flowcell"),
        "fallback_display_names": {"flowtest", "flowcell", "blender organizer"},
        "default_action_file": "flowtest_actions.py",
        "default_bridge_file": "flowtest_bridge.py",
    },
}


def _load_json_file(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def _resolve_workspace_root(target_key: str) -> Path | None:
    target = WORKSPACE_TARGETS[target_key]
    candidates: list[Path] = []

    for env_name in target["root_envs"]:
        env_root = os.environ.get(env_name, "").strip()
        if env_root:
            candidates.append(Path(env_root).expanduser())

    script_path = Path(__file__).resolve()
    for parent in (script_path.parent, *script_path.parents):
        candidates.append(parent)

    candidates.extend(target["root_hints"])

    seen: set[str] = set()
    for candidate in candidates:
        candidate_key = str(candidate).casefold()
        if candidate_key in seen:
            continue
        seen.add(candidate_key)

        if (candidate / "run_hidden.vbs").is_file() and (candidate / "FlowCell" / "run_hidden.vbs").is_file():
            return candidate

    return None


def _load_workspace_blender_config(workspace_root: Path) -> dict:
    for relative_path in BLENDER_CONFIG_RELATIVE_PATHS:
        config_path = workspace_root / relative_path
        if config_path.is_file():
            config = _load_json_file(config_path)
            if isinstance(config, dict):
                return config

    return {}


def _get_addon_candidates(target_key: str, workspace_root: Path) -> tuple[list[str], set[str]]:
    target = WORKSPACE_TARGETS[target_key]
    config = _load_workspace_blender_config(workspace_root)
    automation = config.get("automation", {}) if isinstance(config, dict) else {}
    if not isinstance(automation, dict):
        automation = {}

    display_names = set(target["fallback_display_names"])
    configured_display_name = str(automation.get("addonDisplayName", "") or "").strip()
    if configured_display_name:
        display_names.add(configured_display_name.casefold())

    module_candidates: list[str] = []
    for key, default_value in (
        ("addonActionsFileName", target["default_action_file"]),
        ("addonBridgeFileName", target["default_bridge_file"]),
    ):
        file_name = str(automation.get(key, "") or default_value).strip()
        module_name = Path(file_name).stem.strip()
        if module_name and module_name not in module_candidates:
            module_candidates.append(module_name)

    for module_name in target["fallback_modules"]:
        if module_name not in module_candidates:
            module_candidates.append(module_name)

    return module_candidates, display_names


def _find_workspace_module_name(target_key: str, workspace_root: Path) -> str:
    module_candidates, display_names = _get_addon_candidates(target_key, workspace_root)

    for module in addon_utils.modules(refresh=False):
        module_name = str(getattr(module, "__name__", "") or "").strip()
        if not module_name or module_name == __name__:
            continue

        display_name = str((getattr(module, "bl_info", {}) or {}).get("name", "")).strip().casefold()
        if display_name in display_names:
            return module_name

    for module_name in module_candidates:
        if module_name == __name__:
            continue
        if any(str(getattr(module, "__name__", "") or "") == module_name for module in addon_utils.modules(refresh=False)):
            return module_name

    return ""


def _get_workspace_runtime_paths(workspace_root: Path) -> dict[str, Path]:
    flowcell_root = workspace_root / "FlowCell"
    frontend_root = workspace_root / "FlowCellFrontend"
    return {
        "legacy_ui_script": (flowcell_root / "FlowCellUI.ps1").resolve(),
        "backend_script": (flowcell_root / "FlowCellBackend.ahk").resolve(),
        "frontend_launcher_script": (flowcell_root / "helpers" / "Start-FlowCellFrontend.ps1").resolve(),
        "backend_launcher": (workspace_root / "run_backend_hidden.vbs").resolve(),
        "workspace_launcher": (workspace_root / "run_hidden.vbs").resolve(),
        "frontend_root": frontend_root.resolve(),
        "frontend_exe": (frontend_root / "src-tauri" / "target" / "debug" / "flowcell_frontend.exe").resolve(),
    }


def _get_workspace_process_ids(workspace_root: Path) -> list[int]:
    runtime_paths = _get_workspace_runtime_paths(workspace_root)
    ui_script = str(runtime_paths["legacy_ui_script"])
    backend_script = str(runtime_paths["backend_script"])
    frontend_script = str(runtime_paths["frontend_launcher_script"])
    frontend_exe = str(runtime_paths["frontend_exe"])
    ps_command = (
        "$frontendExe='{0}';"
        "$frontendScript='{1}';"
        "$ui='{2}';"
        "$backend='{3}';"
        "Get-CimInstance Win32_Process | "
        "Where-Object {{ "
        "$cmd=[string]$_.CommandLine; "
        "$exe=[string]$_.ExecutablePath; "
        "("
        "(-not [string]::IsNullOrWhiteSpace($cmd) -and ("
        "($cmd -like ('*' + $ui + '*')) -or "
        "($cmd -like ('*' + $backend + '*')) -or "
        "($cmd -like ('*' + $frontendScript + '*'))"
        ")) -or "
        "(-not [string]::IsNullOrWhiteSpace($exe) -and "
        "[System.StringComparer]::OrdinalIgnoreCase.Equals($exe, $frontendExe))"
        ") "
        "}} | Select-Object -ExpandProperty ProcessId"
    ).format(
        frontend_exe.replace("'", "''"),
        frontend_script.replace("'", "''"),
        ui_script.replace("'", "''"),
        backend_script.replace("'", "''"),
    )

    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_command],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Could not inspect running workspace processes.")

    process_ids: list[int] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            process_id = int(line)
        except ValueError:
            continue
        if process_id not in process_ids:
            process_ids.append(process_id)

    return process_ids


def _stop_workspace_processes(workspace_root: Path) -> None:
    for process_id in _get_workspace_process_ids(workspace_root):
        subprocess.run(
            ["taskkill", "/PID", str(process_id), "/T", "/F"],
            check=False,
            capture_output=True,
            text=True,
        )


def _restart_workspace_desktop(target_key: str, workspace_root: Path) -> str:
    target_name = str(WORKSPACE_TARGETS[target_key]["display_name"])
    runtime_paths = _get_workspace_runtime_paths(workspace_root)
    _stop_workspace_processes(workspace_root)
    time.sleep(0.35)

    direct_frontend = runtime_paths["frontend_exe"]
    backend_launcher = runtime_paths["backend_launcher"]
    if direct_frontend.is_file() and backend_launcher.is_file():
        subprocess.Popen(
            ["wscript.exe", "//nologo", str(backend_launcher)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        subprocess.Popen(
            [str(direct_frontend)],
            cwd=str(runtime_paths["frontend_root"]),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return f"Restarted {target_name}."

    launcher_path = runtime_paths["workspace_launcher"]
    if not launcher_path.is_file():
        raise RuntimeError(f"{target_name} launcher was not found: {launcher_path}")

    subprocess.Popen(
        ["wscript.exe", "//nologo", str(launcher_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return f"Restarted {target_name}."


def _reload_workspace_addon(target_key: str, workspace_root: Path) -> str:
    target_name = str(WORKSPACE_TARGETS[target_key]["display_name"])
    module_name = _find_workspace_module_name(target_key, workspace_root)
    if not module_name:
        raise RuntimeError(f"Could not find the installed {target_name} bridge add-on to reload.")

    _, is_enabled = addon_utils.check(module_name)
    if is_enabled:
        addon_utils.disable(module_name, default_set=False)

    addon_utils.enable(module_name, default_set=False)
    return f"Reloaded {target_name} Blender add-on '{module_name}'."


def _refresh_workspace(target_key: str) -> str:
    target_name = str(WORKSPACE_TARGETS[target_key]["display_name"])
    workspace_root = _resolve_workspace_root(target_key)
    if workspace_root is None:
        raise RuntimeError(
            f"Could not find the {target_name} workspace root. Set the matching workspace env var or install this script from that repo."
        )

    addon_message = _reload_workspace_addon(target_key, workspace_root)
    desktop_message = _restart_workspace_desktop(target_key, workspace_root)
    return f"{addon_message} {desktop_message}"


class VIEW3D_OT_refresh_flowcell(bpy.types.Operator):
    bl_idname = "view3d.refresh_flowcell"
    bl_label = "refresh flowcell"
    bl_description = "Disable and re-enable the FlowCell bridge add-on, then restart FlowCell"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        del context
        try:
            message = _refresh_workspace("flowcell")
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report({"INFO"}, message)
        return {"FINISHED"}


class VIEW3D_OT_refresh_flowtest(bpy.types.Operator):
    bl_idname = "view3d.refresh_flowtest"
    bl_label = "refresh flowtest"
    bl_description = "Disable and re-enable the FlowTest bridge add-on, then restart FlowTest"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        del context
        try:
            message = _refresh_workspace("flowtest")
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report({"INFO"}, message)
        return {"FINISHED"}


class VIEW3D_PT_refresh_flowcell_item_tab(bpy.types.Panel):
    bl_label = "FlowCell"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Item"

    def draw(self, context: bpy.types.Context):
        del context
        self.layout.operator(VIEW3D_OT_refresh_flowcell.bl_idname, icon="FILE_REFRESH")
        self.layout.operator(VIEW3D_OT_refresh_flowtest.bl_idname, icon="FILE_REFRESH")


CLASSES = (
    VIEW3D_OT_refresh_flowcell,
    VIEW3D_OT_refresh_flowtest,
    VIEW3D_PT_refresh_flowcell_item_tab,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
