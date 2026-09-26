# Description: Relays Snapshots to the shared Temp Shots folder setup and resident backend.
[CmdletBinding()]
param([switch]$ValidateOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = if ($env:FLOWCELL_RESOURCE_ROOT -and
    (Test-Path -LiteralPath (Join-Path $env:FLOWCELL_RESOURCE_ROOT 'flowcellbackend/FlowCellBackend.ahk'))) {
    $env:FLOWCELL_RESOURCE_ROOT
} else {
    $current = [IO.Path]::GetFullPath($PSScriptRoot)
    while ($current -and -not (Test-Path -LiteralPath (Join-Path $current 'PROGRAM_SUMMARY.txt') -PathType Leaf)) {
        $parent = Split-Path -Parent $current
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
    $current
}
$engine = Join-Path $repoRoot 'Programs/Windows/Windows Git Scripts/Utility/Temp Shots/Temp Shots.ps1'
if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) {
    throw 'The shared Temp Shots capture engine is missing.'
}
& $engine -ValidateOnly:$ValidateOnly -Mode snapshots -LauncherPath (Join-Path $PSScriptRoot 'Snapshots.vbs')
exit $LASTEXITCODE
