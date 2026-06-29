# Description: New Project - pick a folder (remembers the last one), name the project, optionally apply an organization profile, then save the .blend.

from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

import bpy
from bpy.props import EnumProperty, StringProperty


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


def _load_flowcell_actions():
    # The bridge loader puts the addon root on sys.path; reuse it so we can
    # resolve organization-profile destinations exactly like Save STL/PNG do.
    _load_flowcell_bridge()
    actions = importlib.import_module("flowcell_actions")
    try:
        actions = importlib.reload(actions)
    except Exception:
        pass
    return actions


STATE_FILE_NAME = "flowcell_new_project_state.json"
NONE_PROFILE_TOKEN = "__none__"
INVALID_FILENAME_CHARS = '<>:"/\\|?*'
REPO_HINTS = (
    r"D:\Dev\workspace\Codex\flowcell",
    r"D:\Dev\workspace\Codex\FlowCell",
)

PICK_OPERATOR_ID = "flowcell.new_project_pick_folder"
PICK_OPERATOR_CLASS_NAME = "FLOWCELL_OT_new_project_pick_folder"
DETAILS_OPERATOR_ID = "flowcell.new_project_details"
DETAILS_OPERATOR_CLASS_NAME = "FLOWCELL_OT_new_project_details"

# Keep a reference to the most recent EnumProperty items so Blender does not
# garbage-collect the strings while the dropdown is open (a known API gotcha).
_PROFILE_ENUM_CACHE: list[tuple[str, str, str]] = []


def _result(status="FINISHED", message="", **extra):
    payload = {"status": status, "message": message}
    payload.update(extra)
    return payload


def _bridge_root() -> Path:
    return Path(bpy.utils.user_resource("SCRIPTS")) / "addons" / "blender_bridge_flowcell"


def _state_path() -> Path:
    return _bridge_root() / STATE_FILE_NAME


def _read_last_folder() -> str:
    try:
        state = json.loads(_state_path().read_text(encoding="utf-8-sig"))
        folder = str(state.get("last_folder", "") or "").strip()
        if folder and os.path.isdir(folder):
            return folder
    except Exception:
        pass
    return ""


