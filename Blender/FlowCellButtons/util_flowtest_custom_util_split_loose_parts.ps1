# Description: Split joined or physically separated parts into disconnected objects and set each new origin to geometry.

# Source Bridge Action: flowtest_custom_util_split_loose_parts
# Source Python Filename: flowtest_custom_util_split_loose_parts.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_split_loose_parts.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 159

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     return perform_split_loose_parts(context=context, data=data)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_split_loose_parts' -Label 'util_split_loose_parts'
exit $LASTEXITCODE
