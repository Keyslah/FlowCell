# Description: Setup Organization.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) { return $currentPath }
        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) { break }
        $currentPath = $parentPath
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

$repoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
$scriptPath = Join-Path $repoRoot 'Programs\Windows\Windows Git Scripts\Files\setup_organization.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Setup Organization script not found: $scriptPath" }
& $scriptPath
exit $LASTEXITCODE
