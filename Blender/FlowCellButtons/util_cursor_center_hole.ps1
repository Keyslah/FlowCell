# Description: Open FlowCell alignment controls for active-object min, center, max, surface, and geocenter alignment.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_flowcell_alignment_tool
# Source Action Start Line: 565

# Source Action Logic:

# def perform_flowcell_alignment_tool(context: bpy.types.Context, data: dict) -> dict[str, str]:
#     command = str(data.get("command", "align_axis") or "align_axis").strip().lower()
#     if str(data.get("tool", "") or "").strip().lower() == "flatten_revolve":
#         delegated_data = dict(data)
#         delegated_data["command"] = str(data.get("tool_command", command) or command)
#         return perform_flowcell_flatten_revolve_tool(context, delegated_data)
#     if command == "cursor_center_hole":
#         return {"message": perform_cursor_center_hole(context)}
#     if command == "probe":
#         return {"message": "Alignment tools bridge is ready."}
# 
#     selected_objects = list(context.selected_objects)
#     active = getattr(context.view_layer.objects, "active", None)
#     if active is None or active not in selected_objects:
#         raise ValueError("Select an active reference object and one object to move.")
# 
#     moved_objects = [obj for obj in selected_objects if obj != active]
#     if not moved_objects:
#         raise ValueError("Select at least one object besides the active reference object.")
# 
#     active_min, active_max = get_flowcell_alignment_bounds(active)
#     active_center = (active_min + active_max) / 2.0
# 
#     axis_lookup = {"X": 0, "Y": 1, "Z": 2}
#     mode = str(data.get("mode", "CENTER") or "CENTER").strip().upper()
#     modifier = str(data.get("modifier", "") or "").strip().upper()
#     if modifier not in {"", "SURFACE", "GEOCENTER"}:
#         raise ValueError(f"Unsupported alignment modifier: {modifier}")
# 
#     if command == "center_all":
#         for obj in moved_objects:
#             obj_min, obj_max = get_flowcell_alignment_bounds(obj)
#             obj_center = (obj_min + obj_max) / 2.0
#             offset = active_center - obj_center
#             matrix = obj.matrix_world.copy()
#             matrix.translation = matrix.translation + offset
#             obj.matrix_world = matrix
#         restore_flowcell_alignment_selection(context, selected_objects, active)
#         return {"message": f"Centered {len(moved_objects)} object(s)."}
# 
#     axis = str(data.get("axis", "X") or "X").strip().upper()
#     if axis not in axis_lookup:
#         raise ValueError(f"Unsupported alignment axis: {axis}")
#     if mode not in {"MIN", "CENTER", "MAX"}:
#         raise ValueError(f"Unsupported alignment mode: {mode}")
# 
#     axis_index = axis_lookup[axis]
#     moved_count = 0
#     for obj in moved_objects:
#         obj_min, obj_max = get_flowcell_alignment_bounds(obj)
#         obj_center = (obj_min + obj_max) / 2.0
#         source = obj_center
#         if modifier == "SURFACE":
#             target = active_min[axis_index] if obj_center[axis_index] > active_center[axis_index] else active_max[axis_index]
#             source = obj_min if obj_center[axis_index] <= active_center[axis_index] else obj_max
#         elif modifier == "GEOCENTER":
#             if mode == "MIN":
#                 target = active_min[axis_index]
#             elif mode == "MAX":
#                 target = active_max[axis_index]
#             else:
#                 target = active_center[axis_index]
#         elif mode == "MIN":
#             source = obj_min
#             target = active_min[axis_index]
#         elif mode == "MAX":
#             source = obj_max
#             target = active_max[axis_index]
#         else:
#             target = active_center[axis_index]
# 
#         offset_flowcell_object_world_axis(obj, axis_index, target - source[axis_index])
#         moved_count += 1
# 
#     restore_flowcell_alignment_selection(context, selected_objects, active)
#     return {"message": f"Aligned {moved_count} object(s)."}
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'alignment_tools' -Label 'Cursor Center Hole' -DataJson '{"command":"cursor_center_hole"}'
exit $LASTEXITCODE





















































