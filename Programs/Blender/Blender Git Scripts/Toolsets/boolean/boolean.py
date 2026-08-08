# Description: Quick Boolean with I/U/D operation buttons, one cycling solver button, SI/HT/HC/S toggles, and Run.



bl_info = {
    "name": "Quick Boolean (0.1 mm Voxel, No Smoothing)",
    "author": "Aaron & GPT-5",
    "version": (2, 2),
    "blender": (3, 0, 0),
    "location": "View3D > Sidebar > Tool Tab",
    "description": "Quick Boolean with snapshot, cutter hide, and optional Remesh (0.1 mm default, no smoothing)",
    "category": "Object",
}

import importlib
import sys
from pathlib import Path

import bpy


def _load_flowcell_bridge():
    first_error = None
    try:
        module = importlib.import_module("flowcell_bridge")
        try:
            module = importlib.reload(module)
        except Exception:
            pass
        return module
    except Exception as exc:
        first_error = exc

    search_roots = []
    user_scripts = bpy.utils.user_resource("SCRIPTS")
    if user_scripts:
        search_roots.append(Path(user_scripts) / "addons")
    for root in bpy.utils.script_paths():
        if root:
            search_roots.append(Path(root) / "addons")

    seen = set()
    for addon_root in search_roots:
        try:
            addon_root = addon_root.resolve()
        except Exception:
            continue
        addon_key = str(addon_root)
        if addon_key in seen or not addon_root.is_dir():
            continue
        seen.add(addon_key)
        addon_root_text = str(addon_root)
        if addon_root_text not in sys.path:
            sys.path.insert(0, addon_root_text)
        try:
            module = importlib.import_module("flowcell_bridge")
            try:
                module = importlib.reload(module)
            except Exception:
                pass
            return module
        except Exception:
            continue

    raise RuntimeError(
        "FlowCell Blender bridge module was not found. Reload the FlowCell add-on or restart Blender."
    ) from first_error


def _snapshot_message_is_failure(message):
    normalized = str(message or "").strip().lower()
    return (
        not normalized
        or normalized.startswith("no selected objects to snapshot")
        or normalized.startswith("skipped snapshot")
    )


def _refresh_flowcell_snapshot_actions(bridge):
    actions_module = getattr(bridge, "actions", None)
    if actions_module is None:
        return

    try:
        importlib.reload(actions_module)
    except Exception:
        pass


def _snapshot_active_object_before_boolean(context, active):
    original_selection = list(context.selected_objects)
    original_active = context.view_layer.objects.active

    try:
        for obj in original_selection:
            if obj != active:
                obj.select_set(False)
        active.select_set(True)
        context.view_layer.objects.active = active

        bridge = _load_flowcell_bridge()
        _refresh_flowcell_snapshot_actions(bridge)
        result = bridge.execute_bridge_operator("snapshot", {})
    except Exception as exc:
        result = {"status": "error", "message": str(exc)}
    finally:
        for obj in list(context.selected_objects):
            if not any(obj == selected for selected in original_selection):
                obj.select_set(False)
        for obj in original_selection:
            obj.select_set(True)
        if original_active is not None:
            context.view_layer.objects.active = original_active

    message = str(result.get("message", "") if isinstance(result, dict) else result).strip()
    status = str(result.get("status", "ok") if isinstance(result, dict) else "ok").strip().lower()
    if status == "error" or _snapshot_message_is_failure(message):
        return {"status": "error", "message": message or "Snapshot before Boolean failed."}
    return {"status": "ok", "message": message}


def _set_modifier_property(modifier, name, value):
    if not hasattr(modifier, name):
        return
    try:
        setattr(modifier, name, value)
    except Exception:
        pass


def _collect_boolean_targets(context):
    active = context.active_object
    if active is None:
        return None, [], "Select a target object and make it active before running Boolean."
    if getattr(active, "type", "") != 'MESH':
        return None, [], "The active Boolean target must be a mesh object."

    cutters = [obj for obj in context.selected_objects if obj != active]
    if not cutters:
        return None, [], "Select at least one cutter object besides the active target."

    non_mesh_cutters = [obj for obj in cutters if getattr(obj, "type", "") != 'MESH']
    if non_mesh_cutters:
        names = ", ".join(getattr(obj, "name", "Unknown") for obj in non_mesh_cutters[:3])
        return None, [], f"Boolean cutters must be mesh objects. Non-mesh cutter(s): {names}."

    return active, cutters, ""


