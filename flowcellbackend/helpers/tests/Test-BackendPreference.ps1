<# Fixture-only launcher integration: no AutoHotkey, real state, shortcuts, or UI. #>
$ErrorActionPreference = 'Stop'
$helpers = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell backend preference ' + [guid]::NewGuid().ToString('N'))
$fixtureHelpers = Join-Path $fixtureRoot 'flowcellbackend\helpers'
$localRoot = Join-Path $fixtureRoot 'user data'
$fixtureState = Join-Path $fixtureRoot 'preference'
$statusPath = Join-Path $localRoot 'logs\backend-bindings-installed.json'
$backendPath = Join-Path $fixtureRoot 'flowcellbackend\FlowCellBackend.ahk'
foreach ($path in @($fixtureHelpers, (Join-Path $fixtureRoot 'flowcellbackend\runtime'), (Split-Path -Parent $statusPath))) {
    [IO.Directory]::CreateDirectory($path) | Out-Null
}
foreach ($file in @('FlowCellPaths.ps1','Start-FlowCellBackend.ps1')) {
    Copy-Item -LiteralPath (Join-Path $helpers $file) -Destination (Join-Path $fixtureHelpers $file)
}
$realStateHelper = (Join-Path $helpers 'AutoHotkeyState.ps1').Replace("'", "''")
@"
. '$realStateHelper'
function Get-FlowCellAutoHotkeyStateRoot { return `$global:BackendPreferenceFixture.StateRoot }
function Get-FlowCellAutoHotkeySessionId { return `$global:BackendPreferenceFixture.SessionId }
function Enter-FlowCellAutoHotkeyLock { `$global:BackendPreferenceFixture.Locked = `$true; return 'fixture-lock' }
function Exit-FlowCellAutoHotkeyLock { param(`$Mutex) `$global:BackendPreferenceFixture.Locked = `$false }
"@ | Set-Content -LiteralPath (Join-Path $fixtureHelpers 'AutoHotkeyState.ps1')
'{}' | Set-Content -LiteralPath (Join-Path $fixtureRoot 'flowcell-installed.json')
@{ localRoot = $localRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'flowcell.runtime.json')
'; never executed' | Set-Content -LiteralPath $backendPath
'' | Set-Content -LiteralPath (Join-Path $fixtureRoot 'flowcellbackend\runtime\AutoHotkey64.exe')
Add-Type -TypeDefinition @'
public static class FlowCellBackendReady {
    public static bool Ready = true;
    public static bool IsReady(string title, int processId) { return Ready; }
}
'@
$global:BackendPreferenceFixture = @{
    StateRoot = $fixtureState; SessionId = 'first-signin'; Starts = 0; Stops = 0;
    Existing = $false; Locked = $false; HasExited = $false; LoadErrors = 0; WaitedAfterStop = $false
}
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-FixtureProcess {
    $process = [pscustomobject]@{ Id = 424242; HasExited = $global:BackendPreferenceFixture.HasExited; ExitCode = 23; Handle = [IntPtr]::Zero }
    $process | Add-Member ScriptMethod Refresh { }
    $process | Add-Member ScriptMethod WaitForExit { param($Milliseconds) $global:BackendPreferenceFixture.WaitedAfterStop = $true; return $true }
    $process | Add-Member ScriptMethod Dispose { }
    return $process
}
function Get-CimInstance {
    if ($global:BackendPreferenceFixture.Existing) {
        return [pscustomobject]@{
            ProcessId = 424242; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
            CommandLine = '"' + $backendPath + '" --headless --direct-script-receiver --backend-role=installed'
        }
    }
}
function Get-Process { param([int]$Id, $ErrorAction) return Get-FixtureProcess }
function Stop-Process { param([int]$Id, [switch]$Force, $ErrorAction) $global:BackendPreferenceFixture.Stops++; $global:BackendPreferenceFixture.Existing = $false }
function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru)
    Assert-True $global:BackendPreferenceFixture.Locked 'Process creation must hold the common preference lock.'
    if ($global:BackendPreferenceFixture.Stops -gt 0) {
        Assert-True $global:BackendPreferenceFixture.WaitedAfterStop 'Restart must wait for the previous backend to exit before launching its replacement.'
    }
    $global:BackendPreferenceFixture.Starts++
    $global:BackendPreferenceFixture.Existing = $true
    @{ processId = 424242; registrationErrorCount = 0; loadErrorCount = $global:BackendPreferenceFixture.LoadErrors } |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath
    return Get-FixtureProcess
}
$savedEnvironment = @{}
foreach ($key in @('FLOWCELL_LOCAL_ROOT','FLOWCELL_PROGRAMS_ROOT','FLOWCELL_RESOURCE_ROOT','FLOWCELL_BACKEND_ROLE')) {
    $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key)
}
try {
    . (Join-Path $fixtureHelpers 'AutoHotkeyState.ps1')
    $launcher = Join-Path $fixtureHelpers 'Start-FlowCellBackend.ps1'
    Set-FlowCellAutoHotkeyEnabled -Enabled $false
    & $launcher -Role installed -Logon -Restart
    Assert-True ($global:BackendPreferenceFixture.Starts -eq 0 -and $global:BackendPreferenceFixture.Stops -eq 0) 'Repeated startup and restart must respect same-session OFF.'
    Assert-True (-not (Get-FlowCellAutoHotkeyState).Enabled) 'Startup must not flip current-session OFF.'
    $global:BackendPreferenceFixture.SessionId = 'second-signin'
    & $launcher -Role installed -Logon
    Assert-True ($global:BackendPreferenceFixture.Starts -eq 1 -and (Get-FlowCellAutoHotkeyState).Enabled) 'A new Windows sign-in must explicitly initialize ON and launch once.'
    & $launcher -Role installed -Logon
    Assert-True ($global:BackendPreferenceFixture.Starts -eq 1 -and $global:BackendPreferenceFixture.Stops -eq 0) 'Repeated ensure startup must reuse the existing backend.'
    $global:BackendPreferenceFixture.SessionId = 'first-signin'
    & $launcher -Role installed -Restart
    Assert-True ($global:BackendPreferenceFixture.Starts -eq 1 -and $global:BackendPreferenceFixture.Stops -eq 0) 'Another active sign-in must not invalidate this sign-in OFF latch.'
    $global:BackendPreferenceFixture.SessionId = 'second-signin'
    @{ processId = 424242; registrationErrorCount = 1; loadErrorCount = 0 } | ConvertTo-Json | Set-Content -LiteralPath $statusPath
    $failure = ''
    try { & $launcher -Role installed } catch { $failure = $_.Exception.Message }
    Assert-True ($failure -match 'bindings failed') 'A live receiver must not hide failed binding registration.'
    [FlowCellBackendReady]::Ready = $false
    $global:BackendPreferenceFixture.HasExited = $true
    $failure = ''
    try { & $launcher -Role installed -Restart } catch { $failure = $_.Exception.Message }
    Assert-True ($failure -match 'exited before it was ready') 'An early backend exit must report startup failure.'
    Assert-True (-not $global:BackendPreferenceFixture.Locked) 'Every failed launch must release the preference lock.'
    Write-Output 'PASS: backend OFF/logon/restart isolation, new-sign-in ON, process reuse, binding registration failure, early exit and lock release. All process boundaries mocked.'
} finally {
    foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key]) }
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ([IO.Path]::GetFullPath($fixtureRoot).StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($fixtureRoot).StartsWith('FlowCell backend preference ')) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
