; Only verified active sources owned by a Startup panel run when the frontend
; is closed. Unknown, stale, or unowned bindings fail closed.
class FlowCellStartupShortcutPolicy {
    static SafePart(value) {
        return value != "" && value != "." && value != ".."
            && !RegExMatch(value, '[\\/:*?"<>|]')
    }

    static SafeRelative(value) {
        value := StrReplace(value, "/", "\")
        if value = "" || RegExMatch(value, '(^\\|:|(^|\\)\.\.?($|\\))')
            return false
        return true
    }

    static SamePhysicalPath(a, b) {
        try return StrLower(FlowCellBackendIdentity.PhysicalPath(a)) = StrLower(FlowCellBackendIdentity.PhysicalPath(b))
        catch
            return false
    }

    static IsStartupSource(scriptPath, programsRoot) {
        try {
            path := FlowCellBackendIdentity.NormalizeRoot(scriptPath)
            SplitPath path, , &sourceDir
            ; Source entry points may be nested beneath the owned source folder.
            Loop 16 {
                SplitPath sourceDir, &name, &parent
                if StrLower(name) = "source"
                    break
                if parent = "" || parent = sourceDir
                    return false
                sourceDir := parent
            }
            if StrLower(name) != "source"
                return false
            packageDir := parent
            installPath := packageDir "\flowcell.install.json"
            install := FileRead(installPath, "UTF-8")
            owner := JsonStringValue(install, "ownerButtonId")
            program := JsonStringValue(install, "programName")
            panel := JsonStringValue(install, "panelName")
            sourceRelative := JsonStringValue(install, "sourceRelativePath")
            if !RegExMatch(owner, '^[A-Za-z0-9_-]{1,128}$') || StrLower(program) != "windows"
                || StrLower(panel) != "startup" || !this.SafeRelative(sourceRelative)
                return false
            if JsonStringValue(install, "installId") != owner
                return false
            programRoot := FlowCellBackendIdentity.NormalizeRoot(programsRoot) "\" program
            manifest := FileRead(programRoot "\flowcell.program.json", "UTF-8")
            localFolder := JsonStringValue(manifest, "localScriptsFolder")
            panelsFolder := JsonStringValue(manifest, "panelsFolder")
            if !this.SafeRelative(localFolder) || !this.SafeRelative(panelsFolder)
                return false
            expectedPackage := programRoot "\" localFolder "\" owner
            if !this.SamePhysicalPath(packageDir, expectedPackage)
                || !this.SamePhysicalPath(path, expectedPackage "\" sourceRelative)
                return false
            activePath := programRoot "\" panelsFolder "\" panel "\" owner ".flowcell-source.json"
            active := FileRead(activePath, "UTF-8")
            if JsonStringValue(active, "ownerButtonId") != owner
                || JsonStringValue(active, "installId") != owner
                || StrLower(JsonStringValue(active, "programName")) != StrLower(program)
                || StrLower(JsonStringValue(active, "panelName")) != "startup"
                return false
            activeSource := JsonStringValue(active, "sourcePath")
            if !RegExMatch(activeSource, 'i)^(?:[A-Z]:\\|\\\\|\\\\\?\\)') {
                if !this.SafeRelative(activeSource)
                    return false
                activeSource := programRoot "\" activeSource
            }
            return this.SamePhysicalPath(path, activeSource)
        } catch {
            return false
        }
    }

    static NeedsFirstRunSetup(scriptPath, programsRoot, localRoot) {
        if !this.IsStartupSource(scriptPath, programsRoot)
            return false
        try {
            SplitPath scriptPath, &fileName, &dir
            Loop 16 {
                SplitPath dir, &name, &parent
                if StrLower(name) = "source"
                    break
                dir := parent
            }
            if StrLower(name) != "source"
                return false
            install := FileRead(parent "\flowcell.install.json", "UTF-8")
            owner := JsonStringValue(install, "ownerButtonId")
            program := JsonStringValue(install, "programName")
            programRoot := FlowCellBackendIdentity.NormalizeRoot(programsRoot) "\" program
            manifest := FileRead(programRoot "\flowcell.program.json", "UTF-8")
            panels := JsonStringValue(manifest, "panelsFolder")
            active := FileRead(programRoot "\" panels "\Startup\" owner ".flowcell-source.json", "UTF-8")
            ; The Rust helper validates this declaration again before setup.
            ; Skip complete JSON strings, including braces and escaped quotes
            ; inside argument values, before looking for the firstRun field.
            if !RegExMatch(active, 'is)"inputSetup"\s*:\s*\{(?:"(?:\\.|[^"\\])*"|[^"{}])*?"firstRun"\s*:\s*true')
                return false
            cache := RTrim(localRoot, "\/") "\button-inputs\" owner ".json"
            if !FileExist(cache)
                return true
            if !RegExMatch(FileRead(cache, "UTF-8"), 'i)"configured"\s*:\s*true')
                return true
            if StrLower(fileName) = "screenshots.vbs" || StrLower(fileName) = "temp_shots.vbs"
                return FlowCellTempShotsSettings.ReadFolder(scriptPath, localRoot) = ""
        } catch {
            ; A broken verified Startup source should go through the canonical
            ; helper, which can report a precise actionable error.
            return true
        }
        return false
    }

    ; Scope button input environment to process creation; restore it before wait.
    static StartProcessWithInputs(command, cache, &processHandle, &childPid, workingDir := "") {
        oldPath := EnvGet("FLOWCELL_BUTTON_INPUTS_PATH")
        oldJson := EnvGet("FLOWCELL_BUTTON_INPUTS_JSON")
        inputJson := FileExist(cache) ? FileRead(cache, "UTF-8") : '{"configured":false}'
        wasCritical := A_IsCritical
        Critical "On"
        try {
            EnvSet "FLOWCELL_BUTTON_INPUTS_PATH", cache
            EnvSet "FLOWCELL_BUTTON_INPUTS_JSON", inputJson
            commandBuffer := Buffer((StrLen(command) + 1) * 2, 0)
            StrPut(command, commandBuffer, "UTF-16")
            startupInfo := Buffer(A_PtrSize = 8 ? 104 : 68, 0)
            NumPut("UInt", startupInfo.Size, startupInfo)
            processInfo := Buffer(A_PtrSize * 2 + 8, 0)
            if !DllCall("CreateProcessW", "Ptr", 0, "Ptr", commandBuffer,
                "Ptr", 0, "Ptr", 0, "Int", false, "UInt", 0x08000000,
                "Ptr", 0, "Ptr", workingDir = "" ? 0 : StrPtr(workingDir), "Ptr", startupInfo, "Ptr", processInfo)
                throw Error("The Startup script could not be started.", , A_LastError)
            processHandle := NumGet(processInfo, 0, "Ptr")
            childPid := NumGet(processInfo, A_PtrSize * 2, "UInt")
            DllCall("CloseHandle", "Ptr", NumGet(processInfo, A_PtrSize, "Ptr"))
        } finally {
            EnvSet "FLOWCELL_BUTTON_INPUTS_PATH", oldPath
            EnvSet "FLOWCELL_BUTTON_INPUTS_JSON", oldJson
            Critical wasCritical
        }
    }

    static WaitForProcess(processHandle, childPid) {
        try {
            ProcessWaitClose childPid
            exitCode := 0
            if !DllCall("GetExitCodeProcess", "Ptr", processHandle, "UInt*", &exitCode)
                throw Error("The Startup script exit status could not be read.", , A_LastError)
            return exitCode
        } finally DllCall("CloseHandle", "Ptr", processHandle)
    }

    static InputCache(scriptPath, programsRoot, localRoot) {
        if !this.IsStartupSource(scriptPath, programsRoot)
            return ""
        SplitPath scriptPath, , &dir
        Loop 16 {
            SplitPath dir, &name, &parent
            if StrLower(name) = "source"
                break
            dir := parent
        }
        install := FileRead(parent "\flowcell.install.json", "UTF-8")
        owner := JsonStringValue(install, "ownerButtonId")
        cache := RTrim(localRoot, "\/") "\button-inputs\" owner ".json"
        return FileExist(cache) ? cache : ""
    }

    static FrontendOpen(resourceRoot) {
        try {
            expected := resourceRoot "\flowcell_frontend.exe"
            for hwnd in WinGetList("ahk_exe flowcell_frontend.exe") {
                window := "ahk_id " hwnd
                if WinGetTitle(window) = "FlowCell" && DllCall("user32\IsWindowVisible", "ptr", hwnd, "int")
                    && this.SamePhysicalPath(WinGetProcessPath(window), expected)
                    return true
            }
        } catch {
        }
        return false
    }

    static IsStartupMacro(macroPath, macrosRoot, programsRoot, actionId) {
        try {
            actual := StrLower(FlowCellBackendIdentity.PhysicalPath(macroPath))
            root := StrLower(FlowCellBackendIdentity.PhysicalPath(macrosRoot)) "\"
            if InStr(actual, root) != 1
                return false
            ; Read UTF-8 using the same parser as saved macros: Windows INI
            ; APIs do not reliably understand UTF-8 macro files.
            raw := FileRead(macroPath, "UTF-8")
            section := ""
            values := Map()
            for line in StrSplit(StrReplace(raw, "`r"), "`n") {
                line := Trim(line, " `t" Chr(0xFEFF))
                if RegExMatch(line, '^\[([^\]]+)\]$', &match) {
                    section := StrLower(match[1])
                    continue
                }
                equal := InStr(line, "=")
                if section = "action" && equal
                    values[StrLower(Trim(SubStr(line, 1, equal - 1)))] := Trim(SubStr(line, equal + 1))
            }
            if !values.Has("id") || StrLower(values["id"]) != StrLower(actionId)
                return false
            if !values.Has("owner") || StrLower(values["owner"]) != "flowcell_frontend"
                return false
            program := values.Has("programname") ? values["programname"] : ""
            panel := values.Has("panelname") ? values["panelname"] : ""
            if StrLower(program) != "windows" || StrLower(panel) != "startup"
                return false
            programRoot := FlowCellBackendIdentity.NormalizeRoot(programsRoot) "\" program
            manifest := FileRead(programRoot "\flowcell.program.json", "UTF-8")
            panels := JsonStringValue(manifest, "panelsFolder")
            return this.SafeRelative(panels) && DirExist(programRoot "\" panels "\Startup")
        } catch {
            return false
        }
    }
}
