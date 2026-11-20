#Requires AutoHotkey v2.0
#SingleInstance Off
#Include ..\JsonStringValues.ahk
#Include ..\BackendIdentity.ahk
#Include ..\TempShotsSettings.ahk
#Include ..\StartupShortcutPolicy.ahk

Assert(value, message) {
    if !value
        throw Error(message)
    global assertions
    assertions += 1
}

assertions := 0
root := A_Args[1] "\Programs"
program := root "\Windows"
owner := "button-test-startup"
package := program "\Local Scripts\" owner
source := package "\source\Screenshots.vbs"
active := program "\Panels\Startup\" owner ".flowcell-source.json"
try {
    DirCreate package "\source"
    DirCreate program "\Panels\Startup"
    FileAppend "fixture", source
    FileAppend '{"programId":"windows","localScriptsFolder":"Local Scripts","panelsFolder":"Panels"}', program "\flowcell.program.json", "UTF-8"
    FileAppend '{"ownerButtonId":"' owner '","installId":"' owner '","programName":"Windows","panelName":"Startup","sourceRelativePath":"source\\Screenshots.vbs"}', package "\flowcell.install.json", "UTF-8"
    FileAppend '{"ownerButtonId":"' owner '","installId":"' owner '","programName":"Windows","panelName":"Startup","sourcePath":"Local Scripts\\' owner '\\source\\Screenshots.vbs","inputSetup":{"arguments":["{\"firstRun\":true}"],"firstRun":true,"source":"Configure-Inputs.ps1"}}', active, "UTF-8"
    Assert(FlowCellStartupShortcutPolicy.IsStartupSource(source, root), "Verified Startup source must work while frontend is closed.")
    localRoot := A_Args[1] "\local"
    DirCreate localRoot "\button-inputs"
    cache := localRoot "\button-inputs\" owner ".json"
    Assert(FlowCellStartupShortcutPolicy.NeedsFirstRunSetup(source, root, localRoot), "Missing inputs did not request setup.")
    original := FileRead(active, "UTF-8")
    FileDelete active
    FileAppend StrReplace(original, '"firstRun":true', '"firstRun":false'), active, "UTF-8-RAW"
    Assert(!FlowCellStartupShortcutPolicy.NeedsFirstRunSetup(source, root, localRoot), "Argument text must not enable first-run setup.")
    FileDelete active
    FileAppend original, active, "UTF-8-RAW"
    FileAppend '{"configured":false}', cache, "UTF-8"
    Assert(FlowCellStartupShortcutPolicy.NeedsFirstRunSetup(source, root, localRoot), "Disabled inputs did not request setup.")
    FileDelete cache
    FileAppend '{"configured":true,"values":{"folder":"' StrReplace(A_Args[1], "\", "\\") '"}}', cache, "UTF-8"
    Assert(!FlowCellStartupShortcutPolicy.NeedsFirstRunSetup(source, root, localRoot), "Configured destination should not request setup.")
    FileDelete cache
    FileAppend '{"configured":true,"values":{"folder":"C:\\missing-flowcell-test-folder"}}', cache, "UTF-8"
    Assert(FlowCellStartupShortcutPolicy.NeedsFirstRunSetup(source, root, localRoot), "Missing destination did not request setup.")
    Assert(FlowCellStartupShortcutPolicy.IsStartupSource(StrUpper(source), root), "Windows path matching must ignore case.")
    blender := root "\Blender"
    otherPackage := blender "\Local Scripts\" owner
    otherSource := otherPackage "\source\Screenshots.vbs"
    DirCreate otherPackage "\source"
    DirCreate blender "\Panels\Startup"
    FileAppend "fixture", otherSource
    FileAppend '{"programId":"blender","localScriptsFolder":"Local Scripts","panelsFolder":"Panels"}', blender "\flowcell.program.json", "UTF-8"
    FileAppend '{"ownerButtonId":"' owner '","installId":"' owner '","programName":"Blender","panelName":"Startup","sourceRelativePath":"source\\Screenshots.vbs"}', otherPackage "\flowcell.install.json", "UTF-8"
    FileAppend '{"ownerButtonId":"' owner '","installId":"' owner '","programName":"Blender","panelName":"Startup","sourcePath":"Local Scripts\\' owner '\\source\\Screenshots.vbs","inputSetup":{"firstRun":true}}', blender "\Panels\Startup\" owner ".flowcell-source.json", "UTF-8"
    Assert(!FlowCellStartupShortcutPolicy.IsStartupSource(otherSource, root), "A non-Windows Startup source must not run while frontend is closed.")
    Assert(!FlowCellStartupShortcutPolicy.NeedsFirstRunSetup(otherSource, root, localRoot), "A non-Windows Startup source must not trigger background setup.")
    Assert(!FlowCellStartupShortcutPolicy.IsStartupSource(source, root "-wrong"), "A source outside the trusted program root was accepted.")
    other := package "\source\other.vbs"
    FileAppend "fixture", other
    Assert(!FlowCellStartupShortcutPolicy.IsStartupSource(other, root), "A different package entry point was accepted.")
    FileDelete active
    Assert(!FlowCellStartupShortcutPolicy.IsStartupSource(source, root), "A missing active source record was accepted.")
    FileAppend '{"ownerButtonId":"' owner '","installId":"' owner '","programName":"Windows","panelName":"Utility","sourcePath":"Local Scripts\\' owner '\\source\\Screenshots.vbs"}', active, "UTF-8"
    Assert(!FlowCellStartupShortcutPolicy.IsStartupSource(source, root), "A non-Startup record was accepted.")
    macros := A_Args[1] "\recorded_actions"
    DirCreate macros
    macro := macros "\test.ini"
    FileAppend "[Action]`nId=test-id`nOwner=flowcell_frontend`nProgramName=Windows`nPanelName=Startup`n", macro, "UTF-8"
    Assert(FlowCellStartupShortcutPolicy.IsStartupMacro(macro, macros, root, "test-id"), "A Startup-owned macro was rejected.")
    Assert(!FlowCellStartupShortcutPolicy.IsStartupMacro(macro, macros, root, "another-id"), "A different macro ID was accepted.")
    FileDelete macro
    FileAppend "[Action]`nId=test-id`nOwner=flowcell_frontend`nProgramName=Blender`nPanelName=Startup`n", macro, "UTF-8"
    Assert(!FlowCellStartupShortcutPolicy.IsStartupMacro(macro, macros, root, "test-id"), "A non-Windows Startup macro must not run while frontend is closed.")
    FileDelete macro
    FileAppend "[Action]`nId=test-id`nOwner=flowcell_frontend`nProgramName=Windows`nPanelName=Utility`n", macro, "UTF-8"
    Assert(!FlowCellStartupShortcutPolicy.IsStartupMacro(macro, macros, root, "test-id"), "A Utility macro was accepted while frontend is closed.")
    FileAppend "Startup shortcut policy checks passed: " assertions " assertions`n", "*"
    ExitApp(0)
} catch as err {
    FileAppend err.Message " | " err.What " | " err.Line "`n", "*"
    ExitApp(1)
}
