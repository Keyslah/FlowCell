<#
Purpose: Release this installation's bundled runtime before NSIS upgrades/uninstalls it.
Context: Invoked by NSIS with its exact ResourceRoot; no other backend is targeted.
Inputs: ResourceRoot. Changes: Stops matching headless backend processes and waits for runtime release.
Deletion/conflicts: No files or user state removed. Unrelated processes are preserved.
Constraints: Requires an installed marker and exact executable/script path ownership.
#>
param([Parameter(Mandatory=$true)][string]$ResourceRoot)
$ErrorActionPreference='Stop'

function Wait-FlowCellRuntimeReleased {
    param([string]$Path, [int]$TimeoutMilliseconds = 5000)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $stream = $null
        $released = $false
        $lockError = $null
        try {
            # Open never truncates or writes. Exclusive write access also proves
            # Windows has released the terminated process's executable mapping.
            $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $released = $true
        } catch {
            # Classify the underlying exception explicitly. Windows PowerShell
            # 5.1's optimized repeated typed catches can select the wrong branch.
            $exception = $_.Exception.GetBaseException()
            if (($exception -is [IO.FileNotFoundException] -or
                 $exception -is [IO.DirectoryNotFoundException]) -and
                -not [IO.File]::Exists($Path)) {
                $released = $true # An incomplete installation may not have a runtime yet.
            } elseif ($exception -is [IO.IOException]) {
                $lockError = $exception.Message
            } else {
                throw
            }
        } finally {
            if ($null -ne $stream) { $stream.Dispose() }
        }
        # Only explicit success after handle cleanup allows file replacement.
        if ($released) { return }
        if ($timer.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
            throw "FlowCell runtime is still locked; installation cannot continue: $Path. $lockError"
        }
        Start-Sleep -Milliseconds 100
    }
}

$root=[IO.Path]::GetFullPath($ResourceRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root 'flowcell-installed.json'))) { throw 'Not an installed FlowCell resource root.' }
$runtime=Join-Path $root 'flowcellbackend\runtime\AutoHotkey64.exe'
$backend=Join-Path $root 'flowcellbackend\FlowCellBackend.ahk'
$backendSessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
# Start-FlowCellBackend supplies the backend script first, then --headless.
# A path merely passed as data to another AHK script is not our backend.
$ownedArguments = '(?i)^\s*"?' + [regex]::Escape($runtime) + '"?\s+"?' +
    [regex]::Escape($backend) + '"?\s+--headless(?=\s|$)'
function Test-FlowCellBackendOwnership {
    param($Process)
    return $null -ne $Process -and $Process.SessionId -eq $backendSessionId -and
        $Process.ExecutablePath -eq $runtime -and $Process.CommandLine -and
        $Process.CommandLine -match $ownedArguments
}
Get-CimInstance Win32_Process -Filter "Name = 'AutoHotkey64.exe'" | Where-Object {
    Test-FlowCellBackendOwnership $_
} | ForEach-Object {
    $ownedId = $_.ProcessId
    $previousProcess = Get-Process -Id $ownedId -ErrorAction SilentlyContinue
    if ($previousProcess) {
        try {
            # Keep the original process handle across exit/PID reuse races.
            $null = $previousProcess.Handle
            # The PID could have changed owners between enumeration and opening
            # the handle. Recheck it while the retained handle prevents reuse.
            $confirmed = Get-CimInstance Win32_Process -Filter "ProcessId = $ownedId"
            if (-not (Test-FlowCellBackendOwnership $confirmed)) {
                $previousProcess.Refresh()
                if ($previousProcess.HasExited) { return }
                throw "FlowCell backend ownership changed before shutdown (PID $ownedId); no process was stopped."
            }
            try { Stop-Process -Id $ownedId -Force -ErrorAction Stop }
            catch {
                $previousProcess.Refresh()
                if (-not $previousProcess.HasExited) { throw }
            }
            if (-not $previousProcess.WaitForExit(5000)) {
                throw "Previous FlowCell backend did not stop (PID $ownedId)."
            }
        } finally { $previousProcess.Dispose() }
    }
}
Wait-FlowCellRuntimeReleased -Path $runtime
