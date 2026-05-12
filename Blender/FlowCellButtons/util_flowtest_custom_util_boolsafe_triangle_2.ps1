# Description: Add a Boolean-safe triangular prism using the original low poly objects defaults and cleanup steps.

# Source Bridge Action: flowtest_custom_util_boolsafe_triangle_2
# Source Python Filename: flowtest_custom_util_boolsafe_triangle_2.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_boolsafe_triangle_2.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 137

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_boolsafe_triangle(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_boolsafe_triangle_2' -Label 'util_boolsafe_triangle'
exit $LASTEXITCODE
