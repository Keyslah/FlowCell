# Description: Copy the selected Live objects into Snapshots as versioned s# duplicates.

# Source Bridge Action: flowtest_custom_org_snapshot_3
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_snapshot
# Source Action Start Line: 2032

# Source Action Logic:

# def perform_snapshot(context: bpy.types.Context) -> str:
#     disable_outliner_alpha_sort()
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     snapshots_collection = root_collections["Snapshots"]
#     parent_map = build_collection_parent_map(scene_root)
# 
#     selected_objects = list(context.selected_objects)
#     if not selected_objects:
#         return "No selected objects to snapshot."
# 
#     snapshot_count = 0
#     skipped_non_live = 0
# 
#     for obj in selected_objects:
#         if not object_is_in_root(obj, live_collection, parent_map):
#             skipped_non_live += 1
#             continue
# 
#         target_name = strip_version_prefix(obj.name) or obj.name
#         snapshot_family = ensure_named_bucket(snapshots_collection, target_name)
#         snapshot_name = format_version_label(
#             "s",
#             next_object_version_number(snapshot_family, "s"),
#             target_name,
#         )
# 
#         duplicate = duplicate_object_for_snapshot(obj)
#         duplicate[TARGET_NAME_PROP] = target_name
#         duplicate.name = snapshot_name
#         duplicate.hide_viewport = False
#         duplicate.hide_render = True
#         snapshot_family.objects.link(duplicate)
#         reorder_versioned_objects(snapshot_family, "s", descending=True)
#         duplicate.hide_set(True, view_layer=context.view_layer)
#         snapshot_count += 1
# 
#     if snapshot_count == 0 and skipped_non_live > 0:
#         return "Skipped snapshot: only objects in Live can be snapshotted."
# 
#     if skipped_non_live > 0:
#         return f"Saved {snapshot_count} snapshot object(s). Skipped {skipped_non_live} non-Live object(s)."
# 
#     return f"Saved {snapshot_count} snapshot object(s)."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_org_snapshot_3' -Label 'org_snapshot'
exit $LASTEXITCODE
