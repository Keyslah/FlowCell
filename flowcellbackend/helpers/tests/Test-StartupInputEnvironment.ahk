#Requires AutoHotkey v2.0
#SingleInstance Off
#Include ..\JsonStringValues.ahk
#Include ..\BackendIdentity.ahk
#Include ..\TempShotsSettings.ahk
#Include ..\StartupShortcutPolicy.ahk
#Include ..\AutoHotkeyState.ahk
OnError((err, mode) => (FileAppend(err.Message " " err.Line "`n", "**"), ExitApp(1)))

class FixtureAutoHotkeyState extends FlowCellAutoHotkeyState {
    static Enabled(*) => true
    static MutexName() => "Local\FlowCell.InputEnvironment.Test." DllCall("GetCurrentProcessId", "UInt")
}

if A_Args.Length = 1 {
    FileAppend EnvGet("FLOWCELL_BUTTON_INPUTS_PATH") "`n" EnvGet("FLOWCELL_BUTTON_INPUTS_JSON") "`n" A_WorkingDir, A_Args[1], "UTF-8"
    ExitApp 23
}

root := A_Temp "\flowcell-input-env-" A_TickCount
DirCreate root
EnvSet "FLOWCELL_BUTTON_INPUTS_PATH", "original-path"
EnvSet "FLOWCELL_BUTTON_INPUTS_JSON", "original-json"
Loop 2 {
    cache := root "\button-" A_Index ".json"
    output := root "\output-" A_Index ".txt"
    expected := '{"configured":true,"value":"' A_Index '"}'
    FileAppend expected, cache, "UTF-8-RAW"
    command := '"' A_AhkPath '" "' A_ScriptFullPath '" "' output '"'
    FlowCellStartupShortcutPolicy.StartProcessWithInputs(command, cache, &handle, &pid, root)
    if EnvGet("FLOWCELL_BUTTON_INPUTS_PATH") != "original-path" || EnvGet("FLOWCELL_BUTTON_INPUTS_JSON") != "original-json"
        throw Error("Button inputs leaked into the backend environment")
    if FlowCellStartupShortcutPolicy.WaitForProcess(handle, pid) != 23
        throw Error("Child exit status was lost")
    if FileRead(output, "UTF-8") != cache "`n" expected "`n" A_ScriptDir
        throw Error("Child received the wrong button inputs")
}
cwdOutput := root "\cwd-output.txt"
command := '"' A_ComSpec '" /d /c cd > "' cwdOutput '"'
FlowCellStartupShortcutPolicy.StartProcessWithInputs(command, cache, &handle, &pid, root)
if FlowCellStartupShortcutPolicy.WaitForProcess(handle, pid) != 0 || Trim(FileRead(cwdOutput), "`r`n") != root
    throw Error("Generic child received the wrong working directory")
child := root "\ahk-child.ahk"
output := root "\ahk-output.txt"
FileAppend '#Requires AutoHotkey v2.0`nFileAppend EnvGet("FLOWCELL_BUTTON_INPUTS_JSON") Chr(10) A_WorkingDir, "' output '"`nExitApp 19', child, "UTF-8-RAW"
if FixtureAutoHotkeyState.RunScriptAndWait(child, cache, ObjBindMethod(FlowCellStartupShortcutPolicy, "StartProcessWithInputs")) != 19
    throw Error("AutoHotkey child exit status was lost")
if FileRead(output, "UTF-8") != expected "`n" root
    throw Error("AutoHotkey child received the wrong inputs")
if EnvGet("FLOWCELL_BUTTON_INPUTS_JSON") != "original-json"
    throw Error("AutoHotkey child inputs leaked into the backend")
FileAppend "PASS: isolated button environments and exit status`n", "*"
DirDelete root, 1
