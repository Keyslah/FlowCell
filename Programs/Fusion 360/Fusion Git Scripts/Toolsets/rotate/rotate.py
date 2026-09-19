"""FlowCell Quick Rotate toolset for Autodesk Fusion.

Selected native root-component BRepBody objects are rotated with timeline
MoveFeature free moves. Selected Occurrence objects are rotated with
root-component transforms (and a transform2 fallback). Rotations always use
Fusion world X/Y/Z axes.
"""

from __future__ import annotations

import math

import adsk.core
import adsk.fusion


SUPPORTED_AXES = {"X", "Y", "Z"}
SUPPORTED_CENTER_MODES = {"GEOMETRY", "ORIGIN", "WORLD", "PICK", "OBJECT"}
EPSILON = 1.0e-12


def _result(status="ok", message="", changed=0, **extra):
    return {"status": status, "message": message, "display": message, "changed": changed, **extra}


def _runtime(context=None):
    app = None
    ui = None
    design = None
    if isinstance(context, dict):
        app = context.get("application") or context.get("app")
        ui = context.get("ui")
        design = context.get("design")
    elif context is not None:
        app = getattr(context, "application", None) or getattr(context, "app", None)
        ui = getattr(context, "ui", None)
        design = getattr(context, "design", None)

    app = app or adsk.core.Application.get()
    if app is None:
        raise RuntimeError("Fusion is not available. Open a Fusion design and try Rotate again.")
    ui = ui or getattr(app, "userInterface", None)
    if ui is None:
        raise RuntimeError("Fusion's user interface is unavailable.")
    design = design or adsk.fusion.Design.cast(getattr(app, "activeProduct", None))
    if design is None:
        raise RuntimeError("Rotate requires an active Fusion Design document.")
    return app, ui, design


def _cast_entity(entity):
    try:
        body = adsk.fusion.BRepBody.cast(entity)
    except Exception:
        body = None
    if body is not None:
        return "body", body
    try:
        occurrence = adsk.fusion.Occurrence.cast(entity)
    except Exception:
        occurrence = None
    if occurrence is not None:
        return "occurrence", occurrence
    return None, None


def _entity_label(entity):
    return str(
        getattr(entity, "fullPathName", None)
        or getattr(entity, "name", None)
        or getattr(entity, "objectType", None)
        or type(entity).__name__
    )


def _selected_records(ui):
    selections = getattr(ui, "activeSelections", None)
    count = int(getattr(selections, "count", 0) or 0)
    if count == 0:
        raise ValueError("Select at least one BRep body or component occurrence to rotate.")

    records = []
    unsupported = []
    for index in range(count):
        selection = selections.item(index)
        entity = getattr(selection, "entity", None)
        kind, cast_entity = _cast_entity(entity)
        if cast_entity is None:
            unsupported.append(f"#{index + 1} {_entity_label(entity)}")
            continue
        records.append(
            {
                "kind": kind,
                "entity": cast_entity,
                "selection": selection,
                "point": getattr(selection, "point", None),
                "label": _entity_label(cast_entity),
                "token": str(getattr(cast_entity, "entityToken", "") or ""),
            }
        )
    if unsupported:
        raise ValueError(
            "Rotate supports only BRepBody and Occurrence selections. Unsupported selection(s): "
            + ", ".join(unsupported)
            + ". Select bodies/components only."
        )
    return records


def _xyz(point):
    return (float(point.x), float(point.y), float(point.z))


def _point(values):
    return adsk.core.Point3D.create(float(values[0]), float(values[1]), float(values[2]))


def _vector(values):
    return adsk.core.Vector3D.create(float(values[0]), float(values[1]), float(values[2]))


def _same_component(left, right):
    return left is right or left == right


def _require_parametric_design(design):
    design_types = getattr(adsk.fusion, "DesignTypes", None)
    parametric = getattr(design_types, "ParametricDesignType", None)
    current = getattr(design, "designType", None)
    if parametric is not None and current is not None and current != parametric:
        raise ValueError(
            "Rotate requires Capture Design History so Fusion can create reversible Move features."
        )


