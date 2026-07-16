bl_info = {
    "name": "FlowCell",
    "author": "OpenAI Codex",
    "version": (1, 8, 16),
    "blender": (5, 0, 0),
    "location": "FlowCell bridge runtime",
    "description": "FlowCell Blender sandbox actions.",
    "category": "Object",
}

"""Blender Bridge Button Reference.

Add Button: Add another launcher button for one of the built-in Blender actions.

Style: Change launcher size, spacing, rows, and colors.

Alignment Tools: Open FlowCell alignment controls for active-object min, center, max, surface, and origin alignment.

Flatten Revolve: Flatten the active mesh into a centered profile, hide the source object, and generate revolve output in place.

Cursor Center Hole: With one hole wall face selected in Edit Mode, finds the center point and moves the 3D cursor to it.

Save STL: Export the selected mesh objects to the active organization profile's STL destination, falling back to 01 src\00 assets\03 3d.

Save PNG: Render the active selected object from the current scene camera to 01 src\00 assets\01 images as a transparent PNG cropped exactly to the visible object bounds.

Cura: Export selected mesh objects as STL files and send them to Cura.

Orca: Export selected mesh objects as STL files and send them to Orca.

Make Layers: Create Live, Snapshots, Trash, and Archive if missing.

Sort: Sort by visibility: visible objects become Live, matching invisible family objects become Snapshots as s#, and other invisible objects become Trash as t#.

Sort Live: Move every currently hidden object under Live into Trash.

Snapshot: Copy the selected objects into Snapshots as versioned s# duplicates, creating roots and buckets as needed.

Back: Move the current Live version to Trash and restore the newest matching snapshot back into Live.

Restore: Copy selected snapshot, trash, or archive objects into Live and move the current Live version to Trash first.

Baseline Visibility: Record the objects currently visible in the active view layer.

Restore Visibility: Hide every object in the active view layer except the objects recorded by Baseline Visibility.

Add to Live: Copy selected snapshot, trash, or archive objects into Live without replacing the current Live version.

Trash: Move the selected objects into Trash.

Archive: Copy the selected objects into Archive.

Empty Trash: Delete everything inside Trash.

New Collection: Prompt for a name and create a new child collection near the selected object.

Empty Collections: Delete empty collections while keeping the system roots.

Cycle Collection: Use the selected object's collection and show one direct object at a time while selecting it.

Cycle Versions: With one selected Live object, cycle Live and snapshot versions one visible object at a time.

Rename Selected Objects: Prompt for rename values and batch-rename selected Blender objects through the FlowCell bridge.
"""

import json
import importlib
import math
import os
import re
import inspect
import runpy
import tempfile
import time
import traceback
from pathlib import Path

import bmesh
import bpy
from bpy.app.handlers import persistent
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector


ROOT_STRUCTURE = ("Live", "Snapshots", "Trash", "Archive")
COPY_SUFFIX_RE = re.compile(r"\s+copy(?:\s+(?:\d+|[a-z]+))*$", re.IGNORECASE)
BLENDER_DUPLICATE_SUFFIX_RE = re.compile(r"(?:\.\d{3})+$")
NUMBERED_SLOT_RE = re.compile(r"^(?P<prefix>[sT])(?P<number>\d+)$", re.IGNORECASE)
BRIDGE_FOLDER_NAME = "blender_bridge_flowcell"
REQUEST_FILE_NAME = "request.json"
RESPONSE_FILE_NAME = "response.json"
CUSTOM_ACTIONS_FILE_NAME = "flowcell_custom_actions.json"
POLL_INTERVAL_SECONDS = 0.1
LAST_REQUEST_ID = None
LAST_BRIDGE_MESSAGE = ""
LAST_BRIDGE_DISPLAY = ""
PENDING_UNDO_BRIDGE_ACTION = ""
PENDING_UNDO_BRIDGE_DATA = {}
PENDING_UNDO_BRIDGE_RESULT = None
PENDING_UNDO_BRIDGE_ERROR = ""
READ_ONLY_BRIDGE_COMMANDS = {"status", "state", "get_state", "read_state", "query"}
VERSION_PREFIX_RE = re.compile(r"^\([sta]\d+\)", re.IGNORECASE)
TARGET_NAME_PROP = "lls_target_name"
CYCLE_INDEX_PROP = "lls_cycle_index"
VISIBILITY_BASELINE_PROP = "flowcell_visibility_baseline_objects"
CYCLE_COLLECTION_HOVER_VISIBILITY_PROP = "flowcell_cycle_collection_hover_visibility_v1"
PROJECT_THEME_RESTORE_HANDLER_KEY = "flowcell_project_theme_restore_load_post"
PROJECT_THEME_RESTORE_ATTEMPTS_KEY = "flowcell_project_theme_restore_attempts"
PROJECT_THEME_RESTORE_MAX_ATTEMPTS = 240
PROJECT_THEME_POLL_RESTORE_DONE_KEY = "flowcell_project_theme_poll_restore_done"
PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY = "flowcell_project_theme_poll_restore_attempts"
PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY = "flowcell_project_theme_poll_restore_next_time"
PROJECT_THEME_POLL_RESTORE_MAX_ATTEMPTS = 240
PROJECT_THEME_STARTUP_STATE_FILE_NAME = "flowcell_theme_startup_state_v1.json"
PROJECT_THEME_RESTORE_CAPABILITY = "restore-project-theme-state"
HIDDEN_NAME_PAD = "\u200b"
INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*]+')
FLOWCELL_LITHO_SIZE_SUFFIX_RE = re.compile(
    r"^(?P<base>.+?)__fcsize_(?P<width>\d+(?:\.\d+)?)x(?P<height>\d+(?:\.\d+)?)mm$",
    re.IGNORECASE,
)
RENDER_ISOLATION_OBJECT_TYPES = {
    "MESH",
    "CURVE",
    "SURFACE",
    "META",
    "FONT",
    "VOLUME",
    "POINTCLOUD",
    "CURVES",
    "GPENCIL",
    "GREASEPENCIL",
}
LEGACY_FLATTEN_REVOLVE_COLLECTION_NAMES = {"FR_Profiles", "FR_Extruded", "FR_Revolved"}


def normalize_family_name(name: str) -> str:
    """Match names like 'name', 'name copy', 'name copy 2', or 'name copy six'."""
    cleaned = re.sub(r"\s+", " ", name).strip()

    while cleaned:
        previous = cleaned
        cleaned = BLENDER_DUPLICATE_SUFFIX_RE.sub("", cleaned).strip()
        cleaned = COPY_SUFFIX_RE.sub("", cleaned).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        if cleaned == previous:
            break

    return (cleaned or name).casefold()


def next_numbered_child_name(parent_collection: bpy.types.Collection, prefix: str) -> str:
    highest = 0

    for child in parent_collection.children:
        match = NUMBERED_SLOT_RE.fullmatch(child.name)
        if not match:
            continue
        if match.group("prefix").lower() != prefix.lower():
            continue
        highest = max(highest, int(match.group("number")))

    return f"{prefix}{highest + 1}"


def next_collection_version_number(parent_collection: bpy.types.Collection, prefix: str) -> int:
    highest = 0
    pattern = re.compile(rf"^\({prefix}(?P<number>\d+)\)", re.IGNORECASE)

    for child in parent_collection.children:
        match = pattern.match(child.name)
        if not match:
            continue
        highest = max(highest, int(match.group("number")))

    return highest + 1


def next_object_version_number(parent_collection: bpy.types.Collection, prefix: str) -> int:
    highest = 0
    pattern = re.compile(rf"^\({prefix}(?P<number>\d+)\)", re.IGNORECASE)

    for obj in parent_collection.objects:
        match = pattern.match(obj.name)
        if not match:
            continue
        highest = max(highest, int(match.group("number")))

    return highest + 1


def reorder_versioned_objects(
    parent_collection: bpy.types.Collection,
    prefix: str,
    *,
    descending: bool,
) -> None:
    pattern = re.compile(rf"^\({prefix}(?P<number>\d+)\)", re.IGNORECASE)
    versioned_objects = []
    other_objects = []

    for obj in list(parent_collection.objects):
        match = pattern.match(obj.name)
        if match:
            versioned_objects.append((int(match.group("number")), obj))
        else:
            other_objects.append(obj)

    versioned_objects.sort(key=lambda item: item[0], reverse=descending)
    ordered_objects = [obj for _, obj in versioned_objects] + other_objects

    if not ordered_objects:
        return

    for obj in ordered_objects:
        parent_collection.objects.unlink(obj)

    for obj in ordered_objects:
        parent_collection.objects.link(obj)


def disable_outliner_alpha_sort() -> None:
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return

    for window in window_manager.windows:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue

        for area in screen.areas:
            if area.type != "OUTLINER":
                continue

            for space in area.spaces:
                if space.type == "OUTLINER":
                    try:
                        space.use_sort_alpha = False
                    except Exception:
                        pass


def format_version_label(prefix: str, number: int, name: str) -> str:
    return f"({prefix}{number}){name}"


def format_archive_label(number: int, target_name: str, source_name: str) -> str:
    source_token = extract_version_token(source_name)
    suffix = f"({source_token})" if source_token.startswith("t") else ""
    return f"(a{number}){target_name}{suffix}"


def strip_version_prefix(name: str) -> str:
    return VERSION_PREFIX_RE.sub("", name).strip()


def extract_version_token(name: str) -> str:
    match = re.match(r"^\(([sta]\d+)\)", name, re.IGNORECASE)
    return match.group(1).lower() if match else ""


def strip_hidden_name_pad(name: str) -> str:
    return name.replace(HIDDEN_NAME_PAD, "")


