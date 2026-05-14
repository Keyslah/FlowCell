# Description: Low poly cone.

# Source Bridge Action: flowtest_custom_util_boolsafe_cone
# Source Python Filename: flowtest_custom_util_boolsafe_cone.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_boolsafe_cone.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 147

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_boolsafe_cone(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_boolsafe_cone' -Label 'Cone'
exit $LASTEXITCODE
