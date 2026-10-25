# Description: Import Illustrator SVG layers into Fusion 360, extrude each leading millimeter value, and keep their physical size and placement.
"""FlowCell's internal Fusion action behind Illustrator's Send SVG to Fusion.

Each request item is one Illustrator layer exported as a united, filled SVG.
Like Fusion's Insert SVG, it lands in the active component (the root of a Part
Design, which allows no other components): one sketch named after the layer on
the component's XY plane and one New Body extrude of the filled regions, with
the base on the XY plane and the X/Y center at the layer's selection-relative
offset. Disconnected islands become separate bodies named after the layer.

Fusion reads SVG px at 96 per inch while Illustrator writes 72, and imported
SVG curves are fixed, so they cannot be scaled or moved afterwards. Each file
is therefore imported once to measure Fusion's native size, then imported again
at the exact physical size and position.
"""

from __future__ import annotations

import math
import os
import re
from pathlib import Path

import adsk.core
import adsk.fusion


DEFAULT_THICKNESS_MM = 1.0
CENTIMETERS_PER_MILLIMETER = 0.1
LEADING_EXTRUSION_VALUE = re.compile(
    r"^(?:\(([0-9]+(?:\.[0-9]+)?)\)|([0-9]+(?:\.[0-9]+)?))"
)
# Chordal tessellation tolerances in centimeters, Fusion's internal length unit.
MEASURE_STROKE_TOLERANCE_CM = 1.0e-5
FILL_STROKE_TOLERANCE_CM = 1.0e-4
SIZE_RELATIVE_TOLERANCE = 1.0e-4
SIZE_ABSOLUTE_TOLERANCE_CM = 1.0e-4
FILL_SAMPLE_COUNT = 3
TIMELINE_GROUP_NAME = "Illustrator SVG"
INVALID_NAME_CHARACTERS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def thickness_mm_from_name(name) -> float:
    """Read a leading number, optionally parenthesized, as millimeters."""
    stem = str(name or "")
    match = LEADING_EXTRUSION_VALUE.match(stem)
    if match is None:
        return DEFAULT_THICKNESS_MM

    token = match.group(1) or match.group(2)
    thickness_mm = float(token)
    if not math.isfinite(thickness_mm) or thickness_mm <= 0.0:
        raise ValueError(
            f"SVG name '{stem}' must use a positive finite extrusion value, got '{token}'."
        )
    return thickness_mm


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
        # The owning Illustrator layer name is authoritative; sanitizing or
        # renaming the transport file must not silently change its thickness.
        validated.append(
            {
                "filepath": filepath,
                "layerName": layer_name,
                "thicknessMm": thickness_mm_from_name(layer_name),
                "widthMm": _positive_finite_millimeters(
                    item.get("widthMm"), f"Illustrator SVG item {item_number} widthMm"
                ),
                "heightMm": _positive_finite_millimeters(
                    item.get("heightMm"), f"Illustrator SVG item {item_number} heightMm"
                ),
                "offsetXmm": _finite_millimeters(
                    item.get("offsetXmm"), f"Illustrator SVG item {item_number} offsetXmm"
                ),
                "offsetYmm": _finite_millimeters(
                    item.get("offsetYmm"), f"Illustrator SVG item {item_number} offsetYmm"
                ),
            }
        )
    return validated


def physical_import_plan(native_bounds, width_cm: float, height_cm: float, center_x_cm: float, center_y_cm: float):
    """Return the importSVG scale and position that land the art at its physical size and center.

    Fusion maps each SVG point p to scale * p + position, so the native bounds
    measured at scale 1 and position 0 determine both values exactly.
    """
    min_x, min_y, max_x, max_y = (float(value) for value in native_bounds)
    native_width = max_x - min_x
    native_height = max_y - min_y
    if not (math.isfinite(native_width) and math.isfinite(native_height)):
        raise RuntimeError("Fusion measured invalid native SVG bounds.")
    if native_width <= 0.0 or native_height <= 0.0:
        raise RuntimeError("Fusion imported SVG artwork without a measurable width and height.")

    # Fusion scales SVG uniformly; the larger span carries the most precision.
    if native_width >= native_height:
        scale = width_cm / native_width
    else:
        scale = height_cm / native_height
    position_x = center_x_cm - scale * ((min_x + max_x) / 2.0)
    position_y = center_y_cm - scale * ((min_y + max_y) / 2.0)
    return scale, position_x, position_y


