; The same per-user, Windows-logon preference used by AutoHotkeyState.ps1.
; Status presentation never writes this preference. Missing/new sessions are ON.
class FlowCellAutoHotkeyState {
    static StatePath() {
        localAppData := Buffer(260 * 2, 0)
        if DllCall("shell32\SHGetFolderPathW", "Ptr", 0, "Int", 0x1c, "Ptr", 0,
            "UInt", 0, "Ptr", localAppData, "Int")
            throw Error("The current user's local application data folder could not be resolved.")
        return StrGet(localAppData, "UTF-16") "\FlowCell\autohotkey-toggle\AutoHotkeySessionState-" this.SessionId() ".json"
    }

    static Token() {
        token := 0
        if !DllCall("advapi32\OpenProcessToken", "Ptr", DllCall("GetCurrentProcess", "Ptr"),
            "UInt", 0x0008, "Ptr*", &token)
            throw Error("Windows logon token could not be read.", , A_LastError)
        return token
    }

    static SessionId() {
        static sessionId := ""
        if sessionId != ""
            return sessionId
        token := this.Token()
        try {
            statistics := Buffer(64, 0)
            needed := 0
            if !DllCall("advapi32\GetTokenInformation", "Ptr", token, "Int", 10,
                "Ptr", statistics, "UInt", statistics.Size, "UInt*", &needed)
                throw Error("Windows logon statistics could not be read.", , A_LastError)
            luid := Buffer(8, 0)
            low := NumGet(statistics, 8, "UInt")
            high := NumGet(statistics, 12, "UInt")
            NumPut("UInt", low, "UInt", high, luid)
            data := 0
            status := DllCall("secur32\LsaGetLogonSessionData", "Ptr", luid, "Ptr*", &data, "UInt")
            if status || !data
                throw Error("Windows logon session could not be read.", , status)
            try {
                ; SECURITY_LOGON_SESSION_DATA uses pointer-aligned LSA_UNICODE_STRINGs.
                logonTime := NumGet(data, A_PtrSize = 8 ? 80 : 48, "Int64")
                sessionId := Format("{:08X}{:08X}-{:016X}", high, low, logonTime)
            } finally {
                DllCall("secur32\LsaFreeReturnBuffer", "Ptr", data)
            }
        } finally {
            DllCall("CloseHandle", "Ptr", token)
        }
        return sessionId
    }

    static MutexName() {
        static mutexName := ""
        if mutexName != ""
            return mutexName
        token := this.Token()
        try {
            needed := 0
            DllCall("advapi32\GetTokenInformation", "Ptr", token, "Int", 1,
                "Ptr", 0, "UInt", 0, "UInt*", &needed)
            user := Buffer(needed, 0)
            if !DllCall("advapi32\GetTokenInformation", "Ptr", token, "Int", 1,
                "Ptr", user, "UInt", user.Size, "UInt*", &needed)
                throw Error("Windows user identity could not be read.", , A_LastError)
            sidText := 0
            if !DllCall("advapi32\ConvertSidToStringSidW", "Ptr", NumGet(user, 0, "Ptr"), "Ptr*", &sidText)
                throw Error("Windows user SID could not be read.", , A_LastError)
            try mutexName := "Local\FlowCell.AutoHotkey." StrGet(sidText, "UTF-16")
            finally DllCall("LocalFree", "Ptr", sidText)
        } finally {
            DllCall("CloseHandle", "Ptr", token)
        }
        return mutexName
    }

    static EnabledFromJson(raw, sessionId) {
        ; The writer emits exactly these fields. Strict parsing fails closed on a
        ; partial write, unknown format, duplicate keys, or non-boolean preference.
        pattern := '^\s*\{\s*"sessionId"\s*:\s*"([0-9A-Fa-f]{16}-[0-9A-Fa-f]{16})"\s*,'
            . '\s*"enabled"\s*:\s*(true|false)\s*,'
            . '\s*"updatedAt"\s*:\s*"[^"\\\x00-\x1f]*"\s*\}\s*$'
        if !RegExMatch(raw, pattern, &match)
            throw Error("The AutoHotkey session preference is invalid.")
        return match[1] != sessionId || match[2] = "true"
    }

    static Enabled(statePath := "", sessionId := "") {
        if statePath = ""
            statePath := this.StatePath()
        if !FileExist(statePath)
            return true
        if sessionId = ""
            sessionId := this.SessionId()
        return this.EnabledFromJson(FileRead(statePath, "UTF-8"), sessionId)
    }

    static Acquire() {
        handle := DllCall("CreateMutexW", "Ptr", 0, "Int", false, "Str", this.MutexName(), "Ptr")
        if !handle
            throw Error("The AutoHotkey state lock could not be opened.", , A_LastError)
        waitResult := DllCall("WaitForSingleObject", "Ptr", handle, "UInt", 30000, "UInt")
        if waitResult != 0 && waitResult != 0x80 {
            DllCall("CloseHandle", "Ptr", handle)
            throw Error("Timed out waiting for the AutoHotkey state lock.")
        }
        return handle
    }

    static Release(handle) {
        DllCall("ReleaseMutex", "Ptr", handle)
        DllCall("CloseHandle", "Ptr", handle)
    }

    static RunScriptAndWait(scriptPath) {
        ; Release before waiting: a resident user script must remain stoppable.
        lock := this.Acquire()
        childPid := 0
        processHandle := 0
        try {
            if !this.Enabled()
                throw Error("AutoHotkey is OFF for this Windows sign-in session.")
            ; CreateProcess returns an owned handle atomically with launch, even
            ; for scripts that exit before Run/OpenProcess could observe them.
            command := '"' A_AhkPath '" "' scriptPath '"'
            commandBuffer := Buffer((StrLen(command) + 1) * 2, 0)
            StrPut(command, commandBuffer, "UTF-16")
            startupInfo := Buffer(A_PtrSize = 8 ? 104 : 68, 0)
            NumPut("UInt", startupInfo.Size, startupInfo)
            processInfo := Buffer(A_PtrSize * 2 + 8, 0)
            if !DllCall("CreateProcessW", "Str", A_AhkPath, "Ptr", commandBuffer,
                "Ptr", 0, "Ptr", 0, "Int", false, "UInt", 0x08000000,
                "Ptr", 0, "Ptr", 0, "Ptr", startupInfo, "Ptr", processInfo)
                throw Error("The AutoHotkey script could not be started.", , A_LastError)
            processHandle := NumGet(processInfo, 0, "Ptr")
            childPid := NumGet(processInfo, A_PtrSize * 2, "UInt")
            DllCall("CloseHandle", "Ptr", NumGet(processInfo, A_PtrSize, "Ptr"))
        } finally {
            this.Release(lock)
        }
        try {
            ProcessWaitClose childPid
            exitCode := 0
            if !DllCall("GetExitCodeProcess", "Ptr", processHandle, "UInt*", &exitCode)
                throw Error("The AutoHotkey script exit status could not be read.", , A_LastError)
            return exitCode
        } finally {
            DllCall("CloseHandle", "Ptr", processHandle)
        }
    }
}
