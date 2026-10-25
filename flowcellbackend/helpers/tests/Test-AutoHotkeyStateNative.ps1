<#
Purpose: Verify AHK/PowerShell logon identity, state semantics, and isolated
short-lived child launch/exit status without running the backend, registering
shortcuts, changing the real toggle, or opening UI.
#>
[CmdletBinding()]
param([string]$Runtime)
$ErrorActionPreference = 'Stop'
$helpers = Split-Path -Parent $PSScriptRoot
$backend = Split-Path -Parent $helpers
. (Join-Path $helpers 'AutoHotkeyState.ps1')
if (-not $Runtime) {
    $Runtime = @(
        (Join-Path $backend 'runtime\AutoHotkey64.exe'),
        (Join-Path $backend 'local\bin\AutoHotkey64.exe'),
        (Join-Path $env:ProgramFiles 'AutoHotkey\v2\AutoHotkey64.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $Runtime) { throw 'An AutoHotkey v2 runtime is required for the native state tests.' }
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell AHK state ' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$sessionId = Get-FlowCellAutoHotkeySessionId
$mutexName = 'Local\FlowCell.AutoHotkey.' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$statePath = Join-Path (Get-FlowCellAutoHotkeyStateRoot) ('AutoHotkeySessionState-' + $sessionId + '.json')
$stdout = Join-Path $fixtureRoot 'stdout.txt'
$stderr = Join-Path $fixtureRoot 'stderr.txt'
foreach ($validation in @(
    @{ Script = (Join-Path $backend 'FlowCellBackend.ahk'); Arguments = @('--validate-only') },
    @{ Script = (Join-Path $PSScriptRoot 'Test-AutoHotkeyState.ahk'); Arguments = @(('"' + $fixtureRoot + '"'), $sessionId, $mutexName, ('"' + $statePath + '"')) }
)) {
    $arguments = @('/ErrorStdOut', ('"' + $validation.Script + '"')) + $validation.Arguments
    $process = Start-Process -FilePath $Runtime -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru
    Get-Content -LiteralPath $stdout,$stderr -TotalCount 60
    if ($process.ExitCode -ne 0) { throw "Native AutoHotkey validation failed with exit code $($process.ExitCode): $($validation.Script)" }
}
Write-Output 'PASS: backend syntax and native per-sign-in state identity/semantics; no shortcuts registered.'
