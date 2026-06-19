[CmdletBinding()]
param()

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

function Get-BlenderVersionFolders {
    $settingsRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (-not (Test-Path -LiteralPath $settingsRoot -PathType Container)) {
        return @()
    }

    return @(Get-ChildItem -LiteralPath $settingsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+(\.\d+)+$' } |
        Sort-Object @{ Expression = { try { [version]$_.Name } catch { [version]'0.0' } } }, Name -Descending)
}

function Copy-AddonBundle {
    param(
        [string]$SourceRoot,
        [string]$AddonPath
    )

    New-Item -ItemType Directory -Path $AddonPath -Force | Out-Null
    Get-ChildItem -LiteralPath $SourceRoot -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $AddonPath $_.Name) -Recurse -Force
    }
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
$logRoot = Join-Path $repoRoot 'FlowCell\local\logs'
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

    $versionFolders = @(Get-BlenderVersionFolders)
    if ($versionFolders.Count -eq 0) {
        throw 'No Blender user settings folders were found. Open Blender once, close it, then start FlowCell again.'
    }

    $installedPaths = New-Object System.Collections.Generic.List[string]
    $bootstrapPaths = New-Object System.Collections.Generic.List[string]
    foreach ($versionFolder in $versionFolders) {
        $addonPath = Join-Path $versionFolder.FullName 'scripts\addons'
        Copy-AddonBundle -SourceRoot $sourceRoot -AddonPath $addonPath
        [void]$installedPaths.Add($addonPath)
        [void]$bootstrapPaths.Add((Write-StartupBootstrap -VersionFolderPath $versionFolder.FullName))
    }

    $message = @(
        'FlowCell Blender add-on files installed/repaired.',
        'Installed into:',
        ($installedPaths.ToArray() -join "`r`n"),
        'Startup bootstrap written:',
        ($bootstrapPaths.ToArray() -join "`r`n"),
        'Close and reopen Blender once. The FlowCell bridge should auto-enable and buttons should respond after Blender restarts.'
    ) -join "`r`n"
    Write-Status -Text $message
    exit 0
}
catch {
    Write-Status -Text ("FlowCell Blender add-on install failed.`r`n" + $_.Exception.Message)
    exit 1
}
