[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ButtonTarget,
    [ValidatePattern('^[A-Za-z0-9_-]{0,128}$')][string]$OwnerButtonId = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$layoutPath = Join-Path $PSScriptRoot 'FlowCellFusionBridgeLayout.ps1'
if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
    throw "Fusion bridge layout helper not found: $layoutPath"
}
. $layoutPath

function Move-FlowCellFusionFileToRecycleBin {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

try {
    $target = $ButtonTarget.Trim()
    if (-not $target.StartsWith('action:', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Fusion ButtonTarget must use the action:<bridgeAction> form.'
    }
    $action = $target.Substring(7).Trim()
    if ($action -notmatch '^[A-Za-z0-9_.-]{1,160}$') {
        throw 'Fusion ButtonTarget contains an invalid action id.'
    }

    $addonRoot = Resolve-FlowCellFusionAddonRoot -ExistingOnly
    if ([string]::IsNullOrWhiteSpace($addonRoot)) {
        [ordered]@{ removed = $true; action = $action; ownerButtonId = $OwnerButtonId; message = 'Fusion add-in is not installed; nothing remained to remove.' } | ConvertTo-Json -Compress
        exit 0
    }
    $registryPath = Join-Path $addonRoot 'flowcell_fusion_actions.json'
    $registry = Read-FlowCellFusionRegistry -Path $registryPath
    $matches = @($registry.actions | Where-Object {
        [string]$_.action -eq $action -and (
            [string]::IsNullOrWhiteSpace($OwnerButtonId) -or [string]$_.ownerButtonId -eq $OwnerButtonId
        )
    })
    if ($matches.Count -eq 0) {
        [ordered]@{ removed = $true; action = $action; ownerButtonId = $OwnerButtonId; message = 'Fusion action was already absent.' } | ConvertTo-Json -Compress
        exit 0
    }
    if ($matches.Count -ne 1) {
        throw 'Fusion action ownership is ambiguous; no files were removed.'
    }

    $entry = $matches[0]
    $relativeSource = ([string]$entry.source).Replace('/', '\')
    if ([string]::IsNullOrWhiteSpace($relativeSource) -or [System.IO.Path]::IsPathRooted($relativeSource)) {
        throw 'The installed Fusion action source is not a managed relative path.'
    }
    $managedRoot = Join-Path $addonRoot 'ManagedActions'
    $managedPath = [System.IO.Path]::GetFullPath((Join-Path $addonRoot $relativeSource))
    if (-not (Test-FlowCellPathUnderRoot -Path $managedPath -Root $managedRoot) -or (Split-Path -Parent $managedPath) -ine [System.IO.Path]::GetFullPath($managedRoot)) {
        throw 'The installed Fusion action source escapes ManagedActions.'
    }

    $registry.actions = @($registry.actions | Where-Object { $_ -ne $entry })
    Move-FlowCellFusionFileToRecycleBin -Path $managedPath
    Write-FlowCellFusionJsonFile -Path $registryPath -Value $registry

    [ordered]@{
        removed = $true
        action = $action
        ownerButtonId = [string]$entry.ownerButtonId
        recycledPath = $managedPath
        message = 'Fusion action registry entry removed and its managed source moved to the Recycle Bin.'
    } | ConvertTo-Json -Depth 8 -Compress
    exit 0
}
catch {
    [ordered]@{
        removed = $false
        action = $ButtonTarget
        ownerButtonId = $OwnerButtonId
        message = $_.Exception.Message
    } | ConvertTo-Json -Depth 8 -Compress
    exit 1
}
