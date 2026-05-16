# Description: Copy the selected Live objects into Snapshots as versioned s# duplicates.

# Source Bridge Action: flowtest_custom_snapshot_6
# Source Python Filename: flowtest_custom_snapshot_6.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_snapshot_6.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 75

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     del context
#     bridge = _load_flowtest_bridge()
#     payload = _merge_payload(DEFAULT_DATA, data)
#     return bridge.execute_bridge_operator(ACTION_NAME, payload)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_snapshot_6' -Label 'snapshot'
exit $LASTEXITCODE
