<#
Verify closed-program script requests in an isolated AHK fixture. No backend,
hotkeys, real application COM calls, or application launches are performed.
#>
[CmdletBinding()]
param([string]$Runtime)
$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = [IO.File]::ReadAllText((Join-Path $backend 'FlowCellBackend.ahk'))
if ($source -match 'IllustratorAutomationPrewarm|illustratorAutomationPrewarm|MarkIllustratorAutomationWarm') {
    throw 'The backend must not schedule Illustrator connection polling or keep-warm work.'
}
if ($source -match 'TryRunIllustratorScriptViaProcess|photoshop_launch_with_script_path') {
    throw 'Creative-app script execution must not fall back to an executable or file-association launch.'
}
if (-not $Runtime) {
    $Runtime = @(
        (Join-Path $backend 'runtime\AutoHotkey64.exe'),
        (Join-Path $backend 'local\bin\AutoHotkey64.exe'),
        (Join-Path $env:ProgramFiles 'AutoHotkey\v2\AutoHotkey64.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $Runtime) { throw 'An AutoHotkey v2 runtime is required for the attach-only tests.' }
$methods = foreach ($name in @('RunIllustratorScript', 'RunPhotoshopScript', 'RunGenericScript', 'FindConfiguredProgramWindow', 'ResolveConfiguredProgramExePath')) {
    $match = [regex]::Match($source, '(?ms)^    ' + $name + '\(.*?(?=^    [A-Za-z_]\w*\(|^\})')
    if (-not $match.Success) { throw "Could not extract $name for isolated execution." }
    $match.Value
}
$routerMethod = [regex]::Match($source, '(?ms)^    RunBoundScript\(.*?(?=^    [A-Za-z_]\w*\(|^\})').Value
if (-not $routerMethod) { throw 'Could not extract the registered program action router.' }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell program attach-only ' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
try {
    $scriptPath = Join-Path $fixture 'Test-ProgramAttachOnly.ahk'
    $fixtureSource = @'
#Requires AutoHotkey v2.0
#Warn All, StdOut
flowCellLastActionStatusPath := A_ScriptDir "\unused-fixture-status.txt"
NormalizeFlowCellProgramPath(path) {
    return path
}
ValueToText(value) {
    return value ""
}
class FlowCellAutoHotkeyState {
    static RunScriptAndWait(*) {
        throw Error("A closed-program action reached script launch.")
    }
}
class FixtureLogger {
    Info(*) {
    }
    Warn(*) {
    }
    Error(*) {
    }
}
class FixtureIllustrator {
    __New() {
        this.executed := 0
    }
    DoJavaScriptFile(*) {
        this.executed += 1
        return ""
    }
}
class FixtureApp {
    __New() {
        this.logger := FixtureLogger()
        this.stableWindow := 0
        this.illustrator := FixtureIllustrator()
        this.runningExecutables := Map()
        this.failCom := false
    }
    FindStableIllustratorWindow(*) {
        return this.stableWindow
    }
    GetIllustratorApplication(*) {
        if this.failCom
            throw Error("Fixture COM connection unavailable.")
        return this.illustrator
    }
    GetPhotoshopApplication(*) {
        throw Error("Closed Photoshop action reached COM.")
    }
    ReadFlowCellIllustratorScriptStatus() {
        return ""
    }
    FindProcessWindowByExecutable(executable) {
        return this.runningExecutables.Has(executable) ? this.runningExecutables[executable] : 0
    }
__METHODS__
}
class FixtureRouter {
    IsTempShotsScript(*) {
        return false
    }
    IsSnapshotsScript(*) {
        return false
    }
    GetProgramTabConfig(*) {
        return this.config
    }
    ResolveConfiguredProgramExePath(config) {
        return config.exePath
    }
    RunGenericScript(scriptPath, source, activateExe := "", methodPrefix := "generic", config := 0) {
        return {activateExe: activateExe, method: methodPrefix, config: config}
    }
    RunIllustratorScript(*) {
        return {method: "illustrator_active_com"}
    }
__ROUTER_METHOD__
}
try {
    probeApp := FixtureApp()
    config := {exePath: "fixture-do-not-launch.exe", label: "Example Editor", processNames: ["ExampleEditor", "ExampleEditorPreview"]}
    probeResult := probeApp.RunIllustratorScript(A_ScriptFullPath, "test action", config)
    if probeResult.attempted || probeResult.succeeded || probeResult.detail != "Open Illustrator to use this action."
        throw Error("Closed Illustrator was not rejected before COM execution.")
    probeResult := probeApp.RunPhotoshopScript(A_ScriptFullPath, "test action", config)
    if probeResult.attempted || probeResult.succeeded || probeResult.detail != "Open Photoshop to use this action."
        throw Error("Closed Photoshop was not rejected before COM execution.")
    probeResult := probeApp.RunGenericScript(A_ScriptFullPath, "test action", "", "generic", config)
    if probeResult.attempted || probeResult.succeeded || probeResult.detail != "Open Example Editor to use this action."
        throw Error("Closed configured editor was not rejected before script execution.")
    probeApp.runningExecutables["ExampleEditorPreview.exe"] := 17
    if probeApp.FindConfiguredProgramWindow(config) != 17
        throw Error("Registered process-name alternatives were not recognized.")
    probeApp.runningExecutables[config.exePath] := 18
    if probeApp.FindConfiguredProgramWindow(config) != 18
        throw Error("The registered executable was not recognized.")
    probeApp.stableWindow := 1
    probeResult := probeApp.RunIllustratorScript(A_ScriptFullPath, "test action", config, true)
    if !probeResult.attempted || !probeResult.succeeded || probeApp.illustrator.executed != 1
        throw Error("An already-open Illustrator action did not execute through the attached mock application.")
    probeApp.failCom := true
    probeResult := probeApp.RunIllustratorScript(A_ScriptFullPath, "test action", config, true)
    if probeResult.succeeded || !InStr(probeResult.detail, "COM failed:")
        throw Error("Unavailable Illustrator COM did not return failure without a launch fallback.")
    router := FixtureRouter()
    router.config := {label: "Example Editor", runMethod: "windows_generic", exePath: "closed-editor.exe", processNames: ["ExampleEditor"]}
    routeResult := router.RunBoundScript(A_ScriptFullPath, "explicit maintenance action", 1, "Example Editor")
    if routeResult.method != "windows_generic" || routeResult.activateExe != "" || routeResult.config != 0
        throw Error("Explicit Windows script actions unexpectedly require their catalog's host program.")
    router.config.runMethod := "generic"
    routeResult := router.RunBoundScript(A_ScriptFullPath, "host action", 1, "Example Editor")
    if routeResult.activateExe != "closed-editor.exe" || routeResult.config != router.config
        throw Error("The generic host action lost its configured target presence guard.")
    for runMode in ["illustrator", "illustrator_direct", "illustrator_process", "illustrator_automation"] {
        router.config.runMethod := runMode
        routeResult := router.RunBoundScript(A_ScriptFullPath, "host action", 1, "Illustrator")
        if routeResult.method != "illustrator_active_com"
            throw Error("An Illustrator mode bypassed active COM execution.")
    }
    FileAppend "PASS: closed Illustrator, Photoshop and configured generic editor requests stop before script execution.`n", "*"
    FileAppend "PASS: target detection uses registered executable and process-name alternatives.`n", "*"
    FileAppend "PASS: already-open action uses attached COM and COM failure has no launch fallback.`n", "*"
    FileAppend "PASS: all Illustrator modes attach; configured generic targets are retained; explicit Windows script actions remain independent.`n", "*"
    ExitApp(0)
} catch as fixtureError {
    FileAppend fixtureError.Message "`n", "**"
    ExitApp(1)
}
'@
    [IO.File]::WriteAllText($scriptPath, $fixtureSource.Replace('__METHODS__', ($methods -join "`r`n")).Replace('__ROUTER_METHOD__', $routerMethod))
    $stdout = Join-Path $fixture 'stdout.txt'
    $stderr = Join-Path $fixture 'stderr.txt'
    $process = Start-Process -FilePath $Runtime -ArgumentList @('/ErrorStdOut', ('"' + $scriptPath + '"')) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru
    Get-Content -LiteralPath $stdout,$stderr -TotalCount 40
    if ($process.ExitCode -ne 0) { throw "Program attach-only tests failed with exit code $($process.ExitCode)." }
    Write-Output 'PASS: no backend Illustrator polling or keep-warm timer remains.'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    if ($resolvedFixture.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
