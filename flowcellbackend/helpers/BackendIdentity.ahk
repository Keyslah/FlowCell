; Production owns the user's shortcuts; development has its own receiver only.
class FlowCellBackendIdentity {
    static NormalizeRoot(root) {
        root := StrReplace(Trim(root), "/", "\")
        if StrLower(SubStr(root, 1, 8)) = "\\?\unc\"
            root := "\\" SubStr(root, 9)
        else if SubStr(root, 1, 4) = "\\?\"
            root := SubStr(root, 5)
        return RTrim(root, "\")
    }

    static ReceiverTitle(role, resourceRoot) {
        title := "FlowCellBackendDirectScriptReceiver:" role
        return role = "installed" ? title : title ":" StrLower(this.NormalizeRoot(resourceRoot))
    }

    static PhysicalPath(path) {
        handle := DllCall("CreateFileW", "Str", path, "UInt", 0, "UInt", 7,
            "Ptr", 0, "UInt", 3, "UInt", 0x02000000, "Ptr", 0, "Ptr")
        if handle = -1
            throw Error("Cannot resolve FlowCell data path.", , path)
        try {
            pathBuffer := Buffer(32768 * 2)
            length := DllCall("GetFinalPathNameByHandleW", "Ptr", handle, "Ptr", pathBuffer,
                "UInt", 32768, "UInt", 0, "UInt")
            if !length || length >= 32768
                throw Error("Cannot resolve physical FlowCell data path.", , path)
            return this.NormalizeRoot(StrGet(pathBuffer, length, "UTF-16"))
        } finally {
            DllCall("CloseHandle", "Ptr", handle)
        }
    }

    static LocalRoot(localRoot) {
        state := localRoot "\button-system\button-state.json"
        if FileExist(state) {
            state := this.PhysicalPath(state)
            SplitPath state, , &stateDirectory
            SplitPath stateDirectory, , &localRoot
        } else if DirExist(localRoot) {
            localRoot := this.PhysicalPath(localRoot)
        }
        return this.NormalizeRoot(localRoot)
    }

    static MutexName(role, resourceRoot) {
        return role = "installed" ? "Local\FlowCellInstalledBackend"
            : "Local\FlowCellDevelopmentBackend_" StrReplace(StrLower(this.NormalizeRoot(resourceRoot)), "\", "|")
    }

    static Acquire(role, resourceRoot) {
        handle := DllCall("CreateMutexW", "Ptr", 0, "Int", true,
            "Str", this.MutexName(role, resourceRoot), "Ptr")
        errorCode := A_LastError
        if !handle
            throw Error("Cannot establish FlowCell backend ownership.", , errorCode)
        if errorCode = 183 {
            DllCall("CloseHandle", "Ptr", handle)
            return 0
        }
        return FlowCellBackendInstanceGuard(handle)
    }

    static RebaseProgramPath(path, programsRoot) {
        path := StrReplace(Trim(path), "/", "\")
        ; Rebind old FlowCell package roots, never arbitrary external scripts.
        if RegExMatch(path, "i)\\FlowCell\\local\\Programs\\(.+)$", &match) {
            candidate := this.NormalizeRoot(programsRoot) "\" match[1]
            if FileExist(candidate)
                return candidate
        }
        return path
    }
}

class FlowCellBackendInstanceGuard {
    __New(handle) {
        this.handle := handle
        OnExit ObjBindMethod(this, "Close")
    }

    Close(*) {
        if this.handle {
            DllCall("ReleaseMutex", "Ptr", this.handle)
            DllCall("CloseHandle", "Ptr", this.handle)
            this.handle := 0
        }
    }
}
