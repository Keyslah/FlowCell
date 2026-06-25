# Description: Setup Organization.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $current = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($current) -and (Test-Path -LiteralPath $current -PathType Container)) {
        if ((Test-Path -LiteralPath (Join-Path $current 'PROGRAM_SUMMARY.txt') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $current 'FlowCell') -PathType Container)) { return $current }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
        $current = $parent
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

$repo = Find-FlowCellRoot -StartPath $PSScriptRoot
$setupScript = Join-Path $repo 'Programs\Windows\Windows Git Scripts\Files\setup_organization.ps1'
if (-not (Test-Path -LiteralPath $setupScript -PathType Leaf)) {
    throw "Setup Organization script not found: $setupScript"
}

& $setupScript @args
exit $LASTEXITCODE
