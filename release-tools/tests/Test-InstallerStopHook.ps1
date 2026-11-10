<#
Purpose: Compile and run the real NSIS preinstall stop hook against disposable roots.
Inputs: Current installer-hooks.nsh and Stop-InstalledBackend.ps1; local NSIS compiler.
Writes: Only a unique temporary fixture tree. No registry, shortcuts or real installs.
Safety: Dummy runtime bytes are never executed; no process can belong to these roots.
The fixtures and compiler log are retained for inspection.
#>
[CmdletBinding()]
param(
    [string]$MakeNsis,
    [string]$FixtureParent = [IO.Path]::GetTempPath()
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $MakeNsis) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) { $MakeNsis = $command.Source }
    else { $MakeNsis = Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe' }
}
if (-not (Test-Path -LiteralPath $MakeNsis -PathType Leaf)) {
    throw 'NSIS compiler not found. Supply -MakeNsis with an existing makensis.exe.'
}
$fixture = Join-Path $FixtureParent ('FlowCell Installer Stop Hook ' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
$installer = Join-Path $fixture 'stop-hook-fixture.exe'
$scriptPath = Join-Path $fixture 'stop-hook-fixture.nsi'
$hook = Join-Path $repo 'release-tools\installer-hooks.nsh'
$script:checks = 0
function Assert-Hook([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
}
function Write-FixtureFile([string]$Path, [string]$Text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Invoke-Fixture([string]$InstallRoot) {
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$InstallRoot") -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(30000)) {
            $process.Kill()
            [void]$process.WaitForExit(5000)
            throw 'Task-owned NSIS fixture exceeded its 30-second limit.'
        }
        $process.Refresh()
        return $process.ExitCode
    } finally { $process.Dispose() }
}
function New-ExistingRoot([string]$Label, [switch]$WithoutMarker) {
    $root = Join-Path $fixture $Label
    if (-not $WithoutMarker) { Write-FixtureFile (Join-Path $root 'flowcell-installed.json') '{}' }
    Write-FixtureFile (Join-Path $root 'flowcellbackend\runtime\AutoHotkey64.exe') 'Task-owned dummy runtime; never execute.'
    Write-FixtureFile (Join-Path $root 'flowcellbackend\helpers\Stop-InstalledBackend.ps1') "throw 'Old installed helper must never be used by the new preinstall hook.'"
    return $root
}

# Single-quoted template preserves NSIS variables and macro syntax verbatim.
$nsi = @'
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "@@HOOK@@"
Name "FlowCell isolated stop-hook fixture"
OutFile "@@INSTALLER@@"
RequestExecutionLevel user
SilentInstall silent
InstallDir "@@DEFAULT@@"
Section
  !insertmacro NSIS_HOOK_PREINSTALL
  CreateDirectory "$INSTDIR"
  FileOpen $1 "$INSTDIR\after-hook.txt" w
  FileWrite $1 "Hook completed before application copy."
  FileClose $1
SectionEnd
'@
$nsi = $nsi.Replace('@@HOOK@@', $hook).Replace('@@INSTALLER@@', $installer).Replace('@@DEFAULT@@', (Join-Path $fixture 'default unused'))
Write-FixtureFile $scriptPath $nsi
$compileOutput = & $MakeNsis /V2 $scriptPath 2>&1
$compileExitCode = $LASTEXITCODE
$compileOutput | Set-Content -LiteralPath (Join-Path $fixture 'compile.log') -Encoding UTF8
if ($compileExitCode -ne 0) { throw "NSIS fixture compile failed: $($compileOutput -join [Environment]::NewLine)" }
Assert-Hook (Test-Path -LiteralPath $installer -PathType Leaf) 'real hook compiles into fixture installer'

$unlocked = New-ExistingRoot 'unlocked old installation'
$runtime = Join-Path $unlocked 'flowcellbackend\runtime\AutoHotkey64.exe'
$runtimeHash = (Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash
Assert-Hook ((Invoke-Fixture $unlocked) -eq 0) 'unlocked installation uses embedded current helper, not failing old installed helper'
Assert-Hook (Test-Path -LiteralPath (Join-Path $unlocked 'after-hook.txt')) 'unlocked installation reaches the application-copy boundary'
Assert-Hook (((Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash) -eq $runtimeHash) 'successful release check preserves runtime bytes'

$locked = New-ExistingRoot 'locked old installation'
$runtime = Join-Path $locked 'flowcellbackend\runtime\AutoHotkey64.exe'
$runtimeHash = (Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash
$held = [IO.File]::Open($runtime, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { $lockedExitCode = Invoke-Fixture $locked }
finally { $held.Dispose() }
Assert-Hook ($lockedExitCode -ne 0) 'persistent runtime lock returns a failing installer exit code'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $locked 'after-hook.txt'))) 'locked runtime aborts before application files are copied'
Assert-Hook (((Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash) -eq $runtimeHash) 'failed release check preserves runtime bytes'
Assert-Hook ((Invoke-Fixture $locked) -eq 0) 'the same installation succeeds after its lock is released'
Assert-Hook (Test-Path -LiteralPath (Join-Path $locked 'after-hook.txt')) 'retry after release reaches the copy boundary'

$fresh = Join-Path $fixture 'fresh empty installation'
Assert-Hook ((Invoke-Fixture $fresh) -eq 0) 'fresh installation skips stop helper without requiring an installed marker'
Assert-Hook (Test-Path -LiteralPath (Join-Path $fresh 'after-hook.txt')) 'fresh installation reaches application copy'

$unmarked = New-ExistingRoot 'unmarked existing runtime' -WithoutMarker
Assert-Hook ((Invoke-Fixture $unmarked) -ne 0) 'existing unmarked runtime fails closed'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $unmarked 'after-hook.txt'))) 'unmarked runtime failure is honored before application copy'

Write-Output "PASS: $script:checks real NSIS stop-hook checks. Fixture retained at $fixture"
