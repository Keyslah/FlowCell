# Description: Set each selected object's origin to its geometry center in Object Mode.

import bpy


def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def _selected_objects(context=None):
    return list(getattr(_ctx(context), "selected_objects", []) or [])


def perform_origin_to_geometry(context=None, data=None):
    del data
    ctx = _ctx(context)
    selected_objects = _selected_objects(ctx)

    if ctx.mode != "OBJECT":
        raise ValueError("Origin to Geometry only runs in Object Mode.")
    if not selected_objects:
        raise ValueError("Select at least one object before running Origin to Geometry.")

    try:
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="MEDIAN")
    except Exception as exc:
        return _result("CANCELLED", f"Origin set failed: {exc}")

    return _result(
        "FINISHED",
        f"Set origin to geometry for {len(selected_objects)} object(s).",
        changed=len(selected_objects),
        objects=[obj.name for obj in selected_objects],
    )


def run_flowcell_action(context=None, data=None):
    return perform_origin_to_geometry(context=context, data=data)
