# Description: Runs set active monitor layout profile.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$dialogScript = Join-Path $PSScriptRoot 'set_active_monitor_layout_profile_dialog.ps1'
if (-not (Test-Path -LiteralPath $dialogScript -PathType Leaf)) {
    throw "Monitor layout selection dialog script not found: $dialogScript"
}

& 'powershell.exe' @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Sta',
    '-File', $dialogScript
)
exit $LASTEXITCODE
