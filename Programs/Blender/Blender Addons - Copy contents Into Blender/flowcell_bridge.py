import json
import importlib
import inspect
import os
import runpy
import time
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

import flowcell_actions as actions


BRIDGE_FOLDER_NAME = "blender_bridge_flowcell"
REQUEST_FILE_NAME = "request.json"
RESPONSE_FILE_NAME = "response.json"
CUSTOM_ACTIONS_FILE_NAME = "flowcell_custom_actions.json"
POLL_INTERVAL_SECONDS = 0.03
LAST_REQUEST_ID = None
LAST_BRIDGE_MESSAGE = ""
LAST_BRIDGE_DISPLAY = ""
LIVE_TOOL_TIMER_MIN_INTERVAL_SECONDS = 0.01
LIVE_TOOL_DEFAULT_INTERVAL_SECONDS = 0.10
LIVE_TOOL_REGISTRY: dict[str, dict[str, object]] = {}
RUNTIME_STATUS_FILE_NAME = "flowcell_bridge_runtime_status.json"
PROJECT_THEME_POLL_RESTORE_DONE_KEY = "flowcell_project_theme_poll_restore_done"
PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY = "flowcell_project_theme_poll_restore_attempts"
PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY = "flowcell_project_theme_poll_restore_next_time"
PROJECT_THEME_POLL_RESTORE_MAX_ATTEMPTS = 240
PROJECT_THEME_STARTUP_STATE_FILE_NAME = "flowcell_theme_startup_state_v1.json"
SMART_AXIS_LOCK_TOOL_ID = "smart_axis_lock"
SMART_AXIS_SUPPORTED_TYPES = {"MESH", "CURVE", "SURFACE", "FONT", "META"}
SMART_AXIS_AXES = "XYZ"
SMART_AXIS_EPS = 1e-6
SMART_AXIS_PREFIX = "_flowcell_smart_axis_"


def set_bridge_result(message: str, display: str = "") -> None:
    global LAST_BRIDGE_MESSAGE, LAST_BRIDGE_DISPLAY
    LAST_BRIDGE_MESSAGE = str(message or "")
    LAST_BRIDGE_DISPLAY = str(display or "")


def get_bridge_root_directory() -> Path:
    scripts_root = Path(bpy.utils.user_resource("SCRIPTS"))
    bridge_root = scripts_root / "addons" / BRIDGE_FOLDER_NAME
    bridge_root.mkdir(parents=True, exist_ok=True)
    return bridge_root


def get_runtime_status_path() -> Path:
    return get_bridge_root_directory() / RUNTIME_STATUS_FILE_NAME