def _remove_temporary_boolean_operand(temp_obj):
    if temp_obj is None:
        return

    temp_mesh = getattr(temp_obj, "data", None)
    try:
        bpy.data.objects.remove(temp_obj, do_unlink=True)
    except Exception:
        pass

    if temp_mesh is not None:
        try:
            bpy.data.meshes.remove(temp_mesh)
        except Exception:
            pass


def _link_temporary_boolean_operand(context, active, temp_obj):
    active_collections = list(getattr(active, "users_collection", []) or [])
    for collection in active_collections:
        try:
            collection.objects.link(temp_obj)
            return
        except Exception:
            pass

    context.scene.collection.objects.link(temp_obj)


def _make_combined_boolean_operand(context, active, cutters):
    if len(cutters) == 1:
        return cutters[0], None

    depsgraph = context.evaluated_depsgraph_get()
    vertices = []
    faces = []
    temp_mesh = bpy.data.meshes.new("FlowCell_Boolean_Cutters_Mesh")
    temp_obj = None

    try:
        for cutter in cutters:
            evaluated = cutter.evaluated_get(depsgraph)
            source_mesh = evaluated.to_mesh()
            try:
                offset = len(vertices)
                transform = cutter.matrix_world.copy()
                vertices.extend(tuple(transform @ vertex.co) for vertex in source_mesh.vertices)
                faces.extend([offset + index for index in polygon.vertices] for polygon in source_mesh.polygons)
            finally:
                try:
                    evaluated.to_mesh_clear()
                except Exception:
                    pass

        if not vertices or not faces:
            raise ValueError("selected cutters do not contain mesh faces to combine")

        temp_mesh.from_pydata(vertices, [], faces)
        temp_mesh.update()
        temp_obj = bpy.data.objects.new("FlowCell_Boolean_Cutters", temp_mesh)
        temp_obj.display_type = 'WIRE'
        temp_obj.hide_render = True
        _link_temporary_boolean_operand(context, active, temp_obj)
        return temp_obj, temp_obj
    except Exception:
        if temp_obj is not None:
            _remove_temporary_boolean_operand(temp_obj)
        else:
            try:
                bpy.data.meshes.remove(temp_mesh)
            except Exception:
                pass
        raise


def _apply_boolean_modifiers(context, active, cutters, s):
    try:
        operand, temp_operand = _make_combined_boolean_operand(context, active, cutters)
    except Exception as exc:
        return {"status": "error", "message": f"Boolean cutter preparation failed: {exc}"}

    mod = None
    try:
        mod = active.modifiers.new(name="QuickBoolean", type='BOOLEAN')
        mod.operation = s.qb_operation
        mod.solver = s.qb_solver
        _set_modifier_property(mod, "use_self", s.qb_self_intersection)
        _set_modifier_property(mod, "use_hole_tolerant", s.qb_hole_tolerant)
        mod.object = operand

        if context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        active.select_set(True)
        context.view_layer.objects.active = active

        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception as exc:
        operand_name = getattr(operand, "name", "combined cutter")
        return {
            "status": "error",
            "message": f"Boolean apply failed for cutter operand '{operand_name}': {exc}"
        }
    finally:
        if mod is not None and mod.name in active.modifiers:
            active.modifiers.remove(mod)
        _remove_temporary_boolean_operand(temp_operand)

    return {"status": "ok", "appliedCount": len(cutters)}



