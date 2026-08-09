# Description: Save Blender in place or create a safely named project from the Save Blender page.
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

import bpy


MAX_PROJECT_NAME_LENGTH = 120
INVALID_WINDOWS_NAME_CHARS = re.compile(r'[<>:"/\\|?*]|[\x00-\x1f]')
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
FILE_ATTRIBUTE_REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x0400)


def _payload_record(data) -> dict:
    return dict(data) if isinstance(data, dict) else {}


def _absolute_path(value: str, label: str) -> Path:
    raw = str(value or "").strip().strip('"').strip()
    if not raw:
        raise ValueError(f"{label} is required.")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ValueError(f"{label} must be an absolute path.")
    return Path(os.path.abspath(str(path)))


def _path_exists(path: Path) -> bool:
    return os.path.lexists(str(path))


def _is_reparse_point(path: Path) -> bool:
    try:
        metadata = os.lstat(path)
    except OSError as exc:
        raise ValueError(f"Could not inspect '{path}': {exc}") from exc
    attributes = int(getattr(metadata, "st_file_attributes", 0) or 0)
    return bool(attributes & FILE_ATTRIBUTE_REPARSE_POINT) or stat.S_ISLNK(metadata.st_mode)


def _assert_regular_directory(path: Path, label: str) -> None:
    if not _path_exists(path):
        raise ValueError(f"{label} does not exist: {path}")
    if _is_reparse_point(path):
        raise ValueError(f"{label} cannot be a reparse point: {path}")
    if not path.is_dir():
        raise ValueError(f"{label} is not a folder: {path}")


def _normalized_path(path: Path) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def _same_path(left: Path, right: Path) -> bool:
    return _normalized_path(left) == _normalized_path(right)


def _is_within(root: Path, candidate: Path) -> bool:
    try:
        return os.path.commonpath([_normalized_path(root), _normalized_path(candidate)]) == _normalized_path(root)
    except ValueError:
        return False


def _assert_no_reparse_between(root: Path, target: Path) -> None:
    if not _is_within(root, target):
        raise ValueError(f"Save target is outside its project folder: {target}")

    _assert_regular_directory(root, "Project folder")
    relative = os.path.relpath(str(target), str(root))
    current = root
    if relative == ".":
        return
    for part in Path(relative).parts:
        current /= part
        if not _path_exists(current):
            raise ValueError(f"Prepared save folder does not exist: {current}")
        if _is_reparse_point(current):
            raise ValueError(f"Prepared save folder cannot contain a reparse point: {current}")
        if not current.is_dir():
            raise ValueError(f"Prepared save path contains a non-folder: {current}")


def _sanitize_project_name(value: str) -> str:
    name = re.sub(r"\s+", "", str(value or ""))
    name = INVALID_WINDOWS_NAME_CHARS.sub("", name).rstrip(".")
    name = name[:MAX_PROJECT_NAME_LENGTH].rstrip(".")
    if not name:
        raise ValueError("Project name must contain at least one valid filename character.")
    reserved_token = name.split(".", 1)[0].upper()
    if reserved_token in WINDOWS_RESERVED_NAMES:
        name = f"_{name}"
    return name[:MAX_PROJECT_NAME_LENGTH].rstrip(".")


def _ensure_new_project_root(parent_folder: Path, project_name: str) -> Path:
    _assert_regular_directory(parent_folder, "Parent folder")
    project_root = parent_folder / project_name

    if _path_exists(project_root):
        if _is_reparse_point(project_root):
            raise ValueError(f"Project folder cannot be a reparse point: {project_root}")
        if not project_root.is_dir():
            raise ValueError(f"Project target is not a folder: {project_root}")
        try:
            has_contents = next(project_root.iterdir(), None) is not None
        except OSError as exc:
            raise ValueError(f"Could not inspect project folder '{project_root}': {exc}") from exc
        if has_contents:
            raise ValueError(f"Project folder already exists and is not empty: {project_root}")
    else:
        try:
            project_root.mkdir()
        except OSError as exc:
            raise ValueError(f"Could not create project folder '{project_root}': {exc}") from exc

    _assert_regular_directory(project_root, "Project folder")
    return project_root


def _ensure_new_direct_project(parent_folder: Path, project_name: str) -> tuple[Path, Path]:
    project_root = _ensure_new_project_root(parent_folder, project_name)
    blender_folder = project_root / "Blender"
    try:
        blender_folder.mkdir()
    except OSError as exc:
        raise ValueError(f"Could not create Blender folder '{blender_folder}': {exc}") from exc
    _assert_regular_directory(blender_folder, "Blender folder")
    final_path = blender_folder / f"{project_name}.blend"
    return project_root, final_path


def _validate_prepared_project(
    parent_folder: Path,
    project_name: str,
    project_root_value: str,
    final_path_value: str,
) -> tuple[Path, Path]:
    _assert_regular_directory(parent_folder, "Parent folder")
    project_root = _absolute_path(project_root_value, "Prepared project folder")
    expected_root = parent_folder / project_name
    if not _same_path(project_root, expected_root):
        raise ValueError(
            f"Setup Organization returned the wrong project folder. Expected '{expected_root}', got '{project_root}'."
        )

    final_path = _absolute_path(final_path_value, "Prepared Blender path")
    if not _is_within(project_root, final_path):
        raise ValueError("Setup Organization returned a Blender path outside the project folder.")
    if final_path.name.casefold() != f"{project_name}.blend".casefold():
        raise ValueError(
            f"Setup Organization must return a Blender filename of '{project_name}.blend'."
        )
    if final_path.suffix.casefold() != ".blend":
        raise ValueError("Prepared Blender path must end with .blend.")

    _assert_no_reparse_between(project_root, final_path.parent)
    return project_root, final_path