def _write_last_folder(folder: str) -> None:
    try:
        root = _bridge_root()
        root.mkdir(parents=True, exist_ok=True)
        _state_path().write_text(
            json.dumps({"last_folder": str(folder)}, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def _repo_root() -> Path | None:
    candidates: list[Path] = []
    env_root = os.environ.get("FLOWCELL_ROOT", "").strip()
    if env_root:
        candidates.append(Path(env_root).expanduser())
    candidates.extend(Path(hint) for hint in REPO_HINTS)
    for candidate in candidates:
        try:
            if (candidate / "FlowCell" / "local" / "Folder Tree Profiles").is_dir():
                return candidate
        except Exception:
            continue
    return None


def _profiles_root() -> Path | None:
    root = _repo_root()
    return (root / "FlowCell" / "local" / "Folder Tree Profiles") if root else None


def _folder_trees_root() -> Path | None:
    root = _repo_root()
    return (root / "FlowCell" / "local" / "Folder Trees") if root else None


def _available_profiles() -> list[str]:
    profiles_root = _profiles_root()
    if not profiles_root or not profiles_root.is_dir():
        return []
    names: list[str] = []
    for path in sorted(profiles_root.glob("*.json"), key=lambda item: item.name.lower()):
        stem = path.stem.strip()
        if stem:
            names.append(stem)
    return names


def _profile_enum_items(self, context):
    global _PROFILE_ENUM_CACHE
    items = [
        (
            NONE_PROFILE_TOKEN,
            "(None - save directly here)",
            "Save the .blend straight into the chosen folder, no project tree.",
        )
    ]
    for name in _available_profiles():
        items.append((name, name, f"Build the '{name}' organization profile tree and file the .blend in it."))
    _PROFILE_ENUM_CACHE = items
    return _PROFILE_ENUM_CACHE


def _sanitize_project_name(value: str) -> str:
    cleaned = "".join(ch for ch in str(value or "") if ch not in INVALID_FILENAME_CHARS)
    cleaned = cleaned.strip().strip(".")
    return cleaned or "Untitled"


def _unique_blend_path(directory: Path, stem: str) -> Path:
    candidate = directory / f"{stem}.blend"
    if not candidate.exists():
        return candidate
    index = 2
    while True:
        candidate = directory / f"{stem} ({index}).blend"
        if not candidate.exists():
            return candidate
        index += 1


def _apply_profile_structure(project_root: Path, profile_name: str) -> dict:
    profiles_root = _profiles_root()
    trees_root = _folder_trees_root()
    if not profiles_root:
        raise RuntimeError(
            "Could not locate the FlowCell organization profiles. Set FLOWCELL_ROOT or run from the repo machine."
        )

    profile_path = profiles_root / f"{profile_name}.json"
    if not profile_path.is_file():
        raise FileNotFoundError(f"Saved profile not found: {profile_name}. Save it in Setup Organization first.")

    with profile_path.open("r", encoding="utf-8-sig") as handle:
        profile = json.load(handle)
    if not isinstance(profile, dict):
        raise ValueError(f"Profile '{profile_name}' is not a valid organization profile.")

    project_root.mkdir(parents=True, exist_ok=True)

    # Recreate the saved skeleton tree (directories only, additive).
    skeleton = (trees_root / profile_name) if trees_root else None
    if skeleton and skeleton.is_dir():
        for current_dir, dir_names, _files in os.walk(skeleton):
            for dir_name in dir_names:
                source = Path(current_dir) / dir_name
                relative = source.relative_to(skeleton)
                (project_root / relative).mkdir(parents=True, exist_ok=True)

    # Write the profile into the project so the dynamic organizer + Save STL/PNG
    # can resolve destinations. UTF-8 without BOM for the Rust/serde reader.
    profile["projectRoot"] = str(project_root)
    profile_out = project_root / "organize-folder.profile.json"
    profile_out.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")

    return profile


def _resolve_profile_destination(profile: dict, project_root: Path) -> Path:
    actions = _load_flowcell_actions()
    try:
        destination = actions.resolve_program_live_destination(profile, project_root, ".blend")
    except Exception:
        destination = None
    if destination:
        return Path(destination)
    # No Blender program folder claims .blend - fall back to the project root.
    return project_root


def perform_new_project(directory: str, project_name: str, profile_name: str) -> dict:
    folder = str(directory or "").strip()
    if not folder or not os.path.isdir(folder):
        return _result("CANCELLED", "Pick an existing folder for the new project first.")

    project_root = Path(folder)
    stem = _sanitize_project_name(project_name)
    selected_profile = str(profile_name or NONE_PROFILE_TOKEN).strip() or NONE_PROFILE_TOKEN

    if selected_profile == NONE_PROFILE_TOKEN:
        destination = project_root
        profile_note = ""
    else:
        profile = _apply_profile_structure(project_root, selected_profile)
        destination = _resolve_profile_destination(profile, project_root)
        profile_note = f" using profile '{selected_profile}'"

    destination.mkdir(parents=True, exist_ok=True)
    blend_path = _unique_blend_path(destination, stem)

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    return _result(
        "FINISHED",
        f"Saved new project '{blend_path.name}'{profile_note} to {destination}.",
        filepath=str(blend_path),
    )


class FLOWCELL_OT_new_project_details(bpy.types.Operator):
    bl_idname = DETAILS_OPERATOR_ID
    bl_label = "New Project"
    bl_options = {"REGISTER"}

    directory: StringProperty(default="")
    project_name: StringProperty(name="Project Name", default="")
    profile: EnumProperty(name="Profile", items=_profile_enum_items)

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self, width=380)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "project_name")
        layout.prop(self, "profile")
        info = layout.column(align=True)
        info.label(text="Folder:")
        info.label(text=self.directory or "(none)")

    def execute(self, context):
        if not str(self.project_name or "").strip():
            self.report({"WARNING"}, "Enter a project name.")
            return {"CANCELLED"}
        try:
            result = perform_new_project(self.directory, self.project_name, self.profile)
        except Exception as exc:
            self.report({"WARNING"}, f"New project failed: {exc}")
            return {"CANCELLED"}
        status = result.get("status", "FINISHED")
        message = result.get("message", "")
        if message:
            self.report({"INFO"} if status == "FINISHED" else {"WARNING"}, message)
        return {status if status in {"FINISHED", "CANCELLED"} else "FINISHED"}


class FLOWCELL_OT_new_project_pick_folder(bpy.types.Operator):
    bl_idname = PICK_OPERATOR_ID
    bl_label = "New Project - Choose Folder"
    bl_options = {"REGISTER"}

    directory: StringProperty(subtype="DIR_PATH", default="")
    filepath: StringProperty(subtype="FILE_PATH", default="")
    filter_glob: StringProperty(default="", options={"HIDDEN"})

    def invoke(self, context, event):
        last_folder = _read_last_folder()
        if last_folder:
            self.directory = last_folder if last_folder.endswith(os.sep) else last_folder + os.sep
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        folder = str(self.directory or "").strip()
        if not folder and self.filepath:
            folder = os.path.dirname(str(self.filepath))
        if not folder or not os.path.isdir(folder):
            self.report({"WARNING"}, "No folder selected for the new project.")
            return {"CANCELLED"}
        folder = os.path.normpath(folder)
        _write_last_folder(folder)
        bpy.ops.flowcell.new_project_details("INVOKE_DEFAULT", directory=folder)
        return {"FINISHED"}


_OPERATOR_CLASSES = (
    FLOWCELL_OT_new_project_details,
    FLOWCELL_OT_new_project_pick_folder,
)


def ensure_operators_registered():
    for operator_class in _OPERATOR_CLASSES:
        existing = getattr(bpy.types, operator_class.__name__, None)
        if existing is operator_class:
            continue
        if existing is not None:
            try:
                bpy.utils.unregister_class(existing)
            except Exception:
                pass
        bpy.utils.register_class(operator_class)


def run_flowcell_action(context=None, data=None):
    del context
    if data and str(data.get("directory", "") or "").strip() and str(data.get("project_name", "") or "").strip():
        return perform_new_project(
            str(data.get("directory", "")),
            str(data.get("project_name", "")),
            str(data.get("profile", "") or NONE_PROFILE_TOKEN),
        )

    ensure_operators_registered()
    bpy.ops.flowcell.new_project_pick_folder("INVOKE_DEFAULT")
    return _result("FINISHED", "New Project folder picker opened in Blender.")
