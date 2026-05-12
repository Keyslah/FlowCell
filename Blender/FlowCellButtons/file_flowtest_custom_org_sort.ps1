# Description: Sort by visibility: visible objects become Live, matching invisible family objects become Snapshots as s#, and other invisible objects become Trash as t#.

# Source Bridge Action: flowtest_custom_org_sort
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_sort
# Source Action Start Line: 1933

# Source Action Logic:

# def perform_sort(context: bpy.types.Context) -> str:
#     disable_outliner_alpha_sort()
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     snapshots_collection = root_collections["Snapshots"]
#     trash_collection = root_collections["Trash"]
#     archive_collection = root_collections["Archive"]
# 
#     parent_map = build_collection_parent_map(scene_root)
#     source_objects = collect_sort_candidate_objects(context.scene, archive_collection, parent_map)
#     if not source_objects:
#         return "No sortable scene objects found."
# 
#     live_count = 0
#     snapshot_count = 0
#     trash_count = 0
#     family_to_live_name = {}
# 
#     # Visible objects become the live/original version and are linked directly under Live.
#     for obj in source_objects:
#         if not object_is_visible(obj, context.view_layer):
#             continue
# 
#         move_object_to_target(obj, live_collection, archive_collection, parent_map)
#         obj[TARGET_NAME_PROP] = obj.name
#         family_to_live_name.setdefault(normalize_family_name(obj.name), obj.name)
#         live_count += 1
# 
#     # Invisible objects never go into Live.
#     # If an invisible object's family matches a visible live object, it becomes:
#     # Snapshots > exact visible live name > (sN)originalInvisibleName
#     # Otherwise it becomes:
#     # Trash > originalInvisibleName > (tN)originalInvisibleName
#     for obj in source_objects:
#         if object_is_visible(obj, context.view_layer):
#             continue
# 
#         family_key = normalize_family_name(obj.name)
#         live_name = family_to_live_name.get(family_key)
# 
#         if live_name:
#             snapshot_family = ensure_named_bucket(snapshots_collection, live_name)
#             obj[TARGET_NAME_PROP] = live_name
#             obj.name = format_version_label(
#                 "s",
#                 next_object_version_number(snapshot_family, "s"),
#                 live_name,
#             )
#             move_object_to_target(obj, snapshot_family, archive_collection, parent_map)
#             reorder_versioned_objects(snapshot_family, "s", descending=True)
#             snapshot_count += 1
#             continue
# 
#         trash_family = ensure_named_bucket(trash_collection, obj.name)
#         obj[TARGET_NAME_PROP] = obj.name
#         obj.name = format_version_label(
#             "t",
#             next_object_version_number(trash_family, "t"),
#             obj.name,
#         )
#         move_object_to_target(obj, trash_family, archive_collection, parent_map)
#         trash_count += 1
# 
#     prune_empty_collections(live_collection)
#     prune_empty_collections(snapshots_collection)
#     prune_empty_collections(trash_collection)
#     prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
# 
#     return f"Sorted {live_count} live, {snapshot_count} snapshots, {trash_count} trash."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_org_sort' -Label 'org_sort'
exit $LASTEXITCODE
