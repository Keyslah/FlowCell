# Finish the requested deployment only after real-Krita tests succeed.
param([switch]$ResumeRelease)
$ErrorActionPreference = 'Stop'
$programRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $programRoot)
$pluginTarget = Join-Path $env:APPDATA 'krita\pykrita\flowcell_layers'
$bridge = Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1'
$logRoot = Join-Path $repoRoot 'flowcellbackend\local\logs'
if (-not $ResumeRelease) {
foreach ($file in @('engine.py','plugin.py','selftest.py')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('flowcell_layers\' + $file)) -Destination (Join-Path $pluginTarget $file) -Force
}
$testJson = & $bridge -Action self_test | Out-String
[IO.File]::WriteAllText((Join-Path $logRoot 'krita-layers-tests.json'), $testJson)
$report = $testJson | ConvertFrom-Json
Write-Output "Krita integration tests: $($report.passed)/$($report.total) passed."
if ($report.passed -ne $report.total) {
    $report.tests | Where-Object { -not $_.ok } | ConvertTo-Json -Depth 6 | Write-Output
    throw 'Integration tests failed; release deployment stopped.'
}
$status = (& $bridge -Action status | Out-String) | ConvertFrom-Json
if (@($status.documents).Count -ne 0) { throw 'Krita has open documents; leave them intact before the final plugin reload.' }
$ready = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'FlowCell\KritaLayers\ready.json') -Raw | ConvertFrom-Json
$testProcess = Get-Process -Id $ready.pid
$testProcess.CloseMainWindow() | Out-Null
if (-not $testProcess.WaitForExit(10000)) { throw 'Krita did not close normally.' }
& (Join-Path $PSScriptRoot 'Install-KritaLayers.ps1')
$env:FLOWCELL_KRITA_TEST = '0'
Start-Process -FilePath 'C:\Program Files\Krita (x64)\bin\krita.exe' -WindowStyle Hidden | Out-Null
Write-Output 'Reloaded the installed Krita plugin without test mode.'
} else {
    $report = Get-Content -LiteralPath (Join-Path $logRoot 'krita-layers-tests.json') -Raw | ConvertFrom-Json
    if ($report.passed -ne $report.total -or $report.total -lt 15) { throw 'A successful integration report is required.' }
}
# The launcher otherwise reuses the compiled executable when only program-owned
# runtime packages changed. Retain the prior stamp to request a real release build.
$stamp = Join-Path $repoRoot 'FlowCellFrontend\src-tauri\target\release\.flowcell_frontend_source_stamp'
$backupRoot = Join-Path $repoRoot 'flowcellbackend\local\backups\krita-layers'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if (Test-Path -LiteralPath $stamp) {
    $stampBackup = Join-Path $backupRoot ('frontend-source-stamp-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Move-Item -LiteralPath $stamp -Destination $stampBackup
}
[IO.File]::WriteAllText($stamp, 'krita-layers-release-rebuild-required')
Write-Output 'Starting the required FlowCell release build and restart.'
& (Join-Path $repoRoot 'flowcellbackend\helpers\Start-FlowCellFrontend.ps1') -ForceRestart
Write-Output 'FlowCell release build/restart completed.'
