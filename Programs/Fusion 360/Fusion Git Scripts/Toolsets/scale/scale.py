"""FlowCell Scale for Autodesk Fusion.

The action is intentionally limited to selected native BRep bodies owned by the
root component.  That boundary keeps non-uniform dimensions and pin correction
unambiguous: Fusion creates a Scale feature at the root origin followed by a
Move feature that holds each requested MIN, MAX, or center plane stationary.
"""

from __future__ import annotations

import math
import traceback

import adsk.core
import adsk.fusion


COMMAND_ID = "flowcell_fusion_scale_command"
AXES = ("X", "Y", "Z")
PIN_MODES = ("NONE", "MIN", "MAX")
EPSILON_CM = 1.0e-7

_last_state = {
    "x": 0.0,
    "y": 0.0,
    "z": 0.0,
    "aspect_lock": True,
    "free_axis": "X",
    "x_pin": "NONE",
    "y_pin": "NONE",
    "z_pin": "NONE",
}
_pending_command = None
_command_definition = None
_definition_handler = None
_sessions = []


def _result(status="FINISHED", message="", **extra):
    output = {"status": status, "message": message}
    output.update(extra)
    return output


def _as_bool(value, fallback=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1", "yes", "on"}:
            return True
        if text in {"false", "0", "no", "off"}:
            return False
    return fallback


def _finite_positive(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) and number > 0.0 else fallback


def _pin_mode(value):
    mode = str(value or "NONE").upper()
    return mode if mode in PIN_MODES else "NONE"


def _normalize_state(data=None, fallback=None):
    source = data if isinstance(data, dict) else {}
    base = dict(fallback or _last_state)
    state = {
        "x": _finite_positive(source.get("x"), _finite_positive(base.get("x"))),
        "y": _finite_positive(source.get("y"), _finite_positive(base.get("y"))),
        "z": _finite_positive(source.get("z"), _finite_positive(base.get("z"))),
        "aspect_lock": _as_bool(source.get("aspect_lock"), _as_bool(base.get("aspect_lock"), True)),
        "free_axis": str(source.get("free_axis") or base.get("free_axis") or "X").upper(),
        "x_pin": _pin_mode(source.get("x_pin", base.get("x_pin"))),
        "y_pin": _pin_mode(source.get("y_pin", base.get("y_pin"))),
        "z_pin": _pin_mode(source.get("z_pin", base.get("z_pin"))),
    }
    if state["free_axis"] not in AXES:
        state["free_axis"] = "X"
    return state


def _field_patch(state):
    return {
        "x": round(float(state["x"]), 9),
        "y": round(float(state["y"]), 9),
        "z": round(float(state["z"]), 9),
        "aspect_lock": bool(state["aspect_lock"]),
        "free_axis": state["free_axis"],
        "x_pin": state["x_pin"],
        "y_pin": state["y_pin"],
        "z_pin": state["z_pin"],
    }


def _cycle_pin(mode):
    return {"NONE": "MIN", "MIN": "MAX", "MAX": "NONE"}.get(_pin_mode(mode), "MIN")


def _bounding_box_for_bodies(bodies):
    if not bodies:
        raise ValueError("Select at least one BRep body.")
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    precise = True
    for body in bodies:
        box = None
        try:
            box = body.preciseBoundingBox
        except Exception:
            precise = False
        if box is None:
            precise = False
            box = body.boundingBox
        if box is None:
            raise ValueError("Fusion could not calculate a body bounding box.")
        low = box.minPoint
        high = box.maxPoint
        coordinates_low = (low.x, low.y, low.z)
        coordinates_high = (high.x, high.y, high.z)
        for index in range(3):
            minimum[index] = min(minimum[index], float(coordinates_low[index]))
            maximum[index] = max(maximum[index], float(coordinates_high[index]))
    dimensions = [maximum[index] - minimum[index] for index in range(3)]
    if any((not math.isfinite(value)) or value <= EPSILON_CM for value in dimensions):
        raise ValueError("Each selected-body XYZ extent must be greater than zero.")
    return {
        "min": tuple(minimum),
        "max": tuple(maximum),
        "center": tuple((minimum[index] + maximum[index]) * 0.5 for index in range(3)),
        "dimensions": tuple(dimensions),
        "precise": precise,
    }


def _selected_root_bodies(ui, design):
    selections = ui.activeSelections
    bodies = []
    non_body_count = 0
    proxy_count = 0
    non_root_count = 0
    seen = set()
    for index in range(selections.count):
        selection = selections.item(index)
        entity = getattr(selection, "entity", None)
        body = adsk.fusion.BRepBody.cast(entity)
        if body is None:
            non_body_count += 1
            continue
        if getattr(body, "assemblyContext", None) is not None:
            proxy_count += 1
            continue
        if body.parentComponent != design.rootComponent:
            non_root_count += 1
            continue
        if getattr(body, "isTransient", False):
            non_body_count += 1
            continue
        token = str(body.entityToken)
        if token not in seen:
            seen.add(token)
            bodies.append(body)
    if non_body_count:
        raise ValueError("Select BRep bodies only; faces, sketches, meshes, and components are not scaled.")
    if proxy_count or non_root_count:
        raise ValueError("Select native root-component BRep bodies; occurrence proxies and component-owned bodies are rejected for non-uniform correctness.")
    if not bodies:
        raise ValueError("Select at least one native root-component BRep body.")
    return bodies


def _document_units(design):
    units = design.unitsManager
    return units, str(units.defaultLengthUnits)


def _require_parametric_design(design):
    design_types = getattr(adsk.fusion, "DesignTypes", None)
    parametric = getattr(design_types, "ParametricDesignType", None)
    current = getattr(design, "designType", None)
    if parametric is not None and current is not None and current != parametric:
        raise ValueError(
            "Scale requires Capture Design History so Fusion can create reversible Scale and Move features."
        )


def _to_document_units(design, centimeters):
    units, unit_name = _document_units(design)
    return float(units.convert(float(centimeters), "cm", unit_name))


def _to_centimeters(design, document_value):
    units, unit_name = _document_units(design)
    return float(units.convert(float(document_value), unit_name, "cm"))


def _state_from_bounds(design, state, bounds):
    updated = dict(state)
    for index, axis in enumerate(AXES):
        updated[axis.lower()] = _to_document_units(design, bounds["dimensions"][index])
    return updated


def _desired_dimensions_cm(design, state, baseline):
    desired = {}
    for index, axis in enumerate(AXES):
        requested = _finite_positive(state.get(axis.lower()))
        desired[axis] = _to_centimeters(design, requested) if requested > 0.0 else baseline["dimensions"][index]
    if state["aspect_lock"]:
        free_axis = state["free_axis"]
        index = AXES.index(free_axis)
        factor = desired[free_axis] / baseline["dimensions"][index]
        desired = {axis: baseline["dimensions"][i] * factor for i, axis in enumerate(AXES)}
    return desired


def _scale_plan(baseline, desired_cm, state):
    factors = {}
    anchors = {}
    translations = {}
    for index, axis in enumerate(AXES):
        factor = float(desired_cm[axis]) / float(baseline["dimensions"][index])
        if not math.isfinite(factor) or factor <= 0.0:
            raise ValueError("Scale dimensions must produce positive finite factors.")
        mode = _pin_mode(state.get(axis.lower() + "_pin"))
        if mode == "MIN":
            anchor = baseline["min"][index]
        elif mode == "MAX":
            anchor = baseline["max"][index]
        else:
            anchor = baseline["center"][index]
        factors[axis] = factor
        anchors[axis] = anchor
        translations[axis] = (1.0 - factor) * anchor
    return {"factors": factors, "anchors": anchors, "translations": translations}


def _resolve_bodies(design, tokens):
    bodies = []
    for token in tokens:
        matches = design.findEntityByToken(token)
        body = None
        for entity in matches or []:
            candidate = adsk.fusion.BRepBody.cast(entity)
            if candidate is not None:
                body = candidate
                break
        if body is None or not getattr(body, "isValid", True):
            raise RuntimeError("A selected body is no longer valid. Reopen Scale from FlowCell.")
        if getattr(body, "assemblyContext", None) is not None or body.parentComponent != design.rootComponent:
            raise RuntimeError("Scale can only continue with native root-component BRep bodies.")
        bodies.append(body)
    return bodies


def _object_collection(entities):
    collection = adsk.core.ObjectCollection.create()
    for entity in entities:
        collection.add(entity)
    return collection


def _real_value(number):
    return adsk.core.ValueInput.createByReal(float(number))


def _apply_scale_features(design, bodies, baseline, desired_cm, state):
    plan = _scale_plan(baseline, desired_cm, state)
    factors = plan["factors"]
    if all(abs(factors[axis] - 1.0) <= 1.0e-10 for axis in AXES):
        return {"changed": False, "features": []}

    component = design.rootComponent
    features = component.features
    scale_features = features.scaleFeatures
    input_entities = _object_collection(bodies)
    scale_input = scale_features.createInput(input_entities, component.originConstructionPoint, _real_value(factors["X"]))
    if scale_input is None:
        raise RuntimeError("Fusion could not create the Scale feature input.")
    if not scale_input.setToNonUniform(_real_value(factors["X"]), _real_value(factors["Y"]), _real_value(factors["Z"])):
        raise RuntimeError("Fusion rejected non-uniform body scaling.")
    scale_feature = scale_features.add(scale_input)
    if scale_feature is None:
        raise RuntimeError("Fusion did not create the Scale feature.")
    try:
        scale_feature.name = "FlowCell Scale"
    except Exception:
        pass

    created = [scale_feature]
    translations = plan["translations"]
    if any(abs(translations[axis]) > EPSILON_CM for axis in AXES):
        move_features = features.moveFeatures
        create_input2 = getattr(move_features, "createInput2", None)
        if not callable(create_input2):
            raise RuntimeError("This Fusion build lacks MoveFeatures.createInput2 (January 2023+ required for pinned scaling).")
        move_input = create_input2(_object_collection(bodies))
        if move_input is None:
            raise RuntimeError("Fusion could not create the pin-correction Move input.")
        defined = move_input.defineAsTranslateXYZ(
            _real_value(translations["X"]),
            _real_value(translations["Y"]),
            _real_value(translations["Z"]),
            False,
        )
        if not defined:
            raise RuntimeError("Fusion rejected the pin-correction translation.")
        move_feature = move_features.add(move_input)
        if move_feature is None:
            raise RuntimeError("Fusion did not create the pin-correction Move feature.")
        try:
            move_feature.name = "FlowCell Scale Pins"
        except Exception:
            pass
        created.append(move_feature)
    return {"changed": True, "features": created, "plan": plan}


def _axis_vectors(axis, reverse):
    sign = -1.0 if reverse else 1.0
    if axis == "X":
        return ((sign, 0, 0), (0, 1, 0), (0, 0, sign))
    if axis == "Y":
        return ((sign, 0, 0), (0, sign, 0), (0, 0, 1))
    return ((1, 0, 0), (0, sign, 0), (0, 0, sign))


def _triad_transform(baseline, state):
    origin = []
    for index, axis in enumerate(AXES):
        mode = state[axis.lower() + "_pin"]
        if mode == "MIN":
            origin.append(baseline["min"][index])
        elif mode == "MAX":
            origin.append(baseline["max"][index])
        else:
            origin.append(baseline["center"][index])
    free_axis = state["free_axis"]
    reverse = state[free_axis.lower() + "_pin"] == "MAX"
    vectors = _axis_vectors(free_axis, reverse)
    matrix = adsk.core.Matrix3D.create()
    matrix.setWithCoordinateSystem(
        adsk.core.Point3D.create(*origin),
        adsk.core.Vector3D.create(*vectors[0]),
        adsk.core.Vector3D.create(*vectors[1]),
        adsk.core.Vector3D.create(*vectors[2]),
    )
    return matrix


def _selected_list_value(drop_down, fallback):
    items = drop_down.listItems
    for index in range(items.count):
        item = items.item(index)
        if item.isSelected:
            return str(item.name).upper()
    return fallback


def _selected_pin_value(drop_down, fallback):
    label = _selected_list_value(drop_down, fallback).upper()
    if label in {"CENTER", "NONE"}:
        return "NONE"
    if label in {"MIN", "MINIMUM SIDE"}:
        return "MIN"
    if label in {"MAX", "MAXIMUM SIDE"}:
        return "MAX"
    return _pin_mode(fallback)


def _add_dropdown(inputs, input_id, name, values, selected):
    drop_down = inputs.addDropDownCommandInput(input_id, name, adsk.core.DropDownStyles.TextListDropDownStyle)
    for value, label in values:
        drop_down.listItems.add(label, value == selected, "")
    return drop_down


class _ScaleCommandSession:
    def __init__(self, command, pending):
        self.command = command
        self.design = pending["design"]
        self.tokens = list(pending["tokens"])
        self.baseline = dict(pending["baseline"])
        self.state = dict(pending["state"])
        self.syncing = False
        self.inputs = {}
        self.handlers = []
        self._build_inputs()
        self._wire_events()

    def _build_inputs(self):
        inputs = self.command.commandInputs
        inputs.addTextBoxCommandInput(
            "selection_summary",
            "Bodies",
            "{} native root-component BRep bod{}".format(len(self.tokens), "y" if len(self.tokens) == 1 else "ies"),
            1,
            True,
        )
        _units, unit_name = _document_units(self.design)
        for index, axis in enumerate(AXES):
            value_cm = _to_centimeters(self.design, self.state[axis.lower()])
            self.inputs[axis.lower()] = inputs.addValueInput(
                axis.lower() + "_dimension",
                axis + " dimension",
                unit_name,
                _real_value(value_cm),
            )
        self.inputs["aspect_lock"] = inputs.addBoolValueInput(
            "aspect_lock", "Lock aspect", True, "", bool(self.state["aspect_lock"])
        )
        self.inputs["free_axis"] = _add_dropdown(
            inputs,
            "free_axis",
            "Free drag axis",
            [("X", "X"), ("Y", "Y"), ("Z", "Z")],
            self.state["free_axis"],
        )
        pin_values = [("NONE", "Center"), ("MIN", "Minimum side"), ("MAX", "Maximum side")]
        for axis in AXES:
            key = axis.lower() + "_pin"
            self.inputs[key] = _add_dropdown(inputs, key, axis + " pin", pin_values, self.state[key])

        triad_group = inputs.addGroupCommandInput("triad_group", "Drag the free axis")
        triad_group.isExpanded = True
        self.inputs["triad"] = triad_group.children.addTriadCommandInput(
            "scale_triad", _triad_transform(self.baseline, self.state)
        )
        # Fusion rejects scale-factor assignments while command inputs are
        # still being constructed.  Configure the visible handle now and set
        # its factor from the command's activate event.
        self._configure_triad(apply_factor=False)

    def _wire_events(self):
        activate_handler = _ActivateHandler(self)
        input_handler = _InputChangedHandler(self)
        preview_handler = _PreviewHandler(self)
        execute_handler = _ExecuteHandler(self)
        validate_handler = _ValidateHandler(self)
        destroy_handler = _DestroyHandler(self)
        self.command.activate.add(activate_handler)
        self.command.inputChanged.add(input_handler)
        self.command.executePreview.add(preview_handler)
        self.command.execute.add(execute_handler)
        self.command.validateInputs.add(validate_handler)
        self.command.destroy.add(destroy_handler)
        self.handlers.extend(
            [activate_handler, input_handler, preview_handler, execute_handler, validate_handler, destroy_handler]
        )

    def _sync_triad_factor(self):
        axis = self.state["free_axis"]
        factor = self.inputs[axis.lower()].value / self.baseline["dimensions"][AXES.index(axis)]
        setattr(self.inputs["triad"], axis.lower() + "ScaleFactor", factor)

    def _configure_triad(self, apply_factor=True):
        triad = self.inputs["triad"]
        triad.hideAll()
        axis = self.state["free_axis"]
        if axis == "X":
            triad.isXScalingInXYVisible = True
        elif axis == "Y":
            triad.isYScalingInXYVisible = True
        else:
            triad.isZScalingInXZVisible = True
        triad.transform = _triad_transform(self.baseline, self.state)
        triad.isEnabled = True
        triad.isVisible = True
        if apply_factor:
            self._sync_triad_factor()

    def _sync_dimensions_from_factor(self, factor, changed_axis):
        if not math.isfinite(factor) or factor <= 0.0:
            return
        if self.state["aspect_lock"]:
            for index, axis in enumerate(AXES):
                self.inputs[axis.lower()].value = self.baseline["dimensions"][index] * factor
        else:
            index = AXES.index(changed_axis)
            self.inputs[changed_axis.lower()].value = self.baseline["dimensions"][index] * factor

    def input_changed(self, changed_input):
        if self.syncing:
            return
        self.syncing = True
        try:
            input_id = str(changed_input.id)
            if input_id in {"x_dimension", "y_dimension", "z_dimension"}:
                axis = input_id[0].upper()
                dimension = self.inputs[axis.lower()].value
                factor = dimension / self.baseline["dimensions"][AXES.index(axis)]
                self._sync_dimensions_from_factor(factor, axis)
                free_axis = self.state["free_axis"]
                free_factor = self.inputs[free_axis.lower()].value / self.baseline["dimensions"][AXES.index(free_axis)]
                setattr(self.inputs["triad"], free_axis.lower() + "ScaleFactor", free_factor)
            elif input_id == "scale_triad":
                triad = self.inputs["triad"]
                if not triad.isValidExpressions:
                    return
                axis = self.state["free_axis"]
                factor = float(getattr(triad, axis.lower() + "ScaleFactor"))
                self._sync_dimensions_from_factor(factor, axis)
            elif input_id == "aspect_lock":
                self.state["aspect_lock"] = bool(self.inputs["aspect_lock"].value)
                if self.state["aspect_lock"]:
                    axis = self.state["free_axis"]
                    factor = self.inputs[axis.lower()].value / self.baseline["dimensions"][AXES.index(axis)]
                    self._sync_dimensions_from_factor(factor, axis)
            elif input_id == "free_axis":
                self.state["free_axis"] = _selected_list_value(self.inputs["free_axis"], self.state["free_axis"])
                self._configure_triad()
            elif input_id in {"x_pin", "y_pin", "z_pin"}:
                self.state[input_id] = _selected_pin_value(self.inputs[input_id], self.state[input_id])
                self._configure_triad()
        finally:
            self.syncing = False

    def dimensions_cm(self):
        return {axis: float(self.inputs[axis.lower()].value) for axis in AXES}

    def validate(self):
        if not self.tokens:
            return False
        for axis in AXES:
            value = self.inputs[axis.lower()].value
            if not math.isfinite(value) or value <= EPSILON_CM:
                return False
        return bool(self.inputs["triad"].isValidExpressions)

    def execute(self):
        global _last_state
        bodies = _resolve_bodies(self.design, self.tokens)
        desired = self.dimensions_cm()
        applied = _apply_scale_features(self.design, bodies, self.baseline, desired, self.state)
        updated = dict(self.state)
        for axis in AXES:
            updated[axis.lower()] = _to_document_units(self.design, desired[axis])
        _last_state = updated
        return applied


class _ActivateHandler(adsk.core.CommandEventHandler):
    def __init__(self, session):
        super().__init__()
        self.session = session

    def notify(self, args):
        del args
        self.session._sync_triad_factor()


class _InputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self, session):
        super().__init__()
        self.session = session

    def notify(self, args):
        self.session.input_changed(args.input)