def _placement_tolerance(span_cm: float) -> float:
    return max(SIZE_ABSOLUTE_TOLERANCE_CM, abs(span_cm) * SIZE_RELATIVE_TOLERANCE)


def validate_placement(bounds, width_cm: float, height_cm: float, center_x_cm: float, center_y_cm: float, layer_name: str) -> None:
    min_x, min_y, max_x, max_y = bounds
    tolerance = _placement_tolerance(max(width_cm, height_cm))
    checks = (
        ("width", max_x - min_x, width_cm),
        ("height", max_y - min_y, height_cm),
        ("X position", (min_x + max_x) / 2.0, center_x_cm),
        ("Y position", (min_y + max_y) / 2.0, center_y_cm),
    )
    for label, actual, expected in checks:
        if not math.isclose(actual, expected, rel_tol=0.0, abs_tol=tolerance):
            raise RuntimeError(
                f"Imported SVG '{layer_name}' did not preserve its Illustrator {label}: "
                f"expected {expected * 10.0:g} mm, got {actual * 10.0:g} mm."
            )


def _segments_bounds(segments):
    xs = [x for segment in segments for x, _ in segment]
    ys = [y for segment in segments for _, y in segment]
    return min(xs), min(ys), max(xs), max(ys)


def point_inside_segments(point, segments, bounds=None) -> bool:
    """Even-odd ray cast against a closed boundary given as unordered segments."""
    x, y = point
    if bounds is not None and (x < bounds[0] or x > bounds[2] or y < bounds[1] or y > bounds[3]):
        return False
    inside = False
    for (x1, y1), (x2, y2) in segments:
        if (y1 > y) != (y2 > y):
            crossing_x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < crossing_x:
                inside = not inside
    return inside


def even_depth_indices(loops) -> list[int]:
    """Indexes of regions whose outer boundary sits inside an even number of others.

    Illustrator unites each layer before export, so its boundaries never cross.
    The even-depth regions are the filled ones (outline, island in a hole, ...);
    odd-depth regions are holes. Each loop carries its boundary segments and a
    few points on that boundary; a majority vote tolerates a boundary that only
    touches another one at a point.
    """
    bounds = [_segments_bounds(loop["segments"]) for loop in loops]
    filled = []
    for index, loop in enumerate(loops):
        samples = loop["samples"]
        if not samples:
            raise RuntimeError("An imported SVG region has no measurable outline.")
        depth = 0
        for other_index, other in enumerate(loops):
            if other_index == index:
                continue
            votes = sum(
                1
                for sample in samples
                if point_inside_segments(sample, other["segments"], bounds[other_index])
            )
            if votes * 2 > len(samples):
                depth += 1
        if depth % 2 == 0:
            filled.append(index)
    return filled


def _curve_extents(geometry):
    ok, start, end = geometry.evaluator.getParameterExtents()
    if not ok:
        raise RuntimeError("Fusion could not read an imported SVG curve's extents.")
    return start, end


def _stroke_points(geometry, tolerance: float):
    start, end = _curve_extents(geometry)
    ok, points = geometry.evaluator.getStrokes(start, end, tolerance)
    if not ok or not points:
        raise RuntimeError("Fusion could not tessellate an imported SVG curve.")
    return [(float(point.x), float(point.y)) for point in points]


def _sketch_xy_bounds(sketch):
    min_x = min_y = math.inf
    max_x = max_y = -math.inf
    for curve in sketch.sketchCurves:
        for x, y in _stroke_points(curve.geometry, MEASURE_STROKE_TOLERANCE_CM):
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if not math.isfinite(min_x):
        raise RuntimeError("Fusion imported SVG artwork without measurable curves.")
    return min_x, min_y, max_x, max_y


def _outer_loop(profile):
    outer_loops = [loop for loop in profile.profileLoops if loop.isOuter]
    if len(outer_loops) != 1:
        raise RuntimeError("Fusion returned an SVG region without exactly one outer boundary.")
    return outer_loops[0]


def _loop_fill_data(loop):
    segments = []
    samples = []
    for profile_curve in loop.profileCurves:
        geometry = profile_curve.geometry
        points = _stroke_points(geometry, FILL_STROKE_TOLERANCE_CM)
        segments.extend(zip(points, points[1:]))
        if len(samples) < FILL_SAMPLE_COUNT:
            start, end = _curve_extents(geometry)
            ok, point = geometry.evaluator.getPointAtParameter((start + end) / 2.0)
            if ok:
                samples.append((float(point.x), float(point.y)))
    if not segments:
        raise RuntimeError("An imported SVG region has no measurable outline.")
    return {"segments": segments, "samples": samples}


