# Description: Create Live, Snapshots, Trash, and Archive if missing.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_make_layers
# Source Action Start Line: 2052

# Source Action Logic:

# def perform_make_layers(context: bpy.types.Context) -> str:
#     ensure_root_structure(context.scene.collection)
#     return "Ensured Live, Snapshots, Trash, and Archive."
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'make_layers' -Label 'make layers'
exit $LASTEXITCODE


