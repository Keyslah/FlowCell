# Description: Apply location, rotation, and scale to all selected objects in Object Mode.

import bpy


def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def _selected_objects(context=None):
    return list(getattr(_ctx(context), "selected_objects", []) or [])


def perform_transform_all(context=None, data=None):
    del data
    ctx = _ctx(context)
    selected_objects = _selected_objects(ctx)

    if ctx.mode != "OBJECT":
        raise ValueError("Transform All only runs in Object Mode.")
    if not selected_objects:
        raise ValueError("Select at least one object before running Transform All.")

    try:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    except Exception as exc:
        return _result("CANCELLED", f"Apply failed: {exc}")

    return _result(
        "FINISHED",
        f"Applied all transforms to {len(selected_objects)} object(s).",
        changed=len(selected_objects),
        objects=[obj.name for obj in selected_objects],
    )


def run_flowcell_action(context=None, data=None):
    return perform_transform_all(context=context, data=data)
