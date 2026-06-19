[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$FlowCellRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProgramsRoot = Join-Path $FlowCellRoot 'Programs'
$LogRoot = Join-Path $FlowCellRoot 'FlowCell\local\logs'
$LogPath = Join-Path $LogRoot 'startup-preflight.log'

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

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $target = Join-Path $Destination $_.Name
        if ($_.PSIsContainer) {
            Merge-DirectoryContents -Source $_.FullName -Destination $target
        } else {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
    }
}

function Repair-ProgramPackageWrappers {
    if (-not (Test-Path -LiteralPath $ProgramsRoot -PathType Container)) {
        return
    }

    Get-ChildItem -LiteralPath $ProgramsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'FlowCell-*' } |
        ForEach-Object {
            $wrapper = $_
            $innerPrograms = Join-Path $wrapper.FullName 'Programs'
            if (-not (Test-Path -LiteralPath $innerPrograms -PathType Container)) {
                return
            }

            Get-ChildItem -LiteralPath $innerPrograms -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $target = Join-Path $ProgramsRoot $_.Name
                if (-not (Test-Path -LiteralPath $target)) {
                    Move-Item -LiteralPath $_.FullName -Destination $target -Force
                    Write-PreflightLog "Moved nested program payload to $target"
                } else {
                    Merge-DirectoryContents -Source $_.FullName -Destination $target
                    Write-PreflightLog "Merged nested program payload into $target"
                }
            }
        }
}

function Remove-EmptyAutoCreatedPanels {
    if (-not (Test-Path -LiteralPath $ProgramsRoot -PathType Container)) {
        return
    }

    $autoPanelNames = @('Collections', 'Files', 'Utility', 'Layers')
    Get-ChildItem -LiteralPath $ProgramsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike 'FlowCell-*' } |
        ForEach-Object {
            $panelsRoot = Join-Path $_.FullName 'Panels'
            if (-not (Test-Path -LiteralPath $panelsRoot -PathType Container)) {
                return
            }

            foreach ($panelName in $autoPanelNames) {
                $panelPath = Join-Path $panelsRoot $panelName
                if (-not (Test-Path -LiteralPath $panelPath -PathType Container)) {
                    continue
                }

                $children = @(Get-ChildItem -LiteralPath $panelPath -Force -ErrorAction SilentlyContinue)
                if ($children.Count -eq 0) {
                    Remove-Item -LiteralPath $panelPath -Force
                    Write-PreflightLog "Removed empty auto-created panel $panelPath"
                }
            }
        }
}

function Repair-BlenderAddon {
    $installer = Join-Path $ProgramsRoot 'Blender\SupportScripts\Install-FlowCellBlenderAddon.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        return
    }

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) {
        $powershell = 'powershell.exe'
    }

    $process = Start-Process -FilePath $powershell -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $installer
    ) -WindowStyle Hidden -Wait -PassThru
    Write-PreflightLog "Blender add-on installer exit code: $($process.ExitCode)"
}

try {
    Repair-ProgramPackageWrappers
} catch {
    Write-PreflightLog "Program wrapper repair failed: $($_.Exception.Message)"
}

try {
    Remove-EmptyAutoCreatedPanels
} catch {
    Write-PreflightLog "Auto panel cleanup failed: $($_.Exception.Message)"
}

try {
    Repair-BlenderAddon
} catch {
    Write-PreflightLog "Blender add-on repair failed: $($_.Exception.Message)"
}
