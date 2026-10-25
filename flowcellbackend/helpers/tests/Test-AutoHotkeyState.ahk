#Requires AutoHotkey v2.0
#SingleInstance Off
#Include ..\AutoHotkeyState.ahk

; Isolated state and short-lived child fixtures: no hotkeys, backend, user
; preference, or UI. The fixture lock cannot block the live toggle.
class FixtureAutoHotkeyState extends FlowCellAutoHotkeyState {
    static StatePath() {
        global testRoot
        return testRoot "\state.json"
    }
    static MutexName() {
        return "Local\FlowCell.AutoHotkey.Test." DllCall("GetCurrentProcessId", "UInt")
    }
}

Assert(condition, message) {
    if !condition
        throw Error(message)
    global assertions
    assertions += 1
}

assertions := 0
try {
    testRoot := A_Args[1]
    expectedSession := A_Args[2]
    expectedMutex := A_Args[3]
    expectedStatePath := A_Args[4]
    Assert(FlowCellAutoHotkeyState.SessionId() = expectedSession, "AHK and PowerShell disagree about the Windows sign-in identity.")
    Assert(FlowCellAutoHotkeyState.MutexName() = expectedMutex, "AHK and PowerShell do not share the same per-user lock.")
    Assert(FlowCellAutoHotkeyState.StatePath() = expectedStatePath, "AHK and PowerShell disagree about the per-user state folder.")
    statePath := testRoot "\state.json"
    Assert(FlowCellAutoHotkeyState.Enabled(statePath, expectedSession), "Fresh users must start ON.")
    offJson := '{"sessionId":"' expectedSession '","enabled":false,"updatedAt":"2026-10-22T00:00:00Z"}'
    FileAppend offJson, statePath, "UTF-8-RAW"
    Assert(!FlowCellAutoHotkeyState.Enabled(statePath, expectedSession), "Current sign-in OFF must block launches.")
    Assert(FlowCellAutoHotkeyState.Enabled(statePath, "0000000000000000-0000000000000000"), "A new Windows sign-in must reset OFF to ON.")
    Assert(FlowCellAutoHotkeyState.EnabledFromJson(StrReplace(offJson, "false", "true"), expectedSession), "Current sign-in ON was not respected.")
    for invalidJson in ["", "{}", StrReplace(offJson, "false", '"false"'), SubStr(offJson, 1, -1), StrReplace(offJson, '"enabled":false', '"enabled":false,"enabled":true')] {
        rejected := false
        try FlowCellAutoHotkeyState.EnabledFromJson(invalidJson, expectedSession)
        catch
            rejected := true
        Assert(rejected, "Malformed preference did not fail closed.")
    }
    childScript := testRoot "\child fixture.ahk"
    childProof := testRoot "\child.txt"
    FileAppend '#Requires AutoHotkey v2.0`nFileAppend "ran", A_ScriptDir "\child.txt"`nExitApp 23', childScript, "UTF-8-RAW"
    blocked := false
    try FixtureAutoHotkeyState.RunScriptAndWait(childScript)
    catch as err
        blocked := InStr(err.Message, "AutoHotkey is OFF") > 0
    Assert(blocked && !FileExist(childProof), "OFF did not prevent the child AutoHotkey launch.")
    stateFile := FileOpen(statePath, "w", "UTF-8-RAW")
    stateFile.Write(StrReplace(offJson, "false", "true"))
    stateFile.Close()
    Assert(FixtureAutoHotkeyState.RunScriptAndWait(childScript) = 23, "Child script exit status was lost.")
    Assert(FileRead(childProof) = "ran", "The child script was not run exactly once.")
    ; The OFF path must release its lock, allowing the subsequent ON launch.
    FileAppend "AutoHotkey state checks passed: " assertions " assertions`n", "*"
    ExitApp(0)
} catch as err {
    FileAppend err.Message " | " err.What " | " err.Line "`n", "*"
    ExitApp(1)
}