def _apply_boolean_remesh(context, active, s):
    remesh = active.modifiers.new(name="QB_Remesh", type='REMESH')
    remesh.mode = s.qb_remesh_mode
    remesh.use_smooth_shade = s.qb_remesh_smooth_shade

    if s.qb_remesh_mode == 'VOXEL':
        remesh.voxel_size = s.qb_remesh_voxel_size
        remesh.adaptivity = s.qb_remesh_adaptivity
    else:
        remesh.octree_depth = s.qb_remesh_octree_depth
        remesh.scale = s.qb_remesh_scale
        remesh.use_remove_disconnected = s.qb_remesh_remove_disconnected

    if context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    context.view_layer.objects.active = active
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    if remesh.name in active.modifiers:
        active.modifiers.remove(remesh)


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ PANEL Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
class OBJECT_PT_quick_boolean(bpy.types.Panel):
    bl_label = "Quick Boolean"
    bl_idname = "OBJECT_PT_quick_BOOLEAN"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Tool'

    def draw(self, context):
        layout = self.layout
        s = context.scene

        row = layout.row(align=True)
        split = row.split(factor=0.5, align=True)
        split.row(align=True).prop(s, "qb_operation", expand=True)

        controls = split.row(align=True)
        controls.prop(s, "qb_solver", text="")
        controls.prop(s, "qb_self_intersection", text="SI", toggle=True)
        controls.prop(s, "qb_hole_tolerant", text="HT", toggle=True)
        controls.prop(s, "qb_hide_cutter", text="HC", toggle=True)
        controls.prop(s, "qb_backup_active", text="S", toggle=True)
        controls.operator("object.qb_run_auto", text="Run", icon='MOD_BOOLEAN')


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ OPERATOR Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
class OBJECT_OT_qb_run_auto(bpy.types.Operator):
    bl_label = "Run Quick Boolean"
    bl_idname = "object.qb_run_auto"
    bl_description = "Boolean between active and selected objects, auto-apply; optional snapshot, hide cutter, and Remesh"
    bl_options = {'REGISTER', 'UNDO'}

    def ensure_object_mode(self, context):
        if context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')

    def apply_remesh(self, context, obj, s):
        m = obj.modifiers.new(name="QB_Remesh", type='REMESH')
        m.mode = s.qb_remesh_mode
        m.use_smooth_shade = s.qb_remesh_smooth_shade

        if s.qb_remesh_mode == 'VOXEL':
            m.voxel_size = s.qb_remesh_voxel_size
            m.adaptivity = s.qb_remesh_adaptivity
        else:
            m.octree_depth = s.qb_remesh_octree_depth
            m.scale = s.qb_remesh_scale
            m.use_remove_disconnected = s.qb_remesh_remove_disconnected

        self.ensure_object_mode(context)
        context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)
        if m.name in obj.modifiers:
            obj.modifiers.remove(m)

    def execute(self, context):
        s = context.scene
        self.ensure_object_mode(context)
        active, cutters, target_error = _collect_boolean_targets(context)
        if target_error:
            self.report({'ERROR'}, target_error)
            return {'CANCELLED'}

        snapshot_message = ""
        if s.qb_backup_active:
            snapshot_result = _snapshot_active_object_before_boolean(context, active)
            if snapshot_result.get("status") != "ok":
                self.report({'ERROR'}, snapshot_result.get("message", "Snapshot before Boolean failed."))
                return {'CANCELLED'}
            snapshot_message = str(snapshot_result.get("message", ""))
            active.select_set(True)
            for cutter in cutters:
                cutter.select_set(True)
            context.view_layer.objects.active = active

        apply_result = _apply_boolean_modifiers(context, active, cutters, s)
        if apply_result.get("status") != "ok":
            self.report({'ERROR'}, apply_result.get("message", "Boolean apply failed."))
            return {'CANCELLED'}

        if s.qb_hide_cutter:
            for cutter in cutters:
                cutter.hide_set(True)
                cutter.hide_render = True

        if s.qb_use_remesh:
            _apply_boolean_remesh(context, active, s)

        applied_count = int(apply_result.get("appliedCount", len(cutters)))
        message = f"{s.qb_operation} Boolean applied to {applied_count} cutter object(s)."
        if snapshot_message:
            message = f"{snapshot_message} {message}"
        self.report({'INFO'}, message)
        return {'FINISHED'}


# Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ REGISTER Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
def _ensure_quick_boolean_scene_props():
    if not hasattr(bpy.types.Scene, "qb_operation"):
        bpy.types.Scene.qb_operation = bpy.props.EnumProperty(
            name="Operation",
            items=[('INTERSECT',"I",""),('UNION',"U",""),('DIFFERENCE',"D","")],
            default='DIFFERENCE'
        )
    if not hasattr(bpy.types.Scene, "qb_solver"):
        bpy.types.Scene.qb_solver = bpy.props.EnumProperty(
            name="Solver",
            items=[('FAST',"Float",""),('EXACT',"Exact",""),('MANIFOLD',"Manifold","")],
            default='EXACT'
        )
    if not hasattr(bpy.types.Scene, "qb_self_intersection"):
        bpy.types.Scene.qb_self_intersection = bpy.props.BoolProperty(name="Self Intersection", default=False)
    if not hasattr(bpy.types.Scene, "qb_hole_tolerant"):
        bpy.types.Scene.qb_hole_tolerant = bpy.props.BoolProperty(name="Hole Tolerant", default=False)
    if not hasattr(bpy.types.Scene, "qb_hide_cutter"):
        bpy.types.Scene.qb_hide_cutter = bpy.props.BoolProperty(name="Hide Cutter", default=True)
    if not hasattr(bpy.types.Scene, "qb_backup_active"):
        bpy.types.Scene.qb_backup_active = bpy.props.BoolProperty(name="Snapshot Before Run", default=True)
    if not hasattr(bpy.types.Scene, "qb_show_solver_options"):
        bpy.types.Scene.qb_show_solver_options = bpy.props.BoolProperty(name="Show Solver Options", default=False)
    if not hasattr(bpy.types.Scene, "qb_show_remesh"):
        bpy.types.Scene.qb_show_remesh = bpy.props.BoolProperty(name="Show Remesh", default=False)
    if not hasattr(bpy.types.Scene, "qb_use_remesh"):
        bpy.types.Scene.qb_use_remesh = bpy.props.BoolProperty(name="Enable Remesh", default=False)
    if not hasattr(bpy.types.Scene, "qb_remesh_mode"):
        bpy.types.Scene.qb_remesh_mode = bpy.props.EnumProperty(
            name="Remesh Mode",
            items=[('BLOCKS',"Blocks",""),('SMOOTH',"Smooth",""),('SHARP',"Sharp",""),('VOXEL',"Voxel","")],
            default='VOXEL'
        )
    if not hasattr(bpy.types.Scene, "qb_remesh_voxel_size"):
        bpy.types.Scene.qb_remesh_voxel_size = bpy.props.FloatProperty(
            name="Voxel Size",
            default=0.0001,
            min=0.0001,
            soft_min=0.0001,
            soft_max=0.01,
            step=0.001,
            precision=6,
            subtype='DISTANCE'
        )
    if not hasattr(bpy.types.Scene, "qb_remesh_adaptivity"):
        bpy.types.Scene.qb_remesh_adaptivity = bpy.props.FloatProperty(name="Adaptivity", default=0.0, min=0.0, max=1.0)
    if not hasattr(bpy.types.Scene, "qb_remesh_smooth_shade"):
        bpy.types.Scene.qb_remesh_smooth_shade = bpy.props.BoolProperty(name="Smooth Shading", default=False)
    if not hasattr(bpy.types.Scene, "qb_remesh_octree_depth"):
        bpy.types.Scene.qb_remesh_octree_depth = bpy.props.IntProperty(name="Octree Depth", default=6, min=1, max=12)
    if not hasattr(bpy.types.Scene, "qb_remesh_scale"):
        bpy.types.Scene.qb_remesh_scale = bpy.props.FloatProperty(name="Scale", default=0.9, min=0.1, max=1.0)
    if not hasattr(bpy.types.Scene, "qb_remesh_remove_disconnected"):
        bpy.types.Scene.qb_remesh_remove_disconnected = bpy.props.BoolProperty(name="Remove Disconnected", default=True)


def _run_boolean_operator(context):
    _ensure_quick_boolean_scene_props()
    s = context.scene
    if context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')

    active, cutters, target_error = _collect_boolean_targets(context)
    if target_error:
        return {"status": "error", "message": target_error}

    snapshot_message = ""
    if s.qb_backup_active:
        snapshot_result = _snapshot_active_object_before_boolean(context, active)
        if snapshot_result.get("status") != "ok":
            return snapshot_result
        snapshot_message = str(snapshot_result.get("message", ""))
        active.select_set(True)
        for cutter in cutters:
            cutter.select_set(True)
        context.view_layer.objects.active = active

    apply_result = _apply_boolean_modifiers(context, active, cutters, s)
    if apply_result.get("status") != "ok":
        return apply_result

    if s.qb_hide_cutter:
        for cutter in cutters:
            cutter.hide_set(True)
            cutter.hide_render = True

    if s.qb_use_remesh:
        _apply_boolean_remesh(context, active, s)

    applied_count = int(apply_result.get("appliedCount", len(cutters)))
    message = f"{s.qb_operation} Boolean applied to {applied_count} cutter object(s)."
    if snapshot_message:
        message = f"{snapshot_message} {message}"
    return {
        "status": "ok",
        "message": message
    }


