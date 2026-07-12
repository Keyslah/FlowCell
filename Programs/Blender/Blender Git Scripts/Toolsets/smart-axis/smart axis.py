# Description: Smart Axis Lock stores selected object bounds, cycles pinned axis sides, and can run live while scaling.










import bpy
import mathutils
import flowcell_bridge as live_bridge

SUPPORTED_TYPES = {"MESH", "CURVE", "SURFACE", "FONT", "META"}
AXES = "XYZ"
EPS = 1e-6
PREFIX = "_flowcell_smart_axis_"
TOOL_ID = "smart_axis_lock"


def _ctx(context=None):
    return context or bpy.context


def _scene(context=None):
    return _ctx(context).scene


def _k(name):
    return PREFIX + name


def _mode_key(axis):
    return _k("lock_" + axis.lower() + "_mode")


def _get_mode(scene, axis):
    value = scene.get(_mode_key(axis), "NONE")
    return value if value in {"NONE", "MIN", "MAX"} else "NONE"


def _set_mode(scene, axis, mode):
    scene[_mode_key(axis)] = mode if mode in {"NONE", "MIN", "MAX"} else "NONE"


def _is_live(scene):
    return bool(scene.get(_k("live_enabled"), False))


def _set_live(scene, value):
    scene[_k("live_enabled")] = bool(value)


def _result(status="FINISHED", message="", changed=0, **extra):
    out = {"status": status, "message": message, "changed": changed}
    out.update(extra)
    return out


def selected_target_objects(context=None):
    return [o for o in getattr(_ctx(context), "selected_objects", []) if o and o.type in SUPPORTED_TYPES]


