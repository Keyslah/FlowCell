"""FlowCell Quick Rotate toolset for Autodesk Fusion.

Mirrors the Blender Rotate tool set. Transform rotates the selected bodies and
components around a world X/Y/Z axis. Distribute keeps the selection and adds
evenly spaced copies around the pivot so the total count fills a full turn.

Bodies rotate with Move features in their own component and are copied with
Copy/Paste Body features. Components rotate with the root batch transform
(released from parent ground and captured as a position snapshot so the next
recompute keeps them) and are copied as new instances of the same component.
"""

from __future__ import annotations

import math

import adsk.core
import adsk.fusion


SUPPORTED_AXES = {"X", "Y", "Z"}
SUPPORTED_CENTER_MODES = {"GEOMETRY", "ORIGIN", "WORLD", "PICK", "OBJECT"}
SUPPORTED_OPERATION_MODES = {"TRANSFORM", "DISTRIBUTE"}
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
        raise ValueError("Select at least one body or component to rotate.")

    records = []
    unsupported = []
    seen = set()
    for index in range(count):
        selection = selections.item(index)
        entity = getattr(selection, "entity", None)
        kind, cast_entity = _cast_entity(entity)
        if cast_entity is None:
            unsupported.append(f"#{index + 1} {_entity_label(entity)}")
            continue
        token = str(getattr(cast_entity, "entityToken", "") or "")
        if token and token in seen:
            continue
        if token:
            seen.add(token)
        records.append(
            {
                "kind": kind,
                "entity": cast_entity,
                "point": getattr(selection, "point", None),
                "label": _entity_label(cast_entity),
                "token": token,
            }
        )
    if unsupported:
        raise ValueError(
            "Rotate supports only bodies and components. Unsupported selection(s): "
            + ", ".join(unsupported)
            + "."
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


def _is_parametric(design):
    design_types = getattr(adsk.fusion, "DesignTypes", None)
    parametric = getattr(design_types, "ParametricDesignType", None)
    current = getattr(design, "designType", None)
    return parametric is None or current is None or current == parametric


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
        "Activate its component before selecting the body, or select its component instead."
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
    if record["kind"] != "body" or getattr(entity, "assemblyContext", None) is not None:
        return minimum, maximum
    context_occurrence = _body_context_occurrence(entity, design)
    if context_occurrence is None:
        return minimum, maximum
    return _transformed_bounds(minimum, maximum, context_occurrence.transform2)


def _center(bounds):
    minimum, maximum = bounds
    return tuple((minimum[index] + maximum[index]) * 0.5 for index in range(3))


def _world_origin(record, design):
    """Component origin for occurrences; bodies have no origin, so use their center."""
    if record["kind"] == "occurrence":
        return _xyz(record["entity"].transform2.translation)
    return _center(_world_bounds(record, design))


def _average_points(points):
    if not points:
        return (0.0, 0.0, 0.0)
    return tuple(sum(point[index] for point in points) / float(len(points)) for index in range(3))


def _object_mode_targets(records):
    if len(records) < 2:
        raise ValueError(
            "Object pivot needs one or more selections to rotate followed by the pivot body/component last."
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
            "Pick pivot needs a picked point. Reselect the last body/component by clicking where the pivot should be."
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


def _distribute_count(value):
    try:
        count = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Distribute count must be a number, not {value!r}.") from error
    if not math.isfinite(count):
        raise ValueError("Distribute count must be finite.")
    count = int(round(count))
    if count < 1:
        raise ValueError("Distribute count must be at least 1.")
    if count > 360:
        raise ValueError("Distribute count must be 360 or fewer.")
    return count


def _world_rotation_matrix(pivot, axis_values, angle_radians):
    matrix = adsk.core.Matrix3D.create()
    if not matrix.setToRotation(angle_radians, _vector(axis_values), _point(pivot)):
        raise RuntimeError("Fusion could not construct the requested world-axis rotation.")
    return matrix


def _local_rotation_matrix(context_occurrence, pivot, axis_values, angle_radians):
    """The world rotation expressed in the body's component space."""
    world = _world_rotation_matrix(pivot, axis_values, angle_radians)
    if context_occurrence is None:
        return world
    to_world = context_occurrence.transform2
    local = to_world.copy()
    if not local.transformBy(world):
        raise RuntimeError("Fusion could not resolve the local rotation.")
    if not local.transformBy(_inverted_matrix(to_world)):
        raise RuntimeError("Fusion could not resolve the local rotation.")
    return local


def _body_groups(design, bodies):
    """Group bodies by owning component and assembly context."""
    groups = {}
    for body in bodies:
        native_body = getattr(body, "nativeObject", None) or body
        component = getattr(native_body, "parentComponent", None)
        if component is None:
            raise ValueError(f"Body '{_entity_label(body)}' has no owning component.")
        context_occurrence = _body_context_occurrence(body, design)
        key = (
            str(getattr(component, "id", "") or id(component)),
            str(getattr(context_occurrence, "entityToken", "") or "") if context_occurrence else "",
        )
        group = groups.setdefault(
            key, {"component": component, "context": context_occurrence, "natives": []}
        )
        group["natives"].append(native_body)
    return list(groups.values())


def _add_rotation_move(component, natives, local_transform, name):
    entities = adsk.core.ObjectCollection.create()
    for native_body in natives:
        entities.add(native_body)
    move_features = component.features.moveFeatures
    move_input = move_features.createInput2(entities)
    if move_input is None:
        raise RuntimeError("Fusion could not create a Move Feature input.")
    if not move_input.defineAsFreeMove(local_transform):
        raise RuntimeError("Fusion could not define the rotation move.")
    feature = move_features.add(move_input)
    if feature is None:
        raise RuntimeError("Fusion could not add a Move Feature.")
    try:
        feature.name = name
    except Exception:
        pass
    return feature


def _capture_positions(design):
    """Keep component placement changes; Fusion reverts uncaptured ones on recompute."""
    if not _is_parametric(design):
        return False
    snapshots = getattr(design, "snapshots", None)
    if snapshots is None or not getattr(snapshots, "hasPendingSnapshot", False):
        return False
    return snapshots.add() is not None


def _release_for_transform(occurrences):
    released = []
    for occurrence in occurrences:
        if getattr(occurrence, "isGrounded", False):
            raise ValueError(
                f"Component '{_entity_label(occurrence)}' is grounded. Unground it in the browser before rotating it."
            )
        try:
            if getattr(occurrence, "isGroundToParent", False):
                occurrence.isGroundToParent = False
                released.append(_entity_label(occurrence))
        except Exception:
            pass
    return released


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
        return []
    released = _release_for_transform(occurrences)
    root = design.rootComponent
    batch_error = None
    try:
        if root.transformOccurrences(occurrences, transforms, True):
            _capture_positions(design)
            return released
    except Exception as error:
        batch_error = error

    try:
        for occurrence, transform in zip(occurrences, transforms):
            occurrence.transform2 = transform
    except Exception as error:
        detail = f" Batch transform error: {batch_error}" if batch_error else ""
        raise RuntimeError(
            "Fusion could not rotate the selected component(s). Check for grounded components, "
            f"read-only references, or joints.{detail} Fallback error: {error}"
        ) from error
    _capture_positions(design)
    return released


def _apply_rotation(design, records, pivot, axis_values, angle_radians):
    # Uncaptured component moves would be lost when the Move features recompute.
    _capture_positions(design)
    bodies = [record["entity"] for record in records if record["kind"] == "body"]
    for group in _body_groups(design, bodies):
        local = _local_rotation_matrix(group["context"], pivot, axis_values, angle_radians)
        _add_rotation_move(group["component"], group["natives"], local, "FlowCell Rotate")
    world_rotation = _world_rotation_matrix(pivot, axis_values, angle_radians)
    occurrences = [record["entity"] for record in records if record["kind"] == "occurrence"]
    transforms = [_rotated_occurrence_transform(occurrence, world_rotation) for occurrence in occurrences]
    return _apply_occurrence_transforms(design, occurrences, transforms)


def _body_in_context(body, context_occurrence):
    if context_occurrence is None:
        return body
    try:
        return body.createForAssemblyContext(context_occurrence) or body
    except Exception:
        return body


def _distribute(design, records, pivot, axis_values, count, sign):
    """Copy the selection count-1 times at even steps around the pivot."""
    _capture_positions(design)
    step = sign * 360.0 / float(count)
    created = []
    bodies = [record["entity"] for record in records if record["kind"] == "body"]
    for group in _body_groups(design, bodies):
        copies = group["component"].features.copyPasteBodies
        for index in range(1, count):
            collection = adsk.core.ObjectCollection.create()
            for native_body in group["natives"]:
                collection.add(native_body)
            copy_feature = copies.add(collection)
            if copy_feature is None:
                raise RuntimeError("Fusion could not copy the selected bodies.")
            new_bodies = [copy_feature.bodies.item(item) for item in range(copy_feature.bodies.count)]
            if not new_bodies:
                raise RuntimeError("Fusion copied no bodies.")
            local = _local_rotation_matrix(group["context"], pivot, axis_values, math.radians(step * index))
            _add_rotation_move(group["component"], new_bodies, local, "FlowCell Distribute")
            created.extend(_body_in_context(body, group["context"]) for body in new_bodies)

    for record in records:
        if record["kind"] != "occurrence":
            continue
        occurrence = record["entity"]
        parent = getattr(occurrence, "assemblyContext", None)
        parent_component = parent.component if parent is not None else design.rootComponent
        for index in range(1, count):
            world = _rotated_occurrence_transform(
                occurrence, _world_rotation_matrix(pivot, axis_values, math.radians(step * index))
            )
            local = world
            if parent is not None:
                local = world.copy()
                if not local.transformBy(_inverted_matrix(parent.transform2)):
                    raise RuntimeError("Fusion could not place the copied component in its parent.")
            new_occurrence = parent_component.occurrences.addExistingComponent(occurrence.component, local)
            if new_occurrence is None:
                raise RuntimeError(f"Fusion could not copy component '{_entity_label(occurrence)}'.")
            if parent is not None:
                try:
                    new_occurrence = new_occurrence.createForAssemblyContext(parent) or new_occurrence
                except Exception:
                    pass
            created.append(new_occurrence)
    _capture_positions(design)
    return created


def _restore_selection(ui, design, records, extra_entities=()):
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
        for entity in extra_entities:
            if entity is not None and getattr(entity, "isValid", True):
                selections.add(entity)
        return int(getattr(selections, "count", 0) or 0) >= len(records)
    except Exception:
        return False


def run_flowcell_action(context=None, data=None):
    payload = dict(data or {})
    command = str(payload.get("command") or payload.get("action") or "apply").strip().lower()
    if command in {"status", "state", "probe"}:
        return _result("ok", "Fusion Quick Rotate is ready.")
    if command != "apply":
        raise ValueError(f"Unsupported Fusion Quick Rotate command: {command}")

    operation_mode = str(payload.get("operation_mode") or "TRANSFORM").strip().upper()
    if operation_mode not in SUPPORTED_OPERATION_MODES:
        raise ValueError(f"Unsupported rotate mode: {operation_mode}")
    direction = payload.get("direction", "positive")
    axis, axis_values = _axis_values(payload.get("axis", "Z"))
    center_mode = str(payload.get("center_mode") or "WORLD").strip().upper()

    _app, ui, design = _runtime(context)
    records = _selected_records(ui)
    pivot, targets = _pivot_and_targets(records, design, center_mode)

    if operation_mode == "DISTRIBUTE":
        count = _distribute_count(payload.get("distribute_count", payload.get("value", 3)))
        sign = 1.0 if _signed_angle_degrees(1.0, direction) > 0 else -1.0
        if count == 1:
            return _result(
                "ok",
                f"Distribute count 1 kept {len(targets)} selection(s) unchanged around {axis}.",
                axis=axis,
                centerMode=center_mode,
                operationMode="DISTRIBUTE",
            )
        created = _distribute(design, targets, pivot, axis_values, count, sign)
        selection_preserved = _restore_selection(ui, design, records, created)
        return _result(
            "ok",
            f"Distributed {len(targets)} selection(s) into {count} total positions by creating {count - 1} "
            f"copy set(s) at {360.0 / count:.2f} degree spacing around world {axis}.",
            changed=len(created),
            axis=axis,
            centerMode=center_mode,
            pivot=list(pivot),
            operationMode="DISTRIBUTE",
            selectionPreserved=selection_preserved,
        )

    raw_angle = payload.get("angle_deg", payload.get("value", 15.0))
    if raw_angle is None:
        raw_angle = 15.0
    angle_degrees = _signed_angle_degrees(raw_angle, direction)
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

    released = _apply_rotation(design, targets, pivot, axis_values, math.radians(angle_degrees))
    selection_preserved = _restore_selection(ui, design, records)
    message = (
        f"Rotated {len(targets)} selection(s) {angle_degrees:g} degrees around world {axis} "
        f"using the {center_mode.title()} pivot."
    )
    if released:
        message += " Released from parent ground: " + ", ".join(released) + "."
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
