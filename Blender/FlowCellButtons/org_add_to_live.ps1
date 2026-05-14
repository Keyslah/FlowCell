# Description: Copy selected snapshot, trash, or archive objects into Live without replacing the current Live version.

# Source Bridge Action: add_to_live
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_add_to_live
# Source Action Start Line: 2290

# Source Action Logic:

# def perform_add_to_live(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     selected_objects = list(context.selected_objects)
# 
#     if not selected_objects:
#         return "No selected objects to add to Live."
# 
#     added = 0
# 
#     for obj in selected_objects:
#         target_name = get_target_name_for_object(
#             obj,
#             root_collections,
#             build_collection_parent_map(scene_root),
#         )
#         version_token = extract_version_token(obj.name)
#         live_name = f"{target_name}({version_token})" if version_token else target_name
#         duplicate_object_to_live(obj, live_collection, live_name, context)
#         added += 1
# 
#     return f"Added {added} object(s) to Live."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'add_to_live' -Label 'add to live'
exit $LASTEXITCODE