QB_SOLVER_CYCLE = ("EXACT", "FAST", "MANIFOLD")


def _quick_boolean_state(scene):
    return {
        "operation": scene.qb_operation,
        "solver": scene.qb_solver,
        "selfIntersection": bool(scene.qb_self_intersection),
        "holeTolerant": bool(scene.qb_hole_tolerant),
        "hideCutter": bool(scene.qb_hide_cutter),
        "backupActive": bool(scene.qb_backup_active),
        "fieldPatch": {
            "operation": scene.qb_operation,
            "self_intersection": bool(scene.qb_self_intersection),
            "hole_tolerant": bool(scene.qb_hole_tolerant),
            "hide_cutter": bool(scene.qb_hide_cutter),
            "backup_active": bool(scene.qb_backup_active),
        },
    }


def run_flowcell_action(context=None, data=None):
    context = context or bpy.context
    data = data or {}
    _ensure_quick_boolean_scene_props()
    scene = context.scene
    command = str(data.get("command") or data.get("action") or "").strip().lower()

    if command in {"", "status", "state"}:
        return {"status": "ok", "message": "Quick Boolean tool set ready.", **_quick_boolean_state(scene)}

    operation_map = {
        "operation_intersect": "INTERSECT",
        "intersect": "INTERSECT",
        "i": "INTERSECT",
        "operation_union": "UNION",
        "union": "UNION",
        "u": "UNION",
        "operation_difference": "DIFFERENCE",
        "difference": "DIFFERENCE",
        "d": "DIFFERENCE",
    }
    if command in operation_map:
        scene.qb_operation = operation_map[command]
        return {"status": "ok", "message": f"Quick Boolean operation set to {scene.qb_operation}.", **_quick_boolean_state(scene)}

    solver_map = {
        "solver_fast": "FAST",
        "fast": "FAST",
        "float": "FAST",
        "solver_exact": "EXACT",
        "exact": "EXACT",
        "solver_manifold": "MANIFOLD",
        "manifold": "MANIFOLD",
    }
    if command in {"cycle_solver", "solver_cycle", "solver_next"}:
        current_solver = scene.qb_solver if scene.qb_solver in QB_SOLVER_CYCLE else QB_SOLVER_CYCLE[0]
        next_index = (QB_SOLVER_CYCLE.index(current_solver) + 1) % len(QB_SOLVER_CYCLE)
        scene.qb_solver = QB_SOLVER_CYCLE[next_index]
        return {"status": "ok", "message": f"Quick Boolean solver set to {scene.qb_solver}.", **_quick_boolean_state(scene)}

    if command == "set_solver":
        requested_solver = str(data.get("solver") or data.get("value") or data.get("mode") or "").strip().upper()
        if requested_solver == "FLOAT":
            requested_solver = "FAST"
        if requested_solver not in {"FAST", "EXACT", "MANIFOLD"}:
            return {"status": "error", "message": f"Unknown Quick Boolean solver: {requested_solver}", **_quick_boolean_state(scene)}
        scene.qb_solver = requested_solver
        return {"status": "ok", "message": f"Quick Boolean solver set to {scene.qb_solver}.", **_quick_boolean_state(scene)}

    if command in solver_map:
        scene.qb_solver = solver_map[command]
        return {"status": "ok", "message": f"Quick Boolean solver set to {scene.qb_solver}.", **_quick_boolean_state(scene)}

    toggle_map = {
        "toggle_self_intersection": "qb_self_intersection",
        "si": "qb_self_intersection",
        "toggle_hole_tolerant": "qb_hole_tolerant",
        "ht": "qb_hole_tolerant",
        "toggle_hide_cutter": "qb_hide_cutter",
        "hc": "qb_hide_cutter",
        "toggle_backup_active": "qb_backup_active",
        "ba": "qb_backup_active",
        "s": "qb_backup_active",
    }
    if command in toggle_map:
        prop_name = toggle_map[command]
        setattr(scene, prop_name, not bool(getattr(scene, prop_name)))
        return {"status": "ok", "message": f"Quick Boolean {prop_name} toggled.", **_quick_boolean_state(scene)}

    if command in {"run_boolean", "run"}:
        result = _run_boolean_operator(context)
        result.update(_quick_boolean_state(scene))
        return result

    return {"status": "error", "message": f"Unknown Quick Boolean command: {command}"}


