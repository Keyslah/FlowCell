# Description: Copy selected snapshot, trash, or archive objects into Live and move the current Live version to Trash first.

# Source Bridge Action: restore
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_restore
# Source Action Start Line: 2168

# Source Action Logic:

# def perform_restore(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     trash_collection = root_collections["Trash"]
#     archive_collection = root_collections["Archive"]
#     parent_map = build_collection_parent_map(scene_root)
#     targets = list(context.selected_objects)
# 
#     if not targets:
#         return "No selected objects to restore."
# 
#     restored = 0
# 
#     for target_name, source_obj in dedupe_selected_targets(targets, root_collections, parent_map):
#         current_live = find_live_object(live_collection, target_name)
#         if current_live is not None:
#             move_object_to_version_bucket(
#                 current_live,
#                 trash_collection,
#                 "t",
#                 target_name,
#                 archive_collection,
#                 parent_map,
#             )
# 
#         duplicate_object_to_live(source_obj, live_collection, target_name, context)
#         restored += 1
# 
#     prune_empty_collections(trash_collection)
#     prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
#     return f"Restored {restored} object(s) into Live."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'restore' -Label 'restore'
exit $LASTEXITCODE