class _PreviewHandler(adsk.core.CommandEventHandler):
    def __init__(self, session):
        super().__init__()
        self.session = session

    def notify(self, args):
        try:
            self.session.execute()
            args.isValidResult = True
        except Exception:
            args.isValidResult = False


class _ExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, session):
        super().__init__()
        self.session = session

    def notify(self, args):
        try:
            self.session.execute()
        except Exception as exc:
            args.executeFailed = True
            args.executeFailedMessage = str(exc)


class _ValidateHandler(adsk.core.ValidateInputsEventHandler):
    def __init__(self, session):
        super().__init__()
        self.session = session

    def notify(self, args):
        args.areInputsValid = self.session.validate()


class _DestroyHandler(adsk.core.CommandEventHandler):
    def __init__(self, session):
        super().__init__()
        self.session = session

    def notify(self, args):
        del args
        if self.session in _sessions:
            _sessions.remove(self.session)


class _CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, pending):
        super().__init__()
        self.pending = pending

    def notify(self, args):
        session = _ScaleCommandSession(args.command, self.pending)
        _sessions.append(session)


def _launch_native_command(ui, pending):
    global _command_definition, _definition_handler
    existing = ui.commandDefinitions.itemById(COMMAND_ID)
    if existing is not None:
        try:
            existing.deleteMe()
        except Exception:
            pass
    _command_definition = ui.commandDefinitions.addButtonDefinition(
        COMMAND_ID,
        "FlowCell Scale",
        "Edit exact XYZ dimensions or drag one scale axis while holding center, minimum, or maximum planes fixed.",
    )
    _definition_handler = _CommandCreatedHandler(pending)
    _command_definition.commandCreated.add(_definition_handler)
    _command_definition.execute()