def register():
    # Boolean base
    bpy.types.Scene.qb_operation = bpy.props.EnumProperty(
        name="Operation",
        items=[('INTERSECT',"I",""),('UNION',"U",""),('DIFFERENCE',"D","")],
        default='DIFFERENCE'
    )
    bpy.types.Scene.qb_solver = bpy.props.EnumProperty(
        name="Solver",
        items=[('FAST',"Float",""),('EXACT',"Exact",""),('MANIFOLD',"Manifold","")],
        default='EXACT'
    )
    bpy.types.Scene.qb_self_intersection = bpy.props.BoolProperty(name="Self Intersection", default=False)
    bpy.types.Scene.qb_hole_tolerant = bpy.props.BoolProperty(name="Hole Tolerant", default=False)
    bpy.types.Scene.qb_hide_cutter = bpy.props.BoolProperty(name="Hide Cutter", default=True)
    bpy.types.Scene.qb_backup_active = bpy.props.BoolProperty(name="Snapshot Before Run", default=True)

    # Foldouts
    bpy.types.Scene.qb_show_solver_options = bpy.props.BoolProperty(name="Show Solver Options", default=False)
    bpy.types.Scene.qb_show_remesh = bpy.props.BoolProperty(name="Show Remesh", default=False)

    # Remesh controls
    bpy.types.Scene.qb_use_remesh = bpy.props.BoolProperty(name="Enable Remesh", default=False)
    bpy.types.Scene.qb_remesh_mode = bpy.props.EnumProperty(
        name="Remesh Mode",
        items=[('BLOCKS',"Blocks",""),('SMOOTH',"Smooth",""),('SHARP',"Sharp",""),('VOXEL',"Voxel","")],
        default='VOXEL'
    )
    bpy.types.Scene.qb_remesh_voxel_size = bpy.props.FloatProperty(
        name="Voxel Size",
        default=0.0001,      # 0.1 mm default (in meters)
        min=0.0001,          # Prevent smaller than 0.1 mm
        soft_min=0.0001,
        soft_max=0.01,       # 10 mm upper limit
        step=0.001,
        precision=6,
        subtype='DISTANCE'
    )
    bpy.types.Scene.qb_remesh_adaptivity = bpy.props.FloatProperty(name="Adaptivity", default=0.0, min=0.0, max=1.0)
    bpy.types.Scene.qb_remesh_smooth_shade = bpy.props.BoolProperty(name="Smooth Shading", default=False)
    bpy.types.Scene.qb_remesh_octree_depth = bpy.props.IntProperty(name="Octree Depth", default=6, min=1, max=12)
    bpy.types.Scene.qb_remesh_scale = bpy.props.FloatProperty(name="Scale", default=0.9, min=0.1, max=1.0)
    bpy.types.Scene.qb_remesh_remove_disconnected = bpy.props.BoolProperty(name="Remove Disconnected", default=True)

    bpy.utils.register_class(OBJECT_PT_quick_boolean)
    bpy.utils.register_class(OBJECT_OT_qb_run_auto)


def unregister():
    del bpy.types.Scene.qb_operation
    del bpy.types.Scene.qb_solver
    del bpy.types.Scene.qb_self_intersection
    del bpy.types.Scene.qb_hole_tolerant
    del bpy.types.Scene.qb_hide_cutter
    del bpy.types.Scene.qb_backup_active
    del bpy.types.Scene.qb_show_solver_options
    del bpy.types.Scene.qb_show_remesh
    del bpy.types.Scene.qb_use_remesh
    del bpy.types.Scene.qb_remesh_mode
    del bpy.types.Scene.qb_remesh_voxel_size
    del bpy.types.Scene.qb_remesh_adaptivity
    del bpy.types.Scene.qb_remesh_smooth_shade
    del bpy.types.Scene.qb_remesh_octree_depth
    del bpy.types.Scene.qb_remesh_scale
    del bpy.types.Scene.qb_remesh_remove_disconnected

    bpy.utils.unregister_class(OBJECT_PT_quick_boolean)
    bpy.utils.unregister_class(OBJECT_OT_qb_run_auto)


if __name__ == "__main__":
    register()
