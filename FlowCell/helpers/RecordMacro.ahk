; Description: Runs RecordMacro.
#Requires AutoHotkey v2.0
#SingleInstance Force

SetWorkingDir A_ScriptDir
CoordMode "Mouse", "Screen"
Persistent

GetCliValue(prefix, defaultValue := "") {
    normalizedPrefix := StrLower(prefix) "="
    for arg in A_Args {
        if InStr(StrLower(arg), normalizedPrefix) = 1
            return SubStr(arg, StrLen(prefix) + 2)
    }
    return defaultValue
}

HasCliFlag(flag) {
    for arg in A_Args {
        if StrLower(arg) = StrLower(flag)
            return true
    }
    return false
}

class MacroRecorder {
    __New(outputPath, actionId, actionName) {
        this.outputPath := outputPath
        this.actionId := actionId
        this.actionName := actionName
        this.steps := []
        this.stepCount := 0
        this.keyStates := Map()
        this.hotkeys := []
        this.textBuffer := ""
        this.textStartTick := 0
        this.textEndTick := 0
        this.lastCommittedTick := 0
        this.inputHook := ""
        this.isActive := false
        this.armTick := 0
        this.pendingNumpadText := ""
        this.pendingNumpadTimer := ""
        this.lastInjectedText := ""
        this.lastInjectedTick := 0
    }

    Start() {
        activateResult := this.ActivateIllustratorWindow()
        if !activateResult.ok {
            MsgBox activateResult.detail, "Macro Recorder", "Iconx"
            ExitApp(1)
        }

        this.lastCommittedTick := A_TickCount
        this.isActive := true
        this.armTick := A_TickCount + 700
        this.AddStep({ type: "ActivateIllustrator" }, this.lastCommittedTick)

        this.RegisterHotkey("~*LButton", ObjBindMethod(this, "HandleMouseEvent", "Left"))
        this.RegisterHotkey("~*RButton", ObjBindMethod(this, "HandleMouseEvent", "Right"))
        this.RegisterHotkey("~*MButton", ObjBindMethod(this, "HandleMouseEvent", "Middle"))
        this.RegisterHotkey("~*WheelUp", ObjBindMethod(this, "HandleMouseEvent", "WheelUp"))
        this.RegisterHotkey("~*WheelDown", ObjBindMethod(this, "HandleMouseEvent", "WheelDown"))
        this.RegisterHotkey("*F8", ObjBindMethod(this, "FinishHotkey"))
        this.RegisterHotkey("*F12", ObjBindMethod(this, "CancelHotkey"))

        this.inputHook := InputHook("V L0")
        this.inputHook.VisibleText := true
        this.inputHook.VisibleNonText := true
        this.inputHook.BackspaceIsUndo := false
        this.inputHook.KeyOpt("{All}", "N")
        this.inputHook.OnChar := ObjBindMethod(this, "HandleChar")
        this.inputHook.OnKeyDown := ObjBindMethod(this, "HandleKeyDown")
        this.inputHook.OnKeyUp := ObjBindMethod(this, "HandleKeyUp")
        this.inputHook.Start()
        this.UpdateTooltip("Recording")
    }

    RegisterHotkey(hotkeyName, callback) {
        Hotkey hotkeyName, callback, "On"
        this.hotkeys.Push({
            hotkey: hotkeyName,
            callback: callback
        })
    }

    StopRecorder() {
        this.FlushTextBuffer(A_TickCount)
        if IsObject(this.pendingNumpadTimer) {
            try SetTimer this.pendingNumpadTimer, 0
            catch {
            }
        }
        this.pendingNumpadText := ""
        if IsObject(this.inputHook) {
            try this.inputHook.Stop()
            catch {
            }
        }
        for hotkeyInfo in this.hotkeys {
            try Hotkey hotkeyInfo.hotkey, hotkeyInfo.callback, "Off"
            catch {
            }
        }
        this.hotkeys := []
        ToolTip
        this.isActive := false
    }

    FinishHotkey(*) {
        if !this.isActive
            return
        this.StopRecorder()
        if this.stepCount <= 1 {
            ExitApp(3)
        }
        this.WriteMacroFile()
        ExitApp(0)
    }

    CancelHotkey(*) {
        if !this.isActive
            return
        this.StopRecorder()
        try FileDelete this.outputPath
        catch {
        }
        ExitApp(2)
    }

    HandleChar(ih, chars) {
        if !this.isActive || chars = "" || !this.ShouldCaptureActiveWindow()
            return
        if this.lastInjectedText != "" && chars = this.lastInjectedText && (A_TickCount - this.lastInjectedTick) < 180 {
            this.lastInjectedText := ""
            this.lastInjectedTick := 0
            return
        }
        if this.pendingNumpadText != "" && chars = this.pendingNumpadText {
            if IsObject(this.pendingNumpadTimer) {
                try SetTimer this.pendingNumpadTimer, 0
                catch {
                }
            }
            this.pendingNumpadText := ""
        }
        if this.textBuffer = ""
            this.textStartTick := A_TickCount
        this.textBuffer .= chars
        this.textEndTick := A_TickCount
        this.UpdateTooltip("Typing")
    }

