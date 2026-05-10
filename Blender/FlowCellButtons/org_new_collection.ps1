# Description: Prompt for a name and create a new child collection near the selected object.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_new_collection
# Source Action Start Line: 2288

# Source Action Logic:

# def perform_new_collection(context: bpy.types.Context, requested_name: str) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     selected_objects = list(context.selected_objects)
#     parent_collection = scene_root
# 
#     if selected_objects:
#         selected_object = selected_objects[0]
#         for collection in selected_object.users_collection:
#             if collection.name not in ROOT_STRUCTURE:
#                 parent_collection = collection
#                 break
#         else:
#             for root_name in ("Live", "Snapshots", "Trash", "Archive"):
#                 system_root = root_collections[root_name]
#                 for collection in selected_object.users_collection:
#                     if collection == system_root:
#                         parent_collection = system_root
#                         break
# 
#     cleaned_name = requested_name.strip() if requested_name else ""
#     if not cleaned_name:
#         cleaned_name = "Collection"
# 
#     new_collection = bpy.data.collections.new(
#         unique_child_collection_name(parent_collection, cleaned_name)
#     )
#     parent_collection.children.link(new_collection)
#     new_collection.hide_viewport = False
#     return f"Created collection '{new_collection.name}'."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'new_collection' -Label 'new collection'
exit $LASTEXITCODE
