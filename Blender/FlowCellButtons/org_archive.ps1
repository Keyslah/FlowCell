# Description: Copy the selected objects into Archive.

# Source Bridge Action: archive
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_archive
# Source Action Start Line: 2141

# Source Action Logic:

# def perform_archive(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     archive_collection = root_collections["Archive"]
#     parent_map = build_collection_parent_map(scene_root)
#     targets = list(context.selected_objects)
# 
#     if not targets:
#         return "No selected objects to archive."
# 
#     archived = 0
# 
#     for target_name, obj in dedupe_selected_targets(targets, root_collections, parent_map):
#         duplicate_object_to_bucket(
#             obj,
#             archive_collection,
#             "a",
#             target_name,
#             context,
#             hidden=False,
#             render_hidden=False,
#         )
#         archived += 1
# 
#     return f"Archived {archived} object(s)."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'archive' -Label 'archive'
exit $LASTEXITCODE
