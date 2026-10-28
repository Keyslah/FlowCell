[CmdletBinding()]
param(
    [string]$BlenderExePath = '',
    [switch]$CheckOnly
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

function Write-SetupResult {
    param(
        [ValidateSet('ready', 'needsHostInitialization')][string]$Status,
        [string]$Message,
        [string]$RestartNotes = ''
    )
    if (-not $CheckOnly) { Write-Status -Text $Message }
    $result = @{ status = $Status; message = $Message; restartNotes = $RestartNotes }
    Write-Output ('FLOWCELL_PROGRAM_SETUP_RESULT=' + ($result | ConvertTo-Json -Compress))
}

function Get-RepoRoot {
    Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-BlenderVersionFromExecutablePath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
        foreach ($value in @($versionInfo.ProductVersion, $versionInfo.FileVersion)) {
            if ($value -match '(?<!\d)(\d+\.\d+)(?!\d)') { return $Matches[1] }
        }
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
        # Blender settings use major.minor even when its installation directory
        # includes a patch version. Do not create an uninitialized host profile.
        $version = [version]$detectedVersion
        $target = Join-Path $SettingsRoot ('{0}.{1}' -f $version.Major, $version.Minor)
        if (Test-Path -LiteralPath $target -PathType Container) { return $target }
        return ''
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
$logRoot = Join-Path $(if ($env:FLOWCELL_LOCAL_ROOT) { $env:FLOWCELL_LOCAL_ROOT } elseif (Test-Path -LiteralPath (Join-Path $repoRoot 'flowcellbackend')) { Join-Path $repoRoot 'flowcellbackend\local' } else { $repoRoot }) 'logs'
if (-not $CheckOnly) { New-Item -ItemType Directory -Path $logRoot -Force | Out-Null }
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
        Write-SetupResult -Status needsHostInitialization -Message 'Blender was added, but its settings folder does not exist yet. Open the selected Blender version once, close it, then choose Recheck setup in FlowCell.'
        exit 0
    }

    $versionFolderPath = Get-BlenderTargetVersionFolder -SettingsRoot $settingsRoot -ExecutablePath $BlenderExePath
    if ([string]::IsNullOrWhiteSpace($versionFolderPath)) {
        Write-SetupResult -Status needsHostInitialization -Message 'The selected Blender version has no identifiable initialized settings folder. Open that Blender version once, close it, then choose Recheck setup in FlowCell.'
        exit 0
    }

    if ($CheckOnly) {
        Write-SetupResult -Status ready -Message 'The selected Blender settings folder is available for FlowCell setup.'
        exit 0
    }

    $addonPath = Join-Path $versionFolderPath 'scripts\addons'
    Copy-AddonBundle -SourceRoot $sourceRoot -AddonPath $addonPath
    # Empty runtime directories are not carried by Git-tracked release ZIPs.
    # The bridge resolver requires this directory before the first Button install.
    New-Item -ItemType Directory -Path (Join-Path $addonPath 'blender_bridge_flowcell\ManagedActions') -Force | Out-Null
    $bootstrapPath = Write-StartupBootstrap -VersionFolderPath $versionFolderPath

    $message = @(
        'FlowCell Blender add-on files installed/repaired.',
        'Installed into:',
        $addonPath,
        'Startup bootstrap written:',
        $bootstrapPath,
        'Restart Blender once after adding Blender in FlowCell. The bridge will auto-enable and start its request timer.'
    ) -join "`r`n"
    Write-SetupResult -Status ready -Message $message -RestartNotes 'Restart Blender once to load the installed FlowCell add-on. Setup has not verified a live Blender connection.'
    exit 0
}
catch {
    $failure = "FlowCell Blender add-on install failed.`r`n" + $_.Exception.Message
    if ($CheckOnly) { Write-Output $failure } else { Write-Status -Text $failure }
    exit 1
}
