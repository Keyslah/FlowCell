# Description: Set each selected object's origin to its geometry center in Object Mode.


# Source Bridge Action: flowtest_custom_util_origin_to_geometry
# Source Python Filename: flowtest_custom_util_origin_to_geometry.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_origin_to_geometry.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 43

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_origin_to_geometry(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_origin_to_geometry' -Label 'util_origin_to_geometry'
exit $LASTEXITCODE