def _validate_existing_project_target(
    file_name: str,
    project_root_value: str,
    final_path_value: str,
) -> tuple[Path, Path]:
    project_root = _absolute_path(project_root_value, "Existing project folder")
    _assert_regular_directory(project_root, "Existing project folder")
    volume_root = Path(project_root.anchor)
    if volume_root.anchor and _same_path(project_root, volume_root):
        raise ValueError("An existing Blender project cannot use a drive or share root.")

    final_path = _absolute_path(final_path_value, "Prepared Blender path")
    if not _is_within(project_root, final_path):
        raise ValueError("The prepared Blender path is outside the selected project folder.")
    if final_path.name.casefold() != f"{file_name}.blend".casefold():
        raise ValueError(f"The prepared Blender filename must be '{file_name}.blend'.")
    if final_path.suffix.casefold() != ".blend":
        raise ValueError("Prepared Blender path must end with .blend.")

    _assert_no_reparse_between(project_root, final_path.parent)
    return project_root, final_path


def _assert_new_blend_target(final_path: Path) -> None:
    if _path_exists(final_path):
        if _is_reparse_point(final_path):
            raise ValueError(f"Blender target cannot be a reparse point: {final_path}")
        raise ValueError(f"Refusing to overwrite an existing Blender file: {final_path}")


def _save_as(final_path: Path) -> None:
    result = bpy.ops.wm.save_as_mainfile(
        filepath=str(final_path),
        check_existing=False,
    )
    if result is None or "FINISHED" not in result:
        raise ValueError(f"Blender did not finish saving '{final_path}'.")


def _status() -> dict[str, object]:
    file_path = str(bpy.data.filepath or "").strip()
    saved = bool(file_path)
    return {
        "saved": saved,
        "filePath": file_path,
        "message": f"Current Blender file: {file_path}" if saved else "The current Blender file has not been saved yet.",
    }


def _save_current() -> dict[str, object]:
    file_path = str(bpy.data.filepath or "").strip()
    if not file_path:
        raise ValueError("The current Blender file has not been saved yet.")
    final_path = _absolute_path(file_path, "Current Blender path")
    _save_as(final_path)
    return {
        "saved": True,
        "finalPath": str(final_path),
        "message": f"Saved Blender file to {final_path}",
    }


def _prepare_root(data: dict) -> dict[str, object]:
    if str(bpy.data.filepath or "").strip():
        raise ValueError("This Blender file is already saved. Use Save in place instead.")
    project_name = _sanitize_project_name(str(data.get("projectName", "") or ""))
    parent_folder = _absolute_path(str(data.get("parentFolder", "") or ""), "Parent folder")
    project_root = _ensure_new_project_root(parent_folder, project_name)
    return {
        "prepared": True,
        "projectRoot": str(project_root),
        "message": f"Prepared empty project folder at {project_root}",
    }


def _save_target(data: dict) -> dict[str, object]:
    if str(bpy.data.filepath or "").strip():
        raise ValueError("This Blender file is already saved. Use Save in place instead.")

    project_name = _sanitize_project_name(str(data.get("projectName", "") or ""))
    parent_folder = _absolute_path(str(data.get("parentFolder", "") or ""), "Parent folder")
    prepared_by_profile = bool(data.get("preparedByProfile", False))

    if prepared_by_profile:
        project_root, final_path = _validate_prepared_project(
            parent_folder,
            project_name,
            str(data.get("projectRoot", "") or ""),
            str(data.get("finalPath", "") or ""),
        )
    else:
        if str(data.get("projectRoot", "") or "").strip() or str(data.get("finalPath", "") or "").strip():
            raise ValueError("Direct saves cannot supply a precomputed project or Blender path.")
        project_root, final_path = _ensure_new_direct_project(parent_folder, project_name)

    _assert_new_blend_target(final_path)
    _save_as(final_path)
    return {
        "saved": True,
        "projectRoot": str(project_root),
        "finalPath": str(final_path),
        "message": f"Saved Blender project to {final_path}",
    }


def _save_existing_target(data: dict) -> dict[str, object]:
    if str(bpy.data.filepath or "").strip():
        raise ValueError("This Blender file is already saved. Use Save in place instead.")

    file_name = _sanitize_project_name(str(data.get("fileName", "") or ""))
    project_root, final_path = _validate_existing_project_target(
        file_name,
        str(data.get("projectRoot", "") or ""),
        str(data.get("finalPath", "") or ""),
    )
    _assert_new_blend_target(final_path)
    _save_as(final_path)
    return {
        "saved": True,
        "projectRoot": str(project_root),
        "finalPath": str(final_path),
        "message": f"Added Blender file to {project_root}: {final_path}",
    }


def run_flowcell_action(context=None, data=None):
    del context
    payload = _payload_record(data)
    command = str(payload.get("command", "status") or "status").strip().casefold()
    if command == "status":
        return _status()
    if command == "save-current":
        return _save_current()
    if command == "prepare-root":
        return _prepare_root(payload)
    if command == "save-target":
        return _save_target(payload)
    if command == "save-existing-target":
        return _save_existing_target(payload)
    raise ValueError(f"Unsupported Save Blender command: {command or '[blank]'}")
