"""FlowCell's constrained filesystem bridge for Autodesk Fusion.

The background watcher only performs filesystem work and asks Fusion to fire a
custom event.  Registry lookup, module loading, and every Fusion API call made
by an installed action happen from that event handler on Fusion's main thread.
"""

from __future__ import annotations

import datetime as _datetime
import hashlib
import importlib.util
import json
import os
import re
import threading
import time
import traceback

import adsk.core


ADDIN_VERSION = "1.0.0"
CUSTOM_EVENT_ID = "flowcell.fusion.bridge.request.v1"
POLL_INTERVAL_SECONDS = 0.075
HEARTBEAT_INTERVAL_SECONDS = 2.0
MAX_ERROR_TEXT = 4000
ACTION_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,160}$")

_addin_root = os.path.dirname(os.path.abspath(__file__))
_bridge_root = os.path.join(_addin_root, "Bridge")
_runtime_root = os.path.join(_bridge_root, str(os.getpid()))
_request_path = os.path.join(_runtime_root, "request.json")
_response_path = os.path.join(_runtime_root, "response.json")
_status_path = os.path.join(_runtime_root, "runtime_status.json")
_registry_path = os.path.join(_addin_root, "flowcell_fusion_actions.json")
_managed_actions_root = os.path.join(_addin_root, "ManagedActions")

_app = None
_custom_event = None
_event_handler = None
_watch_thread = None
_stop_event = threading.Event()
_queue_lock = threading.Lock()
_status_lock = threading.Lock()
_pending_requests = {}
_processed_request_ids = []
_module_cache = {}
_last_request_id = ""
_last_error = ""


def _utc_now():
    return _datetime.datetime.now(_datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = "{}.{}.{}.tmp".format(path, os.getpid(), threading.get_ident())
    with open(temp_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, default=str)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)


def _runtime_status(state="ready", **extra):
    global _last_error
    payload = {
        "schemaVersion": 1,
        "state": state,
        "pid": os.getpid(),
        "version": ADDIN_VERSION,
        "customEventId": CUSTOM_EVENT_ID,
        "addinRoot": _addin_root,
        "bridgeRoot": _bridge_root,
        "runtimeRoot": _runtime_root,
        "requestPath": _request_path,
        "responsePath": _response_path,
        "registryPath": _registry_path,
        "heartbeatUtc": _utc_now(),
        "lastRequestId": _last_request_id,
        "lastError": _last_error,
    }
    payload.update(extra)
    return payload


def _write_runtime_status(state="ready", **extra):
    with _status_lock:
        _atomic_write_json(_status_path, _runtime_status(state, **extra))


