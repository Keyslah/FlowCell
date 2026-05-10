# Description: Toggle Smart Axis live pinning.

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'smart_axis_lock' -Label 'Live' -DataJson '{"command":"toggle_live"}'
exit $LASTEXITCODE
