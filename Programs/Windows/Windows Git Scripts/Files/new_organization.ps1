# Description: New Organization.
param(
    [string]$ProfileId = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }
        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) { break }
        $currentPath = $parentPath
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

try {
    $repoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
    $corePath = Join-Path $repoRoot 'Programs\Windows\SupportScripts\Organization-ProfileCore.ps1'
    if (-not (Test-Path -LiteralPath $corePath -PathType Leaf)) {
        throw "Organization profile core script not found: $corePath"
    }
    . $corePath

    $profile = Read-OrganizationProfile -ProfileId $ProfileId
    $result = Invoke-OrganizationProfile -Profile $profile

    $status = @(
        ('Profile: {0}' -f $result.ProfileId),
        ('Root: {0}' -f $result.RootPath),
        ('Files moved: {0}' -f $result.FilesMoved),
        ('Kept: {0}' -f $result.Kept),
        ('Skipped already organized: {0}' -f $result.SkippedAlreadyOrganized),
        ('Unmapped: {0}' -f $result.Unmapped),
        ('Ambiguous: {0}' -f $result.Ambiguous),
        ('Conflicts: {0}' -f $result.Conflicts),
        ('Log: {0}' -f $result.LogPath),
        ('Undo manifest: {0}' -f $result.UndoPath)
    ) -join [Environment]::NewLine

    Write-FlowCellStatus $status
    $status
    exit 0
}
catch {
    $message = $_.Exception.Message
    if (Get-Command Write-FlowCellStatus -ErrorAction SilentlyContinue) {
        Write-FlowCellStatus $message
    }
    else {
        try {
            $repoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
            $statusPath = Join-Path $repoRoot 'flowcellbackend\local\logs\last_action_status.txt'
            New-Item -ItemType Directory -Path (Split-Path -Parent $statusPath) -Force | Out-Null
            Set-Content -LiteralPath $statusPath -Value $message -Encoding UTF8
        }
        catch { }
    }
    Write-Error $message
    exit 1
}
