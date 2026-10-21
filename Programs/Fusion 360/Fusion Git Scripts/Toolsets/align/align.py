"""FlowCell Align toolset for Autodesk Fusion.

Mirrors the Blender Align tool set. The last selected body or component is the
fixed reference (Blender's active object) and every earlier selection moves. A
selected face, edge, or vertex stands for its whole body.
Shift aligns to the world origin instead and moves the whole selection. Alt
with Center, All, or X-Y aligns component origins. Group moves the selection as
one combined bounding box.

Body moves are Move features in the body's own component. Component moves use
the root batch transform; grounded-to-parent components are released first and
a position snapshot is captured so the next recompute keeps the new placement.
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
    "x_geo": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": "GEOCENTER"},
    "y_min": {"command": "align_axis", "axis": "Y", "mode": "MIN", "modifier": ""},
    "y_center": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": ""},
    "y_max": {"command": "align_axis", "axis": "Y", "mode": "MAX", "modifier": ""},
    "y_surface": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": "SURFACE"},
    "y_geo": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": "GEOCENTER"},
    "z_min": {"command": "align_axis", "axis": "Z", "mode": "MIN", "modifier": ""},
    "z_center": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": ""},
    "z_max": {"command": "align_axis", "axis": "Z", "mode": "MAX", "modifier": ""},
    "z_surface": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": "SURFACE"},
    "z_geo": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": "GEOCENTER"},
    "center_everything": {"command": "center_all"},
    "center_xy": {"command": "center_xy"},
}
EPSILON = 1.0e-9


def _result(status="ok", message="", changed=0, **extra):
    return {"status": status, "message": message, "display": message, "changed": changed, **extra}


def _flag(values, key):
    if not isinstance(values, dict):
        return False
    value = values.get(key)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


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


def _owning_body(entity):
    """A selected face, edge, or vertex stands for its whole body."""
    for cast_type in ("BRepFace", "BRepEdge", "BRepVertex"):
        caster = getattr(adsk.fusion, cast_type, None)
        try:
            part = caster.cast(entity) if caster is not None else None
        except Exception:
            part = None
        if part is not None:
            return getattr(part, "body", None)
    return None


def _resolve_selection(entity):
    kind, cast_entity = _cast_entity(entity)
    if cast_entity is not None:
        return kind, cast_entity
    body = _owning_body(entity)
    if body is not None:
        return "body", body
    return None, None


def _entity_label(entity):
    return str(
        getattr(entity, "fullPathName", None)
        or getattr(entity, "name", None)
        or getattr(entity, "objectType", None)
        or type(entity).__name__
    )


def _selected_picks(ui):
    """Every selected entity as clicked (faces stay faces), for restoring the selection."""
    selections = getattr(ui, "activeSelections", None)
    count = int(getattr(selections, "count", 0) or 0)
    picks = []
    for index in range(count):
        entity = getattr(selections.item(index), "entity", None)
        picks.append({"entity": entity, "token": str(getattr(entity, "entityToken", "") or "")})
    return picks


def _selected_records(ui):
    """Bodies and components to align; faces, edges, and vertices count as their body.

    Several picks on one body count once, at its last pick, so the body of the
    last pick is always the reference.
    """
    records = []
    unsupported = []
    for index, pick in enumerate(_selected_picks(ui)):
        kind, cast_entity = _resolve_selection(pick["entity"])
        if cast_entity is None:
            unsupported.append(f"#{index + 1} {_entity_label(pick['entity'])}")
            continue
        records.append(
            {
                "kind": kind,
                "entity": cast_entity,
                "label": _entity_label(cast_entity),
                "token": str(getattr(cast_entity, "entityToken", "") or ""),
            }
        )
    if unsupported:
        raise ValueError(
            "Align works on bodies, components, and their faces, edges, or vertices. Unsupported selection(s): "
            + ", ".join(unsupported)
            + "."
        )
    unique = []
    seen = set()
    for record in reversed(records):
        token = record["token"]
        if token and token in seen:
            continue
        if token:
            seen.add(token)
        unique.append(record)
    unique.reverse()
    return unique


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


def _combined_bounds(bounds_list):
    return (
        tuple(min(bounds[0][index] for bounds in bounds_list) for index in range(3)),
        tuple(max(bounds[1][index] for bounds in bounds_list) for index in range(3)),
    )


def _world_origin(record, design):
    """Component origin for occurrences; bodies have no origin, so use their center."""
    if record["kind"] == "occurrence":
        return _xyz(record["entity"].transform2.translation)
    return _center(_world_bounds(record, design))


def _axis_delta(axis_index, plan, anchor, origin_center):
    """One-axis translation for a batch, following the Blender Align rules."""
    command = plan["command"]
    mode = plan["mode"]
    modifier = plan["modifier"]
    batch_min, batch_max = plan["bounds"]
    batch_center = _center(plan["bounds"])
    anchor_min, anchor_max = anchor["bounds"]
    anchor_center = _center(anchor["bounds"])
    index = axis_index

    if modifier == "SURFACE":
        # Use the current side so repeated presses cross to the other face.
        above = batch_center[index] > anchor_center[index]
        target = anchor_min[index] if above else anchor_max[index]
        source = batch_max[index] if above else batch_min[index]
    elif modifier in {"GEOCENTER", "ORIGIN"}:
        source = plan["origin"][index]
        target = anchor_min[index] if source > anchor_center[index] else anchor_max[index]
    elif command in {"center_all", "center_xy"} or mode == "CENTER":
        target = anchor["origin"][index] if origin_center else anchor_center[index]
        source = plan["origin"][index] if origin_center else batch_center[index]
    elif mode == "MIN":
        target = anchor_min[index]
        source = batch_min[index]
    else:
        target = anchor_max[index]
        source = batch_max[index]
    return target - source


def _alignment_translation(target_bounds, reference_bounds, target_origin, axis, mode, modifier,
                           reference_origin=None, origin_center=False, command="align_axis"):
    """Translation for one target against a reference (kept for direct testing)."""
    axis = str(axis or "X").strip().upper()
    if axis not in AXES:
        raise ValueError(f"Unsupported alignment axis: {axis}")
    mode = str(mode or "CENTER").strip().upper()
    if mode not in {"MIN", "CENTER", "MAX"}:
        raise ValueError(f"Unsupported alignment mode: {mode}")
    modifier = str(modifier or "").strip().upper()
    if modifier not in SUPPORTED_MODIFIERS:
        raise ValueError(f"Unsupported alignment modifier: {modifier}")
    plan = {
        "command": command,
        "mode": mode,
        "modifier": modifier,
        "bounds": target_bounds,
        "origin": target_origin,
    }
    anchor = {
        "bounds": reference_bounds,
        "origin": reference_origin if reference_origin is not None else _center(reference_bounds),
    }
    delta = [0.0, 0.0, 0.0]
    delta[AXES[axis]] = _axis_delta(AXES[axis], plan, anchor, origin_center)
    return tuple(delta)


def _world_vector_to_body_space(body, design, values):
    context_occurrence = _body_context_occurrence(body, design)
    vector = _vector(values)
    if context_occurrence is None:
        return vector
    if not vector.transformBy(_inverted_matrix(context_occurrence.transform2)):
        raise RuntimeError(f"Fusion could not resolve body-space movement for '{_entity_label(body)}'.")
    return vector


def _apply_body_moves(design, moves):
    """One Move feature per component, context, and translation."""
    groups = {}
    for body, delta in moves:
        native_body = getattr(body, "nativeObject", None) or body
        component = getattr(native_body, "parentComponent", None)
        if component is None:
            raise ValueError(f"Body '{_entity_label(body)}' has no owning component.")
        context_occurrence = _body_context_occurrence(body, design)
        key = (
            str(getattr(component, "id", "") or id(component)),
            str(getattr(context_occurrence, "entityToken", "") or "") if context_occurrence else "",
            tuple(round(value, 9) for value in delta),
        )
        group = groups.setdefault(key, {"component": component, "body": body, "delta": delta, "natives": []})
        group["natives"].append(native_body)

    for group in groups.values():
        entities = adsk.core.ObjectCollection.create()
        for native_body in group["natives"]:
            entities.add(native_body)
        move_features = group["component"].features.moveFeatures
        move_input = move_features.createInput2(entities)
        if move_input is None:
            raise RuntimeError("Fusion could not create a Move Feature input.")
        transform = adsk.core.Matrix3D.create()
        transform.translation = _world_vector_to_body_space(group["body"], design, group["delta"])
        if not move_input.defineAsFreeMove(transform):
            raise RuntimeError("Fusion could not define a free move.")
        feature = move_features.add(move_input)
        if feature is None:
            raise RuntimeError("Fusion could not add a Move Feature.")
        try:
            feature.name = "FlowCell Align"
        except Exception:
            pass
    return len(groups)


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
                f"Component '{_entity_label(occurrence)}' is grounded. Unground it in the browser before moving it."
            )
        try:
            if getattr(occurrence, "isGroundToParent", False):
                occurrence.isGroundToParent = False
                released.append(_entity_label(occurrence))
        except Exception:
            pass
    return released


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
            "Fusion could not transform the selected component(s). Check for grounded components, "
            f"read-only references, or joints.{detail} Fallback error: {error}"
        ) from error
    _capture_positions(design)
    return released


def _translated_occurrence_transform(occurrence, world_delta):
    transform = occurrence.transform2.copy()
    current = transform.translation
    transform.translation = adsk.core.Vector3D.create(
        float(current.x) + world_delta[0],
        float(current.y) + world_delta[1],
        float(current.z) + world_delta[2],
    )
    return transform


def _apply_plan(design, deltas):
    body_moves = []
    occurrences = []
    transforms = []
    for record, delta in deltas:
        if all(abs(value) <= EPSILON for value in delta):
            continue
        if record["kind"] == "body":
            body_moves.append((record["entity"], delta))
        else:
            occurrences.append(record["entity"])
            transforms.append(_translated_occurrence_transform(record["entity"], delta))
    # Uncaptured component moves would be lost when the Move features recompute.
    _capture_positions(design)
    if body_moves:
        _apply_body_moves(design, body_moves)
    return _apply_occurrence_transforms(design, occurrences, transforms)


def _restore_picks(ui, design, picks):
    """Reselect exactly what was clicked (faces included), following moved entities by token."""
    selections = getattr(ui, "activeSelections", None)
    if selections is None or not picks:
        return False
    try:
        if not selections.clear():
            return False
        for pick in picks:
            entity = pick["entity"]
            if entity is None or not getattr(entity, "isValid", True):
                entity = None
                for candidate in design.findEntityByToken(pick["token"]) or [] if pick["token"] else []:
                    entity = candidate
                    break
            if entity is None or not selections.add(entity):
                return False
        return int(getattr(selections, "count", 0) or 0) == len(picks)
    except Exception:
        return False


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
        return _result("ok", "Fusion Align is ready. Select the bodies/components to move, then the reference last.")
    if command not in {"align_axis", "center_all", "center_xy"}:
        raise ValueError(f"Unsupported Fusion Align command: {command}")

    axis = str(payload.get("axis") or "X").strip().upper()
    mode = str(payload.get("mode") or "CENTER").strip().upper()
    modifier = str(payload.get("modifier") or "").strip().upper()
    if axis not in AXES:
        raise ValueError(f"Unsupported alignment axis: {axis}")
    if mode not in {"MIN", "CENTER", "MAX"}:
        raise ValueError(f"Unsupported alignment mode: {mode}")
    if modifier not in SUPPORTED_MODIFIERS:
        raise ValueError(f"Unsupported alignment modifier: {modifier}")
    modifiers = payload.get("modifiers") if isinstance(payload.get("modifiers"), dict) else {}
    world = _flag(modifiers, "shift")
    grouped = _flag(payload, "group")
    centering = command in {"center_all", "center_xy"}
    origin_center = _flag(modifiers, "alt") and not modifier and (centering or mode == "CENTER")

    _app, ui, design = _runtime(context)
    picks = _selected_picks(ui)
    records = _selected_records(ui)
    if world:
        if not records:
            raise ValueError("Select at least one body or component to align to the world origin.")
        moving = list(records)
        anchor = {"bounds": ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), "origin": (0.0, 0.0, 0.0), "label": "the world origin"}
    else:
        if len(records) < 2:
            raise ValueError(
                "Select the bodies/components to move, then the reference last. Hold Shift to align to the world origin."
            )
        reference = records[-1]
        moving = records[:-1]
        anchor = {
            "bounds": _world_bounds(reference, design),
            "origin": _world_origin(reference, design),
            "label": f"'{reference['label']}'",
        }

    axes = (0, 1, 2) if command == "center_all" else (0, 1) if command == "center_xy" else (AXES[axis],)
    bounds = {id(record): _world_bounds(record, design) for record in moving}
    batches = [moving] if grouped else [[record] for record in moving]
    deltas = []
    for batch in batches:
        batch_bounds = _combined_bounds([bounds[id(record)] for record in batch])
        plan = {
            "command": command,
            "mode": mode,
            "modifier": modifier,
            "bounds": batch_bounds,
            "origin": _center(batch_bounds) if grouped else _world_origin(batch[0], design),
        }
        delta = [0.0, 0.0, 0.0]
        for index in axes:
            delta[index] = _axis_delta(index, plan, anchor, origin_center)
        deltas.extend((record, tuple(delta)) for record in batch)

    released = _apply_plan(design, deltas)
    selection_preserved = _restore_picks(ui, design, picks) or _restore_selection(ui, design, records)
    if command == "center_xy":
        message = f"Centered {len(moving)} selection(s) on X and Y to {anchor['label']}."
    elif command == "center_all":
        message = f"Centered {len(moving)} selection(s) to {anchor['label']}."
    else:
        message = f"Aligned {len(moving)} selection(s) on {axis} to {anchor['label']}."
    if grouped and len(moving) > 1:
        message += " Moved as one group."
    if released:
        message += " Released from parent ground: " + ", ".join(released) + "."
    return _result(
        "ok",
        message,
        changed=len(moving),
        anchor="WORLD" if world else "REFERENCE",
        group=grouped,
        selectionPreserved=selection_preserved,
        fieldPatch={},
    )
