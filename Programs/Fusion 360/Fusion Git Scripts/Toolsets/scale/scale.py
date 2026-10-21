"""FlowCell Scale for Autodesk Fusion, modeled on the Blender Smart Axis tool set.

Base stores the selected bodies' bounds. X, Y, and Z each cycle the side that
stays put while scaling: none (scale around the center), Min ("X-"), or Max
("X+"); a locked side holds the stored Base edge, or the current edge when no
Base is stored. Live makes the X/Y/Z sliders update Fusion while dragging;
with Live off the drag applies when released.

Each slider drag is one scale step relative to the selection's size when the
drag started: one non-uniform Scale feature plus one Move feature that places
the locked sides, edited in place for the whole drag. On release the sliders
return to 100%, and a drag that ends at 100% deletes its features. Typed sizes
resize the selection exactly.

The axis modes, Live, and Base are stored on the design, and every response
reports them so the X/Y/Z and Live Buttons show the real state.
"""

from __future__ import annotations

import json
import math
import traceback

import adsk.core
import adsk.fusion


AXES = ("X", "Y", "Z")
PIN_MODES = ("NONE", "MIN", "MAX")
NEXT_MODE = {"NONE": "MIN", "MIN": "MAX", "MAX": "NONE"}
EPSILON_CM = 1.0e-7
MIN_FACTOR = 0.01
SCALE_FIELDS = ("scale_x", "scale_y", "scale_z")
SIZE_FIELDS = ("size_x", "size_y", "size_z")
ATTRIBUTE_GROUP = "FlowCellScale"

# The active slider drag.
_gesture = None


def _result(status="FINISHED", message="", **extra):
    output = {"status": status, "message": message}
    output.update(extra)
    return output


