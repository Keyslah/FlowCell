# Description: Runs save monitor layout profile.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$dialogScript = Join-Path $PSScriptRoot 'save_monitor_layout_profile_dialog.ps1'
if (-not (Test-Path -LiteralPath $dialogScript -PathType Leaf)) {
    throw "Monitor layout save dialog script not found: $dialogScript"
}

& 'powershell.exe' @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Sta',
    '-File', $dialogScript
)
exit $LASTEXITCODE
