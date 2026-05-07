# Description: Runs RunRecordedMacro.
param(
    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [string]$SignalPath,

    [int]$PreDelayMs = 900,
    [int]$PostDelayMs = 1500
)

$ErrorActionPreference = 'Stop'

function Write-SignalFile {
    param(
        [int]$ExitCode,
        [string]$Message
    )

    $directory = Split-Path -Parent $SignalPath
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    @(
        "ExitCode=$ExitCode"
        "Message=$Message"
    ) | Set-Content -LiteralPath $SignalPath -Encoding UTF8
}

function Get-IniValue {
    param(
        [string]$Path,
        [string]$Key
    )

    $line = Select-String -Path $Path -Pattern ('^{0}=(.*)$' -f [regex]::Escape($Key)) | Select-Object -First 1
    if (-not $line) {
        return ''
    }

    return $line.Matches[0].Groups[1].Value.Trim()
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$localRoot = Join-Path $projectRoot 'local'
$recordedActionsPath = Join-Path $localRoot 'recorded_actions'
$statusPath = Join-Path $localRoot 'logs\last_action_status.txt'
$ahkScriptPath = Join-Path $projectRoot 'FlowCellBackend.ahk'
$ahkExePath = 'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe'

if (-not (Test-Path -LiteralPath $ahkExePath)) {
    $ahkExePath = 'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe'
}

if (Test-Path -LiteralPath $SignalPath) {
    Remove-Item -LiteralPath $SignalPath -Force -ErrorAction SilentlyContinue
}

try {
    if ($PreDelayMs -gt 0) {
        Start-Sleep -Milliseconds $PreDelayMs
    }

    $match = Get-ChildItem -LiteralPath $recordedActionsPath -Filter '*.ini' |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object {
            $filePath = $_.FullName
            $fileLabel = Get-IniValue -Path $filePath -Key 'Label'
            if ($fileLabel -eq $Label) {
                [pscustomobject]@{
                    Id = Get-IniValue -Path $filePath -Key 'Id'
                    Path = $filePath
                    Label = $fileLabel
                }
            }
        } |
        Select-Object -First 1

    if (-not $match) {
        throw "Recorded macro not found for label '$Label'."
    }

    if ([string]::IsNullOrWhiteSpace($match.Id)) {
        throw "Recorded macro '$Label' is missing an Id."
    }

    if (-not (Test-Path -LiteralPath $ahkExePath)) {
        throw "AutoHotkey executable was not found."
    }

    if (-not (Test-Path -LiteralPath $ahkScriptPath)) {
        throw "FlowCellBackend.ahk was not found."
    }

    if (Test-Path -LiteralPath $statusPath) {
        Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
    }

    $process = Start-Process -FilePath $ahkExePath `
        -ArgumentList @('/ErrorStdOut', $ahkScriptPath, "--run-action=$($match.Id)") `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    $exitCode = $process.ExitCode

    if ($exitCode -ne 0) {
        $statusText = ''
        if (Test-Path -LiteralPath $statusPath) {
            $statusText = (Get-Content -LiteralPath $statusPath -Raw).Trim()
        }

        if ([string]::IsNullOrWhiteSpace($statusText)) {
            $statusText = "FlowCell exited with code $exitCode."
        }

        Write-SignalFile -ExitCode $exitCode -Message $statusText
        exit $exitCode
    }

    $statusText = ''
    if (Test-Path -LiteralPath $statusPath) {
        $statusText = (Get-Content -LiteralPath $statusPath -Raw).Trim()
    }

    if ([string]::IsNullOrWhiteSpace($statusText)) {
        $statusText = "Ran macro '$($match.Label)' ($($match.Id))."
    }

    if ($PostDelayMs -gt 0) {
        Start-Sleep -Milliseconds $PostDelayMs
    }

    Write-SignalFile -ExitCode 0 -Message $statusText
    exit 0
} catch {
    Write-SignalFile -ExitCode 1 -Message $_.Exception.Message
    exit 1
}
