# Description: Export the selected mesh objects to 01 src\04 assets\03 3d as a uniquely named STL.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_save_selected_stl_to_assets_result
# Source Action Start Line: 1259

# Source Action Logic:

# def perform_save_selected_stl_to_assets_result(
#     context: bpy.types.Context,
#     requested_name: str = "",
# ) -> dict[str, object]:
#     if not hasattr(bpy.ops.wm, "stl_export"):
#         raise ValueError("This Blender build does not expose wm.stl_export.")
# 
#     selected_objects = list(context.selected_objects)
#     selected_meshes = [obj for obj in selected_objects if obj.type == "MESH"]
#     if not selected_meshes:
#         raise ValueError("Select at least one mesh object to export an STL.")
# 
#     assets_dir = get_assets_3d_directory_from_current_file()
#     export_scale = get_stl_export_scale_for_millimeters(context.scene)
# 
#     view_layer = context.view_layer
#     previous_active = view_layer.objects.active
#     previous_selected = list(selected_objects)
#     previous_mode = str(getattr(context, "mode", "OBJECT") or "OBJECT")
#     exported_paths: list[Path] = []
# 
#     try:
#         if previous_mode != "OBJECT":
#             if previous_active is not None:
#                 view_layer.objects.active = previous_active
#             elif selected_meshes:
#                 view_layer.objects.active = selected_meshes[0]
#             bpy.ops.object.mode_set(mode="OBJECT")
# 
#         result = None
#         for obj in selected_meshes:
#             bpy.ops.object.select_all(action="DESELECT")
#             obj.select_set(True)
#             view_layer.objects.active = obj
# 
#             export_stem = (
#                 sanitize_export_stem(requested_name)
#                 if requested_name.strip() and len(selected_meshes) == 1
#                 else sanitize_export_stem(strip_hidden_name_pad(strip_version_prefix(obj.name) or obj.name))
#             )
#             export_path = get_overwrite_export_path(assets_dir, export_stem, ".stl")
# 
#             result = bpy.ops.wm.stl_export(
#                 filepath=str(export_path),
#                 check_existing=False,
#                 export_selected_objects=True,
#                 apply_modifiers=True,
#                 ascii_format=False,
#                 use_scene_unit=False,
#                 global_scale=export_scale,
#             )
#             if result is None or "FINISHED" not in result:
#                 raise ValueError(f"STL export did not finish for '{obj.name}'.")
# 
#             exported_paths.append(export_path)
#     finally:
#         bpy.ops.object.select_all(action="DESELECT")
#         for obj in previous_selected:
#             try:
#                 obj.select_set(True)
#             except Exception:
#                 pass
#         if previous_active is not None:
#             try:
#                 view_layer.objects.active = previous_active
#             except Exception:
#                 pass
#         if previous_mode != "OBJECT":
#             try:
#                 bpy.ops.object.mode_set(mode=previous_mode)
#             except Exception:
#                 pass
# 
#     exported_count = len(exported_paths)
#     if exported_count == 0:
#         raise ValueError("STL export did not produce any files.")
# 
#     if exported_count == 1:
#         return {
#             "message": f"Saved STL to {exported_paths[0]}",
#             "exported_paths": [str(exported_paths[0])],
#         }
# 
#     return {
#         "message": f"Saved {exported_count} STL files to {assets_dir}",
#         "exported_paths": [str(path) for path in exported_paths],
#     }
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_file_orca' -Label 'file_orca'
exit $LASTEXITCODE
