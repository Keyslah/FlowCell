#Requires AutoHotkey v2.0
#SingleInstance Off
#Include ..\BackendIdentity.ahk

Assert(condition, message) {
    if !condition
        throw Error(message)
    global assertions
    assertions += 1
}

assertions := 0
testRoot := A_Args[1]
try {
    Assert(FlowCellBackendIdentity.ReceiverTitle("installed", "C:\one") = FlowCellBackendIdentity.ReceiverTitle("installed", "D:\two"), "Installed ownership must be independent of checkout path.")
    one := FlowCellBackendIdentity.ReceiverTitle("development", "C:\one")
    two := FlowCellBackendIdentity.ReceiverTitle("development", "D:\two")
    Assert(one != two, "Development receivers must identify their resources.")
    Assert(one != FlowCellBackendIdentity.ReceiverTitle("installed", "C:\one"), "Development cannot address production.")
    Assert(one = FlowCellBackendIdentity.ReceiverTitle("development", "\\?\C:/ONE/"), "Physical path spellings must use one receiver identity.")
    lease := FlowCellBackendIdentity.Acquire("development", testRoot)
    Assert(IsObject(lease), "First owner could not acquire its mutex.")
    Assert(!FlowCellBackendIdentity.Acquire("development", testRoot), "A second owner was permitted.")
    other := FlowCellBackendIdentity.Acquire("development", testRoot "\other")
    Assert(IsObject(other), "Independent development roots cannot coexist.")
    other.Close()
    lease.Close()
    renewed := FlowCellBackendIdentity.Acquire("development", testRoot)
    Assert(IsObject(renewed), "Ownership was not released on shutdown.")
    renewed.Close()
    Assert(FlowCellBackendIdentity.LocalRoot(testRoot) = testRoot, "Existing data root did not resolve to its physical directory.")
    owner := testRoot "\physical-owner"
    overlay := testRoot "\overlay"
    DirCreate owner "\button-system"
    DirCreate overlay
    FileAppend "{}", owner "\button-system\button-state.json"
    exitCode := RunWait(A_ComSpec ' /d /c mklink /J "' overlay '\button-system" "' owner '\button-system"', , "Hide")
    Assert(exitCode = 0, "Could not create disposable redirected-state fixture.")
    Assert(FlowCellBackendIdentity.LocalRoot(overlay) = owner, "Backend disagrees with frontend about redirected Button-state ownership.")
    packageRoot := testRoot "\Programs"
    DirCreate packageRoot "\Windows\Windows Local Scripts\owner\source"
    current := packageRoot "\Windows\Windows Local Scripts\owner\source\Temp_Shots.vbs"
    FileAppend "fixture", current
    old := "C:\Users\fixture\AppData\Roaming\FlowCell\local\Programs\Windows\Windows Local Scripts\owner\source\Temp_Shots.vbs"
    Assert(FlowCellBackendIdentity.RebaseProgramPath(old, packageRoot) = current, "An old AppData alias was not resolved against owned Programs.")
    external := "C:\External\Programs\Windows\other.vbs"
    Assert(FlowCellBackendIdentity.RebaseProgramPath(external, packageRoot) = external, "An external script was rebound.")
    missing := "C:\Users\fixture\AppData\Roaming\FlowCell\local\Programs\Windows\missing.vbs"
    Assert(FlowCellBackendIdentity.RebaseProgramPath(missing, packageRoot) = missing, "Missing scripts were guessed.")
    FileAppend "Backend identity checks passed: " assertions " assertions`n", "*"
    ExitApp(0)
} catch as err {
    FileAppend err.Message " | " err.What " | " err.Line "`n", "*"
    ExitApp(1)
}