def _filled_profiles(sketch, layer_name: str):
    profiles = list(sketch.profiles)
    if not profiles:
        raise RuntimeError(f"Imported SVG '{layer_name}' has no closed regions to extrude.")
    loops = [_loop_fill_data(_outer_loop(profile)) for profile in profiles]
    collection = adsk.core.ObjectCollection.create()
    for index in even_depth_indices(loops):
        collection.add(profiles[index])
    if collection.count == 0:
        raise RuntimeError(f"Imported SVG '{layer_name}' has no filled regions to extrude.")
    return collection


def _import_svg_sketch(component, filepath, position_x: float, position_y: float, scale: float):
    sketch = component.sketches.add(component.xYConstructionPlane)
    try:
        if not sketch.importSVG(str(filepath), position_x, position_y, scale):
            raise RuntimeError(f"Fusion did not import '{filepath}'.")
        if sketch.sketchCurves.count == 0:
            raise RuntimeError(f"Fusion imported no curves from '{filepath}'.")
    except Exception:
        sketch.deleteMe()
        raise
    return sketch


def clean_name(value) -> str:
    cleaned = INVALID_NAME_CHARACTERS.sub("_", str(value or "")).strip()
    return cleaned or "Illustrator SVG"


def unique_name(preferred: str, existing_names) -> str:
    existing = set(existing_names)
    if preferred not in existing:
        return preferred
    number = 2
    while f"{preferred} ({number})" in existing:
        number += 1
    return f"{preferred} ({number})"


def _assign_name(entity, preferred: str, existing_names) -> str:
    # Names are presentation only; keep Fusion's default if it rejects both forms.
    for candidate in (preferred, clean_name(preferred)):
        try:
            entity.name = unique_name(candidate, existing_names)
            return str(entity.name)
        except Exception:
            continue
    return str(entity.name)


def _validate_body(body, thickness_cm: float, layer_name: str) -> None:
    if not body.isSolid:
        raise RuntimeError(f"Imported SVG '{layer_name}' produced an open body instead of a solid.")
    box = body.boundingBox
    tolerance = _placement_tolerance(thickness_cm)
    if not math.isclose(float(box.minPoint.z), 0.0, rel_tol=0.0, abs_tol=tolerance) or not math.isclose(
        float(box.maxPoint.z), thickness_cm, rel_tol=0.0, abs_tol=tolerance
    ):
        raise RuntimeError(
            f"Imported SVG '{layer_name}' did not extrude {thickness_cm * 10.0:g} mm up from the XY plane."
        )


def _import_one_svg(component, item, created):
    layer_name = str(item["layerName"])
    filepath = item["filepath"]
    width_cm = float(item["widthMm"]) * CENTIMETERS_PER_MILLIMETER
    height_cm = float(item["heightMm"]) * CENTIMETERS_PER_MILLIMETER
    center_x_cm = float(item["offsetXmm"]) * CENTIMETERS_PER_MILLIMETER
    center_y_cm = float(item["offsetYmm"]) * CENTIMETERS_PER_MILLIMETER
    thickness_cm = float(item["thicknessMm"]) * CENTIMETERS_PER_MILLIMETER
    sketch_names = [sketch.name for sketch in component.sketches]
    body_names = {body.name for body in component.bRepBodies}

    measuring_sketch = _import_svg_sketch(component, filepath, 0.0, 0.0, 1.0)
    try:
        native_bounds = _sketch_xy_bounds(measuring_sketch)
    finally:
        if not measuring_sketch.deleteMe():
            raise RuntimeError(f"Fusion could not remove the measuring sketch for '{layer_name}'.")

    scale, position_x, position_y = physical_import_plan(
        native_bounds, width_cm, height_cm, center_x_cm, center_y_cm
    )
    sketch = _import_svg_sketch(component, filepath, position_x, position_y, scale)
    created.append((sketch, ()))
    sketch_name = _assign_name(sketch, layer_name, sketch_names)
    validate_placement(
        _sketch_xy_bounds(sketch), width_cm, height_cm, center_x_cm, center_y_cm, layer_name
    )

    extrude = component.features.extrudeFeatures.addSimple(
        _filled_profiles(sketch, layer_name),
        adsk.core.ValueInput.createByReal(thickness_cm),
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
    )
    if extrude is None:
        raise RuntimeError(f"Fusion could not extrude '{layer_name}'.")
    bodies = list(extrude.bodies)
    created.append((extrude, tuple(bodies)))
    if not bodies:
        raise RuntimeError(f"Extruding '{layer_name}' produced no bodies.")
    names = []
    for number, body in enumerate(bodies, start=1):
        _validate_body(body, thickness_cm, layer_name)
        preferred = layer_name if len(bodies) == 1 else f"{layer_name} {number}"
        names.append(_assign_name(body, preferred, body_names))
        body_names.add(names[-1])

    return {
        "bodies": bodies,
        "result": {
            "filepath": str(filepath),
            "layerName": layer_name,
            "sketchName": sketch_name,
            "bodyNames": names,
            "thicknessMm": item["thicknessMm"],
            "widthMm": item["widthMm"],
            "heightMm": item["heightMm"],
            "offsetXmm": item["offsetXmm"],
            "offsetYmm": item["offsetYmm"],
        },
    }


