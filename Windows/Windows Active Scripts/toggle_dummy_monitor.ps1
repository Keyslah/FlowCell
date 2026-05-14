# Description: Runs toggle dummy monitor.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'DummyMonitorHelpers.ps1')

$targetDisplay = Get-DummyMonitorTargetDisplay
$result = Invoke-DummyMonitorPython -Arguments @('--toggle-once', '--target-display', $targetDisplay)
if ($result.ExitCode -ne 0) {
    $detail = "Dummy monitor toggle failed for $targetDisplay with exit code $($result.ExitCode)."
    $logTail = Get-DummyMonitorLastLogLines
    if (-not [string]::IsNullOrWhiteSpace($logTail)) {
        $detail += "`r`n`r`nRecent helper log:`r`n$logTail"
    }
    Write-DummyMonitorStatus -Text $detail
    throw $detail
}

Write-DummyMonitorStatus -Text ("Dummy monitor toggle completed.`r`nTarget display: {0}`r`nHelper: {1}" -f $targetDisplay, $result.ScriptPath)