def _require_instance_safe_bodies(records, design):
    root = getattr(design, "rootComponent", None)
    for record in records:
        if record["kind"] != "body":
            continue
        body = record["entity"]
        if getattr(body, "assemblyContext", None) is not None or not _same_component(
            getattr(body, "parentComponent", None), root
        ):
            raise ValueError(
                "Rotate accepts native root-component bodies or whole component occurrences. "
                "Select the occurrence instead of a body inside a component instance."
            )


def _body_context_occurrence(body, design):
    assembly_context = getattr(body, "assemblyContext", None)
    if assembly_context is not None:
        return assembly_context
    parent = getattr(body, "parentComponent", None)
    root = getattr(design, "rootComponent", None)
    if parent is None or _same_component(parent, root):
        return None
    active = getattr(design, "activeOccurrence", None)
    if active is not None and _same_component(getattr(active, "component", None), parent):
        return active
    raise ValueError(
        f"Body '{_entity_label(body)}' is outside the root/active component context. "
        "Activate its component before selecting the body, or select its occurrence instead."
    )


def _inverted_matrix(matrix):
    inverse = matrix.copy()
    if not inverse.invert():
        raise RuntimeError("Fusion could not invert the selected component transform.")
    return inverse


def _transform_point_xyz(values, matrix):
    point = _point(values)
    if not point.transformBy(matrix):
        raise RuntimeError("Fusion could not transform a point into design space.")
    return _xyz(point)


def _body_bounds_are_world(body, design):
    if getattr(body, "assemblyContext", None) is not None:
        return True
    parent = getattr(body, "parentComponent", None)
    return parent is None or _same_component(parent, getattr(design, "rootComponent", None))


def _raw_bounds(entity):
    try:
        bounds = getattr(entity, "preciseBoundingBox", None)
    except Exception:
        bounds = None
    if bounds is None:
        bounds = getattr(entity, "boundingBox", None)
    minimum = getattr(bounds, "minPoint", None)
    maximum = getattr(bounds, "maxPoint", None)
    if minimum is None or maximum is None:
        raise ValueError(f"'{_entity_label(entity)}' does not have usable bounding-box geometry.")
    return _xyz(minimum), _xyz(maximum)


def _transformed_bounds(minimum, maximum, matrix):
    corners = []
    for x in (minimum[0], maximum[0]):
        for y in (minimum[1], maximum[1]):
            for z in (minimum[2], maximum[2]):
                corners.append(_transform_point_xyz((x, y, z), matrix))
    return (
        tuple(min(point[index] for point in corners) for index in range(3)),
        tuple(max(point[index] for point in corners) for index in range(3)),
    )


def _world_bounds(record, design):
    entity = record["entity"]
    minimum, maximum = _raw_bounds(entity)
    if record["kind"] != "body" or _body_bounds_are_world(entity, design):
        return minimum, maximum
    context_occurrence = _body_context_occurrence(entity, design)
    return _transformed_bounds(minimum, maximum, context_occurrence.transform2)


def _world_origin(record, design):
    entity = record["entity"]
    if record["kind"] == "occurrence":
        return _xyz(entity.transform2.translation)
    context_occurrence = _body_context_occurrence(entity, design)
    if context_occurrence is None:
        return (0.0, 0.0, 0.0)
    return _xyz(context_occurrence.transform2.translation)


def _center(bounds):
    minimum, maximum = bounds
    return tuple((minimum[index] + maximum[index]) * 0.5 for index in range(3))


def _average_points(points):
    if not points:
        return (0.0, 0.0, 0.0)
    return tuple(sum(point[index] for point in points) / float(len(points)) for index in range(3))


def _object_mode_targets(records):
    if len(records) < 2:
        raise ValueError(
            "Object pivot needs one or more targets followed by the pivot body/component as the last selection."
        )
    return records[:-1], records[-1]


def _pivot_and_targets(records, design, center_mode):
    mode = str(center_mode or "WORLD").strip().upper()
    if mode not in SUPPORTED_CENTER_MODES:
        raise ValueError(f"Unsupported rotate pivot: {center_mode}")
    if mode == "OBJECT":
        targets, reference = _object_mode_targets(records)
        return _world_origin(reference, design), targets
    if mode == "WORLD":
        return (0.0, 0.0, 0.0), list(records)
    if mode == "GEOMETRY":
        return _average_points([_center(_world_bounds(record, design)) for record in records]), list(records)
    if mode == "ORIGIN":
        return _average_points([_world_origin(record, design) for record in records]), list(records)

    point = records[-1].get("point")
    if point is None:
        raise ValueError(
            "Pick pivot needs a valid selection point. Reselect the last body/component at the desired pivot location."
        )
    return _xyz(point), list(records)