def run_flowcell_action(context=None, data=None):
    del context
    global _last_state, _pending_command
    payload = data if isinstance(data, dict) else {}
    command = str(payload.get("command") or payload.get("action") or "status").strip().lower()
    try:
        app = adsk.core.Application.get()
        if app is None:
            return _result("CANCELLED", "Fusion Application is unavailable.", fieldPatch=_field_patch(_last_state))
        ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if design is None:
            return _result("CANCELLED", "Open a Fusion Design before using Scale.", fieldPatch=_field_patch(_last_state))
        _require_parametric_design(design)

        state = _normalize_state(payload, _last_state)
        if command in {"cycle_pin", "cycle_x", "cycle_y", "cycle_z"}:
            axis = str(payload.get("axis") or (command[-1:] if command.startswith("cycle_") else "X")).upper()
            if axis not in AXES:
                return _result("CANCELLED", "Pin axis must be X, Y, or Z.", fieldPatch=_field_patch(state))
            key = axis.lower() + "_pin"
            state[key] = _cycle_pin(state[key])
            _last_state = state
            return _result(
                "FINISHED",
                "{} pin: {}.".format(axis, "CENTER" if state[key] == "NONE" else state[key]),
                fieldPatch=_field_patch(state),
                axis=axis,
                mode=state[key],
            )

        try:
            bodies = _selected_root_bodies(ui, design)
            bounds = _bounding_box_for_bodies(bodies)
        except Exception as selection_error:
            status = "FINISHED" if command == "status" else "CANCELLED"
            return _result(status, str(selection_error), selected=0, fieldPatch=_field_patch(state))

        if command in {"status", "refresh"}:
            state = _state_from_bounds(design, state, bounds)
            _last_state = state
            _units, unit_name = _document_units(design)
            return _result(
                "FINISHED",
                "Read {} selected bod{} in {}.".format(len(bodies), "y" if len(bodies) == 1 else "ies", unit_name),
                selected=len(bodies),
                units=unit_name,
                preciseBounds=bool(bounds["precise"]),
                fieldPatch=_field_patch(state),
            )

        if command not in {"apply", "open", "scale"}:
            return _result("CANCELLED", "Unknown Fusion Scale command: {}".format(command), fieldPatch=_field_patch(state))

        current_state = _state_from_bounds(design, state, bounds)
        # Keep explicitly typed positive values.  A zero/missing field is
        # refreshed from the current selection before opening the command.
        for axis in AXES:
            key = axis.lower()
            requested = _finite_positive(payload.get(key))
            if requested > 0.0:
                current_state[key] = requested
        desired_cm = _desired_dimensions_cm(design, current_state, bounds)
        for axis in AXES:
            current_state[axis.lower()] = _to_document_units(design, desired_cm[axis])
        _last_state = current_state
        _pending_command = {
            "design": design,
            "tokens": [str(body.entityToken) for body in bodies],
            "baseline": bounds,
            "state": current_state,
        }
        _launch_native_command(ui, _pending_command)
        return _result(
            "FINISHED",
            "Opened Fusion's native Scale command for {} selected bod{}. Drag the {} handle, then press Enter to commit or Esc to cancel.".format(
                len(bodies), "y" if len(bodies) == 1 else "ies", current_state["free_axis"]
            ),
            selected=len(bodies),
            launched=True,
            fieldPatch=_field_patch(current_state),
        )
    except Exception as exc:
        return _result(
            "ERROR",
            str(exc),
            details=traceback.format_exc()[-4000:],
            fieldPatch=_field_patch(_last_state),
        )
