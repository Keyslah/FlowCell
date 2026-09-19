"""FlowCell Align toolset for Autodesk Fusion.

The last selected supported entity is the reference. Every earlier selected
native root-component BRepBody or Occurrence is translated in world X/Y/Z.
Body translations are created as timeline MoveFeature free moves; occurrence
translations use the root component batch transform API with a transform2
fallback.
"""

from __future__ import annotations

import adsk.core
import adsk.fusion


AXES = {"X": 0, "Y": 1, "Z": 2}
SUPPORTED_MODIFIERS = {"", "SURFACE", "GEOCENTER", "ORIGIN"}
SLOT_PAYLOADS = {
    "x_min": {"command": "align_axis", "axis": "X", "mode": "MIN", "modifier": ""},
    "x_center": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": ""},
    "x_max": {"command": "align_axis", "axis": "X", "mode": "MAX", "modifier": ""},
    "x_surface": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": "SURFACE"},
    "x_geo": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": "ORIGIN"},
    "y_min": {"command": "align_axis", "axis": "Y", "mode": "MIN", "modifier": ""},
    "y_center": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": ""},
    "y_max": {"command": "align_axis", "axis": "Y", "mode": "MAX", "modifier": ""},
    "y_surface": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": "SURFACE"},
    "y_geo": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": "ORIGIN"},
    "z_min": {"command": "align_axis", "axis": "Z", "mode": "MIN", "modifier": ""},
    "z_center": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": ""},
    "z_max": {"command": "align_axis", "axis": "Z", "mode": "MAX", "modifier": ""},
    "z_surface": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": "SURFACE"},
    "z_geo": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": "ORIGIN"},
    "center_everything": {"command": "center_all"},
    "center_xy": {"command": "center_xy"},
}


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
        raise RuntimeError("Fusion is not available. Open a Fusion design and try Align again.")
    ui = ui or getattr(app, "userInterface", None)
    if ui is None:
        raise RuntimeError("Fusion's user interface is unavailable.")
    design = design or adsk.fusion.Design.cast(getattr(app, "activeProduct", None))
    if design is None:
        raise RuntimeError("Align requires an active Fusion Design document.")
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
        raise ValueError(
            "Select at least one BRep body or component occurrence to move, then select the reference last."
        )

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
            "Align supports only BRepBody and Occurrence selections. Unsupported selection(s): "
            + ", ".join(unsupported)
            + ". Select bodies/components only; the last selection is the reference."
        )
    if len(records) < 2:
        raise ValueError(
            "Align needs at least two supported selections: one or more targets, then the reference last."
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
            "Align requires Capture Design History so Fusion can create reversible Move features."
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
                "Align accepts native root-component bodies or whole component occurrences. "
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
        translation = entity.transform2.translation
        return (float(translation.x), float(translation.y), float(translation.z))
    context_occurrence = _body_context_occurrence(entity, design)
    if context_occurrence is None:
        return (0.0, 0.0, 0.0)
    translation = context_occurrence.transform2.translation
    return (float(translation.x), float(translation.y), float(translation.z))


def _center(bounds):
    minimum, maximum = bounds
    return tuple((minimum[index] + maximum[index]) * 0.5 for index in range(3))


def _alignment_translation(target_bounds, reference_bounds, target_origin, axis, mode, modifier):
    axis = str(axis or "X").strip().upper()
    if axis not in AXES:
        raise ValueError(f"Unsupported alignment axis: {axis}")
    mode = str(mode or "CENTER").strip().upper()
    if mode not in {"MIN", "CENTER", "MAX"}:
        raise ValueError(f"Unsupported alignment mode: {mode}")
    modifier = str(modifier or "").strip().upper()
    if modifier not in SUPPORTED_MODIFIERS:
        raise ValueError(f"Unsupported alignment modifier: {modifier}")

    index = AXES[axis]
    target_min, target_max = target_bounds
    reference_min, reference_max = reference_bounds
    target_center = _center(target_bounds)
    reference_center = _center(reference_bounds)

    if modifier == "SURFACE":
        if target_center[index] <= reference_center[index]:
            source_value = target_max[index]
            destination_value = reference_min[index]
        else:
            source_value = target_min[index]
            destination_value = reference_max[index]
    elif modifier in {"GEOCENTER", "ORIGIN"}:
        source_value = target_origin[index]
        destination_value = reference_center[index]
    elif mode == "MIN":
        source_value = target_min[index]
        destination_value = reference_min[index]
    elif mode == "MAX":
        source_value = target_max[index]
        destination_value = reference_max[index]
    else:
        source_value = target_center[index]
        destination_value = reference_center[index]

    delta = [0.0, 0.0, 0.0]
    delta[index] = destination_value - source_value
    return tuple(delta)


def _world_vector_to_body_space(body, design, values):
    context_occurrence = _body_context_occurrence(body, design)
    vector = _vector(values)
    if context_occurrence is None:
        return vector
    if not vector.transformBy(_inverted_matrix(context_occurrence.transform2)):
        raise RuntimeError(f"Fusion could not resolve body-space movement for '{_entity_label(body)}'.")
    return vector


def _add_body_free_move(design, body, world_delta):
    native_body = getattr(body, "nativeObject", None) or body
    component = getattr(native_body, "parentComponent", None)
    if component is None:
        raise ValueError(f"Body '{_entity_label(body)}' has no owning component.")

    entities = adsk.core.ObjectCollection.create()
    entities.add(native_body)
    move_features = component.features.moveFeatures
    move_input = move_features.createInput2(entities)
    if move_input is None:
        raise RuntimeError(f"Fusion could not create a Move Feature input for '{_entity_label(body)}'.")
    transform = adsk.core.Matrix3D.create()
    transform.translation = _world_vector_to_body_space(body, design, world_delta)
    if not move_input.defineAsFreeMove(transform):
        raise RuntimeError(f"Fusion could not define a free move for '{_entity_label(body)}'.")
    if move_features.add(move_input) is None:
        raise RuntimeError(f"Fusion could not add a Move Feature for '{_entity_label(body)}'.")


def _translated_occurrence_transform(occurrence, world_delta):
    transform = occurrence.transform2.copy()
    current = transform.translation
    transform.translation = adsk.core.Vector3D.create(
        float(current.x) + world_delta[0],
        float(current.y) + world_delta[1],
        float(current.z) + world_delta[2],
    )
    return transform


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
            "Fusion could not transform the selected occurrence(s). Check for grounded components, "
            f"read-only references, or assembly constraints.{detail} Fallback error: {error}"
        ) from error


