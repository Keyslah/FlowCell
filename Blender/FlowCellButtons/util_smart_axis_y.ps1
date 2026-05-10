# Description: Cycle Smart Axis Y between none, minus, and plus pinning.

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'smart_axis_lock' -Label 'Y' -DataJson '{"command":"cycle_y"}'
exit $LASTEXITCODE