def _axis_values(axis):
    normalized = str(axis or "Z").strip().upper()
    if normalized not in SUPPORTED_AXES:
        raise ValueError(f"Unsupported rotation axis: {axis}")
    if normalized == "X":
        return normalized, (1.0, 0.0, 0.0)
    if normalized == "Y":
        return normalized, (0.0, 1.0, 0.0)
    return normalized, (0.0, 0.0, 1.0)


def _signed_angle_degrees(value, direction):
    try:
        angle = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Rotation angle must be a number, not {value!r}.") from error
    if not math.isfinite(angle):
        raise ValueError("Rotation angle must be finite.")
    normalized = str(direction or "positive").strip().lower()
    if normalized in {"positive", "plus", "+"}:
        return abs(angle)
    if normalized in {"negative", "minus", "-"}:
        return -abs(angle)
    raise ValueError(f"Unsupported quick-rotate direction: {direction}")


def _world_point_to_body_space(body, design, values):
    context_occurrence = _body_context_occurrence(body, design)
    point = _point(values)
    if context_occurrence is None:
        return point
    if not point.transformBy(_inverted_matrix(context_occurrence.transform2)):
        raise RuntimeError(f"Fusion could not resolve the local pivot for '{_entity_label(body)}'.")
    return point


def _world_axis_to_body_space(body, design, values):
    context_occurrence = _body_context_occurrence(body, design)
    axis = _vector(values)
    if context_occurrence is None:
        return axis
    if not axis.transformBy(_inverted_matrix(context_occurrence.transform2)):
        raise RuntimeError(f"Fusion could not resolve the local axis for '{_entity_label(body)}'.")
    if not axis.normalize():
        raise RuntimeError(f"Fusion produced an invalid local axis for '{_entity_label(body)}'.")
    return axis


def _add_body_rotation(design, body, pivot, axis_values, angle_radians):
    native_body = getattr(body, "nativeObject", None) or body
    component = getattr(native_body, "parentComponent", None)
    if component is None:
        raise ValueError(f"Body '{_entity_label(body)}' has no owning component.")

    transform = adsk.core.Matrix3D.create()
    if not transform.setToRotation(
        angle_radians,
        _world_axis_to_body_space(body, design, axis_values),
        _world_point_to_body_space(body, design, pivot),
    ):
        raise RuntimeError(f"Fusion could not construct a body rotation for '{_entity_label(body)}'.")

    entities = adsk.core.ObjectCollection.create()
    entities.add(native_body)
    move_features = component.features.moveFeatures
    move_input = move_features.createInput2(entities)
    if move_input is None:
        raise RuntimeError(f"Fusion could not create a Move Feature input for '{_entity_label(body)}'.")
    if not move_input.defineAsFreeMove(transform):
        raise RuntimeError(f"Fusion could not define a free rotation for '{_entity_label(body)}'.")
    if move_features.add(move_input) is None:
        raise RuntimeError(f"Fusion could not add a Move Feature for '{_entity_label(body)}'.")


def _world_rotation_matrix(pivot, axis_values, angle_radians):
    matrix = adsk.core.Matrix3D.create()
    if not matrix.setToRotation(angle_radians, _vector(axis_values), _point(pivot)):
        raise RuntimeError("Fusion could not construct the requested world-axis rotation.")
    return matrix


def _rotated_occurrence_transform(occurrence, world_rotation):
    current = occurrence.transform2
    origin, x_axis, y_axis, z_axis = current.getAsCoordinateSystem()
    if not origin.transformBy(world_rotation):
        raise RuntimeError(f"Fusion could not rotate the origin of '{_entity_label(occurrence)}'.")
    for direction in (x_axis, y_axis, z_axis):
        if not direction.transformBy(world_rotation):
            raise RuntimeError(f"Fusion could not rotate the axes of '{_entity_label(occurrence)}'.")
    result = adsk.core.Matrix3D.create()
    if not result.setWithCoordinateSystem(origin, x_axis, y_axis, z_axis):
        raise RuntimeError(f"Fusion could not build the new transform for '{_entity_label(occurrence)}'.")
    return result


