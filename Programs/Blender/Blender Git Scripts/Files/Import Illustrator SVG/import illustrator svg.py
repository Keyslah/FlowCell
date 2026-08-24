# Description: Import Illustrator SVG layers, extrude each leading millimeter value, and convert them to meshes.
from __future__ import annotations

import math
import os
import re
from pathlib import Path

import bmesh
import bpy
from mathutils.bvhtree import BVHTree


DEFAULT_THICKNESS_MM = 1.0
SVG_CURVE_RESOLUTION_U = 16
LEADING_EXTRUSION_VALUE = re.compile(
    r"^(?:\(([0-9]+(?:\.[0-9]+)?)\)|([0-9]+(?:\.[0-9]+)?))"
)


def _ctx(context=None):
    return context or bpy.context


def _finished(operator_result) -> bool:
    return bool(operator_result) and "FINISHED" in operator_result


def thickness_mm_from_filepath(filepath) -> float:
    """Read a leading number, optionally parenthesized, as millimeters."""
    stem = Path(str(filepath or "")).stem
    match = LEADING_EXTRUSION_VALUE.match(stem)
    if match is None:
        return DEFAULT_THICKNESS_MM

    token = match.group(1) or match.group(2)
    thickness_mm = float(token)
    if not math.isfinite(thickness_mm) or thickness_mm <= 0.0:
        raise ValueError(
            f"SVG filename '{stem}' must use a positive finite extrusion value, got '{token}'."
        )
    return thickness_mm


def _scene_scale_length(scene) -> float:
    unit_settings = getattr(scene, "unit_settings", None)
    scale_length = float(getattr(unit_settings, "scale_length", 1.0) or 1.0)
    if not math.isfinite(scale_length) or scale_length <= 0.0:
        raise ValueError("Blender scene unit scale must be positive and finite.")
    return scale_length


def millimeters_to_blender_units(scene, millimeters: float) -> float:
    thickness_mm = float(millimeters)
    if not math.isfinite(thickness_mm) or thickness_mm <= 0.0:
        raise ValueError("SVG extrusion thickness must be a positive finite millimeter value.")
    return (thickness_mm / 1000.0) / _scene_scale_length(scene)


def millimeter_offset_to_blender_units(scene, millimeters: float) -> float:
    offset_mm = float(millimeters)
    if not math.isfinite(offset_mm):
        raise ValueError("SVG position offset must be a finite millimeter value.")
    return (offset_mm / 1000.0) / _scene_scale_length(scene)