def world_bounds(obj, depsgraph=None):
    dg = depsgraph or bpy.context.evaluated_depsgraph_get()
    ob = obj.evaluated_get(dg)
    pts = [ob.matrix_world @ mathutils.Vector(c) for c in ob.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def ensure_baseline(obj, axes=AXES):
    lo, hi = world_bounds(obj)
    for axis in axes:
        i = AXES.index(axis)
        if obj.get(f"_{axis}_min_ref") is None:
            obj[f"_{axis}_min_ref"] = float(lo[i])
        if obj.get(f"_{axis}_max_ref") is None:
            obj[f"_{axis}_max_ref"] = float(hi[i])


def set_baseline(obj, axes=AXES):
    lo, hi = world_bounds(obj)
    for axis in axes:
        i = AXES.index(axis)
        obj[f"_{axis}_min_ref"] = float(lo[i])
        obj[f"_{axis}_max_ref"] = float(hi[i])


def lock_to_stored(obj, axis, side):
    lo, hi = world_bounds(obj)
    i = AXES.index(axis)
    ref = obj.get(f"_{axis}_{'min' if side == 'MIN' else 'max'}_ref")
    if ref is None or side not in {"MIN", "MAX"}:
        return False
    delta = ref - (lo[i] if side == "MIN" else hi[i])
    if abs(delta) < EPS:
        return False
    obj.location[i] += delta
    return True


def set_last_scale(obj):
    obj["_sx"], obj["_sy"], obj["_sz"] = float(obj.scale.x), float(obj.scale.y), float(obj.scale.z)


def get_last_scale(obj):
    sx, sy, sz = obj.get("_sx"), obj.get("_sy"), obj.get("_sz")
    return None if sx is None or sy is None or sz is None else mathutils.Vector((sx, sy, sz))


def remember_current_scales(objects):
    for obj in objects:
        set_last_scale(obj)


def scale_changed(obj):
    old = get_last_scale(obj)
    s = obj.scale
    return old is None or abs(old.x - s.x) > EPS or abs(old.y - s.y) > EPS or abs(old.z - s.z) > EPS


def active_modes(context=None):
    scn = _scene(context)
    return {axis: _get_mode(scn, axis) for axis in AXES}


def active_axes(context=None):
    return [axis for axis, mode in active_modes(context).items() if mode in {"MIN", "MAX"}]


def perform_set_baseline(context=None, data=None):
    objs = selected_target_objects(context)
    if not objs:
        return _result("CANCELLED", "Select at least one supported object.")
    for obj in objs:
        set_baseline(obj)
    remember_current_scales(objs)
    return _result("FINISHED", "Baseline set to current bounds on X/Y/Z.", len(objs))


def perform_toggle_axis(context=None, data=None, axis=None):
    axis = (axis or (data or {}).get("axis") or "X").upper()
    if axis not in AXES:
        return _result("CANCELLED", "Axis must be X, Y, or Z.")
    scn = _scene(context)
    mode = {"NONE": "MIN", "MIN": "MAX", "MAX": "NONE"}.get(_get_mode(scn, axis), "MIN")
    _set_mode(scn, axis, mode)
    objs = selected_target_objects(context)
    if mode in {"MIN", "MAX"}:
        for obj in objs:
            ensure_baseline(obj, axis)
        remember_current_scales(objs)
    return _result("FINISHED", f"{axis} {'cleared' if mode == 'NONE' else 'armed'}.", len(objs), axis=axis, mode=mode)


def perform_toggle_x(context=None, data=None):
    return perform_toggle_axis(context, data, "X")


def perform_toggle_y(context=None, data=None):
    return perform_toggle_axis(context, data, "Y")


def perform_toggle_z(context=None, data=None):
    return perform_toggle_axis(context, data, "Z")


def perform_pin_armed_axes(context=None, data=None):
    force = bool((data or {}).get("force", True))
    axes = active_axes(context)
    if not axes:
        return _result("CANCELLED", "No axis side is armed. Toggle X/Y/Z first.")
    modes = active_modes(context)
    objs = selected_target_objects(context)
    moved = 0
    for obj in objs:
        if force or scale_changed(obj):
            ensure_baseline(obj, axes)
            for axis in axes:
                moved += 1 if lock_to_stored(obj, axis, modes[axis]) else 0
            set_last_scale(obj)
    return _result("FINISHED", "Armed sides pinned.", moved, active_axes=axes)


def perform_clear_axis_locks(context=None, data=None):
    for axis in AXES:
        _set_mode(_scene(context), axis, "NONE")
    return _result("FINISHED", "Axis locks cleared.")


def _selection_token(context=None):
    return tuple(sorted(obj.name for obj in selected_target_objects(context)))


def _live_status_payload(context=None, entry=None):
    ctx = _ctx(context)
    active_entry = entry or {}
    modes = active_modes(ctx)
    return {
        "tool_id": TOOL_ID,
        "registered": TOOL_ID in live_bridge.LIVE_TOOL_REGISTRY,
        "runner_active": live_bridge._is_live_tool_timer_registered(),
        "enabled_tool_count": len(live_bridge._enabled_live_tool_entries()),
        "live_enabled": bool(active_entry.get("enabled")) if active_entry else live_bridge.is_live_tool_enabled(TOOL_ID),
        "modes": modes,
        "active_axes": [axis for axis, mode in modes.items() if mode in {"MIN", "MAX"}],
        "selected": len(selected_target_objects(ctx)),
    }


def _live_enable(context=None, entry=None):
    ctx = _ctx(context)
    objs = selected_target_objects(ctx)
    axes = active_axes(ctx)
    for obj in objs:
        if axes:
            ensure_baseline(obj, axes)
    remember_current_scales(objs)
    if entry is not None:
        entry["selection_token"] = _selection_token(ctx)


def _live_disable(context=None, entry=None):
    del context
    if entry is not None:
        entry["selection_token"] = ()


def _live_tick(context=None, entry=None):
    ctx = _ctx(context)
    active_entry = entry or {}
    current_token = _selection_token(ctx)
    previous_token = tuple(active_entry.get("selection_token", ()) or ())
    axes = active_axes(ctx)
    objs = selected_target_objects(ctx)

    if current_token != previous_token:
        for obj in objs:
            if axes:
                ensure_baseline(obj, axes)
        remember_current_scales(objs)
        active_entry["selection_token"] = current_token

    if not axes:
        for obj in objs:
            if scale_changed(obj):
                set_last_scale(obj)
        return

    modes = active_modes(ctx)
    for obj in objs:
        if not scale_changed(obj):
            continue
        ensure_baseline(obj, axes)
        for axis in axes:
            lock_to_stored(obj, axis, modes[axis])
        set_last_scale(obj)


def _ensure_live_tool_registered():
    return live_bridge.register_live_tool(
        TOOL_ID,
        _live_tick,
        enable_fn=_live_enable,
        disable_fn=_live_disable,
        status_fn=_live_status_payload,
        interval=0.10,
    )


def perform_toggle_live(context=None, data=None):
    ctx = _ctx(context)
    _ensure_live_tool_registered()
    status = live_bridge.toggle_live_tool(TOOL_ID)
    live = bool(status.get("enabled"))
    _set_live(ctx.scene, live)
    payload = _live_status_payload(ctx, live_bridge.LIVE_TOOL_REGISTRY.get(TOOL_ID))
    return _result(
        "FINISHED",
        "Live axis pinning started." if live else "Live axis pinning stopped.",
        **payload,
    )


def perform_start_live(context=None, data=None):
    return _result("FINISHED", "Live already running.", live_enabled=True) if _is_live(_scene(context)) else perform_toggle_live(context, data)


def perform_stop_live(context=None, data=None):
    return perform_toggle_live(context, data) if _is_live(_scene(context)) else _result("FINISHED", "Live already stopped.", live_enabled=False)


def perform_status(context=None, data=None):
    _ensure_live_tool_registered()
    payload = _live_status_payload(_ctx(context), live_bridge.LIVE_TOOL_REGISTRY.get(TOOL_ID))
    return _result("FINISHED", "Smart Axis Lock status.", **payload)


def run_flowcell_action(context=None, data=None):
    data = data or {}
    action = str(data.get("action") or data.get("command") or "toggle_live").lower().strip()
    routes = {
        "baseline": perform_set_baseline,
        "set_baseline": perform_set_baseline,
        "toggle_axis": perform_toggle_axis,
        "cycle_x": perform_toggle_x,
        "x": perform_toggle_x,
        "toggle_x": perform_toggle_x,
        "cycle_y": perform_toggle_y,
        "y": perform_toggle_y,
        "toggle_y": perform_toggle_y,
        "cycle_z": perform_toggle_z,
        "z": perform_toggle_z,
        "toggle_z": perform_toggle_z,
        "pin": perform_pin_armed_axes,
        "clear": perform_clear_axis_locks,
        "live": perform_toggle_live,
        "toggle_live": perform_toggle_live,
        "start_live": perform_start_live,
        "stop_live": perform_stop_live,
        "status": perform_status,
    }
    return routes.get(action, perform_toggle_live)(context, data)


def main(context=None, data=None):
    return run_flowcell_action(context, data)
