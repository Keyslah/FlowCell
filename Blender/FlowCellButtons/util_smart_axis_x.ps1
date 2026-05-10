# Description: Cycle Smart Axis X between none, minus, and plus pinning.

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'smart_axis_lock' -Label 'X' -DataJson '{"command":"cycle_x"}'
exit $LASTEXITCODE