def sanitize_export_stem(name: str) -> str:
    cleaned = INVALID_FILENAME_CHARS_RE.sub("_", str(name or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if not cleaned:
        cleaned = "selected"
    return cleaned


def get_project_root_from_current_file() -> Path:
    blend_filepath = str(bpy.data.filepath or "").strip()
    if not blend_filepath:
        raise ValueError(
            "Save the current .blend file first so FlowCell can locate the project assets folders."
        )

    blend_path = Path(blend_filepath)
    search_roots = [blend_path.parent, *blend_path.parent.parents]
    for candidate in search_roots:
        if candidate.name.casefold() == "01 src":
            return candidate.parent

    for candidate in search_roots:
        src_root = candidate / "01 src"
        if not src_root.is_dir():
            continue
        return candidate

    raise ValueError(
        "FlowCell could not find '01 src' from the current .blend file path."
    )


def get_assets_subdirectory_from_current_file(*relative_parts: str) -> Path:
    project_root = get_project_root_from_current_file()
    assets_dir = project_root / "01 src" / "00 assets"
    for part in relative_parts:
        assets_dir /= part
    assets_dir.mkdir(parents=True, exist_ok=True)
    return assets_dir


def get_assets_3d_directory_from_current_file() -> Path:
    return get_assets_subdirectory_from_current_file("03 3d")


def normalize_profile_extension(value: object) -> str:
    extension = str(value or "").strip().lower()
    if not extension:
        return ""
    return extension if extension.startswith(".") else f".{extension}"


def normalize_profile_role_id(value: object) -> str:
    return re.sub(r"[^a-z0-9._-]+", "_", str(value or "").strip().lower()).strip("_.-")


def profile_list(value: object) -> list:
    return value if isinstance(value, list) else []


def load_organization_profile(project_root: Path) -> dict | None:
    for profile_path in (
        project_root / "organize-folder.profile.json",
        project_root / ".flowcell" / "organization-profile.json",
    ):
        if not profile_path.is_file():
            continue
        with profile_path.open("r", encoding="utf-8-sig") as handle:
            profile = json.load(handle)
        return profile if isinstance(profile, dict) else None
    return None


def path_is_under_root(path: Path, root: Path) -> bool:
    try:
        normalized_path = os.path.normcase(os.path.abspath(str(path)))
        normalized_root = os.path.normcase(os.path.abspath(str(root)))
        return os.path.commonpath([normalized_path, normalized_root]) == normalized_root
    except Exception:
        return False


def resolve_profile_folder(project_root: Path, folder: object) -> Path:
    folder_text = str(folder or "").strip()
    if not folder_text or folder_text == ".":
        return project_root
    folder_path = Path(folder_text)
    if folder_path.is_absolute():
        raise ValueError(f"Organization profile folder must be relative: {folder_text}")
    destination = project_root / folder_text.replace("\\", "/")
    if not path_is_under_root(destination, project_root):
        raise ValueError(f"Organization profile folder escapes the project root: {folder_text}")
    destination.mkdir(parents=True, exist_ok=True)
    return destination


def role_folder_for_profile(project_root: Path, role: dict) -> Path:
    folder = str(role.get("folder", "") or "").strip()
    if not folder and normalize_profile_role_id(role.get("roleId", "")) != "unknown":
        folder = normalize_profile_role_id(role.get("roleId", ""))
    return resolve_profile_folder(project_root, folder)


def unnumbered_program_folder_name(name: str) -> str:
    return re.sub(r"^\d+\s+", "", name or "").strip()


def next_program_folder_number(src_root: Path) -> int:
    numbers = []
    if src_root.is_dir():
        for child in src_root.iterdir():
            if not child.is_dir() or child.name.casefold() == "00 assets":
                continue
            match = re.match(r"^(\d+)\s+", child.name)
            if match:
                numbers.append(int(match.group(1)))
    return (max(numbers) + 1) if numbers else 1


def resolve_program_root(src_root: Path, name: str) -> Path:
    display_name = str(name or "").strip()
    if not display_name or display_name in {".", ".."} or INVALID_FILENAME_CHARS_RE.search(display_name):
        raise ValueError(f"Program folder name is not valid: {display_name or name}")
    if src_root.is_dir():
        for child in sorted((item for item in src_root.iterdir() if item.is_dir()), key=lambda item: item.name.lower()):
            if unnumbered_program_folder_name(child.name).casefold() == display_name.casefold():
                return child
    return src_root / f"{next_program_folder_number(src_root):02d} {display_name}"


def role_file_types(role: dict) -> set[str]:
    return {
        extension
        for extension in (normalize_profile_extension(raw) for raw in profile_list(role.get("fileTypes", [])))
        if extension
    }


def resolve_program_live_destination(profile: dict, project_root: Path, extension: str) -> Path | None:
    roles_by_id = {
        normalize_profile_role_id(role.get("roleId", "")): role
        for role in profile_list(profile.get("roles", []))
        if isinstance(role, dict)
    }
    matches = []
    for program in profile_list(profile.get("programFolders", [])):
        if not isinstance(program, dict):
            continue
        extensions = {
            item
            for item in (normalize_profile_extension(raw) for raw in profile_list(program.get("fileTypes", [])))
            if item
        }
        for raw_role_id in profile_list(program.get("roles", [])):
            role = roles_by_id.get(normalize_profile_role_id(raw_role_id))
            if role:
                extensions.update(role_file_types(role))
        if extension not in extensions:
            continue
        display_name = str(
            program.get("displayName")
            or program.get("folder")
            or program.get("programId")
            or "Slicer"
        ).strip()
        if display_name:
            matches.append(display_name)

    unique_matches = sorted({match.casefold(): match for match in matches}.values(), key=str.lower)
    if len(unique_matches) > 1:
        raise ValueError(
            f"STL is assigned to multiple program folders: {', '.join(unique_matches)}."
        )
    if not unique_matches:
        return None

    src_root = project_root / "01 src"
    assets_root = src_root / "00 assets"
    assets_root.mkdir(parents=True, exist_ok=True)
    program_root = resolve_program_root(src_root, unique_matches[0])
    live_directory = program_root / "01 live"
    for directory in (
        live_directory,
        program_root / "02 snapshots",
        program_root / "03 archive",
        program_root / "04 trash",
    ):
        directory.mkdir(parents=True, exist_ok=True)
    return live_directory


def resolve_role_destination(profile: dict, project_root: Path, extension: str) -> Path | None:
    roles = [role for role in profile_list(profile.get("roles", [])) if isinstance(role, dict)]
    roles_by_id = {normalize_profile_role_id(role.get("roleId", "")): role for role in roles}

    remembered_role_id = ""
    remembered_choices = profile.get("rememberedChoices")
    if isinstance(remembered_choices, dict):
        remembered = remembered_choices.get(extension)
        if isinstance(remembered, str):
            remembered_role_id = normalize_profile_role_id(remembered)
        elif isinstance(remembered, dict):
            remembered_role_id = normalize_profile_role_id(remembered.get("roleId", ""))
    if remembered_role_id and remembered_role_id in roles_by_id:
        return role_folder_for_profile(project_root, roles_by_id[remembered_role_id])

    matches = [
        role
        for role in roles
        if not bool(role.get("catchAllUnmatched", False)) and extension in role_file_types(role)
    ]
    if len(matches) == 1:
        return role_folder_for_profile(project_root, matches[0])
    if len(matches) > 1:
        role_names = ", ".join(str(role.get("displayName") or role.get("roleId") or "Role") for role in matches)
        raise ValueError(f"STL is assigned to multiple organization roles: {role_names}.")

    unknown = roles_by_id.get("unknown")
    if unknown:
        folder = str(unknown.get("folder", "") or "").strip()
        if folder and folder != ".":
            return role_folder_for_profile(project_root, unknown)

    return None


def get_stl_export_directory_from_current_profile() -> Path:
    project_root = get_project_root_from_current_file()
    profile = load_organization_profile(project_root)
    if not profile:
        return get_assets_3d_directory_from_current_file()

    extension = ".stl"
    program_destination = resolve_program_live_destination(profile, project_root, extension)
    if program_destination:
        return program_destination

    role_destination = resolve_role_destination(profile, project_root, extension)
    if role_destination:
        return role_destination

    return get_assets_3d_directory_from_current_file()


def get_assets_images_directory_from_current_file() -> Path:
    return get_assets_subdirectory_from_current_file("01 images")


def get_default_selected_stl_stem(context: bpy.types.Context) -> str:
    selected_objects = list(context.selected_objects)
    if len(selected_objects) == 1:
        selected_name = strip_hidden_name_pad(
            strip_version_prefix(selected_objects[0].name) or selected_objects[0].name
        )
        return sanitize_export_stem(selected_name)

    blend_filepath = str(bpy.data.filepath or "").strip()
    blend_stem = Path(blend_filepath).stem if blend_filepath else "selected"
    return sanitize_export_stem(f"{blend_stem}_selected")


def get_unique_export_path(folder: Path, stem: str, suffix: str) -> Path:
    candidate = folder / f"{stem}{suffix}"
    index = 2
    while candidate.exists():
        candidate = folder / f"{stem}_{index}{suffix}"
        index += 1
    return candidate


def get_overwrite_export_path(folder: Path, stem: str, suffix: str) -> Path:
    return folder / f"{stem}{suffix}"


def get_active_selected_object(context: bpy.types.Context) -> bpy.types.Object:
    active_object = getattr(context.view_layer.objects, "active", None)
    selected_objects = list(context.selected_objects)
    if active_object is None or active_object not in selected_objects:
        raise ValueError("Select one active object first.")
    return active_object


def _flowcell_signed_axis(axis: Vector) -> Vector:
    axis = axis.normalized()
    dominant_index = max(range(3), key=lambda index: abs(axis[index]))
    if axis[dominant_index] < 0:
        axis.negate()
    return axis


def _flowcell_estimate_hole_axis(seed_face) -> Vector:
    candidates = []
    seed_normal = seed_face.normal.normalized()

    for edge in seed_face.edges:
        edge_dir = (edge.verts[1].co - edge.verts[0].co)
        if edge_dir.length <= 1.0e-8:
            continue
        edge_dir.normalize()

        for linked_face in edge.link_faces:
            if linked_face == seed_face:
                continue
            linked_normal = linked_face.normal.normalized()
            normal_angle = seed_normal.angle(linked_normal, 0.0)
            if normal_angle < math.radians(2.0) or normal_angle > math.radians(75.0):
                continue

            axis = seed_normal.cross(linked_normal)
            if axis.length <= 1.0e-8:
                continue
            axis.normalize()

            if abs(axis.dot(edge_dir)) < 0.65:
                continue
            candidates.append(_flowcell_signed_axis(axis))

    if not candidates:
        raise ValueError("Could not resolve the hole-wall axis from the selected face.")

    axis_sum = Vector((0.0, 0.0, 0.0))
    for candidate in candidates:
        if axis_sum.length > 0.0 and axis_sum.dot(candidate) < 0.0:
            candidate = -candidate
        axis_sum += candidate

    if axis_sum.length <= 1.0e-8:
        raise ValueError("Could not resolve the hole-wall axis from the selected face.")
    return axis_sum.normalized()


def _flowcell_face_matches_hole_wall(face, axis: Vector) -> bool:
    normal = face.normal.normalized()
    return abs(normal.dot(axis)) <= 0.38


def _flowcell_collect_hole_wall_region(seed_face, axis: Vector) -> set:
    max_step_angle = math.radians(68.0)
    region = {seed_face}
    queue = [seed_face]

    while queue:
        face = queue.pop(0)
        for edge in face.edges:
            for linked_face in edge.link_faces:
                if linked_face == face or linked_face in region:
                    continue
                if not _flowcell_face_matches_hole_wall(linked_face, axis):
                    continue
                if face.normal.angle(linked_face.normal, 0.0) > max_step_angle:
                    continue
                region.add(linked_face)
                queue.append(linked_face)

    return region


def _flowcell_group_boundary_loops(boundary_edges: list) -> list[list]:
    unused = set(boundary_edges)
    loops = []

    while unused:
        start = unused.pop()
        component = [start]
        queue = [start]

        while queue:
            edge = queue.pop(0)
            edge_verts = set(edge.verts)
            connected = [candidate for candidate in unused if edge_verts.intersection(candidate.verts)]
            for candidate in connected:
                unused.remove(candidate)
                component.append(candidate)
                queue.append(candidate)

        loops.append(component)

    return loops


def _flowcell_loop_center(loop_edges: list) -> Vector:
    verts = []
    seen = set()
    for edge in loop_edges:
        for vert in edge.verts:
            if vert.index in seen:
                continue
            seen.add(vert.index)
            verts.append(vert)

    if len(verts) < 3:
        raise ValueError("Boundary loop has fewer than three vertices.")

    degree_by_vert = {vert.index: 0 for vert in verts}
    for edge in loop_edges:
        for vert in edge.verts:
            if vert.index in degree_by_vert:
                degree_by_vert[vert.index] += 1

    if any(degree != 2 for degree in degree_by_vert.values()):
        raise ValueError("Boundary loop is not closed.")

    center = Vector((0.0, 0.0, 0.0))
    for vert in verts:
        center += vert.co
    return center / len(verts)


def perform_cursor_center_hole(context: bpy.types.Context) -> str:
    obj = getattr(context.view_layer.objects, "active", None)
    if obj is None or obj.type != "MESH":
        raise ValueError("Active object must be a mesh.")
    if obj.mode != "EDIT":
        raise ValueError("Run Cursor Center Hole in Edit Mode.")

    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.normal_update()
    bm.faces.index_update()
    bm.verts.index_update()
    bm.edges.index_update()

    selected_faces = [face for face in bm.faces if face.select]
    if not selected_faces:
        raise ValueError("Select exactly one face on the inside wall of the hole.")
    if len(selected_faces) > 1:
        raise ValueError("Select only one face on the inside wall of the hole.")

    seed_face = selected_faces[0]
    axis = _flowcell_estimate_hole_axis(seed_face)
    if not _flowcell_face_matches_hole_wall(seed_face, axis):
        raise ValueError("The selected face does not look like a cylindrical wall face.")

    region = _flowcell_collect_hole_wall_region(seed_face, axis)
    if not region:
        raise ValueError("Could not resolve the connected hole-wall region.")

    boundary_edges = []
    for face in region:
        for edge in face.edges:
            region_face_count = sum(1 for linked_face in edge.link_faces if linked_face in region)
            if region_face_count == 1 and edge not in boundary_edges:
                boundary_edges.append(edge)

    if not boundary_edges:
        raise ValueError("No valid boundary loop was found.")

    valid_centers = []
    for loop_edges in _flowcell_group_boundary_loops(boundary_edges):
        try:
            valid_centers.append(_flowcell_loop_center(loop_edges))
        except ValueError:
            continue

    if not valid_centers:
        raise ValueError("No valid boundary loop was found.")
    if len(valid_centers) > 2:
        raise ValueError(f"Expected one or two valid boundary loops, found {len(valid_centers)}.")

    world_centers = [obj.matrix_world @ center for center in valid_centers]
    cursor = context.scene.cursor

    if len(world_centers) == 1:
        cursor.location = world_centers[0]
        return "3D cursor moved to the hole boundary loop center."

    first_center, second_center = world_centers
    axis_world = second_center - first_center
    if axis_world.length <= 1.0e-8:
        raise ValueError("The two boundary loop centers are too close to determine the hole axis.")

    cursor.location = (first_center + second_center) * 0.5
    cursor.rotation_mode = "XYZ"
    cursor.rotation_euler = axis_world.normalized().to_track_quat("Z", "Y").to_euler()
    return "3D cursor moved to the hole center and aligned to the hole axis."


def get_flowcell_alignment_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    world_matrix = obj.matrix_world
    corners = getattr(obj, "bound_box", None)
    if not corners:
        origin = world_matrix.translation.copy()
        return origin.copy(), origin.copy()

    points = [world_matrix @ Vector(corner) for corner in corners]
    mins = Vector((
        min(point.x for point in points),
        min(point.y for point in points),
        min(point.z for point in points),
    ))
    maxs = Vector((
        max(point.x for point in points),
        max(point.y for point in points),
        max(point.z for point in points),
    ))
    return mins, maxs


def get_flowcell_alignment_origin(obj: bpy.types.Object) -> Vector:
    return obj.matrix_world.translation.copy()


def offset_flowcell_object_world_axis(obj: bpy.types.Object, axis_index: int, offset: float) -> None:
    matrix = obj.matrix_world.copy()
    translation = matrix.translation.copy()
    translation[axis_index] += offset
    matrix.translation = translation
    obj.matrix_world = matrix


def restore_flowcell_alignment_selection(
    context: bpy.types.Context,
    selected_objects: list[bpy.types.Object],
    active: bpy.types.Object,
) -> None:
    selected_set = set(selected_objects)
    for obj in list(context.scene.objects):
        obj.select_set(obj in selected_set)
    if active is not None:
        context.view_layer.objects.active = active


def perform_flowcell_alignment_tool(context: bpy.types.Context, data: dict) -> dict[str, str]:
    command = str(data.get("command", "align_axis") or "align_axis").strip().lower()
    if str(data.get("tool", "") or "").strip().lower() == "flatten_revolve":
        delegated_data = dict(data)
        delegated_data["command"] = str(data.get("tool_command", command) or command)
        return perform_flowcell_flatten_revolve_tool(context, delegated_data)
    if command == "cursor_center_hole":
        return {"message": perform_cursor_center_hole(context)}
    if command == "probe":
        return {"message": "Alignment tools bridge is ready."}

    selected_objects = list(context.selected_objects)
    active = getattr(context.view_layer.objects, "active", None)
    if active is None or active not in selected_objects:
        raise ValueError("Select an active reference object and one object to move.")

    moved_objects = [obj for obj in selected_objects if obj != active]
    if not moved_objects:
        raise ValueError("Select at least one object besides the active reference object.")

    active_min, active_max = get_flowcell_alignment_bounds(active)
    active_center = (active_min + active_max) / 2.0
    active_origin = get_flowcell_alignment_origin(active)

    axis_lookup = {"X": 0, "Y": 1, "Z": 2}
    mode = str(data.get("mode", "CENTER") or "CENTER").strip().upper()
    modifier = str(data.get("modifier", "") or "").strip().upper()
    if modifier not in {"", "SURFACE", "GEOCENTER", "ORIGIN"}:
        raise ValueError(f"Unsupported alignment modifier: {modifier}")

    if command == "center_all":
        for obj in moved_objects:
            obj_min, obj_max = get_flowcell_alignment_bounds(obj)
            obj_center = (obj_min + obj_max) / 2.0
            offset = active_center - obj_center
            matrix = obj.matrix_world.copy()
            matrix.translation = matrix.translation + offset
            obj.matrix_world = matrix
        restore_flowcell_alignment_selection(context, selected_objects, active)
        return {"message": f"Centered {len(moved_objects)} object(s)."}

    axis = str(data.get("axis", "X") or "X").strip().upper()
    if axis not in axis_lookup:
        raise ValueError(f"Unsupported alignment axis: {axis}")
    if mode not in {"MIN", "CENTER", "MAX"}:
        raise ValueError(f"Unsupported alignment mode: {mode}")

    axis_index = axis_lookup[axis]
    moved_count = 0
    for obj in moved_objects:
        obj_min, obj_max = get_flowcell_alignment_bounds(obj)
        obj_center = (obj_min + obj_max) / 2.0
        obj_origin = get_flowcell_alignment_origin(obj)
        source = obj_center
        if modifier == "SURFACE":
            target = active_min[axis_index] if obj_center[axis_index] > active_center[axis_index] else active_max[axis_index]
            source = obj_min if obj_center[axis_index] <= active_center[axis_index] else obj_max
        elif modifier in {"GEOCENTER", "ORIGIN"}:
            source = obj_origin
            target = active_origin[axis_index]
        elif mode == "MIN":
            source = obj_min
            target = active_min[axis_index]
        elif mode == "MAX":
            source = obj_max
            target = active_max[axis_index]
        else:
            target = active_center[axis_index]

        offset_flowcell_object_world_axis(obj, axis_index, target - source[axis_index])
        moved_count += 1

    restore_flowcell_alignment_selection(context, selected_objects, active)
    return {"message": f"Aligned {moved_count} object(s)."}


def convex_hull_2d(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(
        origin: tuple[float, float],
        a: tuple[float, float],
        b: tuple[float, float],
    ) -> float:
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for point in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[tuple[float, float]] = []
    for point in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def get_flowcell_combined_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    if not objects:
        origin = Vector((0.0, 0.0, 0.0))
        return origin.copy(), origin.copy()

    min_vec = Vector((float("inf"), float("inf"), float("inf")))
    max_vec = Vector((-float("inf"), -float("inf"), -float("inf")))

    for obj in objects:
        obj_min, obj_max = get_flowcell_alignment_bounds(obj)
        min_vec.x = min(min_vec.x, obj_min.x)
        min_vec.y = min(min_vec.y, obj_min.y)
        min_vec.z = min(min_vec.z, obj_min.z)
        max_vec.x = max(max_vec.x, obj_max.x)
        max_vec.y = max(max_vec.y, obj_max.y)
        max_vec.z = max(max_vec.z, obj_max.z)

    return min_vec, max_vec


def get_flowcell_center_point(
    context: bpy.types.Context,
    source_obj: bpy.types.Object,
    center_mode: str,
) -> Vector:
    mode = str(center_mode or "GEOMETRY").strip().upper()
    if mode == "WORLD":
        return Vector((0.0, 0.0, 0.0))
    if mode == "CURSOR":
        return context.scene.cursor.location.copy()
    if mode == "OBJECT":
        active = getattr(context.view_layer.objects, "active", None)
        if active is not None:
            return active.matrix_world.translation.copy()
        return source_obj.matrix_world.translation.copy()

    selected_meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]
    if not selected_meshes:
        selected_meshes = [source_obj]

    if mode == "ORIGIN":
        point = Vector((0.0, 0.0, 0.0))
        for obj in selected_meshes:
            point += obj.matrix_world.translation
        return point / len(selected_meshes)

    bounds_min, bounds_max = get_flowcell_combined_bounds(selected_meshes)
    return (bounds_min + bounds_max) * 0.5


def get_flowcell_source_for_profile(
    context: bpy.types.Context,
    profile_obj: bpy.types.Object,
) -> bpy.types.Object:
    source_name = str(profile_obj.get("flowcell_source_object", "") or "").strip()
    source_obj = bpy.data.objects.get(source_name) if source_name else None
    if source_obj is not None and source_obj.type == "MESH":
        return source_obj
    return profile_obj


def active_mesh_object(context: bpy.types.Context) -> bpy.types.Object:
    obj = getattr(context.view_layer.objects, "active", None)
    if obj is None or obj.type != "MESH":
        raise ValueError("Select one active mesh object.")
    return obj


def ensure_object_mode_for_mesh_action(
    context: bpy.types.Context,
    active_obj: bpy.types.Object | None = None,
) -> None:
    current_mode = str(getattr(context, "mode", "OBJECT") or "OBJECT").strip().upper()
    if current_mode == "OBJECT":
        return

    if active_obj is None:
        active_obj = getattr(context.view_layer.objects, "active", None)
    if active_obj is None:
        raise ValueError("Select an active mesh object before running this tool.")

    context.view_layer.objects.active = active_obj
    bpy.ops.object.mode_set(mode="OBJECT")


def project_object_vertices_to_profile(
    context: bpy.types.Context,
    obj: bpy.types.Object,
    axis: str,
) -> list[Vector]:
    axis = str(axis or "Y").strip().upper()
    axis_lookup = {"X": 0, "Y": 1, "Z": 2}
    if axis not in axis_lookup:
        raise ValueError(f"Unsupported flatten axis: {axis}")

    depsgraph = context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if not mesh.vertices:
            raise ValueError(f"'{obj.name}' has no vertices to flatten.")

        source_min, source_max = get_flowcell_combined_bounds([obj])
        source_center = (source_min + source_max) * 0.5
        fixed_value = source_center[axis_lookup[axis]]

        points_2d: list[tuple[float, float]] = []
        world_matrix = evaluated.matrix_world
        for vert in mesh.vertices:
            world_co = world_matrix @ vert.co
            if axis == "X":
                points_2d.append((float(world_co.y), float(world_co.z)))
            elif axis == "Y":
                points_2d.append((float(world_co.x), float(world_co.z)))
            else:
                points_2d.append((float(world_co.x), float(world_co.y)))

        hull = convex_hull_2d(points_2d)
        if len(hull) < 3:
            raise ValueError("Not enough unique projected points to create a profile.")

        profile_points: list[Vector] = []
        for a, b in hull:
            if axis == "X":
                profile_points.append(Vector((fixed_value, a, b)))
            elif axis == "Y":
                profile_points.append(Vector((a, fixed_value, b)))
            else:
                profile_points.append(Vector((a, b, fixed_value)))
        return profile_points
    finally:
        evaluated.to_mesh_clear()


def make_unique_object_name(base_name: str) -> str:
    candidate = base_name
    index = 2
    while bpy.data.objects.get(candidate) is not None:
        candidate = f"{base_name}_{index}"
        index += 1
    return candidate


def get_flowcell_active_output_collection(context: bpy.types.Context) -> bpy.types.Collection:
    target_collection = getattr(context, "collection", None)
    if (
        target_collection is None
        or target_collection.name in LEGACY_FLATTEN_REVOLVE_COLLECTION_NAMES
    ):
        return context.scene.collection
    return target_collection


def link_object_to_active_collection(
    context: bpy.types.Context,
    obj: bpy.types.Object,
) -> None:
    target_collection = get_flowcell_active_output_collection(context)

    if obj.name not in target_collection.objects:
        target_collection.objects.link(obj)

    for collection in list(obj.users_collection):
        if collection != target_collection:
            collection.objects.unlink(obj)


def cleanup_legacy_flatten_revolve_collections(context: bpy.types.Context) -> int:
    target_collection = get_flowcell_active_output_collection(context)
    moved_count = 0
    for collection_name in sorted(LEGACY_FLATTEN_REVOLVE_COLLECTION_NAMES):
        collection = bpy.data.collections.get(collection_name)
        if collection is None:
            continue

        for obj in list(collection.objects):
            if obj.name not in target_collection.objects:
                target_collection.objects.link(obj)
            collection.objects.unlink(obj)
            moved_count += 1

        if not collection.objects and not collection.children:
            bpy.data.collections.remove(collection)

    return moved_count


def set_object_origin_preserve_world_geometry(obj: bpy.types.Object, origin: Vector) -> None:
    mesh = obj.data
    world_points = [obj.matrix_world @ vert.co for vert in mesh.vertices]
    obj.matrix_world = Matrix.Translation(origin)
    inverse = obj.matrix_world.inverted()
    for vert, world_point in zip(mesh.vertices, world_points):
        vert.co = inverse @ world_point
    mesh.update()


def create_flowcell_flatten_profile(
    context: bpy.types.Context,
    source_obj: bpy.types.Object,
    flatten_axis: str,
    center_mode: str,
) -> bpy.types.Object:
    axis = str(flatten_axis or "Y").strip().upper()
    profile_points = project_object_vertices_to_profile(context, source_obj, axis)
    origin = get_flowcell_center_point(context, source_obj, center_mode)
    local_points = [point - origin for point in profile_points]

    mesh_name = make_unique_object_name(f"{source_obj.name}_Profile_{axis}_Mesh")
    mesh = bpy.data.meshes.new(mesh_name)
    mesh.from_pydata([tuple(point) for point in local_points], [], [list(range(len(local_points)))])
    mesh.update()

    object_name = make_unique_object_name(f"{source_obj.name}_Profile_{axis}")
    profile_obj = bpy.data.objects.new(object_name, mesh)
    profile_obj.location = origin
    profile_obj["flowcell_is_flatten_profile"] = True
    profile_obj["flowcell_source_object"] = source_obj.name
    profile_obj["flowcell_flatten_axis"] = axis
    link_object_to_active_collection(context, profile_obj)

    source_obj.hide_set(True)
    source_obj.hide_render = True

    bpy.ops.object.select_all(action="DESELECT")
    profile_obj.select_set(True)
    context.view_layer.objects.active = profile_obj
    context.scene["flowcell_flatten_revolve_last_profile"] = profile_obj.name
    return profile_obj


def get_flowcell_revolve_target(
    context: bpy.types.Context,
    center_mode: str,
) -> bpy.types.Object:
    active = getattr(context.view_layer.objects, "active", None)
    selected_meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]
    mode = str(center_mode or "GEOMETRY").strip().upper()

    if mode == "OBJECT":
        if active is None:
            raise ValueError("Select an active pivot object and one mesh object to revolve.")
        revolve_targets = [obj for obj in selected_meshes if obj != active]
        if revolve_targets:
            return revolve_targets[0]
        if active.type == "MESH":
            raise ValueError("Object pivot mode uses the active object as the pivot. Select another mesh object to revolve.")
        raise ValueError("Select one mesh object to revolve besides the active pivot object.")

    if active is not None and active.type == "MESH":
        return active

    if selected_meshes:
        return selected_meshes[0]

    last_name = str(context.scene.get("flowcell_flatten_revolve_last_profile", "") or "").strip()
    target = bpy.data.objects.get(last_name) if last_name else None
    if target is not None and target.type == "MESH":
        return target

    raise ValueError("Select a mesh object to revolve.")


def apply_flowcell_revolve(
    context: bpy.types.Context,
    obj: bpy.types.Object,
    revolve_axis: str,
    center_mode: str,
    angle_deg: float,
    steps: int,
    merge_distance: float,
) -> None:
    axis = str(revolve_axis or "Z").strip().upper()
    if axis not in {"X", "Y", "Z"}:
        raise ValueError(f"Unsupported revolve axis: {axis}")

    source_obj = get_flowcell_source_for_profile(context, obj)
    origin = get_flowcell_center_point(context, source_obj, center_mode)
    set_object_origin_preserve_world_geometry(obj, origin)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    context.view_layer.objects.active = obj

    modifier = obj.modifiers.new(name="FlowCell_Revolve", type="SCREW")
    modifier.axis = axis
    modifier.angle = math.radians(float(angle_deg))
    modifier.steps = int(max(3, steps))
    modifier.render_steps = int(max(3, steps))
    modifier.use_merge_vertices = True
    modifier.merge_threshold = float(max(0.0, merge_distance))
    modifier.use_smooth_shade = True

    result = bpy.ops.object.modifier_apply(modifier=modifier.name)
    if result is None or "FINISHED" not in result:
        raise ValueError("Revolve modifier did not finish.")


def perform_flowcell_flatten_revolve_tool(context: bpy.types.Context, data: dict) -> dict[str, str]:
    command = str(data.get("command", "flatten_profile") or "flatten_profile").strip().lower()
    if command == "probe":
        return {"message": "Flatten revolve bridge is ready."}

    if command == "cleanup_legacy":
        moved_count = cleanup_legacy_flatten_revolve_collections(context)
        return {"message": f"Removed legacy FR collections and moved {moved_count} object link(s) to the active collection."}

    cleanup_legacy_flatten_revolve_collections(context)

    center_mode = str(data.get("center_mode", "GEOMETRY") or "GEOMETRY").strip().upper()
    if center_mode not in {"GEOMETRY", "ORIGIN", "WORLD", "CURSOR", "OBJECT"}:
        raise ValueError(f"Unsupported center mode: {center_mode}")

    if command == "flatten_profile":
        source_obj = active_mesh_object(context)
        ensure_object_mode_for_mesh_action(context, source_obj)
        flatten_axis = str(data.get("flatten_axis", "Y") or "Y").strip().upper()
        profile_obj = create_flowcell_flatten_profile(context, source_obj, flatten_axis, center_mode)
        return {"message": f"Created profile '{profile_obj.name}' and hid '{source_obj.name}'."}

    if command == "generate_revolve":
        target_obj = get_flowcell_revolve_target(context, center_mode)
        ensure_object_mode_for_mesh_action(context, target_obj)
        apply_flowcell_revolve(
            context,
            target_obj,
            str(data.get("revolve_axis", "Z") or "Z"),
            center_mode,
            float(data.get("angle_deg", 360.0) or 360.0),
            int(data.get("revolve_steps", 128) or 128),
            float(data.get("merge_distance", 0.0001) or 0.0001),
        )
        return {"message": f"Revolved '{target_obj.name}' in place."}

    raise ValueError(f"Unsupported flatten revolve command: {command}")


def get_object_camera_test_points(
    obj: bpy.types.Object,
    depsgraph: bpy.types.Depsgraph,
) -> list[Vector]:
    evaluated = obj.evaluated_get(depsgraph)
    world_matrix = evaluated.matrix_world.copy()
    corners = getattr(evaluated, "bound_box", None)

    points = []
    if corners:
        for corner in corners:
            points.append(world_matrix @ Vector(corner))

    if not points:
        points.append(world_matrix.translation.copy())

    center = Vector((0.0, 0.0, 0.0))
    for point in points:
        center += point
    center /= len(points)
    points.append(center)
    return points


def object_intersects_camera_view(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    obj: bpy.types.Object,
    depsgraph: bpy.types.Depsgraph,
) -> bool:
    points = get_object_camera_test_points(obj, depsgraph)
    in_front_points = []

    for point in points:
        camera_space = world_to_camera_view(scene, camera, point)
        if camera_space.z <= 0.0:
            continue
        in_front_points.append(camera_space)
        if 0.0 <= camera_space.x <= 1.0 and 0.0 <= camera_space.y <= 1.0:
            return True

    if not in_front_points:
        return False

    min_x = min(point.x for point in in_front_points)
    max_x = max(point.x for point in in_front_points)
    min_y = min(point.y for point in in_front_points)
    max_y = max(point.y for point in in_front_points)
    return not (max_x < 0.0 or min_x > 1.0 or max_y < 0.0 or min_y > 1.0)


def set_scene_object_render_isolation(
    scene: bpy.types.Scene,
    target_object: bpy.types.Object,
) -> list[tuple[bpy.types.Object, bool]]:
    hidden_states: list[tuple[bpy.types.Object, bool]] = []

    for obj in scene.objects:
        if obj == target_object:
            continue
        if obj.type not in RENDER_ISOLATION_OBJECT_TYPES:
            continue
        hidden_states.append((obj, bool(obj.hide_render)))
        obj.hide_render = True

    return hidden_states


def restore_scene_object_render_isolation(states: list[tuple[bpy.types.Object, bool]]) -> None:
    for obj, previous_hide_render in states:
        try:
            obj.hide_render = previous_hide_render
        except Exception:
            pass


def find_nontransparent_pixel_bounds(
    pixels: list[float],
    width: int,
    height: int,
) -> tuple[int, int, int, int] | None:
    min_x = width
    min_y = height
    max_x = -1
    max_y = -1

    for y in range(height):
        row_start = y * width * 4
        for x in range(width):
            alpha = pixels[row_start + (x * 4) + 3]
            if alpha <= 0.0:
                continue
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

    if max_x < min_x or max_y < min_y:
        return None

    return min_x, min_y, max_x, max_y


def crop_pixel_buffer(
    pixels: list[float],
    source_width: int,
    bounds: tuple[int, int, int, int],
) -> tuple[int, int, list[float]]:
    min_x, min_y, max_x, max_y = bounds
    cropped_width = (max_x - min_x) + 1
    cropped_height = (max_y - min_y) + 1
    cropped_pixels: list[float] = []

    for y in range(min_y, max_y + 1):
        row_start = ((y * source_width) + min_x) * 4
        row_end = row_start + (cropped_width * 4)
        cropped_pixels.extend(pixels[row_start:row_end])

    return cropped_width, cropped_height, cropped_pixels


def save_cropped_png(
    output_path: Path,
    width: int,
    height: int,
    pixels: list[float],
) -> None:
    image = bpy.data.images.new(
        name="FlowCellRenderCrop",
        width=width,
        height=height,
        alpha=True,
    )
    try:
        image.alpha_mode = "STRAIGHT"
        image.filepath_raw = str(output_path)
        image.file_format = "PNG"
        image.pixels.foreach_set(pixels)
        image.save()
    finally:
        bpy.data.images.remove(image)


def get_stl_export_scale_for_millimeters(scene: bpy.types.Scene) -> float:
    unit_settings = getattr(scene, "unit_settings", None)
    if unit_settings is None:
        return 1.0

    scale_length = float(getattr(unit_settings, "scale_length", 0.0) or 0.0)
    if scale_length <= 0.0:
        return 1.0

    # STL is unitless and slicers like Cura assume millimeters. Convert the
    # current scene's length scale from meters into millimeters explicitly.
    return scale_length / 0.001


def perform_render_active_object_png_to_images_result(
    context: bpy.types.Context,
) -> dict[str, object]:
    scene = context.scene
    camera = scene.camera
    if camera is None or camera.type != "CAMERA":
        raise ValueError("No active scene camera exists.")

    target_object = get_active_selected_object(context)
    depsgraph = context.evaluated_depsgraph_get()
    if not object_intersects_camera_view(scene, camera, target_object, depsgraph):
        raise ValueError(f"'{target_object.name}' is outside the current camera view.")

    images_dir = get_assets_images_directory_from_current_file()
    export_stem = sanitize_export_stem(
        strip_hidden_name_pad(strip_version_prefix(target_object.name) or target_object.name)
    )
    output_path = get_overwrite_export_path(images_dir, export_stem, ".png")

    render = scene.render
    image_settings = render.image_settings
    previous_filepath = str(render.filepath)
    previous_film_transparent = bool(render.film_transparent)
    previous_use_file_extension = bool(render.use_file_extension)
    previous_use_border = bool(render.use_border)
    previous_use_crop_to_border = bool(render.use_crop_to_border)
    previous_use_compositing = bool(getattr(render, "use_compositing", True))
    previous_use_sequencer = bool(getattr(render, "use_sequencer", True))
    previous_file_format = str(image_settings.file_format)
    previous_color_mode = str(image_settings.color_mode)
    previous_color_depth = str(image_settings.color_depth)
    previous_target_hide_render = bool(target_object.hide_render)

    hidden_states: list[tuple[bpy.types.Object, bool]] = []
    temp_file = tempfile.NamedTemporaryFile(prefix="flowcell_render_", suffix=".png", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()

    render_result_image = None
    loaded_image = None

    try:
        hidden_states = set_scene_object_render_isolation(scene, target_object)
        target_object.hide_render = False

        render.filepath = str(temp_path)
        render.film_transparent = True
        render.use_file_extension = True
        render.use_border = False
        render.use_crop_to_border = False
        render.use_compositing = False
        render.use_sequencer = False
        image_settings.file_format = "PNG"
        image_settings.color_mode = "RGBA"
        image_settings.color_depth = "8"

        result = bpy.ops.render.render(write_still=True, use_viewport=False)
        if result is None or "FINISHED" not in result:
            raise ValueError(f"Render did not finish for '{target_object.name}'.")

        if not temp_path.exists():
            raise ValueError("Blender did not write the rendered PNG.")

        loaded_image = bpy.data.images.load(str(temp_path), check_existing=False)
        pixels = list(loaded_image.pixels[:])
        width, height = loaded_image.size
        bounds = find_nontransparent_pixel_bounds(pixels, width, height)
        if bounds is None:
            raise ValueError(f"'{target_object.name}' is outside the current camera view.")

        cropped_width, cropped_height, cropped_pixels = crop_pixel_buffer(pixels, width, bounds)
        save_cropped_png(output_path, cropped_width, cropped_height, cropped_pixels)
    finally:
        if loaded_image is not None:
            try:
                bpy.data.images.remove(loaded_image)
            except Exception:
                pass

        restore_scene_object_render_isolation(hidden_states)
        try:
            target_object.hide_render = previous_target_hide_render
        except Exception:
            pass

        render.filepath = previous_filepath
        render.film_transparent = previous_film_transparent
        render.use_file_extension = previous_use_file_extension
        render.use_border = previous_use_border
        render.use_crop_to_border = previous_use_crop_to_border
        render.use_compositing = previous_use_compositing
        render.use_sequencer = previous_use_sequencer
        image_settings.file_format = previous_file_format
        image_settings.color_mode = previous_color_mode
        image_settings.color_depth = previous_color_depth

        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass

    return {
        "message": f"Saved PNG to {output_path}",
        "saved_path": str(output_path),
    }


def perform_render_active_object_png_to_images(
    context: bpy.types.Context,
) -> str:
    result = perform_render_active_object_png_to_images_result(context)
    return str(result.get("message", "Saved PNG."))


def perform_save_selected_stl_to_assets_result(
    context: bpy.types.Context,
    requested_name: str = "",
) -> dict[str, object]:
    if not hasattr(bpy.ops.wm, "stl_export"):
        raise ValueError("This Blender build does not expose wm.stl_export.")

    selected_objects = list(context.selected_objects)
    selected_meshes = [obj for obj in selected_objects if obj.type == "MESH"]
    if not selected_meshes:
        raise ValueError("Select at least one mesh object to export an STL.")

    export_dir = get_stl_export_directory_from_current_profile()
    export_scale = get_stl_export_scale_for_millimeters(context.scene)

    view_layer = context.view_layer
    previous_active = view_layer.objects.active
    previous_selected = list(selected_objects)
    previous_mode = str(getattr(context, "mode", "OBJECT") or "OBJECT")
    exported_paths: list[Path] = []

    try:
        if previous_mode != "OBJECT":
            if previous_active is not None:
                view_layer.objects.active = previous_active
            elif selected_meshes:
                view_layer.objects.active = selected_meshes[0]
            bpy.ops.object.mode_set(mode="OBJECT")

        result = None
        for obj in selected_meshes:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            view_layer.objects.active = obj

            export_stem = (
                sanitize_export_stem(requested_name)
                if requested_name.strip() and len(selected_meshes) == 1
                else sanitize_export_stem(strip_hidden_name_pad(strip_version_prefix(obj.name) or obj.name))
            )
            export_path = get_overwrite_export_path(export_dir, export_stem, ".stl")

            result = bpy.ops.wm.stl_export(
                filepath=str(export_path),
                check_existing=False,
                export_selected_objects=True,
                apply_modifiers=True,
                ascii_format=False,
                use_scene_unit=False,
                global_scale=export_scale,
            )
            if result is None or "FINISHED" not in result:
                raise ValueError(f"STL export did not finish for '{obj.name}'.")

            exported_paths.append(export_path)
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in previous_selected:
            try:
                obj.select_set(True)
            except Exception:
                pass
        if previous_active is not None:
            try:
                view_layer.objects.active = previous_active
            except Exception:
                pass
        if previous_mode != "OBJECT":
            try:
                bpy.ops.object.mode_set(mode=previous_mode)
            except Exception:
                pass

    exported_count = len(exported_paths)
    if exported_count == 0:
        raise ValueError("STL export did not produce any files.")

    if exported_count == 1:
        return {
            "message": f"Saved STL to {exported_paths[0]}",
            "exported_paths": [str(exported_paths[0])],
        }

    return {
        "message": f"Saved {exported_count} STL files to {export_dir}",
        "exported_paths": [str(path) for path in exported_paths],
    }


def perform_save_selected_stl_to_assets(
    context: bpy.types.Context,
    requested_name: str = "",
) -> str:
    result = perform_save_selected_stl_to_assets_result(context, requested_name)
    return str(result.get("message", "Saved STL."))


def unique_bucket_collection_name(
    desired_name: str,
    current_collection: bpy.types.Collection | None = None,
) -> str:
    existing_names = {
        collection.name
        for collection in bpy.data.collections
        if current_collection is None or collection != current_collection
    }

    candidate = desired_name
    suffix = ""
    while candidate in existing_names:
        suffix += HIDDEN_NAME_PAD
        candidate = desired_name + suffix

    return candidate


def ensure_child_collection(parent: bpy.types.Collection, name: str) -> bpy.types.Collection:
    existing = parent.children.get(name)
    if existing is not None:
        existing.hide_viewport = False
        return existing

    child = bpy.data.collections.new(name)
    child.hide_viewport = False
    parent.children.link(child)
    return child


def enforce_root_structure_order(scene_root: bpy.types.Collection) -> None:
    existing_children = list(scene_root.children)
    if len(existing_children) < 2:
        return

    live_collection = next((child for child in existing_children if child.name == "Live"), None)
    snapshots_collection = next((child for child in existing_children if child.name == "Snapshots"), None)
    if live_collection is None or snapshots_collection is None:
        return

    current_live_index = existing_children.index(live_collection)
    current_snapshots_index = existing_children.index(snapshots_collection)
    if current_snapshots_index == current_live_index + 1:
        return

    desired_order = [child for child in existing_children if child is not snapshots_collection]
    desired_live_index = desired_order.index(live_collection)
    desired_order.insert(desired_live_index + 1, snapshots_collection)

    for child in existing_children:
        scene_root.children.unlink(child)

    for child in desired_order:
        scene_root.children.link(child)


def ensure_root_structure(scene_root: bpy.types.Collection) -> dict[str, bpy.types.Collection]:
    collections = {}

    for name in ROOT_STRUCTURE:
        collections[name] = ensure_child_collection(scene_root, name)

    enforce_root_structure_order(scene_root)
    return collections


def move_collection_contents(source: bpy.types.Collection, target: bpy.types.Collection) -> None:
    for child in list(source.children):
        target.children.link(child)
        source.children.unlink(child)

    for obj in list(source.objects):
        if target.objects.get(obj.name) is None:
            target.objects.link(obj)
        source.objects.unlink(obj)


def move_object_between_collections(
    obj: bpy.types.Object,
    source: bpy.types.Collection,
    target: bpy.types.Collection,
) -> None:
    if target.objects.get(obj.name) is None:
        target.objects.link(obj)

    if source.objects.get(obj.name) is not None:
        source.objects.unlink(obj)


def remove_empty_collection(parent: bpy.types.Collection, collection: bpy.types.Collection) -> None:
    if parent.children.get(collection.name) is not None:
        parent.children.unlink(collection)

    if collection.users == 0:
        bpy.data.collections.remove(collection)


def build_collection_visibility_lookup(view_layer: bpy.types.ViewLayer) -> dict[int, bool]:
    lookup = {}

    def walk(layer_collection: bpy.types.LayerCollection, inherited_visible: bool) -> None:
        try:
            local_visible = inherited_visible and layer_collection.visible_get()
        except AttributeError:
            local_visible = (
                inherited_visible
                and not layer_collection.exclude
                and not layer_collection.hide_viewport
                and not layer_collection.collection.hide_viewport
            )

        lookup[layer_collection.collection.as_pointer()] = local_visible

        for child in layer_collection.children:
            walk(child, local_visible)

    walk(view_layer.layer_collection, True)
    return lookup


def collection_is_visible(
    collection: bpy.types.Collection,
    visibility_lookup: dict[int, bool],
) -> bool:
    return visibility_lookup.get(collection.as_pointer(), not collection.hide_viewport)


def object_is_visible(obj: bpy.types.Object, view_layer: bpy.types.ViewLayer) -> bool:
    return obj.visible_get(view_layer=view_layer)


def save_visibility_baseline(context: bpy.types.Context) -> list[str]:
    visible_names = []
    for obj in context.scene.objects:
        if object_is_visible(obj, context.view_layer):
            visible_names.append(obj.name)

    context.scene[VISIBILITY_BASELINE_PROP] = json.dumps(visible_names)
    return visible_names


def load_visibility_baseline(context: bpy.types.Context) -> set[str] | None:
    raw_value = context.scene.get(VISIBILITY_BASELINE_PROP)
    if raw_value is None:
        return None

    try:
        parsed = json.loads(str(raw_value))
    except Exception:
        return None

    if not isinstance(parsed, list):
        return None

    return {str(name) for name in parsed if isinstance(name, str) and name}


def set_object_hidden_in_view_layer(
    obj: bpy.types.Object,
    view_layer: bpy.types.ViewLayer,
    hidden: bool,
) -> None:
    try:
        obj.hide_set(hidden, view_layer=view_layer)
    except Exception:
        obj.hide_viewport = hidden


def get_object_hidden_in_view_layer(
    obj: bpy.types.Object,
    view_layer: bpy.types.ViewLayer,
) -> bool:
    try:
        return bool(obj.hide_get(view_layer=view_layer))
    except TypeError:
        try:
            return bool(obj.hide_get())
        except Exception:
            return bool(obj.hide_viewport)
    except Exception:
        return bool(obj.hide_viewport)


def save_cycle_collection_hover_visibility(context: bpy.types.Context) -> int:
    objects = []
    for obj in context.scene.objects:
        objects.append(
            {
                "name": obj.name,
                "hide_viewport": bool(obj.hide_viewport),
                "hidden": get_object_hidden_in_view_layer(obj, context.view_layer),
            }
        )

    layer_collections = []

    def collect_layer_collection_visibility(
        layer_collection: bpy.types.LayerCollection,
        parent_path: list[str],
    ) -> None:
        path = [*parent_path, layer_collection.collection.name]
        layer_collections.append(
            {
                "path": path,
                "exclude": bool(layer_collection.exclude),
                "hide_viewport": bool(layer_collection.hide_viewport),
                "collection_hide_viewport": bool(layer_collection.collection.hide_viewport),
            }
        )
        for child in layer_collection.children:
            collect_layer_collection_visibility(child, path)

    collect_layer_collection_visibility(context.view_layer.layer_collection, [])
    context.scene[CYCLE_COLLECTION_HOVER_VISIBILITY_PROP] = json.dumps(
        {
            "objects": objects,
            "layer_collections": layer_collections,
        }
    )
    return len(objects)


def load_cycle_collection_hover_visibility(
    context: bpy.types.Context,
) -> dict[str, list[dict]] | None:
    raw_value = context.scene.get(CYCLE_COLLECTION_HOVER_VISIBILITY_PROP)
    if raw_value is None:
        return None

    try:
        parsed = json.loads(str(raw_value))
    except Exception:
        return None

    if not isinstance(parsed, dict):
        return None

    objects = parsed.get("objects")
    if not isinstance(objects, list):
        return None

    layer_collections = parsed.get("layer_collections", [])
    if not isinstance(layer_collections, list):
        layer_collections = []

    return {
        "objects": [record for record in objects if isinstance(record, dict)],
        "layer_collections": [
            record for record in layer_collections if isinstance(record, dict)
        ],
    }


def clear_cycle_collection_hover_visibility(context: bpy.types.Context) -> None:
    try:
        del context.scene[CYCLE_COLLECTION_HOVER_VISIBILITY_PROP]
    except Exception:
        pass


def reveal_collection_in_view_layer(
    context: bpy.types.Context,
    target_collection: bpy.types.Collection | None,
) -> bool:
    if target_collection is None:
        return False

    target_collection.hide_viewport = False
    found = False

    def walk(
        layer_collection: bpy.types.LayerCollection,
        path: list[bpy.types.LayerCollection],
    ) -> None:
        nonlocal found
        current_path = [*path, layer_collection]
        if layer_collection.collection == target_collection:
            for path_item in current_path:
                try:
                    path_item.exclude = False
                except Exception:
                    pass
                try:
                    path_item.hide_viewport = False
                except Exception:
                    pass
                try:
                    path_item.collection.hide_viewport = False
                except Exception:
                    pass
            found = True

        for child in layer_collection.children:
            walk(child, current_path)

    walk(context.view_layer.layer_collection, [])
    return found


def reveal_object_collection_paths(
    context: bpy.types.Context,
    obj: bpy.types.Object,
) -> None:
    for collection in obj.users_collection:
        reveal_collection_in_view_layer(context, collection)


def ensure_named_bucket(parent: bpy.types.Collection, name: str) -> bpy.types.Collection:
    for child in parent.children:
        stored_name = child.get(TARGET_NAME_PROP)
        if stored_name == name or strip_hidden_name_pad(child.name) == name:
            child[TARGET_NAME_PROP] = name
            desired_internal_name = unique_bucket_collection_name(name, child)
            if child.name != desired_internal_name:
                child.name = desired_internal_name
            child.hide_viewport = False
            return child

    bucket = bpy.data.collections.new(unique_bucket_collection_name(name))
    parent.children.link(bucket)
    bucket[TARGET_NAME_PROP] = name
    bucket.hide_viewport = False
    return bucket


def build_collection_parent_map(root: bpy.types.Collection) -> dict[int, bpy.types.Collection]:
    parent_map = {}

    def walk(parent: bpy.types.Collection) -> None:
        for child in parent.children:
            parent_map[child.as_pointer()] = parent
            walk(child)

    walk(root)
    return parent_map


def collection_is_under_root(
    collection: bpy.types.Collection,
    root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> bool:
    current = collection

    while current is not None:
        if current == root:
            return True
        current = parent_map.get(current.as_pointer())

    return False


def object_is_exclusively_in_root(
    obj: bpy.types.Object,
    root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> bool:
    if not obj.users_collection:
        return False

    return all(collection_is_under_root(collection, root, parent_map) for collection in obj.users_collection)


def object_is_in_root(
    obj: bpy.types.Object,
    root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> bool:
    if not obj.users_collection:
        return False

    return any(collection_is_under_root(collection, root, parent_map) for collection in obj.users_collection)


def collect_sort_candidate_objects(
    scene: bpy.types.Scene,
    archive_root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> list[bpy.types.Object]:
    result = []

    for obj in scene.objects:
        if object_is_exclusively_in_root(obj, archive_root, parent_map):
            continue
        result.append(obj)

    return result


def move_object_to_target(
    obj: bpy.types.Object,
    target: bpy.types.Collection,
    archive_root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> None:
    if target.objects.get(obj.name) is None:
        target.objects.link(obj)

    for collection in list(obj.users_collection):
        if collection == target:
            continue
        if collection_is_under_root(collection, archive_root, parent_map):
            continue
        collection.objects.unlink(obj)


def prune_empty_collections(
    parent: bpy.types.Collection,
    skip_names: set[str] | None = None,
) -> None:
    skip_names = skip_names or set()

    for child in list(parent.children):
        prune_empty_collections(child, skip_names=None)

        if child.name in skip_names:
            continue

        if child.children or child.objects:
            continue

        parent.children.unlink(child)
        if child.users == 0:
            bpy.data.collections.remove(child)


def duplicate_object_for_snapshot(obj: bpy.types.Object) -> bpy.types.Object:
    duplicate = obj.copy()

    if obj.data is not None:
        duplicate.data = obj.data.copy()

    if obj.animation_data:
        duplicate.animation_data_clear()

    return duplicate


def set_object_live_state(
    obj: bpy.types.Object,
    context: bpy.types.Context,
    *,
    hidden: bool,
    render_hidden: bool,
) -> None:
    obj.hide_viewport = False
    obj.hide_render = render_hidden
    obj.hide_set(hidden, view_layer=context.view_layer)


def find_bucket_under_root(
    collection: bpy.types.Collection,
    root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> bpy.types.Collection | None:
    current = collection

    while current is not None:
        parent = parent_map.get(current.as_pointer())
        if parent is None:
            return None
        if parent == root:
            return current
        current = parent

    return None


def get_target_name_for_object(
    obj: bpy.types.Object,
    root_collections: dict[str, bpy.types.Collection],
    parent_map: dict[int, bpy.types.Collection],
) -> str:
    for root_name in ("Snapshots", "Trash", "Archive"):
        root = root_collections[root_name]
        for collection in obj.users_collection:
            bucket = find_bucket_under_root(collection, root, parent_map)
            if bucket is not None:
                # For versioned objects inside Snapshots/Trash/Archive, trust the
                # visible object name first so stale stored metadata cannot send
                # "(t1)Cylinder.072" back to an older target like "Cylinder.070".
                visible_name = strip_version_prefix(obj.name)
                if visible_name:
                    return visible_name
                stored_bucket_name = bucket.get(TARGET_NAME_PROP)
                if isinstance(stored_bucket_name, str) and stored_bucket_name.strip():
                    return stored_bucket_name.strip()
                return strip_version_prefix(bucket.name) or bucket.name

    stored_name = obj.get(TARGET_NAME_PROP)
    if isinstance(stored_name, str) and stored_name.strip():
        return stored_name.strip()

    return strip_version_prefix(obj.name) or obj.name


def collection_depth(
    collection: bpy.types.Collection,
    scene_root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> int:
    depth = 0
    current = collection

    while current is not None and current != scene_root:
        current = parent_map.get(current.as_pointer())
        if current is None:
            break
        depth += 1

    return depth


def get_cycle_collection(
    context: bpy.types.Context,
    parent_map: dict[int, bpy.types.Collection],
) -> bpy.types.Collection | None:
    scene_root = context.scene.collection
    target_object = context.active_object or (context.selected_objects[0] if context.selected_objects else None)
    if target_object is None:
        return None

    candidate_collections = [
        collection
        for collection in target_object.users_collection
        if collection != scene_root
    ]
    if not candidate_collections:
        return None

    candidate_collections.sort(
        key=lambda collection: collection_depth(collection, scene_root, parent_map),
        reverse=True,
    )
    return candidate_collections[0]


def find_live_object(
    live_collection: bpy.types.Collection,
    target_name: str,
) -> bpy.types.Object | None:
    exact_match = None
    family_match = None
    target_family = normalize_family_name(target_name)

    for obj in live_collection.objects:
        object_name = strip_version_prefix(obj.name) or obj.name
        if object_name == target_name and exact_match is None:
            exact_match = obj
        if normalize_family_name(object_name) == target_family and family_match is None:
            family_match = obj

    return exact_match or family_match


def find_named_bucket(
    root_collection: bpy.types.Collection,
    target_name: str,
) -> bpy.types.Collection | None:
    for child in root_collection.children:
        stored_name = child.get(TARGET_NAME_PROP)
        if isinstance(stored_name, str) and stored_name.strip() == target_name:
            return child
        if strip_hidden_name_pad(child.name) == target_name:
            return child
    return None


def find_latest_version_object(
    bucket: bpy.types.Collection | None,
    prefix: str,
) -> bpy.types.Object | None:
    if bucket is None:
        return None

    latest = None
    latest_number = -1
    pattern = re.compile(rf"^\({prefix}(?P<number>\d+)\)", re.IGNORECASE)

    for obj in bucket.objects:
        match = pattern.match(obj.name)
        if not match:
            continue
        number = int(match.group("number"))
        if number > latest_number:
            latest_number = number
            latest = obj

    return latest


def get_version_cycle_items(
    live_collection: bpy.types.Collection,
    snapshots_collection: bpy.types.Collection,
    target_name: str,
) -> list[tuple[str, bpy.types.Object]]:
    items = []
    live_object = find_live_object(live_collection, target_name)
    if live_object is not None:
        items.append(("live", live_object))

    snapshot_bucket = find_named_bucket(snapshots_collection, target_name)
    if snapshot_bucket is not None:
        pattern = re.compile(r"^\(s(?P<number>\d+)\)", re.IGNORECASE)
        snapshot_items = []
        for obj in snapshot_bucket.objects:
            match = pattern.match(obj.name)
            if not match:
                continue
            snapshot_items.append((int(match.group("number")), obj))

        snapshot_items.sort(key=lambda item: item[0], reverse=True)
        items.extend((f"s{number}", obj) for number, obj in snapshot_items)

    return items


def move_object_to_version_bucket(
    obj: bpy.types.Object,
    bucket_parent: bpy.types.Collection,
    prefix: str,
    target_name: str,
    archive_root: bpy.types.Collection,
    parent_map: dict[int, bpy.types.Collection],
) -> bpy.types.Collection:
    bucket = ensure_named_bucket(bucket_parent, target_name)
    obj[TARGET_NAME_PROP] = target_name
    obj.name = format_version_label(prefix, next_object_version_number(bucket, prefix), target_name)
    move_object_to_target(obj, bucket, archive_root, parent_map)
    return bucket


def duplicate_object_to_bucket(
    source_obj: bpy.types.Object,
    bucket_parent: bpy.types.Collection,
    prefix: str,
    target_name: str,
    context: bpy.types.Context,
    *,
    hidden: bool,
    render_hidden: bool,
) -> bpy.types.Object:
    bucket = ensure_named_bucket(bucket_parent, target_name)
    duplicate = duplicate_object_for_snapshot(source_obj)
    duplicate[TARGET_NAME_PROP] = target_name
    version_number = next_object_version_number(bucket, prefix)
    if prefix == "a":
        duplicate.name = format_archive_label(version_number, target_name, source_obj.name)
    else:
        duplicate.name = format_version_label(prefix, version_number, target_name)
    bucket.objects.link(duplicate)
    if prefix == "s":
        reorder_versioned_objects(bucket, "s", descending=True)
    set_object_live_state(duplicate, context, hidden=hidden, render_hidden=render_hidden)
    return duplicate


def duplicate_object_to_live(
    source_obj: bpy.types.Object,
    live_collection: bpy.types.Collection,
    target_name: str,
    context: bpy.types.Context,
) -> bpy.types.Object:
    duplicate = duplicate_object_for_snapshot(source_obj)
    duplicate[TARGET_NAME_PROP] = target_name
    duplicate.name = target_name
    live_collection.objects.link(duplicate)
    set_object_live_state(duplicate, context, hidden=False, render_hidden=False)
    return duplicate


def unique_child_collection_name(parent: bpy.types.Collection, base_name: str) -> str:
    candidate = base_name
    suffix = 2

    while parent.children.get(candidate) is not None:
        candidate = f"{base_name} {suffix}"
        suffix += 1

    return candidate


def dedupe_selected_targets(
    selected_objects: list[bpy.types.Object],
    root_collections: dict[str, bpy.types.Collection],
    parent_map: dict[int, bpy.types.Collection],
) -> list[tuple[str, bpy.types.Object]]:
    deduped = []
    seen = set()

    for obj in selected_objects:
        target_name = get_target_name_for_object(obj, root_collections, parent_map)
        key = target_name.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append((target_name, obj))

    return deduped


def delete_object_and_data_if_possible(obj: bpy.types.Object) -> None:
    object_data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)

    try:
        if object_data is not None and object_data.users == 0:
            object_data.user_clear()
    except Exception:
        pass


def clear_collection_recursive(collection: bpy.types.Collection) -> tuple[int, int]:
    object_count = 0
    child_count = 0

    for child in list(collection.children):
        nested_objects, nested_children = clear_collection_recursive(child)
        object_count += nested_objects
        child_count += nested_children
        collection.children.unlink(child)
        if child.users == 0:
            bpy.data.collections.remove(child)
        child_count += 1

    for obj in list(collection.objects):
        delete_object_and_data_if_possible(obj)
        object_count += 1

    return object_count, child_count


def perform_sort(context: bpy.types.Context) -> str:
    disable_outliner_alpha_sort()
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    snapshots_collection = root_collections["Snapshots"]
    trash_collection = root_collections["Trash"]
    archive_collection = root_collections["Archive"]

    parent_map = build_collection_parent_map(scene_root)
    source_objects = collect_sort_candidate_objects(context.scene, archive_collection, parent_map)
    if not source_objects:
        return "No sortable scene objects found."

    live_count = 0
    snapshot_count = 0
    trash_count = 0
    family_to_live_name = {}

    # Visible objects become the live/original version and are linked directly under Live.
    for obj in source_objects:
        if not object_is_visible(obj, context.view_layer):
            continue

        move_object_to_target(obj, live_collection, archive_collection, parent_map)
        obj[TARGET_NAME_PROP] = obj.name
        family_to_live_name.setdefault(normalize_family_name(obj.name), obj.name)
        live_count += 1

    # Invisible objects never go into Live.
    # If an invisible object's family matches a visible live object, it becomes:
    # Snapshots > exact visible live name > (sN)originalInvisibleName
    # Otherwise it becomes:
    # Trash > originalInvisibleName > (tN)originalInvisibleName
    for obj in source_objects:
        if object_is_visible(obj, context.view_layer):
            continue

        family_key = normalize_family_name(obj.name)
        live_name = family_to_live_name.get(family_key)

        if live_name:
            snapshot_family = ensure_named_bucket(snapshots_collection, live_name)
            obj[TARGET_NAME_PROP] = live_name
            obj.name = format_version_label(
                "s",
                next_object_version_number(snapshot_family, "s"),
                live_name,
            )
            move_object_to_target(obj, snapshot_family, archive_collection, parent_map)
            reorder_versioned_objects(snapshot_family, "s", descending=True)
            snapshot_count += 1
            continue

        trash_family = ensure_named_bucket(trash_collection, obj.name)
        obj[TARGET_NAME_PROP] = obj.name
        obj.name = format_version_label(
            "t",
            next_object_version_number(trash_family, "t"),
            obj.name,
        )
        move_object_to_target(obj, trash_family, archive_collection, parent_map)
        trash_count += 1

    prune_empty_collections(live_collection)
    prune_empty_collections(snapshots_collection)
    prune_empty_collections(trash_collection)
    prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))

    return f"Sorted {live_count} live, {snapshot_count} snapshots, {trash_count} trash."


def perform_snapshot(context: bpy.types.Context) -> str:
    disable_outliner_alpha_sort()
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    snapshots_collection = root_collections["Snapshots"]
    parent_map = build_collection_parent_map(scene_root)

    selected_objects = list(context.selected_objects)
    if not selected_objects:
        return "No selected objects to snapshot."

    snapshot_count = 0

    for obj in selected_objects:
        target_name = get_target_name_for_object(obj, root_collections, parent_map)
        snapshot_family = ensure_named_bucket(snapshots_collection, target_name)
        snapshot_name = format_version_label(
            "s",
            next_object_version_number(snapshot_family, "s"),
            target_name,
        )

        duplicate = duplicate_object_for_snapshot(obj)
        duplicate[TARGET_NAME_PROP] = target_name
        duplicate.name = snapshot_name
        duplicate.hide_viewport = False
        duplicate.hide_render = True
        snapshot_family.objects.link(duplicate)
        reorder_versioned_objects(snapshot_family, "s", descending=True)
        duplicate.hide_set(True, view_layer=context.view_layer)
        snapshot_count += 1

    return f"Saved {snapshot_count} snapshot object(s)."


def perform_make_layers(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    archive_collection = root_collections["Archive"]
    parent_map = build_collection_parent_map(scene_root)
    moved_to_live = 0

    for obj in list(context.scene.objects):
        if not object_is_visible(obj, context.view_layer):
            continue
        if object_is_exclusively_in_root(obj, archive_collection, parent_map):
            continue
        if not object_is_in_root(obj, live_collection, parent_map):
            moved_to_live += 1
        move_object_to_target(obj, live_collection, archive_collection, parent_map)
        obj[TARGET_NAME_PROP] = strip_version_prefix(obj.name) or obj.name

    return (
        "Ensured Live, Snapshots, Trash, and Archive. "
        f"Moved {moved_to_live} visible object(s) to Live."
    )


def perform_sort_live(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    trash_collection = root_collections["Trash"]
    archive_collection = root_collections["Archive"]
    parent_map = build_collection_parent_map(scene_root)
    hidden_live_objects = []
    seen_objects = set()

    for obj in context.scene.objects:
        object_id = obj.as_pointer()
        if object_id in seen_objects:
            continue
        seen_objects.add(object_id)

        if not object_is_in_root(obj, live_collection, parent_map):
            continue
        if object_is_visible(obj, context.view_layer):
            continue
        hidden_live_objects.append(obj)

    if not hidden_live_objects:
        return "Live has no hidden objects to move to Trash."

    moved = 0
    for obj in hidden_live_objects:
        target_name = get_target_name_for_object(obj, root_collections, parent_map)
        move_object_to_version_bucket(
            obj,
            trash_collection,
            "t",
            target_name,
            archive_collection,
            parent_map,
        )
        moved += 1

    prune_empty_collections(trash_collection)
    prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
    return f"Moved {moved} hidden Live object(s) to Trash."


def perform_trash(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    trash_collection = root_collections["Trash"]
    archive_collection = root_collections["Archive"]
    parent_map = build_collection_parent_map(scene_root)
    targets = list(context.selected_objects)

    if not targets:
        return "No selected objects to trash."

    moved = 0
    skipped_archive = 0

    for target_name, obj in dedupe_selected_targets(targets, root_collections, parent_map):
        if object_is_in_root(obj, archive_collection, parent_map):
            skipped_archive += 1
            continue

        move_object_to_version_bucket(
            obj,
            trash_collection,
            "t",
            target_name,
            archive_collection,
            parent_map,
        )
        moved += 1

    prune_empty_collections(trash_collection)
    prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))

    if moved == 0 and skipped_archive > 0:
        return "Skipped trash: selected objects were in Archive."

    if skipped_archive > 0:
        return f"Moved {moved} object(s) to Trash. Skipped {skipped_archive} archived object(s)."

    return f"Moved {moved} object(s) to Trash."


def perform_archive(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    archive_collection = root_collections["Archive"]
    parent_map = build_collection_parent_map(scene_root)
    targets = list(context.selected_objects)

    if not targets:
        return "No selected objects to archive."

    archived = 0

    for target_name, obj in dedupe_selected_targets(targets, root_collections, parent_map):
        duplicate_object_to_bucket(
            obj,
            archive_collection,
            "a",
            target_name,
            context,
            hidden=False,
            render_hidden=False,
        )
        archived += 1

    return f"Archived {archived} object(s)."


def perform_restore(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    trash_collection = root_collections["Trash"]
    archive_collection = root_collections["Archive"]
    parent_map = build_collection_parent_map(scene_root)
    targets = list(context.selected_objects)

    if not targets:
        return "No selected objects to restore."

    restored = 0

    for target_name, source_obj in dedupe_selected_targets(targets, root_collections, parent_map):
        current_live = find_live_object(live_collection, target_name)
        if current_live is not None:
            move_object_to_version_bucket(
                current_live,
                trash_collection,
                "t",
                target_name,
                archive_collection,
                parent_map,
            )

        duplicate_object_to_live(source_obj, live_collection, target_name, context)
        restored += 1

    prune_empty_collections(trash_collection)
    prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
    return f"Restored {restored} object(s) into Live."


def perform_baseline_visibility(context: bpy.types.Context) -> str:
    visible_names = save_visibility_baseline(context)
    return f"Recorded {len(visible_names)} visible object(s)."


def perform_cycle_collection_hover_save_visibility(context: bpy.types.Context) -> str:
    object_count = save_cycle_collection_hover_visibility(context)
    return f"Captured cycle collection hover visibility for {object_count} object(s)."


def perform_cycle_collection_hover_clear_visibility(context: bpy.types.Context) -> str:
    had_snapshot = context.scene.get(CYCLE_COLLECTION_HOVER_VISIBILITY_PROP) is not None
    clear_cycle_collection_hover_visibility(context)
    if had_snapshot:
        return "Cleared the cycle collection hover visibility snapshot."
    return "No cycle collection hover visibility snapshot was recorded."


def perform_cycle_collection_hover_restore_visibility(context: bpy.types.Context) -> str:
    snapshot = load_cycle_collection_hover_visibility(context)
    if snapshot is None:
        return "No cycle collection hover visibility snapshot is recorded."

    scene_objects = list(context.scene.objects)
    objects_by_name = {obj.name: obj for obj in scene_objects}
    restored_objects = 0
    missing_objects = 0

    for record in snapshot["objects"]:
        name = record.get("name")
        if not isinstance(name, str) or not name:
            continue

        obj = objects_by_name.get(name)
        if obj is None:
            missing_objects += 1
            continue

        obj.hide_viewport = bool(record.get("hide_viewport", False))
        set_object_hidden_in_view_layer(obj, context.view_layer, bool(record.get("hidden", False)))
        restored_objects += 1

    layer_collections_by_path = {}

    def index_layer_collections(
        layer_collection: bpy.types.LayerCollection,
        parent_path: tuple[str, ...],
    ) -> None:
        path = (*parent_path, layer_collection.collection.name)
        layer_collections_by_path[path] = layer_collection
        for child in layer_collection.children:
            index_layer_collections(child, path)

    index_layer_collections(context.view_layer.layer_collection, ())
    restored_layer_collections = 0
    missing_layer_collections = 0

    for record in snapshot["layer_collections"]:
        path = record.get("path")
        if not isinstance(path, list) or not all(isinstance(name, str) for name in path):
            continue

        layer_collection = layer_collections_by_path.get(tuple(path))
        if layer_collection is None:
            missing_layer_collections += 1
            continue

        try:
            layer_collection.collection.hide_viewport = bool(
                record.get("collection_hide_viewport", False)
            )
        except Exception:
            pass
        try:
            layer_collection.exclude = bool(record.get("exclude", False))
        except Exception:
            pass
        try:
            layer_collection.hide_viewport = bool(record.get("hide_viewport", False))
        except Exception:
            pass
        restored_layer_collections += 1

    try:
        context.view_layer.update()
    except Exception:
        pass

    message = (
        "Restored cycle collection visibility for "
        f"{restored_objects} object(s) and {restored_layer_collections} collection path(s)."
    )
    if missing_objects > 0 or missing_layer_collections > 0:
        message += (
            f" Missing {missing_objects} saved object(s) and "
            f"{missing_layer_collections} saved collection path(s)."
        )
    return message


def perform_restore_visibility(context: bpy.types.Context) -> str:
    baseline_names = load_visibility_baseline(context)
    if baseline_names is None:
        return "No visibility baseline is recorded."

    scene_objects = list(context.scene.objects)
    objects_by_name = {obj.name: obj for obj in scene_objects}
    baseline_objects = [objects_by_name[name] for name in baseline_names if name in objects_by_name]
    baseline_ids = {obj.as_pointer() for obj in baseline_objects}

    for obj in scene_objects:
        if obj.as_pointer() in baseline_ids:
            continue
        set_object_hidden_in_view_layer(obj, context.view_layer, True)

    for obj in baseline_objects:
        reveal_object_collection_paths(context, obj)
        obj.hide_viewport = False
        set_object_hidden_in_view_layer(obj, context.view_layer, False)

    try:
        context.view_layer.update()
    except Exception:
        pass

    missing_count = len(baseline_names) - len(baseline_objects)
    if missing_count > 0:
        return f"Restored {len(baseline_objects)} visible object(s). Missing {missing_count} saved object(s)."
    return f"Restored {len(baseline_objects)} visible object(s)."


def perform_back(context: bpy.types.Context) -> str:
    disable_outliner_alpha_sort()
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    snapshots_collection = root_collections["Snapshots"]
    trash_collection = root_collections["Trash"]
    archive_collection = root_collections["Archive"]
    parent_map = build_collection_parent_map(scene_root)
    targets = list(context.selected_objects)

    if not targets:
        return "No selected objects for Back."

    restored = 0
    restored_objects = []

    for target_name, _ in dedupe_selected_targets(targets, root_collections, parent_map):
        snapshot_bucket = find_named_bucket(snapshots_collection, target_name)
        latest_snapshot = find_latest_version_object(snapshot_bucket, "s")
        if latest_snapshot is None:
            continue

        current_live = find_live_object(live_collection, target_name)
        if current_live is not None:
            move_object_to_version_bucket(
                current_live,
                trash_collection,
                "t",
                target_name,
                archive_collection,
                parent_map,
            )

        restored_live = duplicate_object_to_live(latest_snapshot, live_collection, target_name, context)
        restored_objects.append(restored_live)
        delete_object_and_data_if_possible(latest_snapshot)
        restored += 1

    prune_empty_collections(snapshots_collection)
    prune_empty_collections(trash_collection)
    prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))

    if restored_objects:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in restored_objects:
            obj.select_set(True)
        context.view_layer.objects.active = restored_objects[-1]

    return f"Back restored {restored} object(s)."


def perform_empty_trash(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    trash_collection = root_collections["Trash"]
    object_count, child_count = clear_collection_recursive(trash_collection)
    prune_empty_collections(trash_collection)
    return f"Emptied Trash: removed {object_count} object(s) and {child_count} collection(s)."


def perform_add_to_live(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    selected_objects = list(context.selected_objects)

    if not selected_objects:
        return "No selected objects to add to Live."

    added = 0

    for obj in selected_objects:
        target_name = get_target_name_for_object(
            obj,
            root_collections,
            build_collection_parent_map(scene_root),
        )
        version_token = extract_version_token(obj.name)
        live_name = f"{target_name}({version_token})" if version_token else target_name
        duplicate_object_to_live(obj, live_collection, live_name, context)
        added += 1

    return f"Added {added} object(s) to Live."


def perform_new_collection(context: bpy.types.Context, requested_name: str) -> str:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    selected_objects = list(context.selected_objects)
    parent_collection = scene_root

    if selected_objects:
        selected_object = selected_objects[0]
        for collection in selected_object.users_collection:
            if collection.name not in ROOT_STRUCTURE:
                parent_collection = collection
                break
        else:
            for root_name in ("Live", "Snapshots", "Trash", "Archive"):
                system_root = root_collections[root_name]
                for collection in selected_object.users_collection:
                    if collection == system_root:
                        parent_collection = system_root
                        break

    cleaned_name = requested_name.strip() if requested_name else ""
    if not cleaned_name:
        cleaned_name = "Collection"

    new_collection = bpy.data.collections.new(
        unique_child_collection_name(parent_collection, cleaned_name)
    )
    parent_collection.children.link(new_collection)
    new_collection.hide_viewport = False
    return f"Created collection '{new_collection.name}'."


def perform_empty_collections(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    before = len(bpy.data.collections)
    prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
    after = len(bpy.data.collections)
    removed = max(before - after, 0)
    return f"Removed {removed} empty collection(s)."


def perform_cycle_collection(context: bpy.types.Context) -> str:
    scene_root = context.scene.collection
    parent_map = build_collection_parent_map(scene_root)
    target_collection = get_cycle_collection(context, parent_map)

    if target_collection is None:
        return "Select an object in a collection to cycle."

    collection_objects = list(target_collection.objects)
    if not collection_objects:
        return f"Collection '{target_collection.name}' has no direct objects."

    current_index = int(target_collection.get(CYCLE_INDEX_PROP, -1))
    next_index = (current_index + 1) % len(collection_objects)
    next_object = collection_objects[next_index]

    reveal_collection_in_view_layer(context, target_collection)
    reveal_object_collection_paths(context, next_object)

    for obj in collection_objects:
        obj.hide_viewport = False
        obj.hide_set(obj != next_object, view_layer=context.view_layer)

    next_object.hide_viewport = False
    next_object.hide_set(False, view_layer=context.view_layer)
    try:
        context.view_layer.update()
    except Exception:
        pass

    bpy.ops.object.select_all(action="DESELECT")
    next_object.select_set(True)
    context.view_layer.objects.active = next_object
    target_collection[CYCLE_INDEX_PROP] = next_index

    return f"Cycled '{target_collection.name}' to '{next_object.name}'."


def perform_cycle_live_versions(
    context: bpy.types.Context,
    direction: str = "forward",
) -> dict[str, str]:
    scene_root = context.scene.collection
    root_collections = ensure_root_structure(scene_root)
    live_collection = root_collections["Live"]
    snapshots_collection = root_collections["Snapshots"]
    parent_map = build_collection_parent_map(scene_root)
    selected_objects = list(context.selected_objects)

    if len(selected_objects) != 1:
        return {
            "message": "Select exactly one object from Live or its snapshots.",
            "display": "",
        }

    step = -1 if str(direction).strip().lower() == "backward" else 1

    selected_object = selected_objects[0]
    in_live = object_is_in_root(selected_object, live_collection, parent_map)
    in_snapshots = object_is_in_root(selected_object, snapshots_collection, parent_map)
    if not in_live and not in_snapshots:
        return {
            "message": "Select one Live object or one of its snapshots.",
            "display": "",
        }

    target_name = get_target_name_for_object(selected_object, root_collections, parent_map)
    version_items = get_version_cycle_items(live_collection, snapshots_collection, target_name)
    snapshot_bucket = find_named_bucket(snapshots_collection, target_name)
    if not version_items:
        return {
            "message": f"No Live or snapshot versions found for '{target_name}'.",
            "display": "",
        }

    current_index = -1
    visible_indexes = [
        index
        for index, (_, obj) in enumerate(version_items)
        if obj.visible_get(view_layer=context.view_layer)
    ]
    if len(visible_indexes) == 1:
        current_index = visible_indexes[0]
    else:
        for index, (_, obj) in enumerate(version_items):
            if obj == selected_object:
                current_index = index
                break

    if current_index < 0:
        next_index = 0 if step > 0 else len(version_items) - 1
    else:
        next_index = (current_index + step) % len(version_items)
    next_label, next_object = version_items[next_index]

    reveal_collection_in_view_layer(context, live_collection)
    reveal_collection_in_view_layer(context, snapshots_collection)
    reveal_collection_in_view_layer(context, snapshot_bucket)
    reveal_object_collection_paths(context, next_object)

    for _, obj in version_items:
        obj.hide_viewport = False
        obj.hide_set(obj != next_object, view_layer=context.view_layer)

    bpy.ops.object.select_all(action="DESELECT")
    next_object.hide_set(False, view_layer=context.view_layer)
    next_object.select_set(True)
    context.view_layer.objects.active = next_object

    return {
        "message": f"Cycled versions for '{target_name}' to {next_label}.",
        "display": next_label,
    }


def get_selected_object_entries(context: bpy.types.Context) -> list[dict[str, str]]:
    return [{"name": obj.name} for obj in list(context.selected_objects)]


def perform_batch_rename_selected_objects(
    context: bpy.types.Context,
    items: list[dict[str, str]],
) -> str:
    selected_objects = list(context.selected_objects)
    if not selected_objects:
        raise ValueError("Select at least one object.")

    if not items:
        raise ValueError("No rename items were provided.")

    selected_by_name = {obj.name: obj for obj in selected_objects}
    rename_pairs: list[tuple[bpy.types.Object, str]] = []

    for entry in items:
        current_name = str(entry.get("current_name", "")).strip()
        new_name = str(entry.get("new_name", "")).strip()
        if not current_name:
            raise ValueError("Each rename item needs a current_name.")
        if not new_name:
            raise ValueError(f"New name is missing for '{current_name}'.")
        obj = selected_by_name.get(current_name)
        if obj is None:
            raise ValueError(f"'{current_name}' is no longer selected.")
        rename_pairs.append((obj, new_name))

    if len(rename_pairs) != len(selected_objects):
        raise ValueError("Rename list must include every selected object.")

    new_names = [new_name for _, new_name in rename_pairs]
    if len(set(new_names)) != len(new_names):
        raise ValueError("New names must be unique.")

    selected_name_set = {obj.name for obj in selected_objects}
    for _, new_name in rename_pairs:
        if new_name in selected_name_set:
            continue
        existing = bpy.data.objects.get(new_name)
        if existing is not None and existing not in selected_objects:
            raise ValueError(f"Another object already uses '{new_name}'.")

    temp_prefix = "__flowcell_collection_rename__"
    for index, (obj, _) in enumerate(rename_pairs, start=1):
        temp_name = f"{temp_prefix}{index}"
        while bpy.data.objects.get(temp_name) is not None:
            temp_name += "_x"
        obj.name = temp_name

    for obj, new_name in rename_pairs:
        obj.name = new_name

    return f"Renamed {len(rename_pairs)} object(s)."


def set_bridge_result(message: str, display: str = "") -> None:
    global LAST_BRIDGE_MESSAGE, LAST_BRIDGE_DISPLAY
    LAST_BRIDGE_MESSAGE = str(message or "")
    LAST_BRIDGE_DISPLAY = str(display or "")


def ensure_flowcell_obj_import_operator() -> None:
    import_scene = getattr(bpy.ops, "import_scene", None)
    if import_scene is not None and hasattr(import_scene, "obj_fix_transform"):
        return

    script_path = Path(bpy.utils.user_resource("SCRIPTS")) / "addons" / "import obj.py"
    if not script_path.exists():
        raise ValueError(f"Blender import script not found: {script_path}")

    runpy.run_path(str(script_path), run_name="__main__")

    import_scene = getattr(bpy.ops, "import_scene", None)
    if import_scene is None or not hasattr(import_scene, "obj_fix_transform"):
        raise ValueError("The Blender import obj script did not register import_scene.obj_fix_transform.")


def ensure_lithophane_tool_operators() -> None:
    object_ops = getattr(bpy.ops, "object", None)
    if (
        object_ops is not None and
        hasattr(object_ops, "add_mesh_plane_from_image") and
        hasattr(object_ops, "litho_run_original")
    ):
        return

    script_path = Path(bpy.utils.user_resource("SCRIPTS")) / "addons" / "litho tool.py"
    if not script_path.exists():
        raise ValueError(f"Blender lithophane tool script not found: {script_path}")

    runpy.run_path(str(script_path), run_name="__main__")

    object_ops = getattr(bpy.ops, "object", None)
    if (
        object_ops is None or
        not hasattr(object_ops, "add_mesh_plane_from_image") or
        not hasattr(object_ops, "litho_run_original")
    ):
        raise ValueError("The Blender lithophane tool script did not register its operators.")


def parse_flowcell_litho_filename(path: Path) -> tuple[str, float | None, float | None]:
    stem = path.stem
    match = FLOWCELL_LITHO_SIZE_SUFFIX_RE.match(stem)
    if not match:
        return stem, None, None
    return (
        match.group("base"),
        float(match.group("width")),
        float(match.group("height")),
    )


def apply_flowcell_litho_dimensions(
    context: bpy.types.Context,
    obj: bpy.types.Object,
    width_mm: float,
    height_mm: float,
) -> None:
    scale_length = float(getattr(context.scene.unit_settings, "scale_length", 1.0) or 1.0)
    if scale_length <= 0.0:
        scale_length = 1.0

    target_x = (float(width_mm) / 1000.0) / scale_length
    target_y = (float(height_mm) / 1000.0) / scale_length

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    context.view_layer.objects.active = obj

    for _ in range(3):
        try:
            context.view_layer.update()
        except Exception:
            pass

        current_x = max(abs(float(obj.dimensions.x)), 1e-6)
        current_y = max(abs(float(obj.dimensions.y)), 1e-6)

        scale_x = target_x / current_x
        scale_y = target_y / current_y

        obj.scale.x *= scale_x
        obj.scale.y *= scale_y

        try:
            context.view_layer.update()
        except Exception:
            pass

        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

        try:
            context.view_layer.update()
        except Exception:
            pass

        final_x = abs(float(obj.dimensions.x))
        final_y = abs(float(obj.dimensions.y))
        if abs(final_x - target_x) <= 0.0005 and abs(final_y - target_y) <= 0.0005:
            break


def get_object_dimensions_mm(
    context: bpy.types.Context,
    obj: bpy.types.Object,
) -> tuple[float, float]:
    scale_length = float(getattr(context.scene.unit_settings, "scale_length", 1.0) or 1.0)
    if scale_length <= 0.0:
        scale_length = 1.0
    return (
        float(obj.dimensions.x) * scale_length * 1000.0,
        float(obj.dimensions.y) * scale_length * 1000.0,
    )


def rename_flowcell_litho_result(obj: bpy.types.Object, clean_name: str) -> str:
    base_name = str(clean_name or "").strip()
    if base_name:
        target_name = f"{base_name} litho"
    else:
        target_name = ""
    if not target_name:
        return obj.name

    obj.name = target_name
    if getattr(obj, "data", None) is not None:
        obj.data.name = f"{target_name}_Mesh"

    active_material = getattr(obj, "active_material", None)
    if active_material is not None:
        active_material.name = f"{target_name}_Mat"

    images: list[bpy.types.Image] = []
    seen_image_names: set[str] = set()

    if active_material is not None and active_material.use_nodes and active_material.node_tree is not None:
        for node in active_material.node_tree.nodes:
            image = getattr(node, "image", None)
            if image is None:
                continue
            if image.name in seen_image_names:
                continue
            seen_image_names.add(image.name)
            images.append(image)

    for modifier in obj.modifiers:
        texture = getattr(modifier, "texture", None)
        image = getattr(texture, "image", None) if texture is not None else None
        if image is None:
            continue
        if image.name in seen_image_names:
            continue
        seen_image_names.add(image.name)
        images.append(image)

    for image in images:
        image.name = f"{target_name}.png"

    return obj.name


def perform_import_obj_into_scene_result(
    context: bpy.types.Context,
    filepath: str,
) -> dict[str, object]:
    normalized_path = str(filepath or "").strip()
    if not normalized_path:
        raise ValueError("The OBJ import request did not include a filepath.")

    obj_path = Path(normalized_path).expanduser()
    if not obj_path.exists():
        raise ValueError(f"OBJ file not found: {obj_path}")

    ensure_flowcell_obj_import_operator()

    before_names = {obj.name for obj in bpy.data.objects}
    result = bpy.ops.import_scene.obj_fix_transform("EXEC_DEFAULT", filepath=str(obj_path))
    if result is None or "FINISHED" not in result:
        raise ValueError(f"OBJ import did not finish for '{obj_path.name}'.")

    imported_names = [obj.name for obj in list(context.selected_objects) if obj.name not in before_names]
    if not imported_names:
        imported_names = [obj.name for obj in list(context.selected_objects)]

    if imported_names:
        message = f"Imported {len(imported_names)} object(s) from {obj_path.name}."
    else:
        message = f"Imported OBJ into Blender: {obj_path.name}."

    return {
        "message": message,
        "imported_objects": imported_names,
    }


def perform_import_png_as_lithophane_result(
    context: bpy.types.Context,
    filepath: str,
    dpi: float = 300.0,
) -> dict[str, object]:
    normalized_path = str(filepath or "").strip()
    if not normalized_path:
        raise ValueError("The lithophane import request did not include a filepath.")

    png_path = Path(normalized_path).expanduser()
    if not png_path.exists():
        raise ValueError(f"PNG file not found: {png_path}")

    clean_name, width_mm, height_mm = parse_flowcell_litho_filename(png_path)
    ensure_lithophane_tool_operators()

    view_layer = context.view_layer
    previous_active = view_layer.objects.active
    previous_selected = list(context.selected_objects)
    before_names = {obj.name for obj in bpy.data.objects}

    try:
        import_result = bpy.ops.object.add_mesh_plane_from_image(
            "EXEC_DEFAULT",
            directory=str(png_path.parent) + os.sep,
            files=[{"name": png_path.name}],
            dpi=float(dpi if dpi > 0 else 300.0),
        )
        if import_result is None or "FINISHED" not in import_result:
            raise ValueError(f"Lithophane PNG import did not finish for '{png_path.name}'.")

        imported_objects = [
            obj for obj in list(context.selected_objects)
            if obj.type == "MESH" and obj.name not in before_names
        ]
        if not imported_objects:
            active_object = view_layer.objects.active
            if active_object is not None and active_object.type == "MESH":
                imported_objects = [active_object]

        if not imported_objects:
            raise ValueError("The lithophane PNG import did not create a mesh plane.")

        imported_object = imported_objects[-1]
        bpy.ops.object.select_all(action="DESELECT")
        imported_object.select_set(True)
        view_layer.objects.active = imported_object

        if width_mm is not None and height_mm is not None:
            apply_flowcell_litho_dimensions(context, imported_object, width_mm, height_mm)

        litho_result = bpy.ops.object.litho_run_original("EXEC_DEFAULT")
        if litho_result is None or "FINISHED" not in litho_result:
            raise ValueError(f"Lithophane generation did not finish for '{imported_object.name}'.")

        if width_mm is not None and height_mm is not None:
            apply_flowcell_litho_dimensions(context, imported_object, width_mm, height_mm)

        final_name = rename_flowcell_litho_result(imported_object, clean_name)
        final_width_mm, final_height_mm = get_object_dimensions_mm(context, imported_object)

        if width_mm is not None and height_mm is not None:
            message = (
                f"Imported {png_path.name}, targeted {width_mm:.3f}mm x {height_mm:.3f}mm, "
                f"finalized at {final_width_mm:.3f}mm x {final_height_mm:.3f}mm, "
                f"and built a lithophane on '{final_name}'."
            )
        else:
            message = (
                f"Imported {png_path.name}, finalized at "
                f"{final_width_mm:.3f}mm x {final_height_mm:.3f}mm, "
                f"and built a lithophane on '{final_name}'."
            )

        return {
            "message": message,
            "imported_objects": [final_name],
        }
    finally:
        try:
            bpy.ops.object.select_all(action="DESELECT")
        except Exception:
            pass
        for obj in previous_selected:
            try:
                obj.select_set(True)
            except Exception:
                pass
        if previous_active is not None:
            try:
                view_layer.objects.active = previous_active
            except Exception:
                pass


def _execute_bridge_operator_direct(action: str, data: dict) -> dict[str, object]:
    set_bridge_result("", "")
    normalized = str(action or "").strip().lower()
    result = None

    custom_result = execute_custom_action(normalized, data)
    if custom_result is not None:
        set_bridge_result(
            str(custom_result.get("message", "")),
            str(custom_result.get("display", "")),
        )
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            **custom_result,
            "message": LAST_BRIDGE_MESSAGE or str(custom_result.get("message", f"Completed {normalized}.")),
            "display": LAST_BRIDGE_DISPLAY,
        }

    if normalized == "make_layers":
        result = bpy.ops.object.flowcell_live_snapshot_make_layers("EXEC_DEFAULT")
    elif normalized == "sort":
        result = bpy.ops.object.flowcell_live_snapshot_sort("EXEC_DEFAULT")
    elif normalized == "snapshot":
        result = bpy.ops.object.flowcell_live_snapshot_save("EXEC_DEFAULT")
    elif normalized == "back":
        result = bpy.ops.object.flowcell_live_snapshot_back("EXEC_DEFAULT")
    elif normalized == "restore":
        result = bpy.ops.object.flowcell_live_snapshot_restore("EXEC_DEFAULT")
    elif normalized == "trash":
        result = bpy.ops.object.flowcell_live_snapshot_trash("EXEC_DEFAULT")
    elif normalized == "archive":
        result = bpy.ops.object.flowcell_live_snapshot_archive("EXEC_DEFAULT")
    elif normalized == "empty_trash":
        result = bpy.ops.object.flowcell_live_snapshot_empty_trash("EXEC_DEFAULT")
    elif normalized == "add_to_live":
        result = bpy.ops.object.flowcell_live_snapshot_add_to_live("EXEC_DEFAULT")
    elif normalized == "new_collection":
        result = bpy.ops.object.flowcell_live_snapshot_new_collection(
            "EXEC_DEFAULT",
            name=str(data.get("name", "") or "Collection"),
        )
    elif normalized == "empty_collections":
        result = bpy.ops.object.flowcell_live_snapshot_empty_collections("EXEC_DEFAULT")
    elif normalized == "cycle_collection":
        result = bpy.ops.object.flowcell_live_snapshot_cycle_collection("EXEC_DEFAULT")
    elif normalized == "cycle_live_versions":
        result = bpy.ops.object.flowcell_live_snapshot_cycle_live_versions(
            "EXEC_DEFAULT",
            direction=str(data.get("direction", "forward") or "forward"),
        )
    elif normalized == "save_selected_stl_to_assets":
        message = perform_save_selected_stl_to_assets(
            bpy.context,
            str(data.get("file_name", "") or ""),
        )
        set_bridge_result(message)
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or message,
            "display": LAST_BRIDGE_DISPLAY,
        }
    elif normalized == "import_obj_into_scene":
        result = perform_import_obj_into_scene_result(
            bpy.context,
            str(data.get("filepath", "") or ""),
        )
        set_bridge_result(str(result.get("message", "")))
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or str(result.get("message", "Imported OBJ.")),
            "display": LAST_BRIDGE_DISPLAY,
            "imported_objects": result.get("imported_objects", []),
        }
    elif normalized == "import_png_as_lithophane":
        result = perform_import_png_as_lithophane_result(
            bpy.context,
            str(data.get("filepath", "") or ""),
            float(data.get("dpi", 300.0) or 300.0),
        )
        set_bridge_result(str(result.get("message", "")))
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or str(result.get("message", "Imported PNG as lithophane.")),
            "display": LAST_BRIDGE_DISPLAY,
            "imported_objects": result.get("imported_objects", []),
        }
    elif normalized == "alignment_tools":
        result = perform_flowcell_alignment_tool(bpy.context, data)
        set_bridge_result(str(result.get("message", "")))
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or str(result.get("message", "Aligned objects.")),
            "display": LAST_BRIDGE_DISPLAY,
        }
    elif normalized == "flatten_revolve_tools":
        result = perform_flowcell_flatten_revolve_tool(bpy.context, data)
        set_bridge_result(str(result.get("message", "")))
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or str(result.get("message", "Flatten revolve complete.")),
            "display": LAST_BRIDGE_DISPLAY,
        }
    elif normalized == "smart_axis_lock":
        import flowcell_bridge as flowcell_live_bridge

        result = flowcell_live_bridge.execute_smart_axis_lock_command(
            bpy.context,
            data,
        )
        set_bridge_result(
            str(result.get("message", "")),
            str(result.get("display", "")),
        )
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or str(result.get("message", "Smart Axis Lock complete.")),
            "display": LAST_BRIDGE_DISPLAY,
            **result,
        }
    else:
        custom_result = execute_custom_action(normalized, data)
        if custom_result is None:
            raise ValueError(f"Unsupported action: {action or '[blank]'}")
        set_bridge_result(
            str(custom_result.get("message", "")),
            str(custom_result.get("display", "")),
        )
        try:
            bpy.context.view_layer.update()
        except Exception:
            pass
        return {
            "message": LAST_BRIDGE_MESSAGE or str(custom_result.get("message", f"Completed {normalized}.")),
            "display": LAST_BRIDGE_DISPLAY,
            **custom_result,
        }

    if result is None or "FINISHED" not in result:
        raise ValueError(f"Action did not finish: {action or '[blank]'}")

    try:
        bpy.context.view_layer.update()
    except Exception:
        pass

    return {
        "message": LAST_BRIDGE_MESSAGE or f"Completed {normalized}.",
        "display": LAST_BRIDGE_DISPLAY,
    }


def _should_run_bridge_action_undoably(action: str, data: dict) -> bool:
    if not isinstance(data, dict):
        return True

    for key in ("command", "action", "tool_command"):
        command = str(data.get(key, "") or "").strip().lower()
        if command in READ_ONLY_BRIDGE_COMMANDS:
            return False

    return True


def execute_bridge_operator(action: str, data: dict) -> dict[str, object]:
    global PENDING_UNDO_BRIDGE_ACTION
    global PENDING_UNDO_BRIDGE_DATA
    global PENDING_UNDO_BRIDGE_RESULT
    global PENDING_UNDO_BRIDGE_ERROR

    if not _should_run_bridge_action_undoably(action, data):
        return _execute_bridge_operator_direct(action, data if isinstance(data, dict) else {})

    PENDING_UNDO_BRIDGE_ACTION = str(action or "")
    PENDING_UNDO_BRIDGE_DATA = data if isinstance(data, dict) else {}
    PENDING_UNDO_BRIDGE_RESULT = None
    PENDING_UNDO_BRIDGE_ERROR = ""

    try:
        result = bpy.ops.object.flowcell_bridge_undoable_action("EXEC_DEFAULT")
        if result is None or "FINISHED" not in result:
            error = PENDING_UNDO_BRIDGE_ERROR or f"Action did not finish: {action or '[blank]'}"
            raise ValueError(error)
        if PENDING_UNDO_BRIDGE_ERROR:
            raise ValueError(PENDING_UNDO_BRIDGE_ERROR)
        if not isinstance(PENDING_UNDO_BRIDGE_RESULT, dict):
            raise ValueError(f"Action returned no result: {action or '[blank]'}")
        return PENDING_UNDO_BRIDGE_RESULT
    finally:
        PENDING_UNDO_BRIDGE_ACTION = ""
        PENDING_UNDO_BRIDGE_DATA = {}
        PENDING_UNDO_BRIDGE_RESULT = None
        PENDING_UNDO_BRIDGE_ERROR = ""


def get_bridge_directory() -> Path:
    scripts_root = Path(bpy.utils.user_resource("SCRIPTS"))
    bridge_dir = scripts_root / "addons" / BRIDGE_FOLDER_NAME / str(os.getpid())
    bridge_dir.mkdir(parents=True, exist_ok=True)
    return bridge_dir


def get_custom_actions_registry_path() -> Path:
    scripts_root = Path(bpy.utils.user_resource("SCRIPTS"))
    bridge_root = scripts_root / "addons" / BRIDGE_FOLDER_NAME
    bridge_root.mkdir(parents=True, exist_ok=True)
    return bridge_root / CUSTOM_ACTIONS_FILE_NAME


def load_custom_actions_registry() -> list[dict[str, object]]:
    registry_path = get_custom_actions_registry_path()
    if not registry_path.exists():
        return []

    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8-sig"))
    except Exception:
        return []

    actions_payload = payload.get("actions", [])
    if not isinstance(actions_payload, list):
        return []
    return [entry for entry in actions_payload if isinstance(entry, dict)]


def get_custom_action_names_for_capability(capability: str) -> list[str]:
    normalized_capability = str(capability or "").strip().lower()
    if not normalized_capability:
        return []

    matches: list[str] = []
    for entry in load_custom_actions_registry():
        bridge_data = entry.get("bridgeData", {})
        if not isinstance(bridge_data, dict):
            continue
        capabilities = bridge_data.get("capabilities", [])
        if not isinstance(capabilities, list) or not any(
            str(value or "").strip().lower() == normalized_capability
            for value in capabilities
        ):
            continue
        action_name = str(entry.get("action", "")).strip().lower()
        if action_name and action_name not in matches:
            matches.append(action_name)
    return matches


def resolve_custom_action_script_path(python_path: str) -> Path:
    raw_path = str(python_path or '').strip()
    script_path = Path(raw_path).expanduser()
    if script_path.is_absolute():
        return script_path

    normalized_path = raw_path.replace('\\', '/').lstrip('/')
    scripts_addons_root = Path(bpy.utils.user_resource('SCRIPTS')) / 'addons'
    candidates = [
        scripts_addons_root / normalized_path,
        get_custom_actions_registry_path().parent / normalized_path,
        Path(__file__).resolve().parent / normalized_path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _call_custom_action_callable(
    callback,
    context: bpy.types.Context,
    data: dict,
):
    try:
        parameters = [
            parameter
            for parameter in inspect.signature(callback).parameters.values()
            if parameter.kind in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]
    except (TypeError, ValueError):
        parameters = []

    if not parameters:
        return callback()

    if len(parameters) == 1:
        parameter_name = str(parameters[0].name or '').strip().lower()
        if parameter_name in {'data', 'payload', 'options', 'args', 'request'}:
            return callback(data)
        return callback(context)

    return callback(context, data)


def execute_custom_action(normalized_action: str, data: dict) -> dict[str, object] | None:
    for entry in load_custom_actions_registry():
        action_name = str(entry.get("action", "")).strip().lower()
        if not action_name or action_name != normalized_action:
            continue

        python_path = str(entry.get("pythonPath", "")).strip()
        if not python_path:
            raise ValueError(f"Custom action '{normalized_action}' is missing pythonPath.")

        script_path = resolve_custom_action_script_path(python_path)
        if not script_path.exists():
            raise ValueError(f"Custom action script not found: {script_path}")

        namespace = runpy.run_path(str(script_path), run_name=f"flowcell_custom_{normalized_action}")
        function_name = str(entry.get("functionName", "")).strip()

        callback = None
        if function_name:
            callback = namespace.get(function_name)
            if callback is None:
                raise ValueError(
                    f"Custom action '{normalized_action}' could not find function '{function_name}' in {script_path}."
                )
        else:
            callback = namespace.get("run_flowcell_action") or namespace.get("main")
            if callback is None:
                for name, value in namespace.items():
                    if name.startswith("perform_") and callable(value):
                        callback = value
                        break

        if callback is None or not callable(callback):
            raise ValueError(
                f"Custom action '{normalized_action}' did not expose a callable entrypoint."
            )

        raw_result = _call_custom_action_callable(callback, bpy.context, data or {})
        message = f"Completed {normalized_action}."
        display = ""
        payload: dict[str, object] = {}
        if isinstance(raw_result, dict):
            payload = raw_result
            message = str(payload.get("message", message))
            display = str(payload.get("display", ""))
        elif isinstance(raw_result, str):
            message = raw_result
        elif raw_result is not None:
            message = str(raw_result)

        return {
            "message": message,
            "display": display,
            **payload,
        }

    return None


def execute_custom_action_for_capability(
    capability: str,
    data: dict,
) -> dict[str, object] | None:
    last_error: Exception | None = None
    for action_name in get_custom_action_names_for_capability(capability):
        try:
            result = execute_custom_action(action_name, data)
        except Exception as exc:
            last_error = exc
            continue
        if result is not None:
            return result
    if last_error is not None:
        raise last_error
    return None


def get_request_path() -> Path:
    return get_bridge_directory() / REQUEST_FILE_NAME


def get_response_path() -> Path:
    return get_bridge_directory() / RESPONSE_FILE_NAME


def write_bridge_response(payload: dict) -> None:
    response_path = get_response_path()
    response_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _startup_place_picture_state_enabled() -> bool:
    config_root = bpy.utils.user_resource("CONFIG", path="", create=True)
    if not config_root:
        return False
    state_path = Path(config_root) / PROJECT_THEME_STARTUP_STATE_FILE_NAME
    if not state_path.is_file():
        return False
    try:
        state = json.loads(state_path.read_text(encoding="utf-8-sig"))
    except Exception:
        return False
    if not isinstance(state, dict):
        return False
    place_picture = state.get("place_picture", {})
    if not isinstance(place_picture, dict) or not bool(place_picture.get("enabled")):
        return False
    return bool(str(place_picture.get("path") or place_picture.get("relative_path") or "").strip())


def _maybe_restore_startup_place_picture_from_poll() -> None:
    namespace = bpy.app.driver_namespace
    if bool(namespace.get(PROJECT_THEME_POLL_RESTORE_DONE_KEY)):
        return

    now = time.monotonic()
    next_time = float(namespace.get(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, 0.0) or 0.0)
    if now < next_time:
        return

    attempts = int(namespace.get(PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY, 0) or 0)
    if attempts >= PROJECT_THEME_POLL_RESTORE_MAX_ATTEMPTS:
        namespace[PROJECT_THEME_POLL_RESTORE_DONE_KEY] = True
        namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)
        print("FlowCell startup Place Picture restore stopped after retry limit.")
        return

    namespace[PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY] = attempts + 1
    namespace[PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY] = now + 0.5

    if not _startup_place_picture_state_enabled():
        return

    if not _has_flowcell_project_theme_restore_view3d():
        return

    try:
        runtime_state = execute_custom_action_for_capability(
            PROJECT_THEME_RESTORE_CAPABILITY,
            {"command": "read_place_picture_runtime_state"},
        )
        if isinstance(runtime_state, dict) and bool(runtime_state.get("place_picture_runtime_enabled")):
            namespace[PROJECT_THEME_POLL_RESTORE_DONE_KEY] = True
            namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)
            return

        result = execute_custom_action_for_capability(
            PROJECT_THEME_RESTORE_CAPABILITY,
            {"command": "restore_project_startup_state"},
        )
        if isinstance(result, dict) and bool(result.get("restored_place_picture")):
            namespace[PROJECT_THEME_POLL_RESTORE_DONE_KEY] = True
            namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)
            message = str(result.get("message", "") or "")
            print(message or "FlowCell startup Place Picture restored.")
    except Exception as exc:
        print(f"FlowCell startup Place Picture restore retry failed: {exc}")


def poll_bridge_requests() -> float:
    global LAST_REQUEST_ID

    _maybe_restore_startup_place_picture_from_poll()

    request_path = get_request_path()
    if not request_path.exists():
        return POLL_INTERVAL_SECONDS

    try:
        payload = json.loads(request_path.read_text(encoding="utf-8-sig"))
    except Exception:
        write_bridge_response(
            {
                "id": "",
                "status": "error",
                "message": "The request file is not valid JSON.",
            }
        )
        try:
            request_path.unlink()
        except OSError:
            pass
        return POLL_INTERVAL_SECONDS

    request_id = str(payload.get("id", "")).strip()
    action = str(payload.get("action", "")).strip().lower()
    data = payload.get("data", {}) or {}

    if not request_id:
        write_bridge_response(
            {
                "id": "",
                "status": "error",
                "message": "The request is missing an id.",
            }
        )
        try:
            request_path.unlink()
        except OSError:
            pass
        return POLL_INTERVAL_SECONDS

    if request_id == LAST_REQUEST_ID:
        return POLL_INTERVAL_SECONDS

    LAST_REQUEST_ID = request_id

    try:
        display = ""
        response_data = {}
        if action == "get_selected_objects":
            selected_objects = get_selected_object_entries(bpy.context)
            if not selected_objects:
                raise ValueError("Select at least one object.")
            message = f"Loaded {len(selected_objects)} selected object(s)."
            response_data["selected_objects"] = selected_objects
        elif action == "rename_selected_objects":
            rename_items = data.get("items", []) or []
            message = perform_batch_rename_selected_objects(bpy.context, rename_items)
            response_data["selected_objects"] = get_selected_object_entries(bpy.context)
        else:
            result = execute_bridge_operator(action, data)
            message = str(result.get("message", ""))
            display = str(result.get("display", ""))
            if isinstance(result, dict):
                for key, value in result.items():
                    if key in {"message", "display"}:
                        continue
                    response_data[key] = value

        response_payload = {
            "id": request_id,
            "status": "ok",
            "message": message,
        }
        if display:
            response_payload["display"] = display
        if response_data:
            response_payload.update(response_data)
        write_bridge_response(response_payload)
    except Exception as exc:
        write_bridge_response(
            {
                "id": request_id,
                "status": "error",
                "message": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
    finally:
        try:
            request_path.unlink()
        except OSError:
            pass

    return POLL_INTERVAL_SECONDS


class OBJECT_OT_flowcell_live_snapshot_sort(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_sort"
    bl_label = "Sort"
    bl_description = "Visible objects become Live, matching invisible family objects become Snapshots as s#, and other invisible objects become Trash as t#"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_sort(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_sort_live(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_sort_live"
    bl_label = "Sort Live"
    bl_description = "Move hidden objects from Live into Trash"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_sort_live(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_save(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_save"
    bl_label = "Snapshot"
    bl_description = "Duplicate selected objects into Snapshots"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_snapshot(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_make_layers(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_make_layers"
    bl_label = "Make Layers"
    bl_description = "Create Live, Snapshots, Trash, and Archive if missing"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_make_layers(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_back(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_back"
    bl_label = "Back"
    bl_description = "Move current Live to Trash and restore the latest snapshot"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_back(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_restore(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_restore"
    bl_label = "Restore"
    bl_description = "Restore selected snapshot/trash/archive objects into Live"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_restore(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_trash(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_trash"
    bl_label = "Trash"
    bl_description = "Move selected objects into Trash"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_trash(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_archive(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_archive"
    bl_label = "Archive"
    bl_description = "Copy selected objects into Archive"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_archive(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_empty_trash(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_empty_trash"
    bl_label = "Empty Trash"
    bl_description = "Delete everything inside Trash"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_empty_trash(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_add_to_live(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_add_to_live"
    bl_label = "Add To Live"
    bl_description = "Copy selected objects into Live without replacing the current Live version"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_add_to_live(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_new_collection(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_new_collection"
    bl_label = "New Collection"
    bl_description = "Create a new child collection near the selected object"
    bl_options = {"REGISTER"}

    name: bpy.props.StringProperty(name="Name", default="Collection")

    def execute(self, context: bpy.types.Context):
        message = perform_new_collection(context, self.name)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_empty_collections(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_empty_collections"
    bl_label = "Empty Collections"
    bl_description = "Delete empty collections while keeping the system roots"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_empty_collections(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_cycle_collection(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_cycle_collection"
    bl_label = "Cycle Collection"
    bl_description = "Show one direct object at a time in the selected object's collection"
    bl_options = {"REGISTER"}

    def execute(self, context: bpy.types.Context):
        message = perform_cycle_collection(context)
        set_bridge_result(message)
        self.report({"INFO"}, message)
        return {"FINISHED"}


class OBJECT_OT_flowcell_live_snapshot_cycle_live_versions(bpy.types.Operator):
    bl_idname = "object.flowcell_live_snapshot_cycle_live_versions"
    bl_label = "Cycle Live Versions"
    bl_description = "Cycle the selected Live object and its snapshots one visible version at a time"
    bl_options = {"REGISTER"}
    direction: bpy.props.StringProperty(name="Direction", default="forward")

    def execute(self, context: bpy.types.Context):
        result = perform_cycle_live_versions(context, self.direction)
        set_bridge_result(str(result.get("message", "")), str(result.get("display", "")))
        self.report({"INFO"}, str(result.get("message", "")))
        return {"FINISHED"}


class OBJECT_OT_flowcell_bridge_undoable_action(bpy.types.Operator):
    bl_idname = "object.flowcell_bridge_undoable_action"
    bl_label = "FlowCell Bridge Action"
    bl_description = "Run a FlowCell bridge action as one Blender undo step"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: bpy.types.Context):
        global PENDING_UNDO_BRIDGE_RESULT
        global PENDING_UNDO_BRIDGE_ERROR

        try:
            PENDING_UNDO_BRIDGE_RESULT = _execute_bridge_operator_direct(
                PENDING_UNDO_BRIDGE_ACTION,
                PENDING_UNDO_BRIDGE_DATA,
            )
            message = str(PENDING_UNDO_BRIDGE_RESULT.get("message", ""))
            if message:
                self.report({"INFO"}, message)
            return {"FINISHED"}
        except Exception as exc:
            PENDING_UNDO_BRIDGE_ERROR = str(exc)
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}


CLASSES = (
    OBJECT_OT_flowcell_bridge_undoable_action,
    OBJECT_OT_flowcell_live_snapshot_make_layers,
    OBJECT_OT_flowcell_live_snapshot_sort,
    OBJECT_OT_flowcell_live_snapshot_sort_live,
    OBJECT_OT_flowcell_live_snapshot_save,
    OBJECT_OT_flowcell_live_snapshot_back,
    OBJECT_OT_flowcell_live_snapshot_restore,
    OBJECT_OT_flowcell_live_snapshot_add_to_live,
    OBJECT_OT_flowcell_live_snapshot_trash,
    OBJECT_OT_flowcell_live_snapshot_archive,
    OBJECT_OT_flowcell_live_snapshot_empty_trash,
    OBJECT_OT_flowcell_live_snapshot_new_collection,
    OBJECT_OT_flowcell_live_snapshot_empty_collections,
    OBJECT_OT_flowcell_live_snapshot_cycle_collection,
    OBJECT_OT_flowcell_live_snapshot_cycle_live_versions,
)


def _safe_register_class(cls) -> None:
    try:
        bpy.utils.register_class(cls)
    except (RuntimeError, ValueError) as exc:
        if "already registered" not in str(exc):
            raise


def _safe_unregister_class(cls) -> None:
    try:
        bpy.utils.unregister_class(cls)
    except RuntimeError as exc:
        message = str(exc)
        if "missing bl_rna attribute" not in message and "not registered" not in message:
            raise


def _load_flowcell_live_bridge_module():
    import flowcell_bridge as flowcell_live_bridge

    try:
        flowcell_live_bridge = importlib.reload(flowcell_live_bridge)
    except Exception:
        pass
    return flowcell_live_bridge


def _has_flowcell_project_theme_restore_view3d() -> bool:
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return False

    for window in getattr(window_manager, "windows", []) or []:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue
        for area in getattr(screen, "areas", []) or []:
            if getattr(area, "type", "") == "VIEW_3D":
                return True
    return False


def _restore_flowcell_project_theme_after_load():
    namespace = bpy.app.driver_namespace
    attempts = int(namespace.get(PROJECT_THEME_RESTORE_ATTEMPTS_KEY, 0) or 0)
    namespace[PROJECT_THEME_RESTORE_ATTEMPTS_KEY] = attempts + 1
    if not _has_flowcell_project_theme_restore_view3d():
        if attempts < PROJECT_THEME_RESTORE_MAX_ATTEMPTS:
            return 0.5
        print("FlowCell project theme restore continuing without a VIEW_3D area.")

    try:
        import flowcell_bridge as flowcell_live_bridge

        execute_custom_capability = getattr(
            flowcell_live_bridge,
            "execute_custom_action_for_capability",
            None,
        )
        if not callable(execute_custom_capability):
            flowcell_live_bridge = importlib.reload(flowcell_live_bridge)
            execute_custom_capability = getattr(
                flowcell_live_bridge,
                "execute_custom_action_for_capability",
                None,
            )
        if not callable(execute_custom_capability):
            print("FlowCell project theme restore skipped: capability executor is unavailable.")
            return None

        result = execute_custom_capability(
            PROJECT_THEME_RESTORE_CAPABILITY,
            {"command": "restore_project_startup_state"},
        )
        if result is None:
            print("FlowCell project theme restore skipped: no registered capability owner was found.")
        elif isinstance(result, dict):
            message = str(result.get("message", "") or "")
            if message:
                print(message)
            for warning in result.get("warnings", []) or []:
                print(f"FlowCell project theme restore warning: {warning}")
            has_startup_place_picture = bool(result.get("has_startup_place_picture_state"))
            restored_place_picture = bool(result.get("restored_place_picture"))
            if has_startup_place_picture and not restored_place_picture and attempts < PROJECT_THEME_RESTORE_MAX_ATTEMPTS:
                return 0.5
        else:
            print(str(result))
        namespace.pop(PROJECT_THEME_RESTORE_ATTEMPTS_KEY, None)
        return None
    except Exception as exc:
        print(f"FlowCell project theme restore failed: {exc}")
        if attempts < PROJECT_THEME_RESTORE_MAX_ATTEMPTS:
            return 0.5
    namespace.pop(PROJECT_THEME_RESTORE_ATTEMPTS_KEY, None)
    return None


def _schedule_flowcell_project_theme_restore(first_interval: float = 0.35) -> None:
    namespace = bpy.app.driver_namespace
    namespace[PROJECT_THEME_RESTORE_ATTEMPTS_KEY] = 0
    if not bpy.app.timers.is_registered(_restore_flowcell_project_theme_after_load):
        bpy.app.timers.register(
            _restore_flowcell_project_theme_after_load,
            first_interval=first_interval,
            persistent=True,
        )


@persistent
def _restore_flowcell_project_theme_on_load(_dummy=None):
    _schedule_flowcell_project_theme_restore(first_interval=0.35)


def _ensure_flowcell_project_theme_restore_handler_registered() -> None:
    namespace = bpy.app.driver_namespace
    existing = namespace.get(PROJECT_THEME_RESTORE_HANDLER_KEY)
    if existing in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(existing)
    if _restore_flowcell_project_theme_on_load in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(_restore_flowcell_project_theme_on_load)

    bpy.app.handlers.load_post.append(_restore_flowcell_project_theme_on_load)
    namespace[PROJECT_THEME_RESTORE_HANDLER_KEY] = _restore_flowcell_project_theme_on_load


def _remove_flowcell_project_theme_restore_handler() -> None:
    namespace = bpy.app.driver_namespace
    existing = namespace.get(PROJECT_THEME_RESTORE_HANDLER_KEY)
    if existing in bpy.app.handlers.load_post:
        try:
            bpy.app.handlers.load_post.remove(existing)
        except Exception:
            pass
    if _restore_flowcell_project_theme_on_load in bpy.app.handlers.load_post:
        try:
            bpy.app.handlers.load_post.remove(_restore_flowcell_project_theme_on_load)
        except Exception:
            pass

    namespace.pop(PROJECT_THEME_RESTORE_HANDLER_KEY, None)
    namespace.pop(PROJECT_THEME_RESTORE_ATTEMPTS_KEY, None)
    namespace.pop(PROJECT_THEME_POLL_RESTORE_DONE_KEY, None)
    namespace.pop(PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY, None)
    namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)
    if bpy.app.timers.is_registered(_restore_flowcell_project_theme_after_load):
        try:
            bpy.app.timers.unregister(_restore_flowcell_project_theme_after_load)
        except Exception:
            pass


def register():
    flowcell_live_bridge = _load_flowcell_live_bridge_module()
    namespace = bpy.app.driver_namespace
    namespace.pop(PROJECT_THEME_POLL_RESTORE_DONE_KEY, None)
    namespace.pop(PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY, None)
    namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)

    for cls in CLASSES:
        _safe_register_class(cls)

    cleanup_live_tools = getattr(flowcell_live_bridge, "cleanup_live_tools", None)
    if callable(cleanup_live_tools):
        cleanup_live_tools(clear_registry=True)

    ensure_builtin_live_tools_registered = getattr(
        flowcell_live_bridge,
        "ensure_builtin_live_tools_registered",
        None,
    )
    if callable(ensure_builtin_live_tools_registered):
        ensure_builtin_live_tools_registered()

    get_bridge_directory()
    disable_outliner_alpha_sort()
    _ensure_flowcell_project_theme_restore_handler_registered()
    _schedule_flowcell_project_theme_restore(first_interval=1.25)

    if not bpy.app.timers.is_registered(poll_bridge_requests):
        bpy.app.timers.register(poll_bridge_requests, first_interval=POLL_INTERVAL_SECONDS, persistent=True)


def unregister():
    flowcell_live_bridge = _load_flowcell_live_bridge_module()

    cleanup_live_tools = getattr(flowcell_live_bridge, "cleanup_live_tools", None)
    if callable(cleanup_live_tools):
        cleanup_live_tools(clear_registry=True)
    _remove_flowcell_project_theme_restore_handler()
    if bpy.app.timers.is_registered(poll_bridge_requests):
        bpy.app.timers.unregister(poll_bridge_requests)

    for cls in reversed(CLASSES):
        _safe_unregister_class(cls)


if __name__ == "__main__":
    register()

























































