def _apply_plan(design, plan):
    occurrence_entities = []
    occurrence_transforms = []
    for record, delta in plan:
        if record["kind"] == "body":
            _add_body_free_move(design, record["entity"], delta)
        else:
            occurrence_entities.append(record["entity"])
            occurrence_transforms.append(_translated_occurrence_transform(record["entity"], delta))
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


def _normalize_payload(data):
    payload = dict(data or {})
    command = str(payload.get("command") or payload.get("action") or "status").strip().lower()
    if command in SLOT_PAYLOADS:
        normalized = dict(SLOT_PAYLOADS[command])
        normalized.update({key: value for key, value in payload.items() if key not in normalized})
        return normalized
    payload["command"] = command
    return payload


def run_flowcell_action(context=None, data=None):
    payload = _normalize_payload(data)
    command = str(payload.get("command") or "status").strip().lower()
    if command in {"", "status", "state", "probe"}:
        return _result("ok", "Fusion Align is ready. Select targets first and the reference last.")
    if command not in {"align_axis", "center_all", "center_xy"}:
        raise ValueError(f"Unsupported Fusion Align command: {command}")

    _app, ui, design = _runtime(context)
    _require_parametric_design(design)
    records = _selected_records(ui)
    _require_instance_safe_bodies(records, design)
    reference = records[-1]
    targets = records[:-1]
    reference_bounds = _world_bounds(reference, design)
    plan = []

    if command in {"center_all", "center_xy"}:
        reference_center = _center(reference_bounds)
        axes = range(3) if command == "center_all" else range(2)
        for record in targets:
            target_center = _center(_world_bounds(record, design))
            delta = [0.0, 0.0, 0.0]
            for index in axes:
                delta[index] = reference_center[index] - target_center[index]
            plan.append((record, tuple(delta)))
    else:
        axis = str(payload.get("axis") or "X").strip().upper()
        mode = str(payload.get("mode") or "CENTER").strip().upper()
        modifier = str(payload.get("modifier") or "").strip().upper()
        for record in targets:
            plan.append(
                (
                    record,
                    _alignment_translation(
                        _world_bounds(record, design),
                        reference_bounds,
                        _world_origin(record, design),
                        axis,
                        mode,
                        modifier,
                    ),
                )
            )

    _apply_plan(design, plan)
    selection_preserved = _restore_selection(ui, design, records)
    if command == "center_xy":
        message = f"Centered {len(targets)} selection(s) on X and Y using '{reference['label']}' as reference."
    elif command == "center_all":
        message = f"Centered {len(targets)} selection(s) on X, Y, and Z using '{reference['label']}' as reference."
    else:
        message = f"Aligned {len(targets)} selection(s) on {str(payload.get('axis')).upper()} using '{reference['label']}' as reference."
    return _result(
        "ok",
        message,
        changed=len(targets),
        reference=reference["label"],
        selectionPreserved=selection_preserved,
    )
