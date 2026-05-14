# Description: Runs save monitor layout profile dialog.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms

. (Join-Path $PSScriptRoot 'DummyMonitorHelpers.ps1')

$targetDisplay = Get-DummyMonitorTargetDisplay

$defaultName = 'Layout ' + (Get-Date -Format 'yyyy-MM-dd HHmm')
$layoutName = [Microsoft.VisualBasic.Interaction]::InputBox(
    'Enter a name for the current monitor layout. Saving it also makes it the active layout used for restore.',
    'Save Monitor Layout',
    $defaultName
)

if ([string]::IsNullOrWhiteSpace($layoutName)) {
    exit 0
}

$result = Invoke-DummyMonitorPython -Arguments @('--save-layout', $layoutName, '--target-display', $targetDisplay)
if ($result.ExitCode -ne 0) {
    $detail = "Saving monitor layout '$layoutName' failed with exit code $($result.ExitCode)."
    $logTail = Get-DummyMonitorLastLogLines
    if (-not [string]::IsNullOrWhiteSpace($logTail)) {
        $detail += "`r`n`r`nRecent helper log:`r`n$logTail"
    }
    Write-DummyMonitorStatus -Text $detail
    throw $detail
}

Write-DummyMonitorStatus -Text ("Saved monitor layout '{0}'.`r`nTarget display: {1}`r`nHelper: {2}" -f $layoutName, $targetDisplay, $result.ScriptPath)
[System.Windows.Forms.MessageBox]::Show(
    "Saved layout '$layoutName' and made it active for future restores.",
    'Save Monitor Layout',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
