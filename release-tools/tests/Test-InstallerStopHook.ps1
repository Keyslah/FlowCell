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
    Write-FixtureFile (Join-Path $root 'flowcell_frontend.exe') 'Task-owned dummy frontend; never execute.'
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

$lockedFrontend = New-ExistingRoot 'locked frontend old installation'
$frontend = Join-Path $lockedFrontend 'flowcell_frontend.exe'
$frontendHash = (Get-FileHash -LiteralPath $frontend -Algorithm SHA256).Hash
$held = [IO.File]::Open($frontend, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { $lockedExitCode = Invoke-Fixture $lockedFrontend }
finally { $held.Dispose() }
Assert-Hook ($lockedExitCode -ne 0) 'persistent frontend lock returns a failing installer exit code'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $lockedFrontend 'after-hook.txt'))) 'locked frontend aborts before application files or metadata are changed'
Assert-Hook (((Get-FileHash -LiteralPath $frontend -Algorithm SHA256).Hash) -eq $frontendHash) 'locked frontend preserves the existing executable'
Assert-Hook ((Invoke-Fixture $lockedFrontend) -eq 0) 'installation succeeds after the frontend lock is released'
Assert-Hook (Test-Path -LiteralPath (Join-Path $lockedFrontend 'after-hook.txt')) 'unlocked frontend retry reaches the copy boundary'

$fresh = Join-Path $fixture 'fresh empty installation'
Assert-Hook ((Invoke-Fixture $fresh) -eq 0) 'fresh installation skips stop helper without requiring an installed marker'
Assert-Hook (Test-Path -LiteralPath (Join-Path $fresh 'after-hook.txt')) 'fresh installation reaches application copy'

$unmarked = New-ExistingRoot 'unmarked existing runtime' -WithoutMarker
Assert-Hook ((Invoke-Fixture $unmarked) -ne 0) 'existing unmarked runtime fails closed'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $unmarked 'after-hook.txt'))) 'unmarked runtime failure is honored before application copy'

$unmarkedFrontend = Join-Path $fixture 'unmarked frontend-only installation'
Write-FixtureFile (Join-Path $unmarkedFrontend 'flowcell_frontend.exe') 'Task-owned dummy frontend; never execute.'
Assert-Hook ((Invoke-Fixture $unmarkedFrontend) -ne 0) 'existing unmarked frontend fails closed'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $unmarkedFrontend 'after-hook.txt'))) 'unmarked frontend failure is honored before application copy'

$template = [IO.File]::ReadAllText((Join-Path $repo 'release-tools\installer-tauri-2.11.1.nsi'))
$copyStart = $template.IndexOf('; Copy main executable')
$verifyCall = $template.IndexOf('!insertmacro NSIS_HOOK_VERIFY_PAYLOAD', $copyStart)
$associations = $template.IndexOf('; Create file associations', $copyStart)
$registry = $template.IndexOf('WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion"', $copyStart)
Assert-Hook ($copyStart -ge 0 -and $verifyCall -gt $copyStart -and $associations -gt $verifyCall -and $registry -gt $verifyCall) 'the pinned Tauri template verifies payload before associations and version metadata'
Assert-Hook (($template.Substring($copyStart, $verifyCall - $copyStart) -split '!insertmacro FlowCellAbortOnCopyFailure').Count -ge 5) 'main executable, resource directory, resource, and external binary copy steps fail closed'
$uninstallChoice = $template.IndexOf('reinst_uninstall:')
$oldRootRead = $template.IndexOf('ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""', $uninstallChoice)
$oldRootCheck = $template.IndexOf('!insertmacro FlowCellCheckExistingInstall "$4"', $oldRootRead)
$oldUninstaller = $template.IndexOf("ExecWait '`$R1' `$0", $oldRootCheck)
Assert-Hook ($oldRootRead -gt $uninstallChoice -and $oldRootCheck -gt $oldRootRead -and $oldUninstaller -gt $oldRootCheck) 'an uninstall-first NSIS upgrade preflights the old registered installation before invoking its uninstaller'
Assert-Hook ($template -match '(?s)For upgrades and downgrades, default to keeping the existing install\..*?\$\{Else\}\s+SendMessage \$R3 \$\{BM_SETCHECK\} \$\{BST_CHECKED\} 0') 'normal interactive upgrades default to retaining the previous installation'

