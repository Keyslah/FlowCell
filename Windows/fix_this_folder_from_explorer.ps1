# Description: Runs fix this folder from explorer.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ExplorerWindowInterop {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@

$repoRoot = Split-Path -Parent $PSScriptRoot
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$statusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'

function Get-CodexHomePath {
    if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
        return $env:CODEX_HOME
    }

    return (Join-Path $HOME '.codex')
}

function Get-FixThisFolderSkillScriptPath {
    $codexHome = Get-CodexHomePath
    return (Join-Path $codexHome 'skills\fix-this-folder\scripts\fix_this_folder.ps1')
}

function Write-Status([string]$Message) {
    $directory = Split-Path -Parent $statusPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
}

function Get-ClipboardProjectFolder {
    try {
        $clipboardText = Get-Clipboard -Raw -ErrorAction Stop
    }
    catch {
        return ''
    }

    if ([string]::IsNullOrWhiteSpace($clipboardText)) {
        return ''
    }

    $candidatePath = [string]$clipboardText
    $candidatePath = $candidatePath.Trim()
    $candidatePath = $candidatePath.Trim('"')

    if ([string]::IsNullOrWhiteSpace($candidatePath)) {
        return ''
    }

    if (Test-Path -LiteralPath $candidatePath -PathType Container) {
        return $candidatePath
    }

    if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
        return (Split-Path -Parent $candidatePath)
    }

    return ''
}

function Get-WindowsPowerShellPath {
    $command = Get-Command 'powershell.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
        return [string]$command.Source
    }

    $fallback = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $fallback -PathType Leaf) {
        return $fallback
    }

    throw 'Could not locate powershell.exe.'
}

function Get-ExplorerWindowInfo($Window) {
    try {
        if ($null -eq $Window) { return $null }
        if (-not $Window.FullName) { return $null }
        if ([System.IO.Path]::GetFileName([string]$Window.FullName).ToLowerInvariant() -ne 'explorer.exe') { return $null }

        $folderPath = ''
        try {
            $folderPath = [string]$Window.Document.Folder.Self.Path
        }
        catch {
            $folderPath = ''
        }

        $selectedFolderPaths = @()
        try {
            foreach ($item in @($Window.Document.SelectedItems())) {
                if ($null -eq $item) { continue }
                $candidatePath = [string]$item.Path
                if ([string]::IsNullOrWhiteSpace($candidatePath)) { continue }
                if (Test-Path -LiteralPath $candidatePath -PathType Container) {
                    $selectedFolderPaths += $candidatePath
                }
            }
        }
        catch {
            $selectedFolderPaths = @()
        }

        return [pscustomobject]@{
            Hwnd                = [int64]$Window.HWND
            FolderPath          = $folderPath
            SelectedFolderPaths = @($selectedFolderPaths | Select-Object -Unique)
        }
    }
    catch {
        return $null
    }
}

function Get-TargetProjectFolder {
    $clipboardPath = Get-ClipboardProjectFolder
    if (-not [string]::IsNullOrWhiteSpace($clipboardPath)) {
        return $clipboardPath
    }

    $shell = New-Object -ComObject Shell.Application
    $foregroundHwnd = [int64][ExplorerWindowInterop]::GetForegroundWindow()
    $windows = @()

    foreach ($window in @($shell.Windows())) {
        $info = Get-ExplorerWindowInfo -Window $window
        if ($null -ne $info) {
            $windows += $info
        }
    }

    $preferred = @($windows | Where-Object { $_.Hwnd -eq $foregroundHwnd } | Select-Object -First 1)
    if (@($preferred).Count -eq 0) {
        $preferred = @($windows | Select-Object -First 1)
    }

    if (@($preferred).Count -gt 0) {
        $windowInfo = $preferred[0]
        if (@($windowInfo.SelectedFolderPaths).Count -eq 1) {
            return [string]$windowInfo.SelectedFolderPaths[0]
        }

        if (-not [string]::IsNullOrWhiteSpace([string]$windowInfo.FolderPath) -and (Test-Path -LiteralPath $windowInfo.FolderPath -PathType Container)) {
            return [string]$windowInfo.FolderPath
        }
    }

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose the project folder to normalize.'
    $dialog.ShowNewFolderButton = $false
    $dialog.UseDescriptionForTitle = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace([string]$dialog.SelectedPath)) {
        return [string]$dialog.SelectedPath
    }

    return ''
}

try {
    $skillScriptPath = Get-FixThisFolderSkillScriptPath
    if (-not (Test-Path -LiteralPath $skillScriptPath -PathType Leaf)) {
        throw "Skill script not found: $skillScriptPath"
    }

    $projectPath = Get-TargetProjectFolder
    if ([string]::IsNullOrWhiteSpace($projectPath)) {
        Write-Status 'Fix This Folder cancelled.'
        exit 1
    }

    $powershellExe = Get-WindowsPowerShellPath
    $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $skillScriptPath -ProjectPath $projectPath 2>&1
    $exitCode = $LASTEXITCODE
    $outputLines = @($output | ForEach-Object { [string]$_ })

    $logLine = @($outputLines | Where-Object { $_ -like 'Log:*' } | Select-Object -Last 1)
    $verificationLine = @($outputLines | Where-Object { $_ -like 'Verification:*' } | Select-Object -Last 1)
    $filesMovedLine = @($outputLines | Where-Object { $_ -like 'Files moved:*' } | Select-Object -Last 1)
    $unresolvedLine = @($outputLines | Where-Object { $_ -like 'Unresolved items:*' } | Select-Object -Last 1)

    $statusParts = @(
        ('Project: {0}' -f $projectPath)
    )
    if (@($verificationLine).Count -gt 0) { $statusParts += $verificationLine[0] }
    if (@($filesMovedLine).Count -gt 0) { $statusParts += $filesMovedLine[0] }
    if (@($unresolvedLine).Count -gt 0) { $statusParts += $unresolvedLine[0] }
    if (@($logLine).Count -gt 0) { $statusParts += $logLine[0] }
    if (@($statusParts).Count -eq 1 -and @($outputLines).Count -gt 0) {
        $statusParts += ($outputLines | Select-Object -Last 3)
    }

    Write-Status ($statusParts -join [Environment]::NewLine)

    if ($exitCode -ne 0) {
        exit $exitCode
    }

    exit 0
}
catch {
    Write-Status $_.Exception.Message
    exit 1
}

