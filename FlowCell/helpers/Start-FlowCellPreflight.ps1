[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$FlowCellRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProgramsRoot = Join-Path $FlowCellRoot 'Programs'
$LogRoot = Join-Path $FlowCellRoot 'FlowCell\local\logs'
$LogPath = Join-Path $LogRoot 'startup-preflight.log'
$script:RepairedLegacyBlenderWrapper = $false

function Write-PreflightLog {
    param([string]$Message)
    try {
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message" -Encoding UTF8
    } catch {
    }
}

function Merge-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $Source -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $target = Join-Path $Destination $_.Name
        if (-not (Test-Path -LiteralPath $target)) {
            Move-Item -LiteralPath $_.FullName -Destination $target
            Write-PreflightLog "Moved legacy payload item to $target"
        } elseif ($_.PSIsContainer -and (Test-Path -LiteralPath $target -PathType Container)) {
            Merge-DirectoryContents -Source $_.FullName -Destination $target
        } else {
            Write-PreflightLog "Preserved existing target and left conflicting legacy item at $($_.FullName)"
        }
    }
}

function Repair-ProgramPackageWrappers {
    $legacyBlenderPayload = Join-Path $ProgramsRoot 'FlowCell-Blender\Programs\Blender'
    if (-not (Test-Path -LiteralPath $legacyBlenderPayload -PathType Container)) {
        return
    }

    $target = Join-Path $ProgramsRoot 'Blender'
    if (-not (Test-Path -LiteralPath $target)) {
        Move-Item -LiteralPath $legacyBlenderPayload -Destination $target
        Write-PreflightLog "Moved legacy Blender payload to $target"
    } else {
        Merge-DirectoryContents -Source $legacyBlenderPayload -Destination $target
        Write-PreflightLog "Merged non-conflicting legacy Blender payload items into $target"
    }

    $script:RepairedLegacyBlenderWrapper = $true
}

function Move-EmptyDirectoryToRecycleBin {
    param([string]$Path)

    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

function Remove-EmptyAutoCreatedPanels {
    if (-not $script:RepairedLegacyBlenderWrapper) {
        return
    }

    $panelsRoot = Join-Path $ProgramsRoot 'Blender\Panels'
    if (-not (Test-Path -LiteralPath $panelsRoot -PathType Container)) {
        return
    }

    foreach ($panelName in @('Collections', 'Files', 'Utility', 'Layers')) {
        $panelPath = Join-Path $panelsRoot $panelName
        if (-not (Test-Path -LiteralPath $panelPath -PathType Container)) {
            continue
        }

        $children = @(Get-ChildItem -LiteralPath $panelPath -Force -ErrorAction SilentlyContinue)
        if ($children.Count -eq 0) {
            Move-EmptyDirectoryToRecycleBin -Path $panelPath
            Write-PreflightLog "Moved empty legacy auto-created panel to the Recycle Bin: $panelPath"
        }
    }
}

try {
    Repair-ProgramPackageWrappers
} catch {
    Write-PreflightLog "Program wrapper repair failed: $($_.Exception.Message)"
}

if ($script:RepairedLegacyBlenderWrapper) {
    try {
        Remove-EmptyAutoCreatedPanels
    } catch {
        Write-PreflightLog "Legacy auto panel cleanup failed: $($_.Exception.Message)"
    }
}
