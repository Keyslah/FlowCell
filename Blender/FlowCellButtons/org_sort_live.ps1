# Description: Move every currently hidden object under Live into Trash.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_sort_live
# Source Action Start Line: 2057

# Source Action Logic:

# def perform_sort_live(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     trash_collection = root_collections["Trash"]
#     archive_collection = root_collections["Archive"]
#     parent_map = build_collection_parent_map(scene_root)
#     hidden_live_objects = []
#     seen_objects = set()
# 
#     for obj in context.scene.objects:
#         object_id = obj.as_pointer()
#         if object_id in seen_objects:
#             continue
#         seen_objects.add(object_id)
# 
#         if not object_is_in_root(obj, live_collection, parent_map):
#             continue
#         if object_is_visible(obj, context.view_layer):
#             continue
#         hidden_live_objects.append(obj)
# 
#     if not hidden_live_objects:
#         return "Live has no hidden objects to move to Trash."
# 
#     moved = 0
#     for obj in hidden_live_objects:
#         target_name = get_target_name_for_object(obj, root_collections, parent_map)
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
#     return f"Moved {moved} hidden Live object(s) to Trash."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'sort_live' -Label 'Sort Live'
exit $LASTEXITCODE


