#requires -version 5.1
$ErrorActionPreference = 'Stop'
$invokeScript = Join-Path $PSScriptRoot '..\..\SupportScripts\Invoke-IllustratorFlowCellAction.ps1'
& $invokeScript -ActionId 'ill-align'
exit $LASTEXITCODE