def _is_parametric(design) -> bool:
    return design.designType == adsk.fusion.DesignTypes.ParametricDesignType


def _group_timeline(design, start_marker):
    """Group the batch in the timeline, the Fusion counterpart of Blender's Live collection."""
    if start_marker is None:
        return ""
    try:
        end_index = design.timeline.markerPosition - 1
        if end_index <= start_marker:
            return ""
        group = design.timeline.timelineGroups.add(start_marker, end_index)
        group.name = TIMELINE_GROUP_NAME
        return str(group.name)
    except Exception:
        return ""


def _select(app, occurrence, bodies) -> None:
    try:
        selections = app.userInterface.activeSelections
        selections.clear()
        for body in bodies:
            selections.add(body.createForAssemblyContext(occurrence) if occurrence is not None else body)
    except Exception:
        pass


def _rollback(created, created_document) -> list[str]:
    """Delete new features newest first, then any body a direct-modeling delete left behind."""
    errors = []
    for entity, dependents in reversed(created):
        for target in (entity, *dependents):
            try:
                if target.isValid and not target.deleteMe():
                    errors.append(f"{target.objectType} could not be deleted")
            except Exception as exc:  # Rollback must continue through every new entity.
                errors.append(str(exc))
    if created_document is not None:
        try:
            created_document.close(False)
        except Exception as exc:
            errors.append(f"new design document: {exc}")
    return errors


def _active_design(app):
    design = adsk.fusion.Design.cast(app.activeProduct)
    if design is not None:
        return design, None
    document = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    design = adsk.fusion.Design.cast(app.activeProduct)
    if design is None:
        raise RuntimeError("Fusion could not open a design for the Illustrator SVG import.")
    return design, document


def run_flowcell_action(context=None, data=None):
    del context
    items = _validated_items(data)
    app = adsk.core.Application.get()
    if app is None:
        raise RuntimeError("Fusion is not available.")
    design, created_document = _active_design(app)
    component = design.activeComponent
    start_marker = design.timeline.markerPosition if _is_parametric(design) else None
    created = []
    try:
        layers = [_import_one_svg(component, item, created) for item in items]
    except Exception as exc:
        rollback_errors = _rollback(created, created_document)
        message = f"Illustrator SVG import failed; the batch was rolled back: {exc}"
        if rollback_errors:
            message += " Rollback also reported: " + "; ".join(rollback_errors)
        raise RuntimeError(message) from exc

    timeline_group = _group_timeline(design, start_marker)
    _select(app, design.activeOccurrence, [body for layer in layers for body in layer["bodies"]])
    imported_count = len(layers)
    message = (
        f"Imported {imported_count} Illustrator SVG layer(s) into Fusion 360 with physical "
        "dimensions and selection-relative positions."
    )
    return {
        "status": "FINISHED",
        "message": message,
        "display": message,
        "changed": imported_count,
        "importedCount": imported_count,
        "dimensionsPreserved": True,
        "relativePositionsPreserved": True,
        "component": str(component.name),
        "timelineGroup": timeline_group,
        "imported_bodies": [name for layer in layers for name in layer["result"]["bodyNames"]],
        "results": [layer["result"] for layer in layers],
    }
