# Description: Dynamic Organization.
param(
    [ValidateSet('InitProfile','Scan','ResolveRole','OrganizeLooseFiles')]
    [string]$Mode = 'OrganizeLooseFiles',
    [string]$ProjectPath = '',
    [string]$ProfilePath = '',
    [string]$RoleId = '',
    [string]$FileName = '',
    [string[]]$RequestedRoles = @(),
    [ValidateSet('RootOnly','Recursive')]
    [string]$LooseFileSearchMode = 'RootOnly',
    [switch]$CreateMissing,
    [switch]$PassThruJson
)

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
        $statusPath = Join-Path $repo 'flowcellbackend\local\logs\last_action_status.txt'
        New-Item -ItemType Directory -Path (Split-Path -Parent $statusPath) -Force | Out-Null
        Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
    } catch { }
}

try {
    $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
    $core = Join-Path $repo 'Programs\Windows\SupportScripts\Dynamic-OrganizationCore.ps1'
    if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { throw "Dynamic organization core script not found: $core" }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Get-ClipboardProjectPath }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { throw 'Copy a project folder or project file path first, then run Dynamic Organization.' }

    $invoke = @{
        Mode = $Mode
        ProjectPath = $ProjectPath
        LooseFileSearchMode = $LooseFileSearchMode
        PassThruJson = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($ProfilePath)) { $invoke.ProfilePath = $ProfilePath }
    if (-not [string]::IsNullOrWhiteSpace($RoleId)) { $invoke.RoleId = $RoleId }
    if (-not [string]::IsNullOrWhiteSpace($FileName)) { $invoke.FileName = $FileName }
    if ($RequestedRoles.Count -gt 0) { $invoke.RequestedRoles = $RequestedRoles }
    if ($CreateMissing) { $invoke.CreateMissing = $true }

    $json = & $core @invoke
    $result = $json | ConvertFrom-Json
    $status = @(
        "Dynamic Organization: $($result.mode)",
        "Project: $($result.projectRoot)",
        "Profile: $($result.profilePath)"
    )
    if ($result.PSObject.Properties.Name.Contains('moves')) { $status += "Moved: $(@($result.moves).Count)" }
    if ($result.PSObject.Properties.Name.Contains('ambiguous')) { $status += "Ambiguous: $(@($result.ambiguous).Count)" }
    if ($result.PSObject.Properties.Name.Contains('unresolved')) { $status += "Unresolved: $(@($result.unresolved).Count)" }
    $message = $status -join [Environment]::NewLine
    Write-FlowCellStatus $message
    $message
    if ($PassThruJson) { $json }
    exit 0
}
catch {
    Write-FlowCellStatus $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
