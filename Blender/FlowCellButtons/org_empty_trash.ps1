# Description: Delete everything inside Trash.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_empty_trash
# Source Action Start Line: 2254

# Source Action Logic:

# def perform_empty_trash(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     root_collections = ensure_root_structure(scene_root)
#     trash_collection = root_collections["Trash"]
#     object_count, child_count = clear_collection_recursive(trash_collection)
#     prune_empty_collections(trash_collection)
#     return f"Emptied Trash: removed {object_count} object(s) and {child_count} collection(s)."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'empty_trash' -Label 'empty trash'
exit $LASTEXITCODE


