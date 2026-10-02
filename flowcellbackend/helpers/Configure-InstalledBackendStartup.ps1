<#
Purpose: Register the installed background backend at Windows sign-in independently of the UI.
Context: Per-user installer hooks. The installed launcher supplies explicit role and paths.
Inputs: ResourceRoot; LocalRoot for first registration; fixture startup and registry paths.
Changes: Startup shortcut, installed root registry pointer, first-use config and preserved legacy migration.
Constraints: No user settings are removed; a different installation's shortcut is preserved.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ResourceRoot,
    [ValidateSet('Register','Remove')][string]$Action = 'Register',
    [string]$StartupDirectory = [Environment]::GetFolderPath('Startup'),
    [string]$RegistryPath = 'HKCU:\Software\FlowCell',
    [string]$LocalRoot,
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($ResourceRoot)
$launcher = Join-Path $root 'flowcellbackend\run_backend_hidden.vbs'
$startupPath = Join-Path $StartupDirectory 'FlowCell Background.lnk'
$shell = New-Object -ComObject WScript.Shell
if ($Action -eq 'Remove') {
    if (Test-Path -LiteralPath $startupPath -PathType Leaf) {
        $existing = $shell.CreateShortcut($startupPath)
        if ($existing.TargetPath -eq $launcher) {
            Add-Type -AssemblyName Microsoft.VisualBasic
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($startupPath, 'OnlyErrorDialogs', 'SendToRecycleBin')
        }
    }
    $registeredSettings = Get-ItemProperty -LiteralPath $RegistryPath -ErrorAction SilentlyContinue
    $registeredRoot = if ($registeredSettings -and $registeredSettings.PSObject.Properties['InstalledResourceRoot']) { $registeredSettings.InstalledResourceRoot } else { $null }
    if ($registeredRoot -eq $root) { Remove-ItemProperty -LiteralPath $RegistryPath -Name InstalledResourceRoot }
    return
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'flowcell-installed.json') -PathType Leaf)) { throw 'Startup registration requires an installed FlowCell resource root.' }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Installed backend launcher missing: $launcher" }
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
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'FlowCell background shortcuts and Temp Shots'
$shortcut.Save()
New-Item -Path $RegistryPath -Force | Out-Null
New-ItemProperty -LiteralPath $RegistryPath -Name InstalledResourceRoot -Value $root -PropertyType String -Force | Out-Null
if ($Start) { & (Join-Path $root 'flowcellbackend\helpers\Start-FlowCellBackend.ps1') -Role installed }