def _positive_finite_millimeters(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a positive millimeter number.")
    millimeters = float(value)
    if not math.isfinite(millimeters) or millimeters <= 0.0:
        raise ValueError(f"{label} must be a positive finite millimeter number.")
    return millimeters


def _finite_millimeters(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a millimeter number.")
    millimeters = float(value)
    if not math.isfinite(millimeters):
        raise ValueError(f"{label} must be a finite millimeter number.")
    return millimeters


def _validated_items(data) -> list[dict[str, object]]:
    if not isinstance(data, dict):
        raise ValueError("Illustrator SVG import requires data with a non-empty 'items' array.")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("Illustrator SVG import requires at least one item in data.items.")

    validated = []
    for index, item in enumerate(items):
        item_number = index + 1
        if not isinstance(item, dict):
            raise ValueError(f"Illustrator SVG item {item_number} must be an object.")

        filepath_value = item.get("filepath")
        if not isinstance(filepath_value, str) or not filepath_value.strip():
            raise ValueError(f"Illustrator SVG item {item_number} requires a filepath.")
        filepath = Path(filepath_value.strip().strip('"')).expanduser()
        if not filepath.is_absolute():
            raise ValueError(f"Illustrator SVG item {item_number} filepath must be absolute: {filepath}")
        filepath = Path(os.path.abspath(str(filepath)))
        if filepath.suffix.casefold() != ".svg":
            raise ValueError(f"Illustrator SVG item {item_number} is not an SVG file: {filepath}")
        if not filepath.is_file():
            raise ValueError(f"Illustrator SVG item {item_number} does not exist: {filepath}")

        layer_value = item.get("layerName")
        if layer_value is not None and not isinstance(layer_value, str):
            raise ValueError(f"Illustrator SVG item {item_number} layerName must be text.")
        layer_name = layer_value if isinstance(layer_value, str) and layer_value.strip() else filepath.stem
        thickness_mm = thickness_mm_from_filepath(filepath)
        width_mm = _positive_finite_millimeters(
            item.get("widthMm"), f"Illustrator SVG item {item_number} widthMm"
        )
        height_mm = _positive_finite_millimeters(
            item.get("heightMm"), f"Illustrator SVG item {item_number} heightMm"
        )
        offset_x_mm = _finite_millimeters(
            item.get("offsetXmm"), f"Illustrator SVG item {item_number} offsetXmm"
        )
        offset_y_mm = _finite_millimeters(
            item.get("offsetYmm"), f"Illustrator SVG item {item_number} offsetYmm"
        )

        validated.append(
            {
                "filepath": filepath,
                "layerName": layer_name,
                "thicknessMm": thickness_mm,
                "widthMm": width_mm,
                "heightMm": height_mm,
                "offsetXmm": offset_x_mm,
                "offsetYmm": offset_y_mm,
            }
        )
    return validated


def _identity_key(value):
    as_pointer = getattr(value, "as_pointer", None)
    if callable(as_pointer):
        try:
            pointer = int(as_pointer())
            if pointer:
                return ("BLENDER", pointer)
        except (TypeError, ValueError, ReferenceError):
            pass
    return ("PYTHON", id(value))


def _identity_ids(values) -> set[tuple[str, int]]:
    return {_identity_key(value) for value in values}


def _new_since(values, prior_ids: set[tuple[str, int]]):
    return [value for value in values if _identity_key(value) not in prior_ids]


def _contains_identity(values, target) -> bool:
    target_key = _identity_key(target)
    return any(_identity_key(value) == target_key for value in values)


def _active_object(context):
    view_layer = getattr(context, "view_layer", None)
    objects = getattr(view_layer, "objects", None)
    return getattr(objects, "active", None)


def _set_active_object(context, obj) -> None:
    context.view_layer.objects.active = obj


def _object_is_in_view_layer(context, obj) -> bool:
    view_objects = context.view_layer.objects
    try:
        return obj.name in view_objects
    except (AttributeError, TypeError):
        return _contains_identity(view_objects, obj)


def _ensure_object_mode(context) -> None:
    active = _active_object(context)
    if active is not None and getattr(active, "mode", "OBJECT") != "OBJECT":
        result = bpy.ops.object.mode_set(mode="OBJECT")
        if not _finished(result):
            raise RuntimeError("Blender could not enter Object Mode for SVG import.")


def _select_only(context, objects) -> None:
    _ensure_object_mode(context)
    bpy.ops.object.select_all(action="DESELECT")
    visible = []
    for obj in objects:
        if _object_is_in_view_layer(context, obj):
            obj.select_set(True)
            visible.append(obj)
    if not visible:
        raise RuntimeError("The imported SVG object is not available in the active view layer.")
    _set_active_object(context, visible[-1])


def _join_imported_curves(context, curves):
    _select_only(context, curves)
    transform_result = bpy.ops.object.transform_apply(
        location=False,
        rotation=False,
        scale=True,
    )
    if not _finished(transform_result):
        raise RuntimeError("Blender could not apply the imported SVG object scale.")

    if len(curves) > 1:
        _set_active_object(context, curves[0])
        join_result = bpy.ops.object.join()
        if not _finished(join_result):
            raise RuntimeError("Blender could not join the SVG paths into one curve object.")

    joined = _active_object(context)
    if joined is None or getattr(joined, "type", None) != "CURVE":
        raise RuntimeError("Blender did not produce a joined curve from the imported SVG.")
    return joined


def _raise_curve_tessellation_resolution(curve_obj) -> None:
    curve_data = getattr(curve_obj, "data", None)
    if curve_data is None or not hasattr(curve_data, "resolution_u"):
        raise RuntimeError(
            f"Imported SVG '{curve_obj.name}' does not expose Blender curve resolution."
        )

    try:
        target_resolution = max(int(curve_data.resolution_u), SVG_CURVE_RESOLUTION_U)
    except (TypeError, ValueError, OverflowError) as exc:
        raise RuntimeError(
            f"Imported SVG '{curve_obj.name}' has an invalid Blender curve resolution."
        ) from exc

    curve_data.resolution_u = target_resolution
    for spline in getattr(curve_data, "splines", ()):
        if hasattr(spline, "resolution_u"):
            spline.resolution_u = max(int(spline.resolution_u), target_resolution)

    if int(curve_data.resolution_u) < SVG_CURVE_RESOLUTION_U:
        raise RuntimeError(
            f"Imported SVG '{curve_obj.name}' could not enable smooth curve tessellation."
        )


def _update_view_layer(context) -> None:
    update = getattr(getattr(context, "view_layer", None), "update", None)
    if callable(update):
        update()


def _fit_curve_xy_dimensions(context, curve_obj, width_bu: float, height_bu: float) -> None:
    _update_view_layer(context)
    current_width = float(curve_obj.dimensions.x)
    current_height = float(curve_obj.dimensions.y)
    if not math.isfinite(current_width) or current_width <= 0.0:
        raise RuntimeError(f"Imported SVG '{curve_obj.name}' has no measurable X dimension.")
    if not math.isfinite(current_height) or current_height <= 0.0:
        raise RuntimeError(f"Imported SVG '{curve_obj.name}' has no measurable Y dimension.")

    curve_obj.scale.x *= width_bu / current_width
    curve_obj.scale.y *= height_bu / current_height
    _select_only(context, [curve_obj])
    transform_result = bpy.ops.object.transform_apply(
        location=False,
        rotation=False,
        scale=True,
    )
    if not _finished(transform_result):
        raise RuntimeError("Blender could not apply the physical Illustrator X/Y dimensions.")

    _update_view_layer(context)
    tolerance_x = max(1e-9, width_bu * 1e-5)
    tolerance_y = max(1e-9, height_bu * 1e-5)
    if not math.isclose(float(curve_obj.dimensions.x), width_bu, rel_tol=1e-5, abs_tol=tolerance_x):
        raise RuntimeError(f"Imported SVG '{curve_obj.name}' did not preserve its Illustrator X dimension.")
    if not math.isclose(float(curve_obj.dimensions.y), height_bu, rel_tol=1e-5, abs_tol=tolerance_y):
        raise RuntimeError(f"Imported SVG '{curve_obj.name}' did not preserve its Illustrator Y dimension.")


def _set_symmetric_curve_thickness(context, curve_obj, thickness_bu: float) -> None:
    curve_data = curve_obj.data
    curve_data.dimensions = "2D"
    if hasattr(curve_data, "fill_mode"):
        curve_data.fill_mode = "BOTH"
    if hasattr(curve_data, "offset"):
        curve_data.offset = 0.0
    if hasattr(curve_data, "bevel_depth"):
        curve_data.bevel_depth = 0.0

    # Blender's SVG importer can bake a large scale into Curve data.  In that
    # case Curve.extrude is not a 1:1 Blender-unit value even after the object
    # scale has been applied.  Measure one trial extrusion in evaluated world
    # space, then compensate for the importer-specific factor before converting
    # to a mesh.
    curve_data.extrude = thickness_bu / 2.0
    _update_view_layer(context)
    trial_world_thickness = float(curve_obj.dimensions.z)
    if not math.isfinite(trial_world_thickness) or trial_world_thickness <= 0.0:
        raise RuntimeError(f"Imported SVG '{curve_obj.name}' could not produce measurable thickness.")

    curve_data.extrude *= thickness_bu / trial_world_thickness
    _update_view_layer(context)
    actual_world_thickness = float(curve_obj.dimensions.z)
    tolerance = max(1e-9, thickness_bu * 1e-5)
    if not math.isclose(actual_world_thickness, thickness_bu, rel_tol=1e-5, abs_tol=tolerance):
        raise RuntimeError(
            f"Imported SVG '{curve_obj.name}' could not be calibrated to {thickness_bu:g} "
            "Blender units of thickness."
        )


def _convert_active_curve_to_mesh(context):
    convert_result = bpy.ops.object.convert(target="MESH")
    if not _finished(convert_result):
        raise RuntimeError("Blender could not convert the extruded SVG curve to a mesh.")
    mesh_obj = _active_object(context)
    if mesh_obj is None or getattr(mesh_obj, "type", None) != "MESH":
        raise RuntimeError("Blender did not produce a mesh from the extruded SVG curve.")
    return mesh_obj


def _mesh_integrity_length_epsilon(mesh_obj) -> float:
    dimensions = getattr(mesh_obj, "dimensions", None)
    extents = []
    for axis in ("x", "y", "z"):
        try:
            extent = abs(float(getattr(dimensions, axis)))
        except (AttributeError, TypeError, ValueError):
            continue
        if math.isfinite(extent):
            extents.append(extent)
    largest_extent = max(extents, default=1.0)
    # Blender mesh coordinates are single precision. This remains far below a
    # printable feature while scaling consistently with the imported artwork.
    return max(1e-12, largest_extent * 1e-9)


def _refresh_bmesh_lookup_tables(bm) -> None:
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()


def _vertex_xyz(vertex) -> tuple[float, float, float]:
    coordinate = vertex.co
    return float(coordinate.x), float(coordinate.y), float(coordinate.z)


def _vertex_distance(first, second) -> float:
    first_xyz = _vertex_xyz(first)
    second_xyz = _vertex_xyz(second)
    return math.sqrt(sum((first_xyz[index] - second_xyz[index]) ** 2 for index in range(3)))


def _safe_collinear_cap_middle_vertex(face, length_epsilon: float):
    if len(face.verts) != 3:
        return None
    area = float(face.calc_area())
    if not math.isfinite(area) or area > 0.0:
        return None

    coordinates = [_vertex_xyz(vertex) for vertex in face.verts]
    if not all(math.isfinite(component) for coordinate in coordinates for component in coordinate):
        return None
    z_values = [coordinate[2] for coordinate in coordinates]
    if max(z_values) - min(z_values) > length_epsilon:
        return None

    # The vertex opposite the longest edge is the redundant middle point of a
    # collinear three-point cap triangle. Requiring all three edges to have real
    # length prevents this cleanup from hiding collapsed vertices.
    edge_candidates = [
        (_vertex_distance(face.verts[0], face.verts[1]), 2),
        (_vertex_distance(face.verts[1], face.verts[2]), 0),
        (_vertex_distance(face.verts[2], face.verts[0]), 1),
    ]
    if any(not math.isfinite(length) or length <= length_epsilon for length, _ in edge_candidates):
        return None
    edge_candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    longest_length, middle_index = edge_candidates[0]
    other_lengths = [candidate[0] for candidate in edge_candidates[1:]]
    if math.isclose(longest_length, other_lengths[0], rel_tol=1e-7, abs_tol=length_epsilon):
        return None
    # At millimeter scene scales Blender's float coordinates can make an
    # exactly zero-area collinear triangle miss the edge-sum identity by a few
    # coordinate ULPs. Keep this allowance separate from both the seam weld and
    # collapsed-edge thresholds so only the collinearity proof is relaxed.
    collinearity_epsilon = length_epsilon * 100.0
    if not math.isclose(
        longest_length,
        other_lengths[0] + other_lengths[1],
        rel_tol=1e-7,
        abs_tol=collinearity_epsilon,
    ):
        return None
    return face.verts[middle_index]


def _dissolve_safe_zero_area_cap_vertices(bm, length_epsilon: float) -> int:
    dissolved_count = 0
    maximum_dissolves = len(bm.verts)
    while True:
        middle_vertex = None
        for face in list(bm.faces):
            middle_vertex = _safe_collinear_cap_middle_vertex(face, length_epsilon)
            if middle_vertex is not None:
                break
        if middle_vertex is None:
            return dissolved_count

        # Dissolving one cap seam changes its neighboring cap/side topology.
        # Re-evaluate the remaining faces after every operation; a vertex that
        # looked redundant in the original snapshot may no longer be safe once
        # an adjacent seam has been removed.
        bmesh.ops.dissolve_verts(
            bm,
            verts=[middle_vertex],
            use_face_split=False,
            use_boundary_tear=False,
        )
        dissolved_count += 1
        if dissolved_count > maximum_dissolves:
            raise RuntimeError("Blender could not converge while cleaning collinear cap vertices.")
        _refresh_bmesh_lookup_tables(bm)


def _vertex_xyz(vertex) -> tuple[float, float, float]:
    coordinate = vertex.co
    return float(coordinate.x), float(coordinate.y), float(coordinate.z)


def _face_z_span(face) -> float:
    z_values = [float(vertex.co.z) for vertex in face.verts]
    return max(z_values) - min(z_values)


def _normalized_face_normal(face) -> tuple[float, float, float] | None:
    normal = getattr(face, "normal", None)
    if normal is None:
        return None
    x = float(normal.x)
    y = float(normal.y)
    z = float(normal.z)
    length = math.sqrt((x * x) + (y * y) + (z * z))
    if not math.isfinite(length) or length <= 0.0:
        return None
    return x / length, y / length, z / length


def _point_is_on_segment(point, first, second, tolerance: float) -> bool:
    segment = tuple(second[index] - first[index] for index in range(3))
    offset = tuple(point[index] - first[index] for index in range(3))
    squared_length = sum(component * component for component in segment)
    if squared_length <= tolerance * tolerance:
        return False
    projection = sum(offset[index] * segment[index] for index in range(3)) / squared_length
    parameter_tolerance = tolerance / math.sqrt(squared_length)
    if projection < -parameter_tolerance or projection > 1.0 + parameter_tolerance:
        return False
    closest = tuple(first[index] + (projection * segment[index]) for index in range(3))
    squared_distance = sum((point[index] - closest[index]) ** 2 for index in range(3))
    return squared_distance <= tolerance * tolerance


def _face_component_data(bm):
    component_by_face = {}
    component_z_bounds = {}
    component_index = 0
    for seed in bm.faces:
        if seed.index in component_by_face:
            continue
        pending = [seed]
        component_by_face[seed.index] = component_index
        minimum_z = math.inf
        maximum_z = -math.inf
        while pending:
            face = pending.pop()
            for vertex in face.verts:
                z_value = float(vertex.co.z)
                minimum_z = min(minimum_z, z_value)
                maximum_z = max(maximum_z, z_value)
            for edge in face.edges:
                for linked_face in edge.link_faces:
                    if linked_face.index in component_by_face:
                        continue
                    component_by_face[linked_face.index] = component_index
                    pending.append(linked_face)
        component_z_bounds[component_index] = (minimum_z, maximum_z)
        component_index += 1
    return component_by_face, component_z_bounds


def _is_safe_cap_side_boundary_subdivision(
    first_face,
    second_face,
    component_z_bounds,
    tolerance: float,
) -> bool:
    first_span = _face_z_span(first_face)
    second_span = _face_z_span(second_face)
    if len(first_face.verts) == 3 and first_span <= tolerance and len(second_face.verts) == 4:
        cap_face = first_face
        side_face = second_face
    elif len(second_face.verts) == 3 and second_span <= tolerance and len(first_face.verts) == 4:
        cap_face = second_face
        side_face = first_face
    else:
        return False

    cap_normal = _normalized_face_normal(cap_face)
    side_normal = _normalized_face_normal(side_face)
    if cap_normal is None or side_normal is None:
        return False
    if abs(cap_normal[0]) > 1e-3 or abs(cap_normal[1]) > 1e-3:
        return False
    if abs(side_normal[2]) > 1e-3:
        return False

    component_minimum_z, component_maximum_z = component_z_bounds
    if component_maximum_z - component_minimum_z <= tolerance:
        return False
    cap_z = sum(float(vertex.co.z) for vertex in cap_face.verts) / len(cap_face.verts)
    if abs(cap_z - component_minimum_z) <= tolerance and cap_normal[2] < -0.999:
        opposite_z = component_maximum_z
    elif abs(cap_z - component_maximum_z) <= tolerance and cap_normal[2] > 0.999:
        opposite_z = component_minimum_z
    else:
        return False

    cap_plane_vertices = [
        vertex for vertex in side_face.verts if abs(float(vertex.co.z) - cap_z) <= tolerance
    ]
    opposite_plane_vertices = [
        vertex for vertex in side_face.verts if abs(float(vertex.co.z) - opposite_z) <= tolerance
    ]
    if len(cap_plane_vertices) != 2 or len(opposite_plane_vertices) != 2:
        return False
    if len({vertex.index for vertex in cap_plane_vertices + opposite_plane_vertices}) != 4:
        return False

    contact_vertex_indices = {vertex.index for vertex in cap_plane_vertices}
    contact_edges = [
        edge
        for edge in side_face.edges
        if {vertex.index for vertex in edge.verts} == contact_vertex_indices
    ]
    if len(contact_edges) != 1:
        return False
    contact_edge = contact_edges[0]
    if not bool(contact_edge.is_manifold) or len(contact_edge.link_faces) != 2:
        return False

    contact_points = [_vertex_xyz(vertex) for vertex in cap_plane_vertices]
    matching_cap_edges = []
    for edge in cap_face.edges:
        if not bool(edge.is_manifold) or len(edge.link_faces) != 2 or len(edge.verts) != 2:
            continue
        first = _vertex_xyz(edge.verts[0])
        second = _vertex_xyz(edge.verts[1])
        if all(_point_is_on_segment(point, first, second, tolerance) for point in contact_points):
            matching_cap_edges.append(edge)
    return len(matching_cap_edges) == 1


def _non_adjacent_bvh_overlap_count(bm, length_epsilon: float) -> int:
    try:
        tree = BVHTree.FromBMesh(bm, epsilon=0.0)
        overlap_pairs = tree.overlap(tree)
    except Exception as exc:
        raise RuntimeError(f"Blender could not check the SVG mesh for self-intersections: {exc}") from exc

    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    component_by_face, component_z_bounds = _face_component_data(bm)
    contact_tolerance = length_epsilon * 10.0
    unique_pairs = set()
    intersecting_pairs = 0
    face_count = len(bm.faces)
    for raw_first, raw_second in overlap_pairs:
        first = int(raw_first)
        second = int(raw_second)
        if first == second:
            continue
        pair = (min(first, second), max(first, second))
        if pair in unique_pairs:
            continue
        unique_pairs.add(pair)
        if pair[0] < 0 or pair[1] >= face_count:
            raise RuntimeError("Blender returned an invalid face index while checking SVG mesh overlap.")

        first_vertices = {vertex.index for vertex in bm.faces[pair[0]].verts}
        second_vertices = {vertex.index for vertex in bm.faces[pair[1]].verts}
        # Neighboring faces normally touch along an edge or vertex. BVH reports
        # those contacts too; the one safe disjoint-index subdivision is handled
        # separately below.
        if first_vertices.intersection(second_vertices):
            continue
        first_component = component_by_face[pair[0]]
        if first_component == component_by_face[pair[1]] and _is_safe_cap_side_boundary_subdivision(
            bm.faces[pair[0]],
            bm.faces[pair[1]],
            component_z_bounds[first_component],
            contact_tolerance,
        ):
            # Blender can triangulate the cap boundary more coarsely than its
            # sidewall. BVH then reports a disjoint-index cap/side contact even
            # though the wall edge lies wholly on one manifold outer cap edge.
            continue
        intersecting_pairs += 1
    return intersecting_pairs


def _validate_mesh_integrity(mesh_obj) -> None:
    mesh_data = getattr(mesh_obj, "data", None)
    if mesh_data is None:
        raise RuntimeError(f"Imported SVG '{mesh_obj.name}' has no mesh data to validate.")

    bm = bmesh.new()
    try:
        bm.from_mesh(mesh_data)
        bm.verts.ensure_lookup_table()
        if not bm.verts or not bm.faces:
            raise RuntimeError(f"Imported SVG '{mesh_obj.name}' produced an empty surface mesh.")

        length_epsilon = _mesh_integrity_length_epsilon(mesh_obj)
        # Blender's Curve-to-Mesh conversion can leave coincident cap and side
        # vertices as separate topology. Weld only at the same scale-aware
        # sub-precision threshold used to identify collapsed edges, then judge
        # the resulting printable surface.
        try:
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=length_epsilon)
        except Exception as exc:
            raise RuntimeError(
                f"Blender could not weld curve-conversion seams for imported SVG '{mesh_obj.name}': {exc}"
            ) from exc

        _refresh_bmesh_lookup_tables(bm)
        if not bm.verts or not bm.faces:
            raise RuntimeError(f"Imported SVG '{mesh_obj.name}' produced an empty surface mesh after welding.")

        try:
            _dissolve_safe_zero_area_cap_vertices(bm, length_epsilon)
        except Exception as exc:
            raise RuntimeError(
                f"Blender could not clean collinear cap vertices for imported SVG '{mesh_obj.name}': {exc}"
            ) from exc
        _refresh_bmesh_lookup_tables(bm)
        if not bm.verts or not bm.faces:
            raise RuntimeError(f"Imported SVG '{mesh_obj.name}' produced an empty surface mesh after cap cleanup.")

        try:
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.normal_update()
        except Exception as exc:
            raise RuntimeError(
                f"Blender could not recalculate normals for imported SVG '{mesh_obj.name}': {exc}"
            ) from exc

        boundary_edges = sum(1 for edge in bm.edges if bool(edge.is_boundary))
        other_non_manifold_edges = sum(
            1 for edge in bm.edges if not bool(edge.is_manifold) and not bool(edge.is_boundary)
        )
        zero_length_edges = 0
        for edge in bm.edges:
            edge_length = float(edge.calc_length())
            if not math.isfinite(edge_length) or edge_length <= length_epsilon:
                zero_length_edges += 1
        degenerate_faces = 0
        duplicate_faces = 0
        seen_face_vertices = set()
        for face in bm.faces:
            area = float(face.calc_area())
            if len(face.verts) < 3 or not math.isfinite(area) or area <= 0.0:
                degenerate_faces += 1
            face_vertices = tuple(sorted(vertex.index for vertex in face.verts))
            if face_vertices in seen_face_vertices:
                duplicate_faces += 1
            else:
                seen_face_vertices.add(face_vertices)

        intersecting_pairs = _non_adjacent_bvh_overlap_count(bm, length_epsilon)
        issues = []
        if boundary_edges:
            issues.append(f"{boundary_edges} boundary edge(s)")
        if other_non_manifold_edges:
            issues.append(f"{other_non_manifold_edges} non-manifold edge(s)")
        if zero_length_edges:
            issues.append(f"{zero_length_edges} zero-length edge(s)")
        if degenerate_faces:
            issues.append(f"{degenerate_faces} degenerate face(s)")
        if duplicate_faces:
            issues.append(f"{duplicate_faces} duplicate face(s)")
        if intersecting_pairs:
            issues.append(f"{intersecting_pairs} intersecting face pair(s)")
        if issues:
            raise RuntimeError(
                f"Imported SVG '{mesh_obj.name}' produced an unsafe extrusion mesh: "
                + ", ".join(issues)
                + ". Clean and unite the source paths before exporting."
            )

        bm.to_mesh(mesh_data)
    finally:
        bm.free()

    update = getattr(mesh_data, "update", None)
    if callable(update):
        update()


def _world_xyz_bounds(mesh_obj):
    vertices = list(getattr(mesh_obj.data, "vertices", []))
    if not vertices:
        raise RuntimeError(f"Imported SVG '{mesh_obj.name}' produced an empty mesh.")
    world_points = [mesh_obj.matrix_world @ vertex.co for vertex in vertices]
    world_x = [float(point.x) for point in world_points]
    world_y = [float(point.y) for point in world_points]
    world_z = [float(point.z) for point in world_points]
    return (min(world_x), max(world_x)), (min(world_y), max(world_y)), (min(world_z), max(world_z))


def _world_z_bounds(mesh_obj) -> tuple[float, float]:
    return _world_xyz_bounds(mesh_obj)[2]


def _set_mesh_base_to_world_zero(mesh_obj, expected_thickness_bu: float) -> None:
    minimum_z, maximum_z = _world_z_bounds(mesh_obj)
    actual_thickness = maximum_z - minimum_z
    tolerance = max(1e-9, expected_thickness_bu * 1e-5)
    if not math.isclose(actual_thickness, expected_thickness_bu, rel_tol=1e-5, abs_tol=tolerance):
        raise RuntimeError(
            f"Imported SVG '{mesh_obj.name}' produced {actual_thickness:g} Blender units of thickness; "
            f"expected {expected_thickness_bu:g}."
        )
    mesh_obj.location.z -= minimum_z


def _set_mesh_world_xy_center(context, mesh_obj, target_x_bu: float, target_y_bu: float) -> None:
    if getattr(mesh_obj, "parent", None) is not None:
        raise RuntimeError(f"Imported SVG '{mesh_obj.name}' unexpectedly has a parent transform.")

    _update_view_layer(context)
    x_bounds, y_bounds, _ = _world_xyz_bounds(mesh_obj)
    mesh_obj.location.x += target_x_bu - ((x_bounds[0] + x_bounds[1]) / 2.0)
    mesh_obj.location.y += target_y_bu - ((y_bounds[0] + y_bounds[1]) / 2.0)
    _update_view_layer(context)

    final_x_bounds, final_y_bounds, _ = _world_xyz_bounds(mesh_obj)
    final_x = (final_x_bounds[0] + final_x_bounds[1]) / 2.0
    final_y = (final_y_bounds[0] + final_y_bounds[1]) / 2.0
    # Imported SVG mesh coordinates are single precision and can retain very
    # large baked-in coordinates even after the visible dimensions are fitted.
    # At a target of zero, using only the target value made the validation far
    # more precise than the mesh can represent.  Measure tolerance from the
    # physical span so it remains the same real-world fraction at every scene
    # unit scale.
    final_width = final_x_bounds[1] - final_x_bounds[0]
    final_height = final_y_bounds[1] - final_y_bounds[0]
    tolerance_x = max(1e-9, final_width * 1e-5, abs(target_x_bu) * 1e-5)
    tolerance_y = max(1e-9, final_height * 1e-5, abs(target_y_bu) * 1e-5)
    if not math.isclose(final_x, target_x_bu, rel_tol=1e-5, abs_tol=tolerance_x):
        raise RuntimeError(f"Imported SVG '{mesh_obj.name}' did not preserve its Illustrator X position.")
    if not math.isclose(final_y, target_y_bu, rel_tol=1e-5, abs_tol=tolerance_y):
        raise RuntimeError(f"Imported SVG '{mesh_obj.name}' did not preserve its Illustrator Y position.")


def _ensure_top_level_live_collection(context):
    collections = bpy.data.collections
    live_collection = collections.get("Live")
    if live_collection is None:
        live_collection = collections.new("Live")

    scene_children = context.scene.collection.children
    root_link_added = not _contains_identity(scene_children, live_collection)
    if root_link_added:
        scene_children.link(live_collection)
    return live_collection, root_link_added


def _link_object_only_to_collection(obj, target_collection) -> None:
    if not _contains_identity(target_collection.objects, obj):
        target_collection.objects.link(obj)
    for collection in list(getattr(obj, "users_collection", [])):
        if not _contains_identity([target_collection], collection):
            collection.objects.unlink(obj)

    users = list(getattr(obj, "users_collection", []))
    if len(users) != 1 or not _contains_identity(users, target_collection):
        raise RuntimeError(f"Imported SVG '{obj.name}' could not be linked exclusively to Live.")


def _remove_collection(collection) -> None:
    try:
        bpy.data.collections.remove(collection, do_unlink=True)
    except TypeError:
        bpy.data.collections.remove(collection)


def _remove_now_empty_new_collections(before_collection_ids) -> None:
    pending = _new_since(bpy.data.collections, before_collection_ids)
    while pending:
        removed_any = False
        for collection in list(reversed(pending)):
            if len(collection.objects) == 0 and len(collection.children) == 0:
                _remove_collection(collection)
                pending.remove(collection)
                removed_any = True
        if not removed_any:
            break
    if pending:
        names = ", ".join(getattr(collection, "name", "<unknown>") for collection in pending)
        raise RuntimeError(f"Blender left non-empty SVG importer collections: {names}.")


def _remove_new_orphan_curve_data(before_curve_ids) -> None:
    new_curves = _new_since(bpy.data.curves, before_curve_ids)
    curves_with_users = []
    for curve_data in new_curves:
        try:
            users = int(curve_data.users)
        except (AttributeError, TypeError, ValueError) as exc:
            raise RuntimeError(
                f"Blender could not verify users for imported Curve data "
                f"'{getattr(curve_data, 'name', '<unknown>')}'."
            ) from exc
        if users != 0:
            curves_with_users.append((curve_data, users))

    if curves_with_users:
        details = ", ".join(
            f"{getattr(curve_data, 'name', '<unknown>')} ({users} user(s))"
            for curve_data, users in curves_with_users
        )
        raise RuntimeError(f"Blender left imported Curve data with active users: {details}.")

    for curve_data in reversed(new_curves):
        bpy.data.curves.remove(curve_data)

    remaining = _new_since(bpy.data.curves, before_curve_ids)
    if remaining:
        names = ", ".join(getattr(curve_data, "name", "<unknown>") for curve_data in remaining)
        raise RuntimeError(f"Blender could not remove orphan imported Curve data: {names}.")


def _import_one_svg(context, item, live_collection):
    before_object_ids = _identity_ids(bpy.data.objects)
    before_collection_ids = _identity_ids(bpy.data.collections)
    filepath = str(item["filepath"])

    import_result = bpy.ops.import_curve.svg(filepath=filepath)
    if not _finished(import_result):
        raise RuntimeError(f"Blender did not finish importing '{filepath}'.")

    imported = _new_since(bpy.data.objects, before_object_ids)
    if not imported:
        raise RuntimeError(f"Blender created no objects while importing '{filepath}'.")
    non_curves = [obj.name for obj in imported if getattr(obj, "type", None) != "CURVE"]
    if non_curves:
        raise RuntimeError(
            f"Blender imported unsupported non-curve objects from '{filepath}': {', '.join(non_curves)}"
        )

    curve_obj = _join_imported_curves(context, imported)
    _raise_curve_tessellation_resolution(curve_obj)
    width_bu = millimeters_to_blender_units(context.scene, item["widthMm"])
    height_bu = millimeters_to_blender_units(context.scene, item["heightMm"])
    _fit_curve_xy_dimensions(context, curve_obj, width_bu, height_bu)
    thickness_bu = millimeters_to_blender_units(context.scene, item["thicknessMm"])
    _set_symmetric_curve_thickness(context, curve_obj, thickness_bu)
    mesh_obj = _convert_active_curve_to_mesh(context)

    remaining_imported = _new_since(bpy.data.objects, before_object_ids)
    if len(remaining_imported) != 1 or _identity_key(remaining_imported[0]) != _identity_key(mesh_obj):
        raise RuntimeError(f"Blender did not reduce '{filepath}' to exactly one imported object.")

    mesh_obj.name = item["layerName"]
    if getattr(mesh_obj, "data", None) is not None:
        mesh_obj.data.name = f"{mesh_obj.name} Mesh"
    _validate_mesh_integrity(mesh_obj)
    _set_mesh_base_to_world_zero(mesh_obj, thickness_bu)
    offset_x_bu = millimeter_offset_to_blender_units(context.scene, item["offsetXmm"])
    offset_y_bu = millimeter_offset_to_blender_units(context.scene, item["offsetYmm"])
    _set_mesh_world_xy_center(context, mesh_obj, offset_x_bu, offset_y_bu)
    _link_object_only_to_collection(mesh_obj, live_collection)
    _remove_now_empty_new_collections(before_collection_ids)
    return mesh_obj


def _rollback_new_scene_ids(
    before_object_ids,
    before_collection_ids,
    before_curve_ids,
    before_mesh_ids,
) -> list[str]:
    errors = []
    for obj in reversed(_new_since(bpy.data.objects, before_object_ids)):
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception as exc:  # Rollback must continue through every new ID.
            errors.append(f"object '{getattr(obj, 'name', '<unknown>')}': {exc}")

    for data_label, data_blocks, before_ids in (
        ("curve", bpy.data.curves, before_curve_ids),
        ("mesh", bpy.data.meshes, before_mesh_ids),
    ):
        for data_block in reversed(_new_since(data_blocks, before_ids)):
            try:
                data_blocks.remove(data_block, do_unlink=True)
            except TypeError:
                try:
                    data_blocks.remove(data_block)
                except Exception as exc:  # pragma: no cover - Blender-version fallback.
                    errors.append(
                        f"{data_label} data '{getattr(data_block, 'name', '<unknown>')}': {exc}"
                    )
            except Exception as exc:
                errors.append(f"{data_label} data '{getattr(data_block, 'name', '<unknown>')}': {exc}")

    for collection in reversed(_new_since(bpy.data.collections, before_collection_ids)):
        try:
            bpy.data.collections.remove(collection, do_unlink=True)
        except TypeError:
            try:
                bpy.data.collections.remove(collection)
            except Exception as exc:  # pragma: no cover - Blender-version fallback.
                errors.append(f"collection '{getattr(collection, 'name', '<unknown>')}': {exc}")
        except Exception as exc:
            errors.append(f"collection '{getattr(collection, 'name', '<unknown>')}': {exc}")
    return errors


def _restore_selection(context, selected_before, active_before) -> None:
    try:
        bpy.ops.object.select_all(action="DESELECT")
    except Exception:
        return
    for obj in selected_before:
        if _contains_identity(bpy.data.objects, obj) and _object_is_in_view_layer(context, obj):
            try:
                obj.select_set(True)
            except Exception:
                pass
    if active_before is not None and _contains_identity(bpy.data.objects, active_before):
        try:
            _set_active_object(context, active_before)
        except Exception:
            pass


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    before_object_ids = _identity_ids(bpy.data.objects)
    before_collection_ids = _identity_ids(bpy.data.collections)
    before_curve_ids = _identity_ids(bpy.data.curves)
    before_mesh_ids = _identity_ids(bpy.data.meshes)
    selected_before = list(getattr(ctx, "selected_objects", []))
    active_before = _active_object(ctx)
    live_collection = None
    live_root_link_added = False

    try:
        items = _validated_items(data)
        _ensure_object_mode(ctx)
        live_collection, live_root_link_added = _ensure_top_level_live_collection(ctx)
        results = []
        result_objects = []
        for item in items:
            result_obj = _import_one_svg(ctx, item, live_collection)
            result_objects.append(result_obj)
            results.append(
                {
                    "filepath": str(item["filepath"]),
                    "layerName": item["layerName"],
                    "objectName": result_obj.name,
                    "thicknessMm": item["thicknessMm"],
                    "widthMm": item["widthMm"],
                    "heightMm": item["heightMm"],
                    "offsetXmm": item["offsetXmm"],
                    "offsetYmm": item["offsetYmm"],
                }
            )

        _remove_new_orphan_curve_data(before_curve_ids)
        _select_only(ctx, result_objects)
        imported_names = [obj.name for obj in result_objects]
        imported_count = len(result_objects)
        return {
            "status": "FINISHED",
            "message": (
                f"Imported {imported_count} Illustrator SVG layer(s) with physical dimensions "
                "and selection-relative positions."
            ),
            "changed": imported_count,
            "importedCount": imported_count,
            "dimensionsPreserved": True,
            "relativePositionsPreserved": True,
            "imported_objects": imported_names,
            "results": results,
        }
    except Exception as exc:
        rollback_errors = []
        if live_collection is not None and live_root_link_added:
            try:
                scene_children = ctx.scene.collection.children
                if _contains_identity(scene_children, live_collection):
                    scene_children.unlink(live_collection)
            except Exception as unlink_exc:
                rollback_errors.append(f"Live scene link: {unlink_exc}")
        rollback_errors.extend(
            _rollback_new_scene_ids(
                before_object_ids,
                before_collection_ids,
                before_curve_ids,
                before_mesh_ids,
            )
        )
        _restore_selection(ctx, selected_before, active_before)
        message = f"Illustrator SVG import failed; the batch was rolled back: {exc}"
        if rollback_errors:
            message += " Rollback also reported: " + "; ".join(rollback_errors)
        raise RuntimeError(message) from exc