def _read_json(path):
    with open(path, "r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def _request_id(request):
    if not isinstance(request, dict):
        return ""
    return str(request.get("requestId") or request.get("id") or "").strip()


def _request_action(request):
    if not isinstance(request, dict):
        return ""
    return str(request.get("action") or request.get("bridgeAction") or "").strip()


def _request_payload(request):
    if not isinstance(request, dict):
        return {}
    payload = request.get("payload")
    if payload is None:
        payload = request.get("data")
    return payload if isinstance(payload, dict) else {}


def _remember_processed(request_id):
    if request_id in _processed_request_ids:
        return
    _processed_request_ids.append(request_id)
    if len(_processed_request_ids) > 256:
        del _processed_request_ids[:128]


def _watch_requests():
    """Filesystem watcher.  Its sole Fusion interaction is fireCustomEvent."""
    last_signature = None
    last_heartbeat = 0.0
    while not _stop_event.wait(POLL_INTERVAL_SECONDS):
        now = time.monotonic()
        if now - last_heartbeat >= HEARTBEAT_INTERVAL_SECONDS:
            try:
                _write_runtime_status("ready")
            except Exception:
                pass
            last_heartbeat = now

        try:
            stat = os.stat(_request_path)
            signature = (stat.st_mtime_ns, stat.st_size)
        except (FileNotFoundError, OSError):
            continue
        if signature == last_signature:
            continue

        try:
            request = _read_json(_request_path)
            request_id = _request_id(request)
            action = _request_action(request)
            if not request_id or not action:
                raise ValueError("requestId and action are required")
        except Exception:
            # A writer can briefly expose an incomplete file.  Do not consume
            # its signature; retry after the next polling interval.
            continue

        last_signature = signature
        with _queue_lock:
            if request_id in _processed_request_ids or request_id in _pending_requests:
                continue
            _pending_requests[request_id] = request

        try:
            # This is the only Fusion API call made from the watcher thread.
            _app.fireCustomEvent(CUSTOM_EVENT_ID, request_id)
        except Exception:
            with _queue_lock:
                _pending_requests.pop(request_id, None)
            last_signature = None


def _load_registry():
    if not os.path.isfile(_registry_path):
        return {"schemaVersion": 1, "actions": []}
    registry = _read_json(_registry_path)
    if not isinstance(registry, dict) or not isinstance(registry.get("actions"), list):
        raise ValueError("The Fusion action registry is invalid.")
    return registry


def _resolve_registry_entry(action):
    if not ACTION_PATTERN.fullmatch(action):
        raise ValueError("The requested Fusion action id is invalid.")

    matches = [
        entry
        for entry in _load_registry().get("actions", [])
        if isinstance(entry, dict) and str(entry.get("action") or "") == action
    ]
    if len(matches) != 1:
        raise KeyError("Fusion action '{}' is not installed exactly once.".format(action))

    entry = matches[0]
    if str(entry.get("entrypoint") or "") != "run_flowcell_action":
        raise ValueError("The Fusion action entrypoint is not allowed.")
    relative_source = str(entry.get("source") or "").replace("/", os.sep)
    if not relative_source or os.path.isabs(relative_source):
        raise ValueError("The Fusion action source must be a managed relative path.")

    source_path = os.path.abspath(os.path.join(_addin_root, relative_source))
    managed_root = os.path.normcase(os.path.abspath(_managed_actions_root))
    source_key = os.path.normcase(source_path)
    try:
        under_managed_root = os.path.commonpath([managed_root, source_key]) == managed_root
    except ValueError:
        under_managed_root = False
    if not under_managed_root or os.path.dirname(source_key) != managed_root:
        raise ValueError("The Fusion action source escapes ManagedActions.")
    if os.path.splitext(source_path)[1].lower() != ".py" or not os.path.isfile(source_path):
        raise FileNotFoundError("The managed Fusion action source is missing.")
    return entry, source_path


def _load_action_module(action, source_path):
    mtime_ns = os.stat(source_path).st_mtime_ns
    cached = _module_cache.get(action)
    if cached and cached[0] == source_path and cached[1] == mtime_ns:
        return cached[2]

    digest = hashlib.sha256(source_path.encode("utf-8")).hexdigest()[:16]
    module_name = "flowcell_fusion_action_{}_{}".format(digest, mtime_ns)
    spec = importlib.util.spec_from_file_location(module_name, source_path)
    if spec is None or spec.loader is None:
        raise ImportError("Could not load the managed Fusion action module.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    entrypoint = getattr(module, "run_flowcell_action", None)
    if not callable(entrypoint):
        raise AttributeError("Managed Fusion actions must expose run_flowcell_action.")
    _module_cache[action] = (source_path, mtime_ns, module)
    return module


def _merge_response(request, action_result):
    request_id = _request_id(request)
    action = _request_action(request)
    result = action_result if isinstance(action_result, dict) else {
        "status": "FINISHED",
        "result": action_result,
    }
    response = {
        "schemaVersion": 1,
        "requestId": request_id,
        "id": request_id,
        "action": action,
        "completedUtc": _utc_now(),
    }
    for key, value in result.items():
        if key not in {"requestId", "id", "action", "schemaVersion"}:
            response[key] = value
    response.setdefault("status", "FINISHED")
    response.setdefault("message", "")
    response["ok"] = str(response.get("status") or "").upper() not in {"ERROR", "FAILED", "CANCELLED"}
    return response


def _failure_response(request, message, details=""):
    response = _merge_response(request, {"status": "ERROR", "message": str(message)})
    if details:
        response["details"] = details[-MAX_ERROR_TEXT:]
    response["ok"] = False
    return response


def _process_request(request):
    action = _request_action(request)
    _entry, source_path = _resolve_registry_entry(action)
    module = _load_action_module(action, source_path)
    result = module.run_flowcell_action(None, _request_payload(request))
    return _merge_response(request, result)


def _take_pending_request(additional_info):
    request_id = str(additional_info or "").strip()
    with _queue_lock:
        request = _pending_requests.pop(request_id, None)
    if request is not None:
        return request

    # Fallback for custom-event implementations that omit additionalInfo.
    request = _read_json(_request_path)
    if request_id and _request_id(request) != request_id:
        raise ValueError("The queued Fusion request changed before dispatch.")
    return request


def _handle_custom_event(args):
    global _last_request_id, _last_error
    request = {"requestId": str(getattr(args, "additionalInfo", "") or "")}
    try:
        request = _take_pending_request(getattr(args, "additionalInfo", ""))
        request_id = _request_id(request)
        if not request_id:
            raise ValueError("Fusion bridge requests require requestId.")
        if request_id in _processed_request_ids:
            return
        _last_request_id = request_id
        _write_runtime_status("handling")
        response = _process_request(request)
        _last_error = ""
    except Exception as exc:
        _last_error = str(exc)
        response = _failure_response(request, exc, traceback.format_exc())

    request_id = _request_id(request)
    if request_id:
        _remember_processed(request_id)
    _atomic_write_json(_response_path, response)
    _write_runtime_status("ready", lastResponseStatus=response.get("status", ""))


class _FlowCellCustomEventHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        _handle_custom_event(args)


def run(context):
    del context
    global _app, _custom_event, _event_handler, _watch_thread, _last_error
    _stop_event.clear()
    os.makedirs(_runtime_root, exist_ok=True)
    os.makedirs(_managed_actions_root, exist_ok=True)
    try:
        _app = adsk.core.Application.get()
        if _app is None:
            raise RuntimeError("Fusion Application is unavailable.")
        # Reloading the add-in in the same Fusion PID must not replay the fixed
        # request file when its matching response has already been written.
        try:
            previous_response_id = _request_id(_read_json(_response_path))
            if previous_response_id:
                _remember_processed(previous_response_id)
        except Exception:
            pass
        _custom_event = _app.registerCustomEvent(CUSTOM_EVENT_ID)
        _event_handler = _FlowCellCustomEventHandler()
        _custom_event.add(_event_handler)
        _last_error = ""
        _write_runtime_status("ready")
        _watch_thread = threading.Thread(
            target=_watch_requests,
            name="FlowCellFusionBridgeWatcher",
            daemon=True,
        )
        _watch_thread.start()
    except Exception as exc:
        _last_error = str(exc)
        try:
            _write_runtime_status("error")
        except Exception:
            pass
        raise


def stop(context):
    del context
    global _custom_event, _event_handler, _watch_thread
    _stop_event.set()
    if _watch_thread and _watch_thread.is_alive():
        _watch_thread.join(timeout=1.0)
    try:
        if _custom_event is not None and _event_handler is not None:
            _custom_event.remove(_event_handler)
    finally:
        if _app is not None:
            try:
                _app.unregisterCustomEvent(CUSTOM_EVENT_ID)
            except Exception:
                pass
    _custom_event = None
    _event_handler = None
    _watch_thread = None
    try:
        _write_runtime_status("stopped")
    except Exception:
        pass