    HandleKeyDown(ih, vk, sc) {
        if !this.isActive
            return

        keyId := Format("vk{:02X}sc{:03X}", vk, sc)
        if this.keyStates.Has(keyId)
            return
        this.keyStates[keyId] := true

        keyName := GetKeyName(keyId)
        if this.IsIgnoredKey(keyName)
            return
        if !this.ShouldCaptureActiveWindow()
            return

        eventTick := A_TickCount
        if this.HandleBufferedBackspace(keyName)
            return

        if this.TryQueueNumpadText(keyName)
            return

        if !this.ShouldRecordAsKey(keyName) {
            this.UpdateTooltip("Typing")
            return
        }

        this.FlushTextBuffer(eventTick)
        sequence := this.BuildKeySequence(keyName)
        if sequence = ""
            return

        this.AddStep({
            type: "Key",
            keys: sequence
        }, eventTick)
        this.UpdateTooltip("Key")
    }

    HandleKeyUp(ih, vk, sc) {
        keyId := Format("vk{:02X}sc{:03X}", vk, sc)
        if this.keyStates.Has(keyId)
            this.keyStates.Delete(keyId)
    }

    HandleMouseEvent(buttonName, *) {
        if !this.isActive || !this.ShouldCaptureActiveWindow()
            return

        eventTick := A_TickCount
        this.FlushTextBuffer(eventTick)
        MouseGetPos &x, &y
        if InStr(buttonName, "Wheel") {
            this.AddStep({
                type: "Wheel",
                x: x,
                y: y,
                direction: buttonName = "WheelUp" ? "Up" : "Down",
                count: 1
            }, eventTick)
            this.UpdateTooltip("Wheel")
            return
        }

        this.AddStep({
            type: "Click",
            x: x,
            y: y,
            button: buttonName,
            count: 1
        }, eventTick)
        this.UpdateTooltip("Click")
    }

    FlushTextBuffer(eventTick := 0) {
        if this.textBuffer = ""
            return
        if !eventTick
            eventTick := A_TickCount

        this.AddStep({
            type: "Text",
            text: this.textBuffer
        }, this.textStartTick, this.textEndTick ? this.textEndTick : eventTick)

        this.textBuffer := ""
        this.textStartTick := 0
        this.textEndTick := 0
    }

    AddStep(step, startTick, endTick := 0) {
        if !this.lastCommittedTick
            this.lastCommittedTick := startTick
        delayMs := startTick - this.lastCommittedTick
        if delayMs < 0
            delayMs := 0
        step.delayMs := delayMs
        this.steps.Push(step)
        this.stepCount := this.steps.Length
        this.lastCommittedTick := endTick ? endTick : startTick
    }

    BuildKeySequence(keyName) {
        token := this.FormatKeyToken(keyName)
        if token = ""
            return ""
        return this.GetModifierPrefix() . token
    }

    GetModifierPrefix() {
        prefix := ""
        if GetKeyState("LControl") || GetKeyState("RControl")
            prefix .= "^"
        if GetKeyState("LAlt") || GetKeyState("RAlt")
            prefix .= "!"
        if GetKeyState("LShift") || GetKeyState("RShift")
            prefix .= "+"
        if GetKeyState("LWin") || GetKeyState("RWin")
            prefix .= "#"
        return prefix
    }

    FormatKeyToken(keyName) {
        if keyName = ""
            return ""
        if StrLen(keyName) = 1 {
            if InStr("^!+#{}", keyName)
                return "{" keyName "}"
            return keyName
        }
        return "{" keyName "}"
    }

    ShouldRecordAsKey(keyName) {
        if this.GetModifierPrefix() != ""
            return true
        if RegExMatch(keyName, "i)^Numpad(?:[0-9]|Dot|Del)$")
            return false
        if keyName = "Backspace" || keyName = "Delete" || keyName = "Enter" || keyName = "Tab" || keyName = "Escape"
            return true
        if keyName = "Left" || keyName = "Right" || keyName = "Up" || keyName = "Down"
            return true
        if keyName = "Home" || keyName = "End" || keyName = "PgUp" || keyName = "PgDn"
            return true
        if keyName = "Space"
            return false
        return StrLen(keyName) != 1
    }

    TryQueueNumpadText(keyName) {
        if this.GetModifierPrefix() != ""
            return false

        mapped := this.MapNumpadToText(keyName)
        if mapped = ""
            return false

        this.pendingNumpadText := mapped
        if IsObject(this.pendingNumpadTimer) {
            try SetTimer this.pendingNumpadTimer, 0
            catch {
            }
        }
        this.pendingNumpadTimer := ObjBindMethod(this, "CommitPendingNumpadText")
        SetTimer this.pendingNumpadTimer, -40
        return true
    }

    CommitPendingNumpadText() {
        if !this.isActive || this.pendingNumpadText = "" || !this.ShouldCaptureActiveWindow()
            return
        if this.textBuffer = ""
            this.textStartTick := A_TickCount
        this.textBuffer .= this.pendingNumpadText
        this.textEndTick := A_TickCount
        this.lastInjectedText := this.pendingNumpadText
        this.lastInjectedTick := A_TickCount
        this.pendingNumpadText := ""
        this.UpdateTooltip("Typing")
    }

