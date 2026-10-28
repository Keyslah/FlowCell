#Requires AutoHotkey v2.0
#SingleInstance Off
#NoTrayIcon
#Warn All, StdOut
#Include ..\BackendIdentity.ahk
#Include ..\ProgramBindActions.ahk

; Only package parsing, temporary files, and mocked dispatch. No backend,
; UI Automation, application connection, or hotkey registration is started.
JsonStringValue(*) => ""
flowCellBindingsPath := ""
flowCellProgramsRoot := ""
assertions := 0
Assert(condition, message) {
    global assertions
    if !condition
        throw Error(message)
    assertions += 1
}
Reject(callback, message) {
    rejected := false
    try callback.Call()
    catch {
        rejected := true
    }
    Assert(rejected, message)
}
class FixtureApp {
    calls := 0
    response := "anchor set"
    RunBoundScript(source, label, id, program, preserveForeground) {
        Assert(preserveForeground, "Package actions must preserve the keypress foreground.")
        Assert(FileExist(source), "Dispatch did not use the validated package source.")
        this.calls += 1
        return { attempted: true, succeeded: true, method: "fixture_direct",
            returnValue: this.response, detail: "Return value: " this.response }
    }
}
class FixtureAction extends ProgramBindAction {
    IsForeground(*) => true
}

RunTests() {
try {
    root := A_Args[1]
    contents := ProgramBindActions.ReadDeclaration(A_Args[2])
    entries := ProgramBindActions.Parse(contents)
    Assert(entries.Length = 1, "The shipped action declaration did not parse.")
    Assert(entries[1].id = "illustrator_set_anchor", "The saved user action ID changed.")
    Assert(entries[1].fields["PassThrough"] = "1", "The package must retain native key delivery.")
    Reject(() => ProgramBindActions.Parse(contents "`nPassThrough=0`n"), "Duplicate action field was accepted.")
    Reject(() => ProgramBindActions.Parse(StrReplace(contents, "PassThrough=1", "PassThrough=yes")), "Invalid pass-through policy was accepted.")
    Reject(() => ProgramBindActions.Parse(StrReplace(contents, "SchemaVersion=1", "SchemaVersion=2")), "Unknown schema was accepted.")
    Reject(() => ProgramBindActions.ResolveFile(root, "../outside.jsx"), "Source traversal was accepted.")
    Reject(() => ProgramBindActions.ResolveFile(root, "C:/outside.jsx"), "Absolute source path was accepted.")
    Reject(() => ProgramBindActions.ResolveFile(root, "missing.jsx"), "Missing source was accepted.")

    DirCreate root "\HelperScripts"
    FileAppend "{}", root "\flowcell.program.json", "UTF-8-RAW"
    FileAppend contents, root "\HelperScripts\flowcell.bind-actions.ini", "UTF-8-RAW"
    source := root "\" StrReplace(entries[1].fields["Source"], "/", "\")
    FileAppend "fixture only; never executed", source, "UTF-8-RAW"
    invalid := Buffer(3, 0)
    NumPut("UChar", 65, invalid, 0)
    NumPut("UChar", 66, invalid, 2)
    fixtureHandle := FileOpen(root "\nul.ini", "w")
    fixtureHandle.RawWrite(invalid)
    fixtureHandle.Close()
    Reject(() => ProgramBindActions.ReadDeclaration(root "\nul.ini"), "NUL bytes were accepted.")

    app := FixtureApp()
    action := FixtureAction(app, {id: 7, label: "Fixture", processNames: ["fixture"]}, root,
        "HelperScripts/flowcell.bind-actions.ini", entries[1])
    result := action.Run("")
    Assert(app.calls = 1 && result.effectConfirmed, "Direct capture did not finish before returning its result.")
    Assert(action.PassThroughHotkey, "The runtime lost native key pass-through.")
    app.response := "no selection"
    result := action.Run("")
    Assert(app.calls = 2 && !result.effectConfirmed, "Delivery alone was reported as a successful capture.")
    Assert(InStr(result.detail, "no selection"), "The helper's no-selection diagnostic was lost.")
    Assert(result.note = entries[1].fields["FailureNote"], "The package's failure guidance was lost.")
    FileAppend "Program bind action checks passed: " assertions " assertions`n", "*"
    ExitApp(0)
} catch as err {
    FileAppend err.Message " | " err.What " | " err.Line "`n", "*"
    ExitApp(1)
}
}
RunTests()