# Compile the actual verification hook with known, disposable embedded binaries.
# The metadata marker represents the upstream registry/shortcut block that follows.
$expectedFrontend = Join-Path $fixture 'expected-frontend.exe'
$expectedRuntime = Join-Path $fixture 'expected-runtime.exe'
$poisonedVerifyHelper = Join-Path $fixture 'verify-without-filehash.ps1'
Write-FixtureFile $expectedFrontend 'expected frontend bytes'
Write-FixtureFile $expectedRuntime 'expected runtime bytes'
# A function that throws makes any accidental dependency on Get-FileHash fail,
# reproducing the NSIS PowerShell host where the cmdlet is unavailable.
$verifyHelper = [IO.File]::ReadAllText((Join-Path $repo 'release-tools\Verify-InstallerPayload.ps1'))
$verifyHelper = $verifyHelper.Replace('$ErrorActionPreference = ''Stop''', "function Get-FileHash { throw 'Get-FileHash is unavailable in this fixture.' }`r`n`$ErrorActionPreference = 'Stop'")
Write-FixtureFile $poisonedVerifyHelper $verifyHelper
$installer = Join-Path $fixture 'verify-hook-fixture.exe'
$verifyScript = Join-Path $fixture 'verify-hook-fixture.nsi'
$verifyNsi = @'
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!define MAINBINARYSRCPATH "@@FRONTEND@@"
!define FLOWCELL_RUNTIME_SOURCE "@@RUNTIME@@"
!define FLOWCELL_VERIFY_HELPER_SOURCE "@@VERIFYHELPER@@"
!include "@@HOOK@@"
Name "FlowCell isolated payload-verification fixture"
OutFile "@@INSTALLER@@"
RequestExecutionLevel user
SilentInstall silent
InstallDir "@@DEFAULT@@"
Section
  !insertmacro NSIS_HOOK_VERIFY_PAYLOAD
  FileOpen $1 "$INSTDIR\metadata-written.txt" w
  FileWrite $1 "Only after verifying critical bytes."
  FileClose $1
SectionEnd
'@
$verifyNsi = $verifyNsi.Replace('@@HOOK@@', $hook).Replace('@@INSTALLER@@', $installer).Replace('@@DEFAULT@@', (Join-Path $fixture 'verify default unused')).Replace('@@FRONTEND@@', $expectedFrontend).Replace('@@RUNTIME@@', $expectedRuntime).Replace('@@VERIFYHELPER@@', $poisonedVerifyHelper)
Write-FixtureFile $verifyScript $verifyNsi
$compileOutput = & $MakeNsis /V2 $verifyScript 2>&1
if ($LASTEXITCODE -ne 0) { throw "NSIS verification fixture compile failed: $($compileOutput -join [Environment]::NewLine)" }
function New-VerificationRoot([string]$Label, [string]$FrontendBytes, [string]$RuntimeBytes) {
    $root = Join-Path $fixture $Label
    Write-FixtureFile (Join-Path $root 'flowcell_frontend.exe') $FrontendBytes
    Write-FixtureFile (Join-Path $root 'flowcellbackend\runtime\AutoHotkey64.exe') $RuntimeBytes
    return $root
}
$matching = New-VerificationRoot 'matching payload' 'expected frontend bytes' 'expected runtime bytes'
Assert-Hook ((Invoke-Fixture $matching) -eq 0) 'matching payload passes real verification hook without Get-FileHash'
Assert-Hook (Test-Path -LiteralPath (Join-Path $matching 'metadata-written.txt')) 'matching payload reaches registration boundary'
$wrongFrontend = New-VerificationRoot 'wrong frontend payload' 'old frontend bytes' 'expected runtime bytes'
Assert-Hook ((Invoke-Fixture $wrongFrontend) -ne 0) 'old frontend bytes fail verification'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $wrongFrontend 'metadata-written.txt'))) 'frontend mismatch stops before registration'
$wrongRuntime = New-VerificationRoot 'wrong runtime payload' 'expected frontend bytes' 'old runtime bytes'
Assert-Hook ((Invoke-Fixture $wrongRuntime) -ne 0) 'old runtime bytes fail verification'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $wrongRuntime 'metadata-written.txt'))) 'runtime mismatch stops before registration'
$missing = Join-Path $fixture 'missing payload'
[void][IO.Directory]::CreateDirectory($missing)
Assert-Hook ((Invoke-Fixture $missing) -ne 0) 'missing payload fails verification'
Assert-Hook (-not (Test-Path -LiteralPath (Join-Path $missing 'metadata-written.txt'))) 'missing payload stops before registration'

Write-Output "PASS: $script:checks real NSIS stop-hook checks. Fixture retained at $fixture"
