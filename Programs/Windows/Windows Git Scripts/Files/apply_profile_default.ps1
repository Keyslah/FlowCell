# Description: Apply "default" profile to the clipboard folder.
param([string]$ProjectPath = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProfileName = 'default'

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

function Get-ClipboardProjectPath {
    try { $text = Get-Clipboard -Raw -ErrorAction Stop } catch { return '' }
    $candidate = ([string]$text).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
    if (Test-Path -LiteralPath $candidate -PathType Container) { return (Get-Item -LiteralPath $candidate).FullName }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Split-Path -Parent (Get-Item -LiteralPath $candidate).FullName) }
    return ''
}

function Write-FlowCellStatus([string]$Message) {
    try {
        $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
        $statusPath = Join-Path $repo 'FlowCell\local\logs\last_action_status.txt'
        New-Item -ItemType Directory -Path (Split-Path -Parent $statusPath) -Force | Out-Null
        Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
    } catch { }
}

try {
    $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
    $core = Join-Path $repo 'Programs\Windows\SupportScripts\Apply-OrganizationProfileCore.ps1'
    if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { throw "Apply profile core not found: $core" }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Get-ClipboardProjectPath }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { throw 'Copy a destination folder path to the clipboard first, then run this.' }

    $json = & $core -ProfileName $ProfileName -ProjectPath $ProjectPath -PassThruJson
    $result = $json | ConvertFrom-Json
    $message = @(
        "Applied profile: $ProfileName",
        "Target: $($result.projectRoot)",
        "Folders ensured: $($result.foldersCreated)",
        "Program folders created: $(@($result.programFoldersCreated).Count)",
        "Program folders reused: $(@($result.programFoldersUsed).Count)",
        "Files moved: $($result.filesMoved)",
        "Snapshots created: $($result.snapshotsCreated)",
        "Conflicts: $(@($result.conflicts).Count)"
    ) -join [Environment]::NewLine
    Write-FlowCellStatus $message
    $message
    exit 0
}
catch {
    Write-FlowCellStatus $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
