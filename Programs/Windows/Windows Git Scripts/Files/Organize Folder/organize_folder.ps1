# Description: Organizes the copied project folder path.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'flowcellbackend'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }
        $currentPath = $parentPath
    }

    throw 'Could not locate the FlowCell repository root from this script location.'
}

$repoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
$flowCellLocalRoot = Join-Path $repoRoot 'flowcellbackend\local'
$statusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'

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

function Get-TargetProjectFolder {
    $clipboardPath = Get-ClipboardProjectFolder
    if (-not [string]::IsNullOrWhiteSpace($clipboardPath)) {
        return $clipboardPath
    }

    return ''
}

try {
    $organizerPath = Join-Path $PSScriptRoot 'Organize-FolderCore.ps1'
    if (-not (Test-Path -LiteralPath $organizerPath -PathType Leaf)) {
        throw "Organize Folder core script not found: $organizerPath"
    }

    $projectPath = Get-TargetProjectFolder
    if ([string]::IsNullOrWhiteSpace($projectPath)) {
        Write-Status 'Organize Folder failed. No valid clipboard path found. Copy a project folder path to the clipboard first.'
        exit 1
    }

    $powershellExe = Get-WindowsPowerShellPath
    $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $organizerPath -ProjectPath $projectPath 2>&1
    $exitCode = $LASTEXITCODE
    $outputLines = @($output | ForEach-Object { [string]$_ })

    $logLine = @($outputLines | Where-Object { $_ -like 'Log:*' } | Select-Object -Last 1)
    $undoLine = @($outputLines | Where-Object { $_ -like 'Undo manifest:*' } | Select-Object -Last 1)
    $verificationLine = @($outputLines | Where-Object { $_ -like 'Verification:*' } | Select-Object -Last 1)
    $filesMovedLine = @($outputLines | Where-Object { $_ -like 'Files moved:*' } | Select-Object -Last 1)
    $unresolvedLine = @($outputLines | Where-Object { $_ -like 'Unresolved items:*' } | Select-Object -Last 1)
    $warningLines = @()
    if (@($outputLines | Where-Object { $_ -like 'Warning:*' } | Select-Object -First 1).Count -gt 0) {
        $warningLines = @($outputLines | Where-Object {
            $_ -like 'Warning:*' -or
            $_ -like 'Project-like child folders:*' -or
            $_ -like 'No changes were made.' -or
            $_ -match '^\s{2}.+'
        } | Select-Object -First 10)
    }

    $statusParts = @(
        ('Project: {0}' -f $projectPath)
    )
    if (@($warningLines).Count -gt 0) { $statusParts += $warningLines }
    if (@($verificationLine).Count -gt 0) { $statusParts += $verificationLine[0] }
    if (@($filesMovedLine).Count -gt 0) { $statusParts += $filesMovedLine[0] }
    if (@($unresolvedLine).Count -gt 0) { $statusParts += $unresolvedLine[0] }
    if (@($logLine).Count -gt 0) { $statusParts += $logLine[0] }
    if (@($undoLine).Count -gt 0) { $statusParts += $undoLine[0] }
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