def _as_bool(value, fallback=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1", "yes", "on"}:
            return True
        if text in {"false", "0", "no", "off"}:
            return False
    return fallback


def _finite(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _pin_mode(value):
    mode = str(value or "NONE").upper()
    return mode if mode in PIN_MODES else "NONE"


def _slider_factors(payload):
    return {
        axis: max(MIN_FACTOR, _finite(payload.get(field), 100.0) / 100.0)
        for axis, field in zip(AXES, SCALE_FIELDS)
    }


# --- Design-stored state (modes, Live, Base) ---------------------------------

def _read_attribute(design, name, default):
    try:
        attribute = design.attributes.itemByName(ATTRIBUTE_GROUP, name)
        return json.loads(attribute.value) if attribute is not None else default
    except Exception:
        return default


def _write_attribute(design, name, value, ui=None):
    """Store state on the design; Fusion clears the selection on attribute writes, so restore it."""
    entities = []
    if ui is not None:
        try:
            selections = ui.activeSelections
            entities = [selections.item(index).entity for index in range(selections.count)]
        except Exception:
            entities = []
    design.attributes.add(ATTRIBUTE_GROUP, name, json.dumps(value))
    if entities:
        try:
            selections = ui.activeSelections
            if selections.count == 0:
                for entity in entities:
                    if getattr(entity, "isValid", True):
                        selections.add(entity)
        except Exception:
            pass


def _modes(design):
    stored = _read_attribute(design, "modes", {})
    stored = stored if isinstance(stored, dict) else {}
    return {axis: _pin_mode(stored.get(axis)) for axis in AXES}


def _live(design):
    return _as_bool(_read_attribute(design, "live", True), True)


def _baselines(design):
    stored = _read_attribute(design, "baseline", {})
    return stored if isinstance(stored, dict) else {}


def _state(design):
    modes = _modes(design)
    return {
        "modes": modes,
        "active_axes": [axis for axis in AXES if modes[axis] != "NONE"],
        "live_enabled": _live(design),
    }


# --- Fusion helpers ----------------------------------------------------------

def _document_units(design):
    units = design.unitsManager
    return units, str(units.defaultLengthUnits)


def _to_document_units(design, centimeters):
    units, unit_name = _document_units(design)
    return float(units.convert(float(centimeters), "cm", unit_name))


def _to_centimeters(design, document_value):
    units, unit_name = _document_units(design)
    return float(units.convert(float(document_value), unit_name, "cm"))


def _is_parametric(design):
    design_types = getattr(adsk.fusion, "DesignTypes", None)
    parametric = getattr(design_types, "ParametricDesignType", None)
    current = getattr(design, "designType", None)
    return parametric is None or current is None or current == parametric


def _require_parametric_design(design):
    if not _is_parametric(design):
        raise ValueError(
            "Scale requires Capture Design History so Fusion can create reversible Scale and Move features."
        )


def _context_occurrence(body, design):
    context = getattr(body, "assemblyContext", None)
    if context is not None:
        return context
    parent = getattr(body, "parentComponent", None)
    if parent is None or parent == design.rootComponent:
        return None
    active = getattr(design, "activeOccurrence", None)
    if active is not None and getattr(active, "component", None) == parent:
        return active
    raise ValueError("Select bodies from the root component or from a component's occurrence.")


def _translation_only(occurrence):
    """World offset of an occurrence whose placement has no rotation or scale."""
    if occurrence is None:
        return (0.0, 0.0, 0.0)
    _origin, x_axis, y_axis, z_axis = occurrence.transform2.getAsCoordinateSystem()
    expected = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    for axis, wanted in zip((x_axis, y_axis, z_axis), expected):
        if any(abs(value - target) > 1.0e-9 for value, target in zip((axis.x, axis.y, axis.z), wanted)):
            raise ValueError(
                "Scale works along world X/Y/Z, so it skips components that are rotated. "
                "Select bodies in an unrotated component or in the root component."
            )
    translation = occurrence.transform2.translation
    return (float(translation.x), float(translation.y), float(translation.z))


def _selected_bodies(ui, design):
    selections = ui.activeSelections
    bodies = []
    seen = set()
    skipped = 0
    for index in range(selections.count):
        body = adsk.fusion.BRepBody.cast(getattr(selections.item(index), "entity", None))
        if body is None or getattr(body, "isTransient", False):
            skipped += 1
            continue
        token = str(body.entityToken)
        if token in seen:
            continue
        seen.add(token)
        bodies.append(body)
    if skipped:
        raise ValueError("Scale works on bodies only. Deselect faces, sketches, meshes, and components.")
    if not bodies:
        raise ValueError("Select one or more bodies to scale.")
    return bodies


def _bounds(bodies):
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    for body in bodies:
        box = None
        try:
            box = body.preciseBoundingBox
        except Exception:
            box = None
        if box is None:
            box = body.boundingBox
        if box is None:
            raise ValueError("Fusion could not measure a selected body.")
        low = (box.minPoint.x, box.minPoint.y, box.minPoint.z)
        high = (box.maxPoint.x, box.maxPoint.y, box.maxPoint.z)
        for index in range(3):
            minimum[index] = min(minimum[index], float(low[index]))
            maximum[index] = max(maximum[index], float(high[index]))
    dimensions = [maximum[index] - minimum[index] for index in range(3)]
    if any((not math.isfinite(value)) or value <= EPSILON_CM for value in dimensions):
        raise ValueError("Every selected body needs a nonzero size on X, Y, and Z.")
    return {
        "min": tuple(minimum),
        "max": tuple(maximum),
        "center": tuple((minimum[index] + maximum[index]) * 0.5 for index in range(3)),
        "dimensions": tuple(dimensions),
    }


def _stored_baseline(design, tokens):
    """Combined Base bounds for the selection, or None unless every body has one."""
    stored = _baselines(design)
    entries = [stored.get(token) for token in tokens]
    if not entries or any(not isinstance(entry, dict) for entry in entries):
        return None
    try:
        return {
            "min": tuple(min(float(entry["min"][index]) for entry in entries) for index in range(3)),
            "max": tuple(max(float(entry["max"][index]) for entry in entries) for index in range(3)),
        }
    except (KeyError, TypeError, ValueError, IndexError):
        return None


def _side_plan(start, modes, baseline):
    """Per axis: (start coordinate that must land on target, target coordinate)."""
    plan = {}
    for index, axis in enumerate(AXES):
        mode = modes[axis]
        if mode == "MIN":
            side = start["min"][index]
            target = baseline["min"][index] if baseline else side
        elif mode == "MAX":
            side = start["max"][index]
            target = baseline["max"][index] if baseline else side
        else:
            side = target = start["center"][index]
        plan[axis] = (side, target)
    return plan


def _pin_translation(group, factors, plan):
    """Component-space move placing each planned side after scaling about the component origin."""
    translation = []
    for index, axis in enumerate(AXES):
        side, target = plan[axis]
        offset = group["offset"][index]
        translation.append((target - offset) - factors[axis] * (side - offset))
    return tuple(translation)


def _scale_groups(design, bodies):
    """Bodies grouped by owning component; each group gets its own features."""
    groups = {}
    for body in bodies:
        native = getattr(body, "nativeObject", None) or body
        component = native.parentComponent
        context = _context_occurrence(body, design)
        offset = _translation_only(context)
        key = (str(getattr(component, "id", "") or id(component)), str(getattr(context, "entityToken", "") or ""))
        group = groups.setdefault(key, {"component": component, "offset": offset, "natives": []})
        group["natives"].append(native)
    return list(groups.values())


def _collection(entities):
    collection = adsk.core.ObjectCollection.create()
    for entity in entities:
        collection.add(entity)
    return collection


def _real(number):
    return adsk.core.ValueInput.createByReal(float(number))


def _create_features(group, factors, plan):
    component = group["component"]
    scale_features = component.features.scaleFeatures
    scale_input = scale_features.createInput(
        _collection(group["natives"]), component.originConstructionPoint, _real(1.0)
    )
    if scale_input is None:
        raise RuntimeError("Fusion could not create the Scale feature input.")
    if not scale_input.setToNonUniform(_real(factors["X"]), _real(factors["Y"]), _real(factors["Z"])):
        raise RuntimeError("Fusion rejected non-uniform body scaling.")
    scale_feature = scale_features.add(scale_input)
    if scale_feature is None:
        raise RuntimeError("Fusion did not create the Scale feature.")
    try:
        scale_feature.name = "FlowCell Scale"
    except Exception:
        pass

    translation = _pin_translation(group, factors, plan)
    move_features = component.features.moveFeatures
    move_input = move_features.createInput2(_collection(group["natives"]))
    if move_input is None:
        raise RuntimeError("Fusion could not create the pin Move input.")
    if not move_input.defineAsTranslateXYZ(_real(translation[0]), _real(translation[1]), _real(translation[2]), False):
        raise RuntimeError("Fusion rejected the pin translation.")
    move_feature = move_features.add(move_input)
    if move_feature is None:
        raise RuntimeError("Fusion did not create the pin Move feature.")
    try:
        move_feature.name = "FlowCell Scale Pins"
    except Exception:
        pass
    return {"scale": scale_feature, "move": move_feature}


def _update_features(group, features, factors, plan):
    scale_feature = features["scale"]
    for axis, parameter in zip(AXES, (scale_feature.xScale, scale_feature.yScale, scale_feature.zScale)):
        if abs(float(parameter.value) - factors[axis]) > 1.0e-12:
            parameter.value = factors[axis]
    translation = _pin_translation(group, factors, plan)
    definition = adsk.fusion.MoveFeatureTranslateXYZDefinition.cast(features["move"].definition)
    if definition is None:
        raise RuntimeError("The pin Move feature is no longer a translate move.")
    for value, parameter in zip(translation, (definition.xDistance, definition.yDistance, definition.zDistance)):
        if abs(float(parameter.value) - value) > 1.0e-12:
            parameter.value = value


def _delete_features(features):
    for key in ("move", "scale"):
        feature = features.get(key)
        try:
            if feature is not None and feature.isValid:
                feature.deleteMe()
        except Exception:
            pass


def _features_valid(gesture, design):
    try:
        timeline = design.timeline
        last = timeline.item(timeline.count - 1)
        last_move = gesture["features"][-1]["move"]
        if last.entity is None or not last_move.isValid:
            return False
        if last.entity.entityToken != last_move.entityToken:
            return False
        return all(item["scale"].isValid and item["move"].isValid for item in gesture["features"])
    except Exception:
        return False


def _bodies_from_tokens(design, tokens):
    bodies = []
    for token in tokens:
        body = None
        for entity in design.findEntityByToken(token) or []:
            body = adsk.fusion.BRepBody.cast(entity)
            if body is not None:
                break
        if body is None or not getattr(body, "isValid", True):
            return None
        bodies.append(body)
    return bodies


def _restore_selection(ui, bodies):
    try:
        selections = ui.activeSelections
        selections.clear()
        for body in bodies:
            if getattr(body, "isValid", True):
                selections.add(body)
    except Exception:
        pass


def _size_patch(design, dimensions_cm):
    _units, unit_name = _document_units(design)
    patch = {"units": unit_name}
    for index, (field, legacy) in enumerate(zip(SIZE_FIELDS, ("x", "y", "z"))):
        value = round(_to_document_units(design, dimensions_cm[index]), 6)
        patch[field] = value
        patch[legacy] = value
    return patch


def _reset_patch():
    return {field: 100 for field in SCALE_FIELDS}


def _runtime():
    app = adsk.core.Application.get()
    if app is None:
        raise RuntimeError("Fusion is not available.")
    design = adsk.fusion.Design.cast(app.activeProduct)
    if design is None:
        raise ValueError("Open a Fusion Design before using Scale.")
    return app.userInterface, design


def _end_gesture():
    global _gesture
    _gesture = None


# --- Commands ----------------------------------------------------------------

def _status(ui, design, message=None):
    state = _state(design)
    _units, unit_name = _document_units(design)
    try:
        bodies = _selected_bodies(ui, design)
        bounds = _bounds(bodies)
    except ValueError as error:
        return _result("FINISHED", message or str(error), selected=0,
                       fieldPatch={**_reset_patch(), "units": unit_name}, **state)
    return _result(
        "FINISHED",
        message or f"Read {len(bodies)} selected bod{'y' if len(bodies) == 1 else 'ies'} in {unit_name}.",
        selected=len(bodies),
        units=unit_name,
        fieldPatch={**_reset_patch(), **_size_patch(design, bounds["dimensions"])},
        **state,
    )


def _cycle(ui, design, axis):
    modes = _modes(design)
    modes[axis] = NEXT_MODE[modes[axis]]
    _write_attribute(design, "modes", modes, ui)
    label = {"NONE": "scales around its center", "MIN": "keeps its Min side (X-) fixed", "MAX": "keeps its Max side (X+) fixed"}
    response = _status(ui, design, f"{axis} {label[modes[axis]].replace('X', axis)}.")
    response.update({"axis": axis, "mode": modes[axis]})
    return response


def _toggle_live(ui, design):
    live = not _live(design)
    _write_attribute(design, "live", live, ui)
    return _status(ui, design, "Live scaling on: sliders update Fusion while you drag." if live
                   else "Live scaling off: slider drags apply when you let go.")


def _set_baseline(ui, design):
    bodies = _selected_bodies(ui, design)
    stored = _baselines(design)
    for body in bodies:
        bounds = _bounds([body])
        stored[str(body.entityToken)] = {"min": list(bounds["min"]), "max": list(bounds["max"])}
    _write_attribute(design, "baseline", stored, ui)
    return _status(ui, design, f"Base stored for {len(bodies)} bod{'y' if len(bodies) == 1 else 'ies'}; locked sides hold these edges.")


def _slide(ui, design, payload):
    """Slider step: start or continue this drag's Scale and Move features."""
    global _gesture
    _require_parametric_design(design)
    event = payload.get("fieldEvent") if isinstance(payload.get("fieldEvent"), dict) else {}
    trigger = str(event.get("trigger") or "change").lower()
    factors = _slider_factors(payload)
    state = _state(design)

    if trigger != "change" and not state["live_enabled"]:
        # Live off: preview the sizes only; the release applies the scale.
        try:
            start = _bounds(_selected_bodies(ui, design))
        except ValueError as error:
            return _result("FINISHED", str(error), **state)
        dimensions = tuple(start["dimensions"][index] * factors[axis] for index, axis in enumerate(AXES))
        return _result("FINISHED", "Release to apply the scale.", fieldPatch=_size_patch(design, dimensions), **state)

    gesture = _gesture
    current_tokens = []
    try:
        current_tokens = sorted(str(body.entityToken) for body in _selected_bodies(ui, design))
    except ValueError:
        current_tokens = []
    if gesture is not None and (
        gesture["design"] != design
        or (current_tokens and current_tokens != gesture["tokens"])
        or not _features_valid(gesture, design)
    ):
        gesture = None

    unchanged = all(abs(factors[axis] - 1.0) <= 1.0e-9 for axis in AXES)
    if gesture is None:
        if unchanged:
            _end_gesture()
            return _status(ui, design)
        bodies = _selected_bodies(ui, design)
        body_tokens = [str(body.entityToken) for body in bodies]
        start = _bounds(bodies)
        plan = _side_plan(start, state["modes"], _stored_baseline(design, body_tokens))
        groups = _scale_groups(design, bodies)
        features = [_create_features(group, factors, plan) for group in groups]
        gesture = {
            "design": design,
            "tokens": sorted(body_tokens),
            "bodyTokens": body_tokens,
            "start": start,
            "plan": plan,
            "groups": groups,
            "features": features,
        }
        _gesture = gesture
    else:
        for group, features in zip(gesture["groups"], gesture["features"]):
            _update_features(group, features, factors, gesture["plan"])

    bodies = _bodies_from_tokens(design, gesture["bodyTokens"]) or []
    if bodies:
        _restore_selection(ui, bodies)
    dimensions = tuple(gesture["start"]["dimensions"][index] * factors[axis] for index, axis in enumerate(AXES))

    if trigger != "change":
        return _result("FINISHED", "Scaling...", fieldPatch=_size_patch(design, dimensions), **state)

    _end_gesture()
    if unchanged:
        for features in gesture["features"]:
            _delete_features(features)
        bodies = _bodies_from_tokens(design, gesture["bodyTokens"]) or []
        if bodies:
            _restore_selection(ui, bodies)
        message = "Scale returned to 100%; nothing changed."
    else:
        percent = ", ".join(f"{axis} {factors[axis] * 100:g}%" for axis in AXES)
        count = len(gesture["bodyTokens"])
        message = f"Scaled {count} bod{'y' if count == 1 else 'ies'}: {percent}."
    if bodies:
        try:
            dimensions = _bounds(bodies)["dimensions"]
        except ValueError:
            pass
    return _result("FINISHED", message, fieldPatch={**_reset_patch(), **_size_patch(design, dimensions)}, **state)


def _requested_sizes(design, payload, keys):
    sizes = {}
    for axis, key in zip(AXES, keys):
        value = _finite(payload.get(key), 0.0)
        if value > 0.0:
            sizes[axis] = _to_centimeters(design, value)
    return sizes


def _resize(ui, design, payload, keys, proportional):
    """Resize the selection to exact typed sizes (document units)."""
    _require_parametric_design(design)
    _end_gesture()
    bodies = _selected_bodies(ui, design)
    start = _bounds(bodies)
    requested = _requested_sizes(design, payload, keys)
    factors = {}
    changed = []
    for index, axis in enumerate(AXES):
        target = requested.get(axis, start["dimensions"][index])
        factor = target / start["dimensions"][index]
        factors[axis] = factor
        if abs(factor - 1.0) > 1.0e-6:
            changed.append(axis)
    if proportional and changed:
        uniform = factors[changed[0]]
        factors = {axis: uniform for axis in AXES}
    if all(abs(factors[axis] - 1.0) <= 1.0e-9 for axis in AXES):
        return _status(ui, design, "Sizes unchanged.")
    if any(factors[axis] <= 0.0 or not math.isfinite(factors[axis]) for axis in AXES):
        raise ValueError("Sizes must be greater than zero.")
    tokens = [str(body.entityToken) for body in bodies]
    plan = _side_plan(start, _modes(design), _stored_baseline(design, tokens))
    for group in _scale_groups(design, bodies):
        _create_features(group, factors, plan)
    bodies = _bodies_from_tokens(design, tokens) or []
    if bodies:
        _restore_selection(ui, bodies)
    dimensions = _bounds(bodies)["dimensions"] if bodies else tuple(
        start["dimensions"][index] * factors[axis] for index, axis in enumerate(AXES)
    )
    _units, unit_name = _document_units(design)
    sizes = ", ".join(
        f"{axis} {round(_to_document_units(design, dimensions[index]), 3):g}" for index, axis in enumerate(AXES)
    )
    return _status(ui, design, f"Resized to {sizes} {unit_name}.")


def run_flowcell_action(context=None, data=None):
    del context
    payload = data if isinstance(data, dict) else {}
    command = str(payload.get("command") or payload.get("action") or "status").strip().lower()
    ui = design = None
    try:
        ui, design = _runtime()
        if command in {"status", "refresh"}:
            _end_gesture()
            return _status(ui, design)
        if command in {"cycle_x", "cycle_y", "cycle_z"}:
            return _cycle(ui, design, command[-1].upper())
        if command in {"toggle_live", "live"}:
            return _toggle_live(ui, design)
        if command in {"baseline", "base"}:
            return _set_baseline(ui, design)
        if command == "slide":
            return _slide(ui, design, payload)
        if command == "resize":
            return _resize(ui, design, payload, SIZE_FIELDS, False)
        if command in {"apply", "open", "scale"}:
            # Older Scale layouts send exact X/Y/Z sizes with an aspect lock.
            return _resize(ui, design, payload, ("x", "y", "z"), _as_bool(payload.get("aspect_lock"), False))
        return _result("CANCELLED", f"Unknown Fusion Scale command: {command}")
    except Exception as exc:
        gesture = _gesture
        _end_gesture()
        if gesture is not None and design is not None:
            try:
                _restore_selection(ui, _bodies_from_tokens(design, gesture["bodyTokens"]) or [])
            except Exception:
                pass
        state = {}
        if design is not None:
            try:
                state = _state(design)
            except Exception:
                state = {}
        return _result(
            "ERROR",
            str(exc),
            details=traceback.format_exc()[-4000:],
            fieldPatch=_reset_patch(),
            **state,
        )
