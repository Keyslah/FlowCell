[CmdletBinding()]
param(
    [string]$BlenderExePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-TextFile {
    param([string]$Path, [string]$Text)
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Status {
    param([string]$Text)
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $script:LogPath -Value "[$timestamp] $Text" -Encoding UTF8
    Write-TextFile -Path $script:LastActionStatusPath -Text ($Text.TrimEnd() + "`r`n")
    Write-Host $Text
}

function Get-RepoRoot {
    Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-BlenderVersionFromExecutablePath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }

    $directory = Split-Path -Parent $Path.Trim()
    while (-not [string]::IsNullOrWhiteSpace($directory)) {
        $name = Split-Path -Leaf $directory
        if ($name -match '(?i)(?:^|[^0-9])(?<version>\d+\.\d+(?:\.\d+)*)') {
            return $Matches.version
        }

        $parent = Split-Path -Parent $directory
        if ($parent -eq $directory) {
            break
        }
        $directory = $parent
    }

    return ''
}

function Get-BlenderTargetVersionFolder {
    param(
        [string]$SettingsRoot,
        [string]$ExecutablePath
    )

    $detectedVersion = Get-BlenderVersionFromExecutablePath -Path $ExecutablePath
    if (-not [string]::IsNullOrWhiteSpace($detectedVersion)) {
        return (Join-Path $SettingsRoot $detectedVersion)
    }

    $newestVersionFolder = Get-ChildItem -LiteralPath $SettingsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+(\.\d+)+$' } |
        Sort-Object @{ Expression = { try { [version]$_.Name } catch { [version]'0.0' } } }, Name -Descending |
        Select-Object -First 1
    if ($null -eq $newestVersionFolder) {
        return ''
    }

    return $newestVersionFolder.FullName
}

function Copy-DirectoryContents {
    param(
        [string]$SourceRoot,
        [string]$DestinationRoot
    )

    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    $isBridgeRuntimeRoot = (
        (Split-Path -Leaf $SourceRoot) -ieq 'blender_bridge_flowcell' -and
        (Split-Path -Leaf $DestinationRoot) -ieq 'blender_bridge_flowcell'
    )
    Get-ChildItem -LiteralPath $SourceRoot -Force | ForEach-Object {
        $destination = Join-Path $DestinationRoot $_.Name
        $isInstalledOwnerState = @('flowcell_custom_actions.json', 'ManagedActions') -contains $_.Name
        $preserveInstalledOwnerState = $isBridgeRuntimeRoot -and $isInstalledOwnerState -and (Test-Path -LiteralPath $destination)
        if ($preserveInstalledOwnerState) {
            # Registry entries and ManagedActions belong to installed Buttons.
            # Repairing the base add-on must not replace them with bundle templates.
        }
        elseif ($_.PSIsContainer) {
            Copy-DirectoryContents -SourceRoot $_.FullName -DestinationRoot $destination
        }
        else {
            Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
        }
    }
}

function Copy-AddonBundle {
    param(
        [string]$SourceRoot,
        [string]$AddonPath
    )

    Copy-DirectoryContents -SourceRoot $SourceRoot -DestinationRoot $AddonPath
}

function Write-StartupBootstrap {
    param([string]$VersionFolderPath)

    $startupRoot = Join-Path $VersionFolderPath 'scripts\startup'
    New-Item -ItemType Directory -Path $startupRoot -Force | Out-Null
    $bootstrapPath = Join-Path $startupRoot 'flowcell_startup_bootstrap.py'
    $bootstrap = @'
from __future__ import annotations

import importlib
import pathlib
import sys
import traceback

try:
    import addon_utils

    addons_path = pathlib.Path(__file__).resolve().parents[1] / "addons"
    addons_text = str(addons_path)
    if addons_text not in sys.path:
        sys.path.insert(0, addons_text)

    try:
        addon_utils.enable("flowcell_actions", default_set=True, persistent=True)
    except Exception:
        flowcell_actions = importlib.import_module("flowcell_actions")
        flowcell_actions = importlib.reload(flowcell_actions)
        register = getattr(flowcell_actions, "register", None)
        if callable(register):
            register()
except Exception:
    traceback.print_exc()
'@
    Write-TextFile -Path $bootstrapPath -Text $bootstrap
    return $bootstrapPath
}

$repoRoot = Get-RepoRoot
$logRoot = Join-Path $repoRoot 'flowcellbackend\local\logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$script:LogPath = Join-Path $logRoot 'blender-addon-install.log'
$script:LastActionStatusPath = Join-Path $logRoot 'last_action_status.txt'

try {
    $sourceRoot = Join-Path $repoRoot 'Programs\Blender\Blender Addons - Copy contents Into Blender'
    foreach ($required in @('flowcell_actions.py', 'flowcell_bridge.py', 'blender_bridge_flowcell')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $required))) {
            throw "Missing FlowCell Blender add-on source: $required"
        }
    }

    $settingsRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (-not (Test-Path -LiteralPath $settingsRoot -PathType Container)) {
        Write-Status -Text 'Blender was added, but no Blender settings folder exists yet. Open Blender once, close it, then restart FlowCell.'
        exit 0
    }

    $versionFolderPath = Get-BlenderTargetVersionFolder -SettingsRoot $settingsRoot -ExecutablePath $BlenderExePath
    if ([string]::IsNullOrWhiteSpace($versionFolderPath)) {
        Write-Status -Text 'Blender was added, but no Blender settings version folder could be determined. Open Blender once, close it, then restart FlowCell.'
        exit 0
    }

    $addonPath = Join-Path $versionFolderPath 'scripts\addons'
    Copy-AddonBundle -SourceRoot $sourceRoot -AddonPath $addonPath
    $bootstrapPath = Write-StartupBootstrap -VersionFolderPath $versionFolderPath

    $message = @(
        'FlowCell Blender add-on files installed/repaired.',
        'Installed into:',
        $addonPath,
        'Startup bootstrap written:',
        $bootstrapPath,
        'Restart Blender once after adding Blender in FlowCell. The bridge will auto-enable and start its request timer.'
    ) -join "`r`n"
    Write-Status -Text $message
    exit 0
}
catch {
    Write-Status -Text ("FlowCell Blender add-on install failed.`r`n" + $_.Exception.Message)
    exit 1
}
