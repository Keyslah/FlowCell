# Description: Move the current Live version to Trash and restore the newest matching snapshot back into Live.

# Source Bridge Action: back
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_back
# Source Action Start Line: 2202

# Source Action Logic:

# def perform_back(context: bpy.types.Context) -> str:
#     disable_outliner_alpha_sort()
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     snapshots_collection = root_collections["Snapshots"]
#     trash_collection = root_collections["Trash"]
#     archive_collection = root_collections["Archive"]
#     parent_map = build_collection_parent_map(scene_root)
#     targets = list(context.selected_objects)
# 
#     if not targets:
#         return "No selected objects for Back."
# 
#     restored = 0
#     restored_objects = []
# 
#     for target_name, _ in dedupe_selected_targets(targets, root_collections, parent_map):
#         snapshot_bucket = find_named_bucket(snapshots_collection, target_name)
#         latest_snapshot = find_latest_version_object(snapshot_bucket, "s")
#         if latest_snapshot is None:
#             continue
# 
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
#         restored_live = duplicate_object_to_live(latest_snapshot, live_collection, target_name, context)
#         restored_objects.append(restored_live)
#         delete_object_and_data_if_possible(latest_snapshot)
#         restored += 1
# 
#     prune_empty_collections(snapshots_collection)
#     prune_empty_collections(trash_collection)
#     prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
# 
#     if restored_objects:
#         bpy.ops.object.select_all(action="DESELECT")
#         for obj in restored_objects:
#             obj.select_set(True)
#         context.view_layer.objects.active = restored_objects[-1]
# 
#     return f"Back restored {restored} object(s)."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'back' -Label 'back'
exit $LASTEXITCODE
