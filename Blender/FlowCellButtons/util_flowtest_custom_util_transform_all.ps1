# Description: Apply location, rotation, and scale to all selected objects in Object Mode.


# Source Bridge Action: flowtest_custom_util_transform_all
# Source Python Filename: flowtest_custom_util_transform_all.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_transform_all.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 43

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_transform_all(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_transform_all' -Label 'util_transform_all'
exit $LASTEXITCODE
