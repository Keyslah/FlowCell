# Description: Add a Boolean-safe cylinder using the original low poly objects defaults and cleanup steps.

# Source Bridge Action: flowtest_custom_util_boolsafe_cylinder
# Source Python Filename: flowtest_custom_util_boolsafe_cylinder.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_boolsafe_cylinder.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 146

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_boolsafe_cylinder(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_boolsafe_cylinder' -Label 'util_boolsafe_cylinder'
exit $LASTEXITCODE
