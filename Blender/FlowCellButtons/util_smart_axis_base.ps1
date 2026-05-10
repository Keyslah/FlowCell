# Description: Store the current selected-object bounds as the Smart Axis baseline.

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'smart_axis_lock' -Label 'Base' -DataJson '{"command":"baseline"}'
exit $LASTEXITCODE
