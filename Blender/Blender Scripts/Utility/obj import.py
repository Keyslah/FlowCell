# Description: Import an OBJ, rotate it -90 degrees on X, scale it 10x, and apply transforms. (from Illustrator export)

import math

import bpy
from bpy.props import StringProperty
from bpy_extras.io_utils import ImportHelper

OPERATOR_ID = "flowtest.import_obj_fix_transform"
OPERATOR_CLASS_NAME = "FLOWTEST_OT_import_obj_fix_transform"
SUPPORTED_IMPORTED_TYPES = {"MESH", "CURVE", "SURFACE", "FONT", "EMPTY"}
ROTATE_X_RADIANS = -math.pi / 2.0
UNIFORM_SCALE_FACTOR = 10.0


def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def ensure_object_mode(context=None):
    ctx = _ctx(context)
    active = getattr(ctx, "active_object", None)
    if active and active.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def import_obj(filepath):
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=filepath)
        return
    if hasattr(bpy.ops.import_scene, "obj"):
        bpy.ops.import_scene.obj(filepath=filepath)
        return
    raise RuntimeError("No OBJ import operator is available in this Blender build.")


def imported_objects_from_delta(before_objects, context=None):
    after_objects = set(bpy.data.objects)
    imported = [obj for obj in (after_objects - before_objects) if obj.type in SUPPORTED_IMPORTED_TYPES]
    if imported:
        return imported
    return [obj for obj in getattr(_ctx(context), "selected_objects", []) if obj.type in SUPPORTED_IMPORTED_TYPES]


def apply_transform_fix(imported_objects, context=None):
    ctx = _ctx(context)
    for obj in imported_objects:
        obj.rotation_euler.rotate_axis("X", ROTATE_X_RADIANS)
        obj.scale.x *= UNIFORM_SCALE_FACTOR
        obj.scale.y *= UNIFORM_SCALE_FACTOR
        obj.scale.z *= UNIFORM_SCALE_FACTOR

    ensure_object_mode(ctx)
    previous_active = ctx.view_layer.objects.active

    bpy.ops.object.select_all(action="DESELECT")
    for obj in imported_objects:
        if obj.name not in ctx.view_layer.objects:
            continue
        obj.select_set(True)
        ctx.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.select_set(False)

    visible_imported = []
    for obj in imported_objects:
        if obj.name in ctx.view_layer.objects:
            obj.select_set(True)
            visible_imported.append(obj)

    if visible_imported:
        if previous_active and previous_active.name in ctx.view_layer.objects:
            ctx.view_layer.objects.active = previous_active
        else:
            ctx.view_layer.objects.active = visible_imported[0]


def perform_import_obj_fix_transform(context=None, data=None, filepath=None):
    ctx = _ctx(context)
    source_path = filepath or (data or {}).get("filepath")
    if not source_path:
        raise ValueError("An OBJ filepath is required, or run the action without data to open Blender's file picker.")

    ensure_object_mode(ctx)
    before_objects = set(bpy.data.objects)

    try:
        import_obj(source_path)
    except Exception as exc:
        return _result("CANCELLED", f"OBJ import failed: {exc}")

    imported_objects = imported_objects_from_delta(before_objects, ctx)
    if not imported_objects:
        return _result("CANCELLED", "No imported objects were detected after the OBJ import.")

    apply_transform_fix(imported_objects, ctx)
    return _result(
        "FINISHED",
        f"Imported and fixed {len(imported_objects)} object(s) from '{source_path}'.",
        changed=len(imported_objects),
        imported_objects=[obj.name for obj in imported_objects],
        filepath=source_path,
    )


class FLOWTEST_OT_import_obj_fix_transform(bpy.types.Operator, ImportHelper):
    bl_idname = OPERATOR_ID
    bl_label = "Import OBJ (Fix Transform)"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".obj"
    filter_glob: StringProperty(default="*.obj", options={"HIDDEN"})

    def execute(self, context):
        result = perform_import_obj_fix_transform(context=context, filepath=self.filepath)
        status = result.get("status", "FINISHED")
        message = result.get("message", "")
        report_kind = {"INFO"} if status == "FINISHED" else {"WARNING"}
        if message:
            self.report(report_kind, message)
        return {status}


def ensure_picker_operator_registered():
    existing = getattr(bpy.types, OPERATOR_CLASS_NAME, None)
    if existing is FLOWTEST_OT_import_obj_fix_transform:
        return
    if existing is not None:
        bpy.utils.unregister_class(existing)
    bpy.utils.register_class(FLOWTEST_OT_import_obj_fix_transform)


def run_flowcell_action(context=None, data=None):
    if data and data.get("filepath"):
        return perform_import_obj_fix_transform(context=context, data=data)

    ensure_picker_operator_registered()
    bpy.ops.flowtest.import_obj_fix_transform("INVOKE_DEFAULT")
    return _result("FINISHED", "OBJ picker opened in Blender.")