def _apply_occurrence_transforms(design, occurrences, transforms):
    if not occurrences:
        return
    root = design.rootComponent
    batch_error = None
    try:
        if root.transformOccurrences(occurrences, transforms, True):
            return
    except Exception as error:
        batch_error = error

    try:
        for occurrence, transform in zip(occurrences, transforms):
            occurrence.transform2 = transform
    except Exception as error:
        detail = f" Batch transform error: {batch_error}" if batch_error else ""
        raise RuntimeError(
            "Fusion could not rotate the selected occurrence(s). Check for grounded components, "
            f"read-only references, or assembly constraints.{detail} Fallback error: {error}"
        ) from error


def _apply_rotation(design, records, pivot, axis_values, angle_radians):
    world_rotation = _world_rotation_matrix(pivot, axis_values, angle_radians)
    occurrence_entities = []
    occurrence_transforms = []
    for record in records:
        if record["kind"] == "body":
            _add_body_rotation(design, record["entity"], pivot, axis_values, angle_radians)
        else:
            occurrence_entities.append(record["entity"])
            occurrence_transforms.append(
                _rotated_occurrence_transform(record["entity"], world_rotation)
            )
    _apply_occurrence_transforms(design, occurrence_entities, occurrence_transforms)


def _restore_selection(ui, design, records):
    selections = getattr(ui, "activeSelections", None)
    if selections is None:
        return False
    try:
        if not selections.clear():
            return False
        for record in records:
            entity = record["entity"]
            if not getattr(entity, "isValid", True):
                entity = None
                token = record.get("token")
                if token:
                    for candidate in design.findEntityByToken(token) or []:
                        kind, cast_entity = _cast_entity(candidate)
                        if kind == record["kind"] and cast_entity is not None:
                            entity = cast_entity
                            break
            if entity is None or not selections.add(entity):
                return False
        return int(getattr(selections, "count", 0) or 0) == len(records)
    except Exception:
        return False


def run_flowcell_action(context=None, data=None):
    payload = dict(data or {})
    command = str(payload.get("command") or payload.get("action") or "apply").strip().lower()
    if command in {"status", "state", "probe"}:
        return _result(
            "ok",
            "Fusion Quick Rotate is ready. Distribute is intentionally unavailable in this version.",
            operationMode="TRANSFORM",
        )
    if command != "apply":
        raise ValueError(f"Unsupported Fusion Quick Rotate command: {command}")

    operation_mode = str(payload.get("operation_mode") or "TRANSFORM").strip().upper()
    if operation_mode != "TRANSFORM":
        raise ValueError(
            "Fusion Quick Rotate currently supports TRANSFORM only. Native body/occurrence copying "
            "has different ownership semantics, so DISTRIBUTE is not exposed."
        )

    raw_angle = payload.get("angle_deg", payload.get("value", 15.0))
    if raw_angle is None:
        raw_angle = 15.0
    angle_degrees = _signed_angle_degrees(raw_angle, payload.get("direction", "positive"))
    axis, axis_values = _axis_values(payload.get("axis", "Z"))
    center_mode = str(payload.get("center_mode") or "WORLD").strip().upper()

    _app, ui, design = _runtime(context)
    _require_parametric_design(design)
    records = _selected_records(ui)
    _require_instance_safe_bodies(records, design)
    pivot, targets = _pivot_and_targets(records, design, center_mode)
    if abs(angle_degrees) <= EPSILON:
        return _result(
            "ok",
            "Rotation angle is zero; nothing changed.",
            axis=axis,
            angleDegrees=angle_degrees,
            centerMode=center_mode,
            pivot=list(pivot),
            selectionPreserved=True,
        )

    _apply_rotation(design, targets, pivot, axis_values, math.radians(angle_degrees))
    selection_preserved = _restore_selection(ui, design, records)
    message = (
        f"Rotated {len(targets)} selection(s) {angle_degrees:g} degrees around world {axis} "
        f"using the {center_mode.title()} pivot."
    )
    return _result(
        "ok",
        message,
        changed=len(targets),
        axis=axis,
        angleDegrees=angle_degrees,
        centerMode=center_mode,
        pivot=list(pivot),
        operationMode="TRANSFORM",
        selectionPreserved=selection_preserved,
    )
