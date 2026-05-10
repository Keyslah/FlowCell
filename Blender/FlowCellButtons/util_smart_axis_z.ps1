# Description: Cycle Smart Axis Z between none, minus, and plus pinning.

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'smart_axis_lock' -Label 'Z' -DataJson '{"command":"cycle_z"}'
exit $LASTEXITCODE
