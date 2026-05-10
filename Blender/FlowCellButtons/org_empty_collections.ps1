# Description: Delete empty collections while keeping the system roots.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_empty_collections
# Source Action Start Line: 2320

# Source Action Logic:

# def perform_empty_collections(context: bpy.types.Context) -> str:
#     scene_root = context.scene.collection
#     before = len(bpy.data.collections)
#     prune_empty_collections(scene_root, skip_names=set(ROOT_STRUCTURE))
#     after = len(bpy.data.collections)
#     removed = max(before - after, 0)
#     return f"Removed {removed} empty collection(s)."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'empty_collections' -Label 'empty collections'
exit $LASTEXITCODE
