# Description: Force-stops, rebuilds, and relaunches the FlowCell Tauri frontend.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcherPath = Join-Path $PSScriptRoot 'Start-FlowCellFrontend.ps1'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "FlowCell frontend launcher not found: $launcherPath"
}

& $launcherPath -ForceRestart -ForceRebuild
