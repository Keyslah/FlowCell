<#
Purpose: Keep the removed shortcut synchronizer out of Windows catalogs and release payloads.
Writes: Nothing. This check does not build, install, or create an archive.
#>
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$releaseRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $releaseRoot
function Stop-Package([string]$Message) { throw $Message }
. (Join-Path $releaseRoot 'program-package-safety.ps1')
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
}
$programRoot = Join-Path $repositoryRoot 'Programs/Windows'
$manifest = Get-Content -LiteralPath (Join-Path $programRoot 'flowcell.program.json') -Raw | ConvertFrom-Json
Assert (@($manifest.bundledSources | Where-Object {
    $_.id -eq 'windows.sync-recent-creative-shortcuts' -or
    $_.sourcePath -match 'sync_recent_creative_shortcuts\.ps1$'
}).Count -eq 0) 'The removed script is absent from the Windows catalog.'
Assert (-not (Test-Path -LiteralPath (Join-Path $programRoot 'Windows Git Scripts/Utility/sync_recent_creative_shortcuts.ps1'))) 'The removed script has no distributable source.'
Assert (@($manifest.bundledSources | Where-Object { $_.id -in @('windows.open-chrome-workspace', 'windows.save-chrome-workspace') }).Count -eq 0) 'The removed Chrome Workspace Buttons are absent from the manifest.'
foreach ($folder in @('Open Chrome Workspace', 'Save Chrome Workspace')) {
    Assert (-not (Test-Path -LiteralPath (Join-Path $programRoot "Windows Git Scripts/Utility/$folder"))) "The removed Chrome Workspace package is absent: $folder"
}

$manifestEntry = 'Programs/Windows/flowcell.program.json'
Assert-ProgramPackageEntries @($manifestEntry, 'Programs/Windows/Windows Git Scripts/Utility/Temp Shots/Temp_Shots.vbs') 'Windows' @() 'Test payload'
$script:checks++
foreach ($entry in @(
    'Programs/Windows/Windows Git Scripts/Utility/sync_recent_creative_shortcuts.ps1',
    'Programs\Windows\ScriptDump\SYNC_RECENT_CREATIVE_SHORTCUTS.PS1'
)) {
    $message = ''
    try { Assert-ProgramPackageEntries @($manifestEntry, $entry) 'Windows' @() 'Test payload' }
    catch { $message = $_.Exception.Message }
    Assert ($message -like '*removed Sync Recent Creative Shortcuts script*') "The retired script is rejected at every package path: $entry"
}
foreach ($entry in @(
    'Programs/Windows/Windows Git Scripts/Utility/Open Chrome Workspace/flowcell.script.json',
    'Programs\Windows\ScriptDump\SAVE_CHROME_WORKSPACE.PS1',
    'Programs/Windows/other/ChromeWorkspaceHelpers.ps1'
)) {
    $message = ''
    try { Assert-ProgramPackageEntries @($manifestEntry, $entry) 'Windows' @() 'Test payload' }
    catch { $message = $_.Exception.Message }
    Assert ($message -like '*removed Chrome Workspace script*') "The retired Chrome Workspace source is rejected: $entry"
}
Write-Output "Removed Windows script checks: $script:checks passed. No build, installation, or ZIP created."
