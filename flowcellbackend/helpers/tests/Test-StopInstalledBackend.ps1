<# Exact ownership and runtime-release fixtures only; no installed processes or files are changed. #>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'Stop-InstalledBackend.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell Stop Backend Tests ' + [guid]::NewGuid().ToString('N'))
$runtime = Join-Path $fixture 'flowcellbackend\runtime\AutoHotkey64.exe'
$backend = Join-Path $fixture 'flowcellbackend\FlowCellBackend.ahk'
$fixtureSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
$global:StopBackendFixture = @{ Records=@(); Stopped=@(); Events=@(); WaitResult=$true; StopThrows=$false; Exited=$false; ReusedPid=$false; ReleaseOnSleep=$false; HeldStream=$null }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-CimInstance {
    param($ClassName, $Filter)
    if ($Filter -match '^ProcessId = (\d+)$') {
        $global:StopBackendFixture.Events += 'recheck'
        if ($global:StopBackendFixture.ReusedPid) { return New-Record ([int]$Matches[1]) $runtime 'unrelated process' }
        return $global:StopBackendFixture.Records | Where-Object { $_.ProcessId -eq [int]$Matches[1] }
    }
    return $global:StopBackendFixture.Records
}
function Get-Process {
    param([int]$Id, $ErrorAction)
    $process = [pscustomobject]@{ Id=$Id; HasExited=$false }
    $process | Add-Member ScriptProperty Handle { $global:StopBackendFixture.Events += 'handle'; return [IntPtr]::Zero }
    $process | Add-Member ScriptMethod Refresh { $this.HasExited=$global:StopBackendFixture.Exited }
    $process | Add-Member ScriptMethod WaitForExit { param($Milliseconds) $global:StopBackendFixture.Events += 'wait'; return $global:StopBackendFixture.WaitResult }
    $process | Add-Member ScriptMethod Dispose { $global:StopBackendFixture.Events += 'dispose' }
    return $process
}
function Stop-Process {
    param([int]$Id, [switch]$Force, $ErrorAction)
    $global:StopBackendFixture.Stopped += $Id
    $global:StopBackendFixture.Events += 'stop'
    if ($global:StopBackendFixture.StopThrows) { throw 'Fixture stop failure.' }
}
function Start-Sleep {
    param([int]$Milliseconds)
    if ($global:StopBackendFixture.ReleaseOnSleep) {
        $global:StopBackendFixture.ReleaseOnSleep=$false
        $global:StopBackendFixture.HeldStream.Dispose()
        $global:StopBackendFixture.HeldStream=$null
    }
    [Threading.Thread]::Sleep($Milliseconds)
}
function New-Record([int]$Id, [string]$Executable, $Command, [int]$Session=$fixtureSession) {
    return [pscustomobject]@{ ProcessId=$Id; ExecutablePath=$Executable; CommandLine=$Command; SessionId=$Session }
}
try {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $runtime)) | Out-Null
    [IO.File]::WriteAllText($runtime, 'fixture executable bytes: never executed')
    [IO.File]::WriteAllText((Join-Path $fixture 'flowcell-installed.json'), '{}')
    $expectedBytes=[IO.File]::ReadAllBytes($runtime)
    $ownedCommand='"'+$runtime+'" "'+$backend+'" --headless --direct-script-receiver'
    $global:StopBackendFixture.Records=@(
        (New-Record 41 $runtime $ownedCommand),
        (New-Record 42 $runtime $ownedCommand.ToUpperInvariant()),
        (New-Record 51 ($runtime+'.other') $ownedCommand),
        (New-Record 52 $runtime ('"'+$runtime+'" "'+$backend+'.backup" --headless')),
        (New-Record 53 $runtime ('"'+$runtime+'" "'+$backend+'" --headless-extra')),
        (New-Record 54 $runtime $null),
        (New-Record 55 $runtime $ownedCommand ($fixtureSession+1)),
        (New-Record 56 $runtime ('"'+$runtime+'" "'+(Join-Path $fixture 'Other.ahk')+'" --headless')),
        (New-Record 57 $runtime ('"'+$runtime+'" "'+(Join-Path $fixture 'Other.ahk')+'" "'+$backend+'" --headless')),
        (New-Record 58 $runtime ('"'+$runtime+'" "'+$backend+'" "other --headless text"'))
    )
    & $source -ResourceRoot $fixture
    Assert-True (($global:StopBackendFixture.Stopped -join ',') -eq '41,42') 'Only exact same-session runtime/script/headless tokens may be stopped.'
    Assert-True (($global:StopBackendFixture.Events -join ',') -eq 'handle,recheck,stop,wait,dispose,handle,recheck,stop,wait,dispose') 'Each stop must retain its handle, recheck ownership, wait for exit, then dispose.'
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($runtime)) -eq [Convert]::ToBase64String($expectedBytes)) 'Runtime probe must not alter or truncate executable bytes.'

    $global:StopBackendFixture.Records=@(New-Record 41 $runtime $ownedCommand)
    $global:StopBackendFixture.ReusedPid=$true
    $global:StopBackendFixture.Stopped=@()
    $global:StopBackendFixture.Events=@()
    $failure=''; try { & $source -ResourceRoot $fixture } catch { $failure=$_.Exception.Message }
    Assert-True ($failure -match 'ownership changed' -and $global:StopBackendFixture.Stopped.Count -eq 0) 'A reused unrelated PID must never be stopped.'
    Assert-True (($global:StopBackendFixture.Events -join ',') -eq 'handle,recheck,dispose') 'A rejected process handle must be released without Stop or Wait.'
    $global:StopBackendFixture.ReusedPid=$false
    $global:StopBackendFixture.WaitResult=$false
    $failure=''; try { & $source -ResourceRoot $fixture } catch { $failure=$_.Exception.Message }
    Assert-True ($failure -match 'did not stop') 'Termination timeout must abort installation.'
    $global:StopBackendFixture.WaitResult=$true
    $global:StopBackendFixture.StopThrows=$true
    $global:StopBackendFixture.Exited=$false
    $failure=''; try { & $source -ResourceRoot $fixture } catch { $failure=$_.Exception.Message }
    Assert-True ($failure -match 'Fixture stop failure') 'A still-live stop failure must not proceed.'
    $global:StopBackendFixture.Exited=$true
    & $source -ResourceRoot $fixture # Already-exited race is safe and still waited.

    # Load only the real file probe for short, deterministic lock fixtures.
    $tokens=$null; $parseErrors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
    Assert-True (-not $parseErrors) 'Helper must parse under the installer PowerShell host.'
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-FlowCellRuntimeReleased'},$false)
    . ([scriptblock]::Create($function.Extent.Text))
    $global:StopBackendFixture.HeldStream=[IO.File]::Open($runtime,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $global:StopBackendFixture.ReleaseOnSleep=$true
    Wait-FlowCellRuntimeReleased -Path $runtime -TimeoutMilliseconds 500
    Assert-True (-not $global:StopBackendFixture.ReleaseOnSleep) 'The real conflicting read handle must trigger a retry before succeeding.'

    $global:StopBackendFixture.HeldStream=[IO.File]::Open($runtime,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $failure=''; $timer=[Diagnostics.Stopwatch]::StartNew()
    # Exercise enough retries to enter Windows PowerShell 5.1's optimized loop.
    try { Wait-FlowCellRuntimeReleased -Path $runtime -TimeoutMilliseconds 2000 } catch { $failure=$_.Exception.Message }
    Assert-True ($failure -match 'still locked' -and $timer.ElapsedMilliseconds -ge 2000 -and $timer.ElapsedMilliseconds -lt 4000) 'A persistent runtime lock must remain a failure after repeated retries and stop within its deadline.'
    $global:StopBackendFixture.HeldStream.Dispose(); $global:StopBackendFixture.HeldStream=$null
    Wait-FlowCellRuntimeReleased -Path (Join-Path $fixture 'absent.exe') -TimeoutMilliseconds 100
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($runtime)) -eq [Convert]::ToBase64String($expectedBytes)) 'All lock retries must preserve runtime bytes.'
    Write-Output 'PASS: exact ownership exclusions, primary script/real headless tokens, retained handle/ownership recheck/stop/wait ordering, reused PID protection, termination timeout/failure, already-exited race, real lock retry/timeout, missing runtime and unchanged bytes. Process boundaries mocked; file locks real.'
} finally {
    if ($null -ne $global:StopBackendFixture.HeldStream) { $global:StopBackendFixture.HeldStream.Dispose() }
    $temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    $resolved=[IO.Path]::GetFullPath($fixture)
    if ($resolved.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('FlowCell Stop Backend Tests ')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