def _write_runtime_status(event: str, **payload) -> None:
    runtime_path = get_runtime_status_path()
    history: list[dict[str, object]] = []

    if runtime_path.exists():
        try:
            existing = json.loads(runtime_path.read_text(encoding="utf-8-sig"))
            if isinstance(existing, dict):
                existing_history = existing.get("events", [])
                if isinstance(existing_history, list):
                    history = [entry for entry in existing_history if isinstance(entry, dict)]
        except Exception:
            history = []

    snapshot = {
        "event": str(event or "").strip() or "runtime",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "pid": os.getpid(),
        "runner_active": _is_live_tool_timer_registered() if "_is_live_tool_timer_registered" in globals() else False,
        "enabled_tool_ids": [
            str(entry.get("tool_id", ""))
            for entry in LIVE_TOOL_REGISTRY.values()
            if bool(entry.get("enabled"))
        ],
        "registered_tool_ids": [str(tool_id) for tool_id in LIVE_TOOL_REGISTRY.keys()],
        **payload,
    }
    history.append(snapshot)
    history = history[-40:]

    runtime_path.write_text(
        json.dumps(
            {
                "bridge_folder": str(get_bridge_root_directory()),
                "last_event": snapshot,
                "events": history,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _normalize_live_tool_id(tool_id: str) -> str:
    normalized = str(tool_id or "").strip().lower()
    if not normalized:
        raise ValueError("Live tool id is required.")
    return normalized


def _normalize_live_tool_interval(interval: float) -> float:
    try:
        seconds = float(interval)
    except Exception:
        seconds = LIVE_TOOL_DEFAULT_INTERVAL_SECONDS
    return max(seconds, LIVE_TOOL_TIMER_MIN_INTERVAL_SECONDS)


def _live_tool_callable_name(callback) -> str:
    if not callable(callback):
        return ""
    module_name = str(getattr(callback, "__module__", "") or "").strip()
    qualname = str(getattr(callback, "__qualname__", getattr(callback, "__name__", "")) or "").strip()
    return ".".join(part for part in (module_name, qualname) if part)


def _resolve_live_tool_status_fn(*callbacks):
    for callback in callbacks:
        if not callable(callback):
            continue
        status_fn = getattr(callback, "flowcell_status_fn", None)
        if callable(status_fn):
            return status_fn
    return None


def _call_live_tool_callback(callback, context: bpy.types.Context | None, entry: dict[str, object]):
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
        parameter_name = str(parameters[0].name or "").strip().lower()
        if parameter_name in {"entry", "tool", "tool_entry", "state", "registry_entry"}:
            return callback(entry)
        return callback(context)

    return callback(context, entry)


def _is_live_tool_timer_registered() -> bool:
    try:
        return bpy.app.timers.is_registered(_live_tool_timer_loop)
    except Exception:
        return False


def _enabled_live_tool_entries() -> list[dict[str, object]]:
    return [entry for entry in LIVE_TOOL_REGISTRY.values() if bool(entry.get("enabled"))]


def _live_tool_public_status(
    tool_id: str,
    context: bpy.types.Context | None = None,
    *,
    status_payload: dict[str, object] | None = None,
) -> dict[str, object]:
    normalized_tool_id = _normalize_live_tool_id(tool_id)
    entry = LIVE_TOOL_REGISTRY.get(normalized_tool_id)
    if entry is None:
        raise ValueError(f"Live tool '{normalized_tool_id}' is not registered.")

    payload = dict(status_payload or {})
    return {
        "tool_id": normalized_tool_id,
        "enabled": bool(entry.get("enabled")),
        "interval": float(entry.get("interval", LIVE_TOOL_DEFAULT_INTERVAL_SECONDS)),
        "last_run": float(entry.get("last_run", 0.0) or 0.0),
        "tick_name": str(entry.get("tick_name", "")),
        "enable_name": str(entry.get("enable_name", "")),
        "disable_name": str(entry.get("disable_name", "")),
        "status_name": str(entry.get("status_name", "")),
        "last_error": str(entry.get("last_error", "")),
        **payload,
    }


def _live_tool_status_payload(tool_id: str, context: bpy.types.Context | None = None) -> dict[str, object]:
    normalized_tool_id = _normalize_live_tool_id(tool_id)
    entry = LIVE_TOOL_REGISTRY.get(normalized_tool_id)
    if entry is None:
        raise ValueError(f"Live tool '{normalized_tool_id}' is not registered.")

    status_fn = entry.get("status_fn")
    if not callable(status_fn):
        return {}

    raw_status = _call_live_tool_callback(status_fn, context or bpy.context, entry)
    if isinstance(raw_status, dict):
        return dict(raw_status)
    if raw_status is None:
        return {}
    return {"status_message": str(raw_status)}


def _start_live_tool_timer() -> None:
    if _is_live_tool_timer_registered():
        return
    bpy.app.timers.register(_live_tool_timer_loop, first_interval=LIVE_TOOL_TIMER_MIN_INTERVAL_SECONDS, persistent=True)
    _write_runtime_status("live_runner_started")


def _stop_live_tool_timer() -> None:
    if _is_live_tool_timer_registered():
        bpy.app.timers.unregister(_live_tool_timer_loop)
        _write_runtime_status("live_runner_stopped")


def register_live_tool(
    tool_id: str,
    tick_fn,
    enable_fn=None,
    disable_fn=None,
    status_fn=None,
    interval: float = LIVE_TOOL_DEFAULT_INTERVAL_SECONDS,
):
    if not callable(tick_fn):
        raise ValueError("Live tool tick_fn must be callable.")

    normalized_tool_id = _normalize_live_tool_id(tool_id)
    existing_entry = LIVE_TOOL_REGISTRY.get(normalized_tool_id, {})
    resolved_status_fn = status_fn if callable(status_fn) else _resolve_live_tool_status_fn(tick_fn, enable_fn, disable_fn)
    LIVE_TOOL_REGISTRY[normalized_tool_id] = {
        "tool_id": normalized_tool_id,
        "enabled": bool(existing_entry.get("enabled", False)),
        "interval": _normalize_live_tool_interval(interval),
        "last_run": float(existing_entry.get("last_run", 0.0) or 0.0),
        "tick_fn": tick_fn,
        "tick_name": _live_tool_callable_name(tick_fn),
        "enable_fn": enable_fn if callable(enable_fn) else None,
        "enable_name": _live_tool_callable_name(enable_fn),
        "disable_fn": disable_fn if callable(disable_fn) else None,
        "disable_name": _live_tool_callable_name(disable_fn),
        "status_fn": resolved_status_fn,
        "status_name": _live_tool_callable_name(resolved_status_fn),
        "last_error": str(existing_entry.get("last_error", "")),
    }

    if bool(existing_entry.get("enabled", False)):
        _start_live_tool_timer()

    _write_runtime_status(
        "live_tool_registered",
        tool_id=normalized_tool_id,
        tick_name=_live_tool_callable_name(tick_fn),
        enable_name=_live_tool_callable_name(enable_fn),
        disable_name=_live_tool_callable_name(disable_fn),
        status_name=_live_tool_callable_name(resolved_status_fn),
    )
    return _live_tool_public_status(normalized_tool_id, bpy.context)


def enable_live_tool(tool_id: str):
    normalized_tool_id = _normalize_live_tool_id(tool_id)
    entry = LIVE_TOOL_REGISTRY.get(normalized_tool_id)
    if entry is None:
        raise ValueError(f"Live tool '{normalized_tool_id}' is not registered.")

    if bool(entry.get("enabled")):
        _start_live_tool_timer()
        return _live_tool_public_status(
            normalized_tool_id,
            bpy.context,
            status_payload=_live_tool_status_payload(normalized_tool_id, bpy.context),
        )

    entry["enabled"] = True
    entry["last_run"] = 0.0
    entry["last_error"] = ""
    try:
        enable_fn = entry.get("enable_fn")
        if callable(enable_fn):
            _call_live_tool_callback(enable_fn, bpy.context, entry)
    except Exception:
        entry["enabled"] = False
        raise

    _start_live_tool_timer()
    _write_runtime_status("live_tool_enabled", tool_id=normalized_tool_id)
    return _live_tool_public_status(
        normalized_tool_id,
        bpy.context,
        status_payload=_live_tool_status_payload(normalized_tool_id, bpy.context),
    )


def disable_live_tool(tool_id: str):
    normalized_tool_id = _normalize_live_tool_id(tool_id)
    entry = LIVE_TOOL_REGISTRY.get(normalized_tool_id)
    if entry is None:
        raise ValueError(f"Live tool '{normalized_tool_id}' is not registered.")

    if bool(entry.get("enabled")):
        disable_fn = entry.get("disable_fn")
        try:
            if callable(disable_fn):
                _call_live_tool_callback(disable_fn, bpy.context, entry)
        finally:
            entry["enabled"] = False

    if not _enabled_live_tool_entries():
        _stop_live_tool_timer()

    _write_runtime_status("live_tool_disabled", tool_id=normalized_tool_id)
    return _live_tool_public_status(
        normalized_tool_id,
        bpy.context,
        status_payload=_live_tool_status_payload(normalized_tool_id, bpy.context),
    )


def toggle_live_tool(tool_id: str):
    if is_live_tool_enabled(tool_id):
        return disable_live_tool(tool_id)
    return enable_live_tool(tool_id)


def is_live_tool_enabled(tool_id: str) -> bool:
    normalized_tool_id = _normalize_live_tool_id(tool_id)
    entry = LIVE_TOOL_REGISTRY.get(normalized_tool_id)
    return bool(entry and entry.get("enabled"))


def run_live_tools_tick(context: bpy.types.Context | None = None) -> int:
    active_context = context or bpy.context
    now = time.time()
    ran_count = 0

    for entry in list(LIVE_TOOL_REGISTRY.values()):
        if not bool(entry.get("enabled")):
            continue

        interval = _normalize_live_tool_interval(entry.get("interval", LIVE_TOOL_DEFAULT_INTERVAL_SECONDS))
        last_run = float(entry.get("last_run", 0.0) or 0.0)
        if last_run > 0.0 and (now - last_run) < interval:
            continue

        try:
            _call_live_tool_callback(entry["tick_fn"], active_context, entry)
            entry["last_run"] = now
            entry["last_error"] = ""
            ran_count += 1
        except Exception as exc:
            entry["last_error"] = str(exc)
            traceback.print_exc()
            try:
                disable_live_tool(str(entry.get("tool_id", "")))
            except Exception:
                traceback.print_exc()

    return ran_count


def _live_tool_timer_loop():
    enabled_entries = _enabled_live_tool_entries()
    if not enabled_entries:
        return None

    run_live_tools_tick(bpy.context)
    enabled_entries = _enabled_live_tool_entries()
    if not enabled_entries:
        return None

    next_interval = min(
        _normalize_live_tool_interval(entry.get("interval", LIVE_TOOL_DEFAULT_INTERVAL_SECONDS))
        for entry in enabled_entries
    )
    return max(next_interval, LIVE_TOOL_TIMER_MIN_INTERVAL_SECONDS)


def cleanup_live_tools(*, clear_registry: bool = True) -> None:
    for entry in list(LIVE_TOOL_REGISTRY.values()):
        tool_id = str(entry.get("tool_id", "") or "").strip()
        if not tool_id:
            continue
        try:
            disable_live_tool(tool_id)
        except Exception:
            traceback.print_exc()

    _stop_live_tool_timer()

    if clear_registry:
        LIVE_TOOL_REGISTRY.clear()
    _write_runtime_status("live_tools_cleanup", clear_registry=bool(clear_registry))


def cleanup_live_tool_runner(*, clear_registry: bool = True) -> None:
    cleanup_live_tools(clear_registry=clear_registry)


def _smart_axis_key(name: str) -> str:
    return SMART_AXIS_PREFIX + str(name or "").strip()


def _smart_axis_mode_key(axis: str) -> str:
    return _smart_axis_key(f"lock_{str(axis or '').lower()}_mode")


def _smart_axis_get_mode(scene: bpy.types.Scene, axis: str) -> str:
    value = str(scene.get(_smart_axis_mode_key(axis), "NONE") or "NONE").upper()
    return value if value in {"NONE", "MIN", "MAX"} else "NONE"


def _smart_axis_set_mode(scene: bpy.types.Scene, axis: str, mode: str) -> str:
    normalized_mode = str(mode or "NONE").upper()
    if normalized_mode not in {"NONE", "MIN", "MAX"}:
        normalized_mode = "NONE"
    scene[_smart_axis_mode_key(axis)] = normalized_mode
    return normalized_mode


def _smart_axis_active_modes(context: bpy.types.Context) -> dict[str, str]:
    return {axis: _smart_axis_get_mode(context.scene, axis) for axis in SMART_AXIS_AXES}


def _smart_axis_active_axes(context: bpy.types.Context) -> list[str]:
    return [axis for axis, mode in _smart_axis_active_modes(context).items() if mode in {"MIN", "MAX"}]


def _smart_axis_supported_objects(context: bpy.types.Context) -> list[bpy.types.Object]:
    return [
        obj
        for obj in list(getattr(context, "selected_objects", []))
        if obj is not None and obj.type in SMART_AXIS_SUPPORTED_TYPES
    ]


def _smart_axis_world_bounds(
    obj: bpy.types.Object,
    context: bpy.types.Context,
) -> tuple[Vector, Vector]:
    depsgraph = context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    points = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum


def _smart_axis_ensure_baseline(
    obj: bpy.types.Object,
    context: bpy.types.Context,
    axes: str | list[str] = SMART_AXIS_AXES,
) -> None:
    minimum, maximum = _smart_axis_world_bounds(obj, context)
    for axis in axes:
        axis_index = SMART_AXIS_AXES.index(axis)
        if obj.get(f"_{axis}_min_ref") is None:
            obj[f"_{axis}_min_ref"] = float(minimum[axis_index])
        if obj.get(f"_{axis}_max_ref") is None:
            obj[f"_{axis}_max_ref"] = float(maximum[axis_index])


def _smart_axis_set_baseline(
    obj: bpy.types.Object,
    context: bpy.types.Context,
    axes: str | list[str] = SMART_AXIS_AXES,
) -> None:
    minimum, maximum = _smart_axis_world_bounds(obj, context)
    for axis in axes:
        axis_index = SMART_AXIS_AXES.index(axis)
        obj[f"_{axis}_min_ref"] = float(minimum[axis_index])
        obj[f"_{axis}_max_ref"] = float(maximum[axis_index])


def _smart_axis_set_last_scale(obj: bpy.types.Object) -> None:
    obj["_sx"] = float(obj.scale.x)
    obj["_sy"] = float(obj.scale.y)
    obj["_sz"] = float(obj.scale.z)


def _smart_axis_get_last_scale(obj: bpy.types.Object) -> Vector | None:
    sx = obj.get("_sx")
    sy = obj.get("_sy")
    sz = obj.get("_sz")
    if sx is None or sy is None or sz is None:
        return None
    return Vector((float(sx), float(sy), float(sz)))


def _smart_axis_remember_current_scales(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        _smart_axis_set_last_scale(obj)


def _smart_axis_scale_changed(obj: bpy.types.Object) -> bool:
    previous = _smart_axis_get_last_scale(obj)
    current = obj.scale
    return previous is None or any(abs(previous[index] - current[index]) > SMART_AXIS_EPS for index in range(3))


def _smart_axis_lock_to_stored(
    obj: bpy.types.Object,
    context: bpy.types.Context,
    axis: str,
    side: str,
) -> bool:
    minimum, maximum = _smart_axis_world_bounds(obj, context)
    axis_index = SMART_AXIS_AXES.index(axis)
    ref = obj.get(f"_{axis}_{'min' if side == 'MIN' else 'max'}_ref")
    if ref is None or side not in {"MIN", "MAX"}:
        return False
    delta = float(ref) - (minimum[axis_index] if side == "MIN" else maximum[axis_index])
    if abs(delta) < SMART_AXIS_EPS:
        return False
    obj.location[axis_index] += delta
    return True


def _smart_axis_selection_token(objects: list[bpy.types.Object]) -> tuple[str, ...]:
    return tuple(sorted(str(obj.name_full or obj.name) for obj in objects))


def _smart_axis_status_payload(context: bpy.types.Context, entry: dict[str, object] | None = None) -> dict[str, object]:
    active_entry = entry or LIVE_TOOL_REGISTRY.get(SMART_AXIS_LOCK_TOOL_ID, {})
    modes = _smart_axis_active_modes(context)
    active_axes = [axis for axis, mode in modes.items() if mode in {"MIN", "MAX"}]
    selected = _smart_axis_supported_objects(context)
    return {
        "tool_name": "Smart Axis Lock",
        "registered": SMART_AXIS_LOCK_TOOL_ID in LIVE_TOOL_REGISTRY,
        "runner_active": _is_live_tool_timer_registered(),
        "enabled_tool_count": len(_enabled_live_tool_entries()),
        "modes": modes,
        "active_axes": active_axes,
        "selected": len(selected),
        "selection": [str(obj.name) for obj in selected],
        "live_enabled": bool(active_entry.get("enabled")) if active_entry else False,
    }


def _smart_axis_status_message(payload: dict[str, object]) -> str:
    modes = payload.get("modes", {})
    mode_parts = [f"{axis}:{modes.get(axis, 'NONE')}" for axis in SMART_AXIS_AXES]
    return (
        "Smart Axis Lock status. "
        f"Registered={bool(payload.get('registered'))}; "
        f"Live={'ON' if bool(payload.get('live_enabled')) else 'OFF'}; "
        f"RunnerActive={bool(payload.get('runner_active'))}; "
        f"EnabledTools={int(payload.get('enabled_tool_count', 0) or 0)}; "
        f"Selected={int(payload.get('selected', 0) or 0)}; "
        f"{' '.join(mode_parts)}."
    )


def _smart_axis_result(message: str, **payload) -> dict[str, object]:
    return {"message": str(message or ""), **payload}


def _smart_axis_enable(context: bpy.types.Context | None = None, entry: dict[str, object] | None = None) -> None:
    active_context = context or bpy.context
    selected = _smart_axis_supported_objects(active_context)
    axes = _smart_axis_active_axes(active_context)
    for obj in selected:
        if axes:
            _smart_axis_ensure_baseline(obj, active_context, axes)
    _smart_axis_remember_current_scales(selected)
    if entry is not None:
        entry["selection_token"] = _smart_axis_selection_token(selected)


def _smart_axis_disable(context: bpy.types.Context | None = None, entry: dict[str, object] | None = None) -> None:
    del context
    if entry is not None:
        entry["selection_token"] = ()


def _smart_axis_tick(context: bpy.types.Context | None = None, entry: dict[str, object] | None = None) -> None:
    active_context = context or bpy.context
    active_entry = entry or LIVE_TOOL_REGISTRY.get(SMART_AXIS_LOCK_TOOL_ID)
    if active_entry is None:
        return

    selected = _smart_axis_supported_objects(active_context)
    selection_token = _smart_axis_selection_token(selected)
    previous_token = tuple(active_entry.get("selection_token", ()) or ())
    axes = _smart_axis_active_axes(active_context)

    if selection_token != previous_token:
        for obj in selected:
            if axes:
                _smart_axis_ensure_baseline(obj, active_context, axes)
        _smart_axis_remember_current_scales(selected)
        active_entry["selection_token"] = selection_token

    if not axes:
        for obj in selected:
            if _smart_axis_scale_changed(obj):
                _smart_axis_set_last_scale(obj)
        return

    modes = _smart_axis_active_modes(active_context)
    for obj in selected:
        if not _smart_axis_scale_changed(obj):
            continue
        _smart_axis_ensure_baseline(obj, active_context, axes)
        for axis in axes:
            _smart_axis_lock_to_stored(obj, active_context, axis, modes[axis])
        _smart_axis_set_last_scale(obj)


def _smart_axis_status(context: bpy.types.Context | None = None, entry: dict[str, object] | None = None) -> dict[str, object]:
    active_context = context or bpy.context
    payload = _smart_axis_status_payload(active_context, entry)
    payload["message"] = _smart_axis_status_message(payload)
    return payload


def ensure_builtin_live_tools_registered() -> dict[str, object]:
    status = register_live_tool(
        SMART_AXIS_LOCK_TOOL_ID,
        _smart_axis_tick,
        enable_fn=_smart_axis_enable,
        disable_fn=_smart_axis_disable,
        status_fn=_smart_axis_status,
        interval=LIVE_TOOL_DEFAULT_INTERVAL_SECONDS,
    )
    _write_runtime_status("builtin_live_tools_registered", tool_id=SMART_AXIS_LOCK_TOOL_ID)
    return status


def execute_smart_axis_lock_command(
    context: bpy.types.Context,
    data: dict[str, object] | None = None,
) -> dict[str, object]:
    payload = data or {}
    ensure_builtin_live_tools_registered()
    command = str(payload.get("command", "status") or "status").strip().lower()
    selected = _smart_axis_supported_objects(context)

    if command in {"baseline", "set_baseline"}:
        if not selected:
            raise ValueError("Select at least one supported object.")
        for obj in selected:
            _smart_axis_set_baseline(obj, context)
        _smart_axis_remember_current_scales(selected)
        status_payload = _smart_axis_status_payload(context)
        _write_runtime_status("smart_axis_baseline", tool_id=SMART_AXIS_LOCK_TOOL_ID, selected=len(selected))
        return _smart_axis_result(
            f"Smart Axis Lock baseline stored for {len(selected)} object(s).",
            **status_payload,
        )

    if command in {"cycle_x", "x"}:
        axis = "X"
    elif command in {"cycle_y", "y"}:
        axis = "Y"
    elif command in {"cycle_z", "z"}:
        axis = "Z"
    else:
        axis = ""

    if axis:
        next_mode = {"NONE": "MIN", "MIN": "MAX", "MAX": "NONE"}[_smart_axis_get_mode(context.scene, axis)]
        _smart_axis_set_mode(context.scene, axis, next_mode)
        if next_mode in {"MIN", "MAX"}:
            for obj in selected:
                _smart_axis_ensure_baseline(obj, context, axis)
            _smart_axis_remember_current_scales(selected)
        status_payload = _smart_axis_status_payload(context)
        _write_runtime_status("smart_axis_cycle", tool_id=SMART_AXIS_LOCK_TOOL_ID, axis=axis, mode=next_mode)
        return _smart_axis_result(
            f"Smart Axis Lock {axis} cycled to {next_mode}.",
            axis=axis,
            mode=next_mode,
            **status_payload,
        )

    if command in {"toggle_live", "live"}:
        status = toggle_live_tool(SMART_AXIS_LOCK_TOOL_ID)
        status_payload = _smart_axis_status_payload(context, LIVE_TOOL_REGISTRY.get(SMART_AXIS_LOCK_TOOL_ID))
        _write_runtime_status("smart_axis_live_toggled", tool_id=SMART_AXIS_LOCK_TOOL_ID, live_enabled=bool(status.get("enabled")))
        merged_payload = dict(status_payload)
        merged_payload.update({
            "enabled": bool(status.get("enabled")),
            "tool_id": str(status.get("tool_id") or SMART_AXIS_LOCK_TOOL_ID),
        })
        return _smart_axis_result(
            "Smart Axis Lock live enabled." if bool(status.get("enabled")) else "Smart Axis Lock live disabled.",
            **merged_payload,
        )

    if command == "status":
        status_payload = _smart_axis_status(context, LIVE_TOOL_REGISTRY.get(SMART_AXIS_LOCK_TOOL_ID))
        _write_runtime_status(
            "smart_axis_status",
            tool_id=SMART_AXIS_LOCK_TOOL_ID,
            live_enabled=bool(status_payload.get("live_enabled")),
            runner_active=bool(status_payload.get("runner_active")),
        )
        return status_payload

    raise ValueError(f"Unsupported Smart Axis Lock command: {command}")


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


def execute_bridge_operator(action: str, data: dict) -> dict[str, object]:
    set_bridge_result("", "")
    normalized = str(action or "").strip().lower()
    result: dict[str, object] = {}

    if normalized == "make_layers":
        message = actions.perform_make_layers(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "sort":
        message = actions.perform_sort(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "sort_live":
        message = actions.perform_sort_live(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "snapshot":
        message = actions.perform_snapshot(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "back":
        message = actions.perform_back(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "restore":
        message = actions.perform_restore(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "baseline_visibility":
        message = actions.perform_baseline_visibility(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "restore_visibility":
        message = actions.perform_restore_visibility(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "trash":
        message = actions.perform_trash(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "archive":
        message = actions.perform_archive(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "empty_trash":
        message = actions.perform_empty_trash(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "add_to_live":
        message = actions.perform_add_to_live(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "new_collection":
        message = actions.perform_new_collection(
            bpy.context,
            str(data.get("name", "") or "Collection"),
        )
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "empty_collections":
        message = actions.perform_empty_collections(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "cycle_collection":
        message = actions.perform_cycle_collection(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "cycle_live_versions":
        result = actions.perform_cycle_live_versions(
            bpy.context,
            str(data.get("direction", "forward") or "forward"),
        )
        set_bridge_result(str(result.get("message", "")), str(result.get("display", "")))
    elif normalized == "save_selected_stl_to_assets":
        result = actions.perform_save_selected_stl_to_assets_result(
            bpy.context,
            str(data.get("file_name", "") or ""),
        )
        set_bridge_result(str(result.get("message", "")))
    elif normalized == "import_obj_into_scene":
        result = actions.perform_import_obj_into_scene_result(
            bpy.context,
            str(data.get("filepath", "") or ""),
        )
        set_bridge_result(str(result.get("message", "")))
    elif normalized == "import_png_as_lithophane":
        result = actions.perform_import_png_as_lithophane_result(
            bpy.context,
            str(data.get("filepath", "") or ""),
            float(data.get("dpi", 300.0) or 300.0),
        )
        set_bridge_result(str(result.get("message", "")))
    elif normalized == "render_active_object_png_to_images":
        result = actions.perform_render_active_object_png_to_images_result(
            bpy.context,
        )
        set_bridge_result(str(result.get("message", "")))
    elif normalized == "alignment_tools":
        result = actions.perform_flowcell_alignment_tool(
            bpy.context,
            data,
        )
        set_bridge_result(str(result.get("message", "")))
    elif normalized == "flatten_revolve_tools":
        result = actions.perform_flowcell_flatten_revolve_tool(
            bpy.context,
            data,
        )
        set_bridge_result(str(result.get("message", "")))
    elif normalized == "cursor_center_hole":
        message = actions.perform_cursor_center_hole(bpy.context)
        set_bridge_result(message)
        result["message"] = message
    elif normalized == "smart_axis_lock":
        result = execute_smart_axis_lock_command(
            bpy.context,
            data,
        )
        set_bridge_result(str(result.get("message", "")))
    else:
        custom_result = execute_custom_action(normalized, data)
        if custom_result is None:
            raise ValueError(f"Unsupported action: {action or '[blank]'}")
        result = custom_result
        set_bridge_result(
            str(custom_result.get("message", "")),
            str(custom_result.get("display", "")),
        )

    try:
        bpy.context.view_layer.update()
    except Exception:
        pass

    return {
        **result,
        "message": LAST_BRIDGE_MESSAGE or str(result.get("message", "") or f"Completed {normalized}."),
        "display": LAST_BRIDGE_DISPLAY,
        **({"exported_paths": result.get("exported_paths", [])} if normalized == "save_selected_stl_to_assets" else {}),
        **({"imported_objects": result.get("imported_objects", [])} if normalized in {"import_obj_into_scene", "import_png_as_lithophane"} else {}),
    }


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


def resolve_custom_action_script_path(python_path: str) -> Path:
    raw_path = str(python_path or "").strip()
    script_path = Path(raw_path).expanduser()
    if script_path.is_absolute():
        return script_path

    normalized_path = raw_path.replace("\\", "/").lstrip("/")
    scripts_addons_root = Path(bpy.utils.user_resource("SCRIPTS")) / "addons"
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
        parameter_name = str(parameters[0].name or "").strip().lower()
        if parameter_name in {"data", "payload", "options", "args", "request"}:
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


def get_request_path() -> Path:
    return get_bridge_directory() / REQUEST_FILE_NAME


def get_response_path() -> Path:
    return get_bridge_directory() / RESPONSE_FILE_NAME


def write_bridge_response(payload: dict) -> None:
    response_path = get_response_path()
    response_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _has_view3d_area() -> bool:
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


def _maybe_restore_startup_place_picture() -> None:
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
        _write_runtime_status("startup_place_picture_restore_retry_limit")
        return

    namespace[PROJECT_THEME_POLL_RESTORE_ATTEMPTS_KEY] = attempts + 1
    namespace[PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY] = now + 0.5

    if not _startup_place_picture_state_enabled() or not _has_view3d_area():
        return

    try:
        runtime_state = execute_custom_action(
            "flowcell_custom_theme",
            {"command": "read_place_picture_runtime_state"},
        )
        if isinstance(runtime_state, dict) and bool(runtime_state.get("place_picture_runtime_enabled")):
            namespace[PROJECT_THEME_POLL_RESTORE_DONE_KEY] = True
            namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)
            _write_runtime_status("startup_place_picture_already_restored")
            return

        result = execute_custom_action(
            "flowcell_custom_theme",
            {"command": "restore_project_startup_state"},
        )
        if isinstance(result, dict) and bool(result.get("restored_place_picture")):
            namespace[PROJECT_THEME_POLL_RESTORE_DONE_KEY] = True
            namespace.pop(PROJECT_THEME_POLL_RESTORE_NEXT_TIME_KEY, None)
            _write_runtime_status(
                "startup_place_picture_restored",
                message=str(result.get("message", "") or ""),
            )
    except Exception as exc:
        _write_runtime_status("startup_place_picture_restore_error", error=str(exc))


def poll_bridge_requests() -> float:
    global LAST_REQUEST_ID

    _maybe_restore_startup_place_picture()

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
            response_data.update(
                {
                    key: value
                    for key, value in result.items()
                    if key not in {"message", "display", "status"}
                }
            )

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
