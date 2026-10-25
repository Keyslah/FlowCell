<#
Purpose: Register the installed background backend at Windows sign-in independently of the UI.
Context: Per-user installer hooks. The installed launcher supplies explicit role and paths.
Inputs: ResourceRoot; LocalRoot for first registration; fixture startup, desktop and registry paths.
Changes: Startup/optional desktop shortcuts, installed registry pointer, first-use config and preserved legacy migration.
Constraints: No user settings are removed; a different installation's shortcut is preserved.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ResourceRoot,
    [ValidateSet('Register','Remove')][string]$Action = 'Register',
    [string]$StartupDirectory = [Environment]::GetFolderPath('Startup'),
    [string]$DesktopDirectory = [Environment]::GetFolderPath('Desktop'),
    [ValidateSet('Install','Skip')][string]$DesktopToggle = 'Install',
    [string]$RegistryPath = 'HKCU:\Software\FlowCell',
    [string]$LocalRoot,
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($ResourceRoot)
$launcher = Join-Path $root 'flowcellbackend\run_backend_hidden.vbs'
$startupPath = Join-Path $StartupDirectory 'FlowCell Background.lnk'
$toggleDirectory = Join-Path $root 'tools\autohotkey v2 on off'
$toggleLauncher = Join-Path $toggleDirectory 'Toggle-AutoHotkey.vbs'
$toggleShortcutPath = Join-Path $DesktopDirectory 'Toggle AutoHotkey.lnk'
$scriptHost = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell
if ($Action -eq 'Remove') {
    if (Test-Path -LiteralPath $startupPath -PathType Leaf) {
        $existing = $shell.CreateShortcut($startupPath)
        if ($existing.TargetPath -eq $launcher) {
            Add-Type -AssemblyName Microsoft.VisualBasic
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($startupPath, 'OnlyErrorDialogs', 'SendToRecycleBin')
        }
    }
    if (Test-Path -LiteralPath $toggleShortcutPath -PathType Leaf) {
        $existing = $shell.CreateShortcut($toggleShortcutPath)
        if ($existing.TargetPath -eq $scriptHost -and $existing.Arguments -eq ('"' + $toggleLauncher + '"')) {
            Add-Type -AssemblyName Microsoft.VisualBasic
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($toggleShortcutPath, 'OnlyErrorDialogs', 'SendToRecycleBin')
        }
    }
    $registeredSettings = Get-ItemProperty -LiteralPath $RegistryPath -ErrorAction SilentlyContinue
    $registeredRoot = if ($registeredSettings -and $registeredSettings.PSObject.Properties['InstalledResourceRoot']) { $registeredSettings.InstalledResourceRoot } else { $null }
    if ($registeredRoot -eq $root) { Remove-ItemProperty -LiteralPath $RegistryPath -Name InstalledResourceRoot }
    return
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'flowcell-installed.json') -PathType Leaf)) { throw 'Startup registration requires an installed FlowCell resource root.' }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Installed backend launcher missing: $launcher" }
foreach ($name in @('Toggle-AutoHotkey.vbs','Toggle-AutoHotkey.ps1','Toggle-AutoHotkey-On.ico','Toggle-AutoHotkey-Off.ico')) {
    if (-not (Test-Path -LiteralPath (Join-Path $toggleDirectory $name) -PathType Leaf)) { throw "Installed AutoHotkey toggle resource missing: $name" }
}
$runtimeConfig = Join-Path $root 'flowcell.runtime.json'
. (Join-Path $root 'flowcellbackend\helpers\FlowCellPaths.ps1')
if (-not (Test-Path -LiteralPath $runtimeConfig -PathType Leaf)) {
    if ($LocalRoot) {
        if (-not [IO.Path]::IsPathRooted($LocalRoot)) { throw 'LocalRoot requires an absolute path.' }
        $FlowCellLocalRoot = [IO.Path]::GetFullPath($LocalRoot)
    }
    [IO.Directory]::CreateDirectory($FlowCellLocalRoot) | Out-Null
    $physicalLocalRoot = Resolve-FlowCellPhysicalPath -Path $FlowCellLocalRoot
    @{ localRoot = $physicalLocalRoot } | ConvertTo-Json | Set-Content -LiteralPath $runtimeConfig -Encoding UTF8
}
. (Join-Path $root 'flowcellbackend\helpers\FlowCellPaths.ps1')
$legacyToggleRoots = @((Join-Path $FlowCellLocalRoot 'autohotkey-toggle'), $toggleDirectory)
if (Test-Path -LiteralPath $toggleShortcutPath -PathType Leaf) {
    $previousToggle = $shell.CreateShortcut($toggleShortcutPath)
    $previousLauncher = [string]$previousToggle.TargetPath
    if ([IO.Path]::GetFileName($previousLauncher) -in @('wscript.exe','cscript.exe')) {
        $arguments = $shell.ExpandEnvironmentStrings([string]$previousToggle.Arguments)
        $match = [regex]::Match($arguments, '(?i)^\s*(?:(?://B|//Nologo)\s+)*(?:"([^"]+)"|(\S+))\s*$')
        $previousLauncher = if ($match.Success) { if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value } } else { '' }
    }
    if ([IO.Path]::GetFileName($previousLauncher) -ieq 'Toggle-AutoHotkey.vbs' -and (Test-Path -LiteralPath $previousLauncher -PathType Leaf)) {
        $previousToggleDirectory = Split-Path -Parent $previousLauncher
        if (Test-Path -LiteralPath (Join-Path $previousToggleDirectory 'Toggle-AutoHotkey.ps1') -PathType Leaf) {
            $legacyToggleRoots += $previousToggleDirectory
            $previousRoot = Split-Path -Parent (Split-Path -Parent $previousToggleDirectory)
            if ($previousRoot) {
                $expectedLauncher = Join-Path $previousRoot 'tools\autohotkey v2 on off\Toggle-AutoHotkey.vbs'
                if ([IO.Path]::GetFullPath($previousLauncher) -eq [IO.Path]::GetFullPath($expectedLauncher) -and
                    (Test-Path -LiteralPath (Join-Path $previousRoot 'flowcellbackend\FlowCellBackend.ahk') -PathType Leaf)) {
                    $legacyToggleRoots += Join-Path $previousRoot 'flowcellbackend\local\autohotkey-toggle'
                }
            }
        }
    }
}
. (Join-Path $root 'flowcellbackend\helpers\AutoHotkeyState.ps1')
Import-FlowCellAutoHotkeyLegacyState -LegacyRoots @($legacyToggleRoots | Select-Object -Unique)
$windowsRoot = Join-Path $FlowCellProgramsRoot 'Windows'
$windowsManifest = Join-Path $windowsRoot 'flowcell.program.json'
$panelsFolder = 'Panels'
if (Test-Path -LiteralPath $windowsManifest -PathType Leaf) {
    $manifest = Get-Content -LiteralPath $windowsManifest -Raw | ConvertFrom-Json
    if ($manifest.PSObject.Properties['panelsFolder']) { $panelsFolder = [string]$manifest.panelsFolder }
}
if ([string]::IsNullOrWhiteSpace($panelsFolder) -or [IO.Path]::IsPathRooted($panelsFolder)) { throw 'Windows panelsFolder must be a relative folder.' }
$startupPanel = [IO.Path]::GetFullPath((Join-Path (Join-Path $windowsRoot $panelsFolder) 'Startup'))
if (-not $startupPanel.StartsWith(([IO.Path]::GetFullPath($windowsRoot).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Windows Startup panel escaped its program folder.' }
[IO.Directory]::CreateDirectory($startupPanel) | Out-Null
$legacyStartupPath = Join-Path $StartupDirectory 'FlowCell Hotkeys Startup.vbs'
if ((Test-Path -LiteralPath $legacyStartupPath -PathType Leaf) -and (Get-Item -LiteralPath $legacyStartupPath).Length -le 16384) {
    $legacyText = [IO.File]::ReadAllText($legacyStartupPath)
    $legacyTargets = [regex]::Matches($legacyText, '(?im)^\s*target\s*=\s*"([^"\r\n]+\\run_backend_hidden\.vbs)"\s*$')
    if ($legacyTargets.Count -eq 1 -and [IO.Path]::IsPathRooted($legacyTargets[0].Groups[1].Value)) {
        $legacyLauncher = [IO.Path]::GetFullPath($legacyTargets[0].Groups[1].Value)
        $legacyRoot = Split-Path -Parent $legacyLauncher
        $legacyBackendScript = Join-Path $legacyRoot 'FlowCellBackend.ahk'
        $verifiedLegacyLauncher = $false
        if ((Test-Path -LiteralPath $legacyLauncher -PathType Leaf) -and (Get-Item -LiteralPath $legacyLauncher).Length -le 16384) {
            $wrapperText = [IO.File]::ReadAllText($legacyLauncher)
            if ($wrapperText -match '(?im)^\s*(?:backendScript\s*=\s*root\s*&\s*"\\FlowCellBackend\.ahk"|launcher\s*=\s*root\s*&\s*"\\helpers\\Start-FlowCellBackend\.ps1")\s*$') {
                $verifiedLegacyLauncher = $true
            } elseif ($wrapperText -match '(?im)^\s*target\s*=\s*root\s*&\s*"\\flowcellbackend\\run_backend_hidden\.vbs"\s*$') {
                $nestedLauncher = Join-Path $legacyRoot 'flowcellbackend\run_backend_hidden.vbs'
                if ((Test-Path -LiteralPath $nestedLauncher -PathType Leaf) -and (Get-Item -LiteralPath $nestedLauncher).Length -le 16384) {
                    $nestedText = [IO.File]::ReadAllText($nestedLauncher)
                    $verifiedLegacyLauncher = $nestedText -match '(?im)^\s*(?:backendScript\s*=\s*root\s*&\s*"\\FlowCellBackend\.ahk"|launcher\s*=\s*root\s*&\s*"\\helpers\\Start-FlowCellBackend\.ps1")\s*$'
                    $legacyBackendScript = Join-Path $legacyRoot 'flowcellbackend\FlowCellBackend.ahk'
                }
            }
        }
        if ($verifiedLegacyLauncher -and (Test-Path -LiteralPath $legacyBackendScript -PathType Leaf)) {
            $backupRoot = Join-Path $FlowCellLocalRoot ('backups\startup-migration\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
            $backupRoot = [IO.Path]::GetFullPath($backupRoot)
            if (-not $backupRoot.StartsWith(([IO.Path]::GetFullPath($FlowCellLocalRoot).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Startup backup escaped the configured data root.' }
            [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
            Move-Item -LiteralPath $legacyStartupPath -Destination (Join-Path $backupRoot 'FlowCell Hotkeys Startup.vbs')
            $backendSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
            Get-CimInstance Win32_Process -Filter "Name = 'AutoHotkey64.exe' Or Name = 'AutoHotkey.exe'" | Where-Object {
                $_.SessionId -eq $backendSessionId -and $_.CommandLine -and $_.CommandLine.Contains('--headless') -and $_.CommandLine.IndexOf('--backend-role=', [StringComparison]::OrdinalIgnoreCase) -lt 0 -and
                $_.CommandLine.IndexOf($legacyBackendScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
            } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
        }
    }
}
[IO.Directory]::CreateDirectory($StartupDirectory) | Out-Null
$shortcut = $shell.CreateShortcut($startupPath)
$shortcut.TargetPath = $launcher
$shortcut.Arguments = '--logon'
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'FlowCell Startup shortcuts and background service at Windows sign-in'
$shortcut.Save()
# -Force recreates an existing registry key and removes its child keys, including
# Tauri's remembered installation directory. Only create a genuinely missing key.
if (-not (Test-Path -LiteralPath $RegistryPath)) { New-Item -Path $RegistryPath | Out-Null }
New-ItemProperty -LiteralPath $RegistryPath -Name InstalledResourceRoot -Value $root -PropertyType String -Force | Out-Null
$startupFailure = $null
try {
    # Installing/upgrading is not a new Windows sign-in and must respect a manual OFF choice.
    if ($Start) { & (Join-Path $root 'flowcellbackend\helpers\Start-FlowCellBackend.ps1') -Role installed }
} catch { $startupFailure = $_ }
if ($DesktopToggle -eq 'Install') {
    [IO.Directory]::CreateDirectory($DesktopDirectory) | Out-Null
    $running = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoHotkey%.exe'")
    $isRunning = $running.Count -gt 0
    $toggleShortcut = $shell.CreateShortcut($toggleShortcutPath)
    $toggleShortcut.TargetPath = $scriptHost
    $toggleShortcut.Arguments = '"' + $toggleLauncher + '"'
    $toggleShortcut.WorkingDirectory = $toggleDirectory
    $toggleShortcut.IconLocation = Join-Path $toggleDirectory $(if ($isRunning) { 'Toggle-AutoHotkey-On.ico' } else { 'Toggle-AutoHotkey-Off.ico' })
    $toggleShortcut.Description = if ($startupFailure) { 'Toggle AutoHotkey. FlowCell background startup failed; run the toggle to retry.' } elseif ($isRunning) { 'Toggle AutoHotkey. Current state: ON. AutoHotkey is running.' } else { 'Toggle AutoHotkey. Current state: OFF. No AutoHotkey process is running.' }
    $toggleShortcut.Save()
}
if ($startupFailure) { throw $startupFailure }
