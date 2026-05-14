# Description: Low poly sphere.

# Source Bridge Action: flowtest_custom_util_boolsafe_sphere
# Source Python Filename: flowtest_custom_util_boolsafe_sphere.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_boolsafe_sphere.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 148

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_boolsafe_sphere(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_boolsafe_sphere' -Label 'Sphere'
exit $LASTEXITCODE
