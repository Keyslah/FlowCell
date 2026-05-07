# Description: With one selected Live object, cycle Live and snapshot versions one visible object at a time.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_cycle_live_versions
# Source Action Start Line: 2358

# Source Action Logic:

# def perform_cycle_live_versions(
#     context: bpy.types.Context,
#     direction: str = "forward",
# ) -> dict[str, str]:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     live_collection = root_collections["Live"]
#     snapshots_collection = root_collections["Snapshots"]
#     parent_map = build_collection_parent_map(scene_root)
#     selected_objects = list(context.selected_objects)
# 
#     if len(selected_objects) != 1:
#         return {
#             "message": "Select exactly one object from Live or its snapshots.",
#             "display": "",
#         }
# 
#     step = -1 if str(direction).strip().lower() == "backward" else 1
# 
#     selected_object = selected_objects[0]
#     in_live = object_is_in_root(selected_object, live_collection, parent_map)
#     in_snapshots = object_is_in_root(selected_object, snapshots_collection, parent_map)
#     if not in_live and not in_snapshots:
#         return {
#             "message": "Select one Live object or one of its snapshots.",
#             "display": "",
#         }
# 
#     target_name = get_target_name_for_object(selected_object, root_collections, parent_map)
#     version_items = get_version_cycle_items(live_collection, snapshots_collection, target_name)
#     snapshot_bucket = find_named_bucket(snapshots_collection, target_name)
#     if not version_items:
#         return {
#             "message": f"No Live or snapshot versions found for '{target_name}'.",
#             "display": "",
#         }
# 
#     current_index = -1
#     visible_indexes = [
#         index
#         for index, (_, obj) in enumerate(version_items)
#         if obj.visible_get(view_layer=context.view_layer)
#     ]
#     if len(visible_indexes) == 1:
#         current_index = visible_indexes[0]
#     else:
#         for index, (_, obj) in enumerate(version_items):
#             if obj == selected_object:
#                 current_index = index
#                 break
# 
#     if current_index < 0:
#         next_index = 0 if step > 0 else len(version_items) - 1
#     else:
#         next_index = (current_index + step) % len(version_items)
#     next_label, next_object = version_items[next_index]
# 
#     reveal_collection_in_view_layer(context, live_collection)
#     reveal_collection_in_view_layer(context, snapshots_collection)
#     reveal_collection_in_view_layer(context, snapshot_bucket)
#     reveal_object_collection_paths(context, next_object)
# 
#     for _, obj in version_items:
#         obj.hide_viewport = False
#         obj.hide_set(obj != next_object, view_layer=context.view_layer)
# 
#     bpy.ops.object.select_all(action="DESELECT")
#     next_object.hide_set(False, view_layer=context.view_layer)
#     next_object.select_set(True)
#     context.view_layer.objects.active = next_object
# 
#     return {
#         "message": f"Cycled versions for '{target_name}' to {next_label}.",
#         "display": next_label,
#     }
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'cycle_live_versions' -Label 'cycle versions <' -Direction 'backward'
exit $LASTEXITCODE


