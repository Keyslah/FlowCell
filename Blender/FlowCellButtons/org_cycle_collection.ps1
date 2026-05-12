# Description: Use the selected object's collection and show one direct object at a time while selecting it.

# Source Bridge Action: cycle_collection
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_cycle_collection
# Source Action Start Line: 2329

# Source Action Logic:

# def perform_cycle_collection(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     parent_map = build_collection_parent_map(scene_root)
#     target_collection = get_cycle_collection(context, parent_map)
# 
#     if target_collection is None:
#         return "Select an object in a collection to cycle."
# 
#     collection_objects = list(target_collection.objects)
#     if not collection_objects:
#         return f"Collection '{target_collection.name}' has no direct objects."
# 
#     current_index = int(target_collection.get(CYCLE_INDEX_PROP, -1))
#     next_index = (current_index + 1) % len(collection_objects)
#     next_object = collection_objects[next_index]
# 
#     for obj in collection_objects:
#         obj.hide_viewport = False
#         obj.hide_set(obj != next_object, view_layer=context.view_layer)
# 
#     bpy.ops.object.select_all(action="DESELECT")
#     next_object.hide_set(False, view_layer=context.view_layer)
#     next_object.select_set(True)
#     context.view_layer.objects.active = next_object
#     target_collection[CYCLE_INDEX_PROP] = next_index
# 
#     return f"Cycled '{target_collection.name}' to '{next_object.name}'."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'cycle_collection' -Label 'cycle collection'
exit $LASTEXITCODE
