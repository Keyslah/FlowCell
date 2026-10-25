<#
Purpose: Start only this root's backend with explicit installed/development ownership.
Context: Called by installed startup, frontend and development launchers, independent of cwd.
Inputs: Adjacent installed marker/runtime config. DefinitionsOnly is a fixture-only override.
Changes: Child process environment; Restart stops only this exact backend script.
Constraints: An installed backend at another resource root is never replaced implicitly.
#>
[CmdletBinding()]
param(
    [ValidateSet('installed','development')][string]$Role,
    [switch]$Restart,
    [switch]$Logon,
    [switch]$DefinitionsOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'FlowCellPaths.ps1') -AllowEnvironmentOverrides:$DefinitionsOnly
$resolvedRole = $env:FLOWCELL_BACKEND_ROLE
if ($Role -and $Role -ne $resolvedRole) { throw "Backend role '$Role' does not match resource root '$FlowCellResourceRoot' ($resolvedRole)." }
$backendScript = Join-Path $FlowCellResourceRoot 'flowcellbackend\FlowCellBackend.ahk'
$runtimeCandidates = @(
    (Join-Path $FlowCellResourceRoot 'flowcellbackend\runtime\AutoHotkey64.exe'),
    (Join-Path $FlowCellResourceRoot 'flowcellbackend\runtime\AutoHotkey.exe')
)
if ($resolvedRole -eq 'development') {
    $runtimeCandidates += @(
        (Join-Path $FlowCellResourceRoot 'flowcellbackend\local\bin\AutoHotkey64.exe'),
        (Join-Path $FlowCellResourceRoot 'flowcellbackend\local\bin\AutoHotkey.exe'),
        'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe',
        'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe'
    )
}
$runtime = $runtimeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$descriptor = [pscustomobject]@{
    Role = $resolvedRole
    ResourceRoot = $FlowCellResourceRoot
    LocalRoot = $FlowCellLocalRoot
    ProgramsRoot = $FlowCellProgramsRoot
    BackendScript = $backendScript
    Runtime = $runtime
    Arguments = @(('"' + $backendScript + '"'), '--headless', '--direct-script-receiver', "--backend-role=$resolvedRole")
}
if ($DefinitionsOnly) { return $descriptor }
. (Join-Path $PSScriptRoot 'AutoHotkeyState.ps1')
$stateMutex = $null
try {
    $stateMutex = Enter-FlowCellAutoHotkeyLock
    $preference = Get-FlowCellAutoHotkeyState
    # A repeated startup entry, wake, or upgrade in the same session must not
    # override manual OFF. A genuinely new authentication session starts ON.
    if ($preference.IsNewSession) { Set-FlowCellAutoHotkeyEnabled -Enabled $true }
    if (-not $preference.Enabled) { return }
    if (-not (Test-Path -LiteralPath $backendScript -PathType Leaf)) { throw "Backend script missing: $backendScript" }
    if (-not $runtime) { throw "AutoHotkey v2 runtime missing for $resolvedRole FlowCell at $FlowCellResourceRoot." }
    $backendSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $backends = @(Get-CimInstance Win32_Process -Filter "Name = 'AutoHotkey64.exe' Or Name = 'AutoHotkey.exe'" | Where-Object {
        $_.SessionId -eq $backendSessionId -and $_.CommandLine -and $_.CommandLine -match '(?i)FlowCellBackend\.ahk' -and $_.CommandLine.Contains('--headless')
    })
    if ($resolvedRole -eq 'installed') {
        $otherOwner = $backends | Where-Object {
            $_.CommandLine.Contains('--backend-role=installed') -and $_.CommandLine.IndexOf($backendScript, [StringComparison]::OrdinalIgnoreCase) -lt 0
        } | Select-Object -First 1
        if ($otherOwner) { throw "The installed background backend is already running from another installation (PID $($otherOwner.ProcessId)): $($otherOwner.CommandLine)" }
    }
    $owned = @($backends | Where-Object { $_.CommandLine.IndexOf($backendScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
    if ($Restart) {
        foreach ($ownedBackend in $owned) {
            $previousProcess = Get-Process -Id $ownedBackend.ProcessId -ErrorAction SilentlyContinue
            if (-not $previousProcess) { continue }
            try {
                # Open the wait handle before stopping; the old instance mutex
                # must be released before its replacement can acquire ownership.
                $null = $previousProcess.Handle
                try { Stop-Process -Id $ownedBackend.ProcessId -Force -ErrorAction Stop }
                catch {
                    $previousProcess.Refresh()
                    if (-not $previousProcess.HasExited) { throw }
                }
                if (-not $previousProcess.WaitForExit(5000)) { throw "Previous FlowCell backend did not stop (PID $($ownedBackend.ProcessId))." }
            } finally { $previousProcess.Dispose() }
        }
    }
    if (-not $Restart -and $owned.Count -gt 0) {
        $backendProcess = Get-Process -Id $owned[0].ProcessId -ErrorAction Stop
    } else {
        $backendProcess = Start-Process -FilePath $runtime -ArgumentList $descriptor.Arguments -WorkingDirectory (Split-Path -Parent $backendScript) -WindowStyle Hidden -PassThru
    }
    if (-not ('FlowCellBackendReady' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FlowCellBackendReady {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    public static bool IsReady(string title, int processId) {
        IntPtr window = FindWindow(null, title); uint owner;
        return window != IntPtr.Zero && GetWindowThreadProcessId(window, out owner) != 0 && owner == processId;
    }
}
'@
    }
    $receiverTitle = 'FlowCellBackendDirectScriptReceiver:' + $resolvedRole
    if ($resolvedRole -ne 'installed') { $receiverTitle += ':' + $FlowCellResourceRoot.TrimEnd('\').ToLowerInvariant() }
    $deadline = (Get-Date).AddSeconds(10)
    while (-not [FlowCellBackendReady]::IsReady($receiverTitle, $backendProcess.Id)) {
        $backendProcess.Refresh()
        if ($backendProcess.HasExited) { throw "FlowCell background backend exited before it was ready (exit $($backendProcess.ExitCode))." }
        if ((Get-Date) -ge $deadline) { throw 'FlowCell background backend did not become ready within 10 seconds. See backend logs.' }
        Start-Sleep -Milliseconds 100
    }
    if ($resolvedRole -eq 'installed') {
        $bindingStatusPath = Join-Path $FlowCellLocalRoot 'logs\backend-bindings-installed.json'
        if (-not (Test-Path -LiteralPath $bindingStatusPath -PathType Leaf)) {
            throw 'The installed background backend did not report binding registration status. Restart the updated backend.'
        }
        $bindingStatus = Get-Content -LiteralPath $bindingStatusPath -Raw | ConvertFrom-Json
        if (-not $bindingStatus -or -not $bindingStatus.PSObject.Properties['processId'] -or
            -not $bindingStatus.PSObject.Properties['registrationErrorCount'] -or
            -not $bindingStatus.PSObject.Properties['loadErrorCount'] -or
            [int]$bindingStatus.processId -ne $backendProcess.Id) {
            throw 'The installed background backend binding status is missing or stale. Restart the updated backend.'
        }
        if ([int]$bindingStatus.registrationErrorCount -gt 0 -or [int]$bindingStatus.loadErrorCount -gt 0) {
            throw "FlowCell background bindings failed to load or register ($($bindingStatus.loadErrorCount) load error(s), $($bindingStatus.registrationErrorCount) registration error(s)). See backend logs."
        }
    }
} catch {
    $launchFailure = $_
    $logRoot = Join-Path $FlowCellLocalRoot 'logs'
    [IO.Directory]::CreateDirectory($logRoot) | Out-Null
    Add-Content -LiteralPath (Join-Path $logRoot 'backend-launcher.log') -Value ("[{0}] {1}: {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $resolvedRole, $_.Exception.Message) -Encoding UTF8
    $toggleScript = Join-Path $FlowCellResourceRoot 'tools\autohotkey v2 on off\Toggle-AutoHotkey.ps1'
    if ($resolvedRole -eq 'installed' -and (Test-Path -LiteralPath $toggleScript -PathType Leaf)) {
        try { & $toggleScript -StatusOnly -Quiet -FailureMessage ("FlowCell startup failed: " + $launchFailure.Exception.Message) }
        catch { Write-Warning "Could not refresh AutoHotkey startup status: $($_.Exception.Message)" }
    }
    throw $launchFailure
} finally {
    if ($stateMutex) { Exit-FlowCellAutoHotkeyLock -Mutex $stateMutex }
}
$toggleScript = Join-Path $FlowCellResourceRoot 'tools\autohotkey v2 on off\Toggle-AutoHotkey.ps1'
if ($resolvedRole -eq 'installed' -and (Test-Path -LiteralPath $toggleScript -PathType Leaf)) { & $toggleScript -StatusOnly -Quiet }
