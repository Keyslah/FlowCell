#requires -version 5.1
$ErrorActionPreference = 'Stop'
$invokeScript = Join-Path $PSScriptRoot '..\..\SupportScripts\Invoke-IllustratorFlowCellAction.ps1'
& $invokeScript -ActionId 'illustrator-rotate'
exit $LASTEXITCODE
