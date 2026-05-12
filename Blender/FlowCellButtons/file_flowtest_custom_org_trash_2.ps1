# Description: Move the selected objects into Trash.

# Source Bridge Action: flowtest_custom_org_trash_2
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_trash
# Source Action Start Line: 2100

# Source Action Logic:

# def perform_trash(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     trash_collection = root_collections["Trash"]
#     archive_collection = root_collections["Archive"]
#     parent_map = build_collection_parent_map(scene_root)
#     targets = list(context.selected_objects)
# 
#     if not targets:
#         return "No selected objects to trash."
# 
#     moved = 0
#     skipped_archive = 0
# 
#     for target_name, obj in dedupe_selected_targets(targets, root_collections, parent_map):
#         if object_is_in_root(obj, archive_collection, parent_map):
#             skipped_archive += 1
#             continue
# 
#         move_object_to_version_bucket(
#             obj,
#             trash_collection,
#             "t",
#             target_name,
#             archive_collection,
#             parent_map,
#         )
#         moved += 1
# 
#     prune_empty_collections(trash_collection)
#     prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
# 
#     if moved == 0 and skipped_archive > 0:
#         return "Skipped trash: selected objects were in Archive."
# 
#     if skipped_archive > 0:
#         return f"Moved {moved} object(s) to Trash. Skipped {skipped_archive} archived object(s)."
# 
#     return f"Moved {moved} object(s) to Trash."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_org_trash_2' -Label 'org_trash'
exit $LASTEXITCODE