    MapNumpadToText(keyName) {
        switch keyName {
            case "Numpad0":
                return "0"
            case "Numpad1":
                return "1"
            case "Numpad2":
                return "2"
            case "Numpad3":
                return "3"
            case "Numpad4":
                return "4"
            case "Numpad5":
                return "5"
            case "Numpad6":
                return "6"
            case "Numpad7":
                return "7"
            case "Numpad8":
                return "8"
            case "Numpad9":
                return "9"
            case "NumpadDot":
                return "."
            default:
                return ""
        }
    }

    HandleBufferedBackspace(keyName) {
        if keyName != "Backspace" || this.GetModifierPrefix() != ""
            return false
        if this.textBuffer = ""
            return false

        this.textBuffer := SubStr(this.textBuffer, 1, Max(StrLen(this.textBuffer) - 1, 0))
        if this.textBuffer = "" {
            this.textStartTick := 0
            this.textEndTick := 0
        } else {
            this.textEndTick := A_TickCount
        }
        this.UpdateTooltip("Typing")
        return true
    }

    ShouldCaptureActiveWindow() {
        if !this.isActive
            return false
        if A_TickCount < this.armTick
            return false
        try {
            processName := WinGetProcessName("A")
            return StrLower(processName) = "illustrator.exe"
        } catch {
            return false
        }
    }

    ActivateIllustratorWindow() {
        hwnd := 0
        try hwnd := WinExist("ahk_exe Illustrator.exe")
        if !hwnd {
            return {
                ok: false,
                detail: "Illustrator is not open. Open Illustrator first, then start recording."
            }
        }
        try WinActivate "ahk_id " hwnd
        try WinWaitActive "ahk_id " hwnd, , 2
        Sleep 180
        return {
            ok: true,
            hwnd: hwnd
        }
    }

    IsIgnoredKey(keyName) {
        return keyName = ""
            || keyName = "F8"
            || keyName = "F12"
            || keyName = "LControl"
            || keyName = "RControl"
            || keyName = "LShift"
            || keyName = "RShift"
            || keyName = "LAlt"
            || keyName = "RAlt"
            || keyName = "LWin"
            || keyName = "RWin"
    }

    WriteMacroFile() {
        SplitPath this.outputPath, , &outputDir
        if outputDir != "" && !InStr(FileExist(outputDir), "D")
            DirCreate outputDir

        lines := []
        lines.Push("[Action]")
        lines.Push("Id=" this.actionId)
        lines.Push("Label=" this.CleanIniValue(this.actionName))
        lines.Push("CreatedAt=" FormatTime(, "yyyy-MM-dd HH:mm:ss"))
        lines.Push("")

        for index, step in this.steps {
            lines.Push("[Step_" Format("{:03}", index) "]")
            lines.Push("Type=" step.type)
            lines.Push("DelayMs=" (step.HasOwnProp("delayMs") ? step.delayMs : 0))
            switch step.type {
                case "Click":
                    lines.Push("X=" step.x)
                    lines.Push("Y=" step.y)
                    lines.Push("Button=" step.button)
                    lines.Push("Count=" step.count)
                case "Wheel":
                    lines.Push("X=" step.x)
                    lines.Push("Y=" step.y)
                    lines.Push("Direction=" step.direction)
                    lines.Push("Count=" step.count)
                case "Text":
                    lines.Push("Text=" this.CleanIniValue(step.text))
                case "Key":
                    lines.Push("Keys=" this.CleanIniValue(step.keys))
            }
            lines.Push("")
        }

        file := FileOpen(this.outputPath, "w", "UTF-8")
        file.Write(this.JoinLines(lines) "`r`n")
        file.Close()
    }

    CleanIniValue(value) {
        value := StrReplace(value, "`r", " ")
        value := StrReplace(value, "`n", " ")
        return value
    }

    JoinLines(lines) {
        text := ""
        for index, line in lines {
            if index > 1
                text .= "`r`n"
            text .= line
        }
        return text
    }

    UpdateTooltip(modeText) {
        ToolTip "Recording: " this.actionName "`nMode: " modeText "`nCaptured steps: " Max(this.stepCount - 1, 0) "`nOnly Illustrator input is recorded`nF8 = save   F12 = cancel", 20, 20
    }
}

Main()

Main() {
    outputPath := GetCliValue("--out", "")
    actionName := GetCliValue("--name", "")
    actionId := GetCliValue("--id", "")

    if HasCliFlag("--validate-only")
        ExitApp(0)

    if outputPath = "" || actionName = "" || actionId = "" {
MsgBox "RecordMacro.ahk requires --out, --name, and --id.", "Macro Recorder", "Iconx"
        ExitApp(1)
    }

    MsgBox(
        "Recording action:`n"
        . actionName
        . "`n`nSwitch to Illustrator and do the steps now.`n`nPress F8 to stop and save.`nPress F12 to cancel.",
        "Macro Recorder",
        "Iconi"
    )

    recorder := MacroRecorder(outputPath, actionId, actionName)
    recorder.Start()
}
