; Description: Runs FlowCellBackend.
#Requires AutoHotkey v2.0
#SingleInstance Off

SetWorkingDir A_ScriptDir
CoordMode "Mouse", "Screen"
Persistent

#Include vendor\UIA-v2\Lib\UIA.ahk

flowCellLocalRoot := EnsureFlowCellDir(A_ScriptDir "\local")
flowCellLogsDir := EnsureFlowCellDir(flowCellLocalRoot "\logs")
flowCellBindingsPath := flowCellLocalRoot "\bindings.ini"
flowCellScanStatePath := flowCellLocalRoot "\scan_state.ini"
flowCellRecordedActionsDir := EnsureFlowCellDir(flowCellLocalRoot "\recorded_actions")
flowCellCommandTempDir := EnsureFlowCellDir(flowCellLocalRoot "\temp\command_host_ahk")
flowCellLastActionStatusPath := flowCellLogsDir "\last_action_status.txt"
flowCellCommandBackendPath := A_ScriptDir "\FlowCellCommandBackend.ps1"
flowCellDirectScriptReceiverTitle := "FlowCellBackendDirectScriptReceiver"
flowCellDirectScriptCopyDataId := 0x46435344
flowCellDirectScriptAccepted := 1
flowCellDirectScriptBusy := 2
flowCellDirectScriptBadPayload := 3
flowCellDirectScriptBadScript := 4

logger := ControllerLogger(flowCellLogsDir)

if HasCliFlag("--self-test") {
    try {
        logger.Info("Self-test started.")
        if ResolveActionHotkeyRegistrationShortcut({ PassThroughHotkey: true }, "V") != "~V"
            throw Error("Pass-through action hotkeys must preserve the native application shortcut.")
        if ResolveActionHotkeyRegistrationShortcut({}, "V") != "V"
            throw Error("Ordinary action hotkeys must retain their existing suppression behavior.")
        if ResolveActionHotkeyRegistrationShortcut({}, "^!M") != "^!M"
            throw Error("Ordinary modified action hotkeys must remain unchanged.")
        if ResolveActionHotkeyRegistrationShortcut({ PassThroughHotkey: true }, "~V") != "~V"
            throw Error("Pass-through action hotkeys must not duplicate the no-suppress prefix.")
        UIA.GetRootElement()
        logger.Info("Self-test completed.")
        ExitApp(0)
    } catch as err {
        logger.Error("Self-test failed.", err)
        MsgBox "Self-test failed:`n`n" err.Message, "Macros", "Iconx"
        ExitApp(1)
    }
}

if HasCliFlag("--scan-only") {
    try {
        logger.Info("CLI scan-only requested.")
        scanner := IllustratorScanner(logger, flowCellScanStatePath)
        scanner.Scan()
        logger.Info("CLI scan-only completed.")
        ExitApp(0)
    } catch as err {
        logger.Error("CLI scan-only failed.", err)
        ExitApp(1)
    }
}

runActionId := GetCliValue("--run-action", "")
runScriptPath := GetCliValue("--run-script-path", "")
runScriptProgram := GetCliValue("--run-script-program", "")
runScriptProgramTabId := GetCliIntValue("--run-script-program-tab-id", 0)

HasCliFlag(flag) {
    for arg in A_Args {
        if StrLower(arg) = StrLower(flag)
            return true
    }
    return false
}

GetCliValue(prefix, defaultValue := "") {
    normalizedPrefix := StrLower(prefix) "="
    for arg in A_Args {
        if InStr(StrLower(arg), normalizedPrefix) = 1
            return SubStr(arg, StrLen(prefix) + 2)
    }
    return defaultValue
}

GetCliIntValue(prefix, defaultValue) {
    value := GetCliValue(prefix, "")
    if value = ""
        return defaultValue
    try return Integer(value)
    catch
        return defaultValue
}

JsonStringValue(raw, key) {
    pattern := '"' key '"\s*:\s*"((?:\\.|[^"\\])*)"'
    if RegExMatch(raw, pattern, &match)
        return JsonUnescape(match[1])
    return ""
}

JsonUnescape(value) {
    output := ""
    index := 1
    length := StrLen(value)
    while index <= length {
        char := SubStr(value, index, 1)
        if char != "\" {
            output .= char
            index += 1
            continue
        }

        index += 1
        if index > length {
            output .= "\"
            break
        }

        escaped := SubStr(value, index, 1)
        switch escaped {
            case '"':
                output .= '"'
            case "\":
                output .= "\"
            case "/":
                output .= "/"
            case "b":
                output .= Chr(8)
            case "f":
                output .= Chr(12)
            case "n":
                output .= "`n"
            case "r":
                output .= "`r"
            case "t":
                output .= "`t"
            default:
                output .= escaped
        }
        index += 1
    }
    return output
}

JsonEscape(value) {
    text := value ""
    text := StrReplace(text, "\", "\\")
    text := StrReplace(text, '"', '\"')
    text := StrReplace(text, "`r", "\r")
    text := StrReplace(text, "`n", "\n")
    text := StrReplace(text, "`t", "\t")
    return text
}

SplitConfigList(value) {
    values := []
    if value = ""
        return values

    for token in StrSplit(value, "|") {
        normalizedToken := Trim(token)
        if normalizedToken != ""
            values.Push(normalizedToken)
    }
    return values
}

BoolConfigValue(value, defaultValue := false) {
    normalizedValue := StrLower(Trim(value ""))
    if normalizedValue = ""
        return defaultValue
    return normalizedValue = "1" || normalizedValue = "true" || normalizedValue = "yes"
}

GetFlowCellWorkspaceRoot() {
    static workspaceRoot := ""
    if workspaceRoot != ""
        return workspaceRoot

    SplitPath A_ScriptDir, , &workspaceRoot
    return workspaceRoot
}

NormalizeFlowCellProgramPath(path) {
    path := Trim(path "")
    if path = ""
        return path
    return StrReplace(path, "/", "\")
}

GetFlowCellIllustratorPrewarmScriptPath() {
    return GetFlowCellWorkspaceRoot() "\Programs\Illustrator\HelperScripts\FlowCell_Illustrator_Prewarm.jsx"
}

GetFlowCellIllustratorAnchorScriptPath() {
    return GetFlowCellWorkspaceRoot() "\Programs\Illustrator\HelperScripts\FlowCell_Illustrator_SetAnchorHotkey.jsx"
}

ReadUtf8TextFileWithoutBom(path) {
    text := FileRead(path, "UTF-8")
    if SubStr(text, 1, 1) = Chr(0xFEFF)
        return SubStr(text, 2)
    if SubStr(text, 1, 3) = "ï»¿"
        return SubStr(text, 4)
    return text
}

GetIniTextValue(iniText, sectionName, keyName, defaultValue := "") {
    currentSection := ""
    targetSection := StrLower(Trim(sectionName ""))
    targetKey := StrLower(Trim(keyName ""))
    normalizedText := StrReplace(iniText, "`r", "")

    for rawLine in StrSplit(normalizedText, "`n") {
        line := Trim(rawLine)
        if line = "" || SubStr(line, 1, 1) = ";" || SubStr(line, 1, 1) = "#"
            continue

        lineLength := StrLen(line)
        if lineLength >= 2 && SubStr(line, 1, 1) = "[" && SubStr(line, lineLength, 1) = "]" {
            currentSection := StrLower(Trim(SubStr(line, 2, lineLength - 2)))
            continue
        }

        if currentSection != targetSection
            continue

        separatorIndex := InStr(line, "=")
        if separatorIndex <= 1
            continue

        key := StrLower(Trim(SubStr(line, 1, separatorIndex - 1)))
        if key = targetKey
            return Trim(SubStr(line, separatorIndex + 1))
    }

    return defaultValue
}

GetPreservedBindingsIniSections(iniText) {
    output := ""
    keepCurrentSection := false
    normalizedText := StrReplace(iniText, "`r", "")

    for rawLine in StrSplit(normalizedText, "`n") {
        line := Trim(rawLine)
        lineLength := StrLen(line)
        isSectionHeader := lineLength >= 2
            && SubStr(line, 1, 1) = "["
            && SubStr(line, lineLength, 1) = "]"
        if isSectionHeader {
            sectionName := StrLower(Trim(SubStr(line, 2, lineLength - 2)))
            keepCurrentSection := sectionName != "meta" && InStr(sectionName, "binding_") != 1
            if keepCurrentSection {
                if output != ""
                    output .= "`r`n`r`n"
                output .= rawLine
            }
            continue
        }

        if keepCurrentSection
            output .= "`r`n" rawLine
    }

    return RTrim(output, "`r`n")
}

GetPreservedBindingsMetaEntries(iniText) {
    entries := []
    currentSection := ""
    normalizedText := StrReplace(iniText, "`r", "")

    for rawLine in StrSplit(normalizedText, "`n") {
        line := Trim(rawLine)
        if line = "" || SubStr(line, 1, 1) = ";" || SubStr(line, 1, 1) = "#"
            continue

        lineLength := StrLen(line)
        if lineLength >= 2 && SubStr(line, 1, 1) = "[" && SubStr(line, lineLength, 1) = "]" {
            currentSection := StrLower(Trim(SubStr(line, 2, lineLength - 2)))
            continue
        }
        if currentSection != "meta"
            continue

        separatorIndex := InStr(line, "=")
        if separatorIndex <= 1
            continue
        key := Trim(SubStr(line, 1, separatorIndex - 1))
        normalizedKey := StrLower(key)
        if normalizedKey = "nextid" || normalizedKey = "ids"
            continue
        entries.Push({
            key: key,
            value: Trim(SubStr(line, separatorIndex + 1))
        })
    }

    return entries
}

IsFlowCellProgramRegistered(programLabel) {
    global flowCellBindingsPath
    if !FileExist(flowCellBindingsPath)
        return false

    try iniText := ReadUtf8TextFileWithoutBom(flowCellBindingsPath)
    catch
        return false

    targetLabel := StrLower(Trim(programLabel ""))
    currentProgramSection := false
    normalizedText := StrReplace(iniText, "`r", "")
    for rawLine in StrSplit(normalizedText, "`n") {
        line := Trim(rawLine)
        if line = "" || SubStr(line, 1, 1) = ";" || SubStr(line, 1, 1) = "#"
            continue

        lineLength := StrLen(line)
        if lineLength >= 2 && SubStr(line, 1, 1) = "[" && SubStr(line, lineLength, 1) = "]" {
            sectionName := Trim(SubStr(line, 2, lineLength - 2))
            currentProgramSection := InStr(StrLower(sectionName), "programtab_") = 1
            continue
        }

        if !currentProgramSection
            continue

        separatorIndex := InStr(line, "=")
        if separatorIndex <= 1
            continue
        key := StrLower(Trim(SubStr(line, 1, separatorIndex - 1)))
        if key = "label" && StrLower(Trim(SubStr(line, separatorIndex + 1))) = targetLabel
            return true
    }
    return false
}

class FlowCellApp {
    __New(logger, showUi := true) {
        global flowCellScanStatePath, flowCellBindingsPath, flowCellRecordedActionsDir
        this.projectRoot := A_ScriptDir
        this.logger := logger
        this.isVisualHost := !!showUi
        this.scanner := ""
        this.shortcutManager := ScriptShortcutManager(this, flowCellBindingsPath, this.logger)
        this.actionHotkeyManager := ActionHotkeyManager(this, flowCellBindingsPath, this.logger, this.shortcutManager.candidateShortcuts)
        this.recordedActionStore := RecordedMacroStore(flowCellRecordedActionsDir, this.logger)
        this.macroExecutionStack := []
        this.illustratorAutomationWarmed := false
        this.illustratorAutomationPrewarmInProgress := false
        this.illustratorAutomationPrewarmPid := 0
        this.illustratorAutomationLastPrewarmTick := 0
        this.illustratorAutomationLastDirectActionTick := 0
        this.illustratorAutomationPrewarmTimer := ""
        this.actions := []
        if IsFlowCellProgramRegistered("Illustrator") && FileExist(GetFlowCellIllustratorAnchorScriptPath())
            this.actions.Push(SetIllustratorAnchorAction(this))
        for recordedAction in this.recordedActionStore.LoadActions(this)
            this.actions.Push(recordedAction)
        this.scanResult := ""
        this.macroStopRequested := false
        this.bindingRowIds := []
        this.editorDialog := ""
        this.actionStatusText := ""
        this.shortcutStatusText := ""
        if this.isVisualHost {
            this.BuildGui()
            this.vScrollHandler := ObjBindMethod(this, "HandleVScroll")
            this.mouseWheelHandler := ObjBindMethod(this, "HandleMouseWheel")
            OnMessage(0x115, this.vScrollHandler)
            OnMessage(0x20A, this.mouseWheelHandler)
            this.UpdateActionButtons(false)
        }
        this.SetActionStatus(JoinLines([
            "Fresh session.",
            "This build is recorder-first.",
            "Use Record Action in the macro window, then bind the saved macro here if you want a hotkey.",
            "Emergency stop hotkey: Pause"
        ]))
        if this.isVisualHost {
            this.LoadBindings()
            Hotkey "Pause", ObjBindMethod(this, "HandleEmergencyMacroStop"), "On"
            this.logger.Info("Application started.")
        } else {
            this.logger.Info("Controller CLI runner started without UI.")
        }
    }

    BuildGui() {
        window := Gui("+Resize +MinSize1240x760 +0x200000", "Macros")
        window.SetFont("s9", "Segoe UI")
        this.gui := window
        this.defaultGuiWidth := 1260
        this.defaultGuiHeight := 860
        this.scrollPos := 0
        this.scrollableControls := []
        candidateText := this.BuildCandidateShortcutText()
        candidateHeight := Max(this.MeasureTextBlockHeight(candidateText, 20), 320)
        leftX := 24
        leftW := 540
        rightX := 604
        rightW := 620

        illustratorRegistered := IsFlowCellProgramRegistered("Illustrator")
        if illustratorRegistered {
            this.scanButton := window.AddButton("x12 y12 w150 h30", "Scan Illustrator UI")
            this.scanButton.OnEvent("Click", (*) => this.RunScan(false))
            this.TrackScrollableControl(this.scanButton)

            this.rescanButton := window.AddButton("x172 y12 w100 h30", "Re-scan")
            this.rescanButton.OnEvent("Click", (*) => this.RunScan(true))
            this.TrackScrollableControl(this.rescanButton)
        }

        logButtonX := illustratorRegistered ? 282 : 12
        reloadButtonX := illustratorRegistered ? 392 : 122
        this.logButton := window.AddButton("x" logButtonX " y12 w100 h30", "Open Log")
        this.logButton.OnEvent("Click", (*) => this.OpenLog())
        this.TrackScrollableControl(this.logButton)

        this.reloadButton := window.AddButton("x" reloadButtonX " y12 w100 h30", "Reload App")
        this.reloadButton.OnEvent("Click", (*) => Reload())
        this.TrackScrollableControl(this.reloadButton)

        this.shortcutsLabel := window.AddText("x12 y54 w1180", "Shortcuts")
        this.TrackScrollableControl(this.shortcutsLabel)

        this.actionsLabel := window.AddText("x" leftX " y84 w" leftW, "Actions")
        this.TrackScrollableControl(this.actionsLabel)

        actionTop := 110
        this.actionButtons := []
        for action in this.actions {
            button := window.AddButton("x" leftX " y" actionTop " w420 h34", action.Label)
            button.OnEvent("Click", ObjBindMethod(this, "RunAction", action))
            this.actionButtons.Push(button)
            this.TrackScrollableControl(button)
            actionTop += 42
        }

        this.actionStatusLabel := window.AddText("x" leftX " y168 w" leftW, "Action Status")
        this.TrackScrollableControl(this.actionStatusLabel)
        this.actionStatusEdit := window.AddEdit("x" leftX " y192 w" leftW " h760 ReadOnly -Wrap -VScroll WantTab")
        this.TrackScrollableControl(this.actionStatusEdit)

        this.bindingsLabel := window.AddText("x" rightX " y84 w" rightW, "Bindings")
        this.TrackScrollableControl(this.bindingsLabel)

        this.bindingListView := window.AddListView("x" rightX " y108 w" rightW " h300 -Multi Grid", ["Shortcut", "Target", "Status"])
        this.bindingListView.OnEvent("DoubleClick", ObjBindMethod(this, "EditSelectedBinding"))
        this.bindingListView.ModifyCol(1, 155)
        this.bindingListView.ModifyCol(2, 340)
        this.bindingListView.ModifyCol(3, 110)
        this.TrackScrollableControl(this.bindingListView)

        this.addBindingButton := window.AddButton("x" rightX " y420 w190 h30", "Add Binding")
        this.addBindingButton.OnEvent("Click", (*) => this.OpenBindingEditor())
        this.TrackScrollableControl(this.addBindingButton)

        this.editBindingButton := window.AddButton("x" (rightX + 205) " y420 w190 h30", "Edit Binding")
        this.editBindingButton.OnEvent("Click", ObjBindMethod(this, "EditSelectedBinding"))
        this.TrackScrollableControl(this.editBindingButton)

        this.removeBindingButton := window.AddButton("x" (rightX + 410) " y420 w190 h30", "Remove Binding")
        this.removeBindingButton.OnEvent("Click", ObjBindMethod(this, "RemoveSelectedBinding"))
        this.TrackScrollableControl(this.removeBindingButton)

        this.reloadBindingsButton := window.AddButton("x" rightX " y458 w190 h30", "Reload Bindings")
        this.reloadBindingsButton.OnEvent("Click", (*) => this.LoadBindings(true))
        this.TrackScrollableControl(this.reloadBindingsButton)

        this.copyCandidatesButton := window.AddButton("x" (rightX + 205) " y458 w190 h30", "Copy Candidates")
        this.copyCandidatesButton.OnEvent("Click", (*) => this.CopyCandidateList())
        this.TrackScrollableControl(this.copyCandidatesButton)

        this.openBindingsFileButton := window.AddButton("x" (rightX + 410) " y458 w190 h30", "Open Bindings File")
        this.openBindingsFileButton.OnEvent("Click", (*) => this.OpenBindingsFile())
        this.TrackScrollableControl(this.openBindingsFileButton)

        this.shortcutStatusLabel := window.AddText("x" rightX " y510 w" rightW, "Shortcut Status")
        this.TrackScrollableControl(this.shortcutStatusLabel)
        this.shortcutStatusEdit := window.AddEdit("x" rightX " y534 w" rightW " h98 ReadOnly -Wrap -VScroll WantTab")
        this.TrackScrollableControl(this.shortcutStatusEdit)

        this.candidateLabel := window.AddText("x" rightX " y650 w" rightW, "Candidate Shortcuts")
        this.TrackScrollableControl(this.candidateLabel)
        this.candidateEdit := window.AddEdit("x" rightX " y674 w" rightW " h" candidateHeight " ReadOnly -Wrap -VScroll WantTab")
        this.candidateEdit.Value := candidateText
        this.TrackScrollableControl(this.candidateEdit)

        this.contentHeight := this.CalculateContentHeight(28)
        window.OnEvent("Size", ObjBindMethod(this, "OnGuiSizeScroll"))
        window.OnEvent("Close", (*) => ExitApp())
    }

    Show() {
        if !this.isVisualHost || !HasProp(this, "gui") || !IsObject(this.gui)
            return
        options := "w" this.defaultGuiWidth " h" this.defaultGuiHeight
        if HasCliFlag("--minimized") || HasCliFlag("--start-minimized")
            options .= " Minimize"
        this.gui.Show(options)
        this.ScrollTo(0)
        this.UpdateScrollBar()
    }

    OnGuiSizeScroll(guiObj, minMax, width, height) {
        if minMax = -1
            return
        this.UpdateScrollBar()
    }

    UpdateScrollBar() {
        clientHeight := this.GetClientHeight()
        maxPos := Max(this.contentHeight - clientHeight, 0)
        DllCall("SetScrollRange", "ptr", this.gui.Hwnd, "int", 1, "int", 0, "int", maxPos, "int", true)
        DllCall("ShowScrollBar", "ptr", this.gui.Hwnd, "int", 1, "int", maxPos > 0)
        this.ScrollTo(Min(this.scrollPos, maxPos))
    }

    ScrollTo(newPos) {
        clientHeight := this.GetClientHeight()
        maxPos := Max(this.contentHeight - clientHeight, 0)
        newPos := Max(0, Min(newPos, maxPos))
        this.scrollPos := newPos
        this.UpdateScrollableControlPositions()
        DllCall("SetScrollPos", "ptr", this.gui.Hwnd, "int", 1, "int", this.scrollPos, "int", true)
    }

    HandleVScroll(wParam, lParam, msg, hwnd) {
        if hwnd != this.gui.Hwnd
            return

        action := wParam & 0xFFFF
        clientHeight := this.GetClientHeight()
        lineStep := 40
        pageStep := Max(clientHeight - 60, 80)
        newPos := this.scrollPos

        switch action {
            case 0:
                newPos -= lineStep
            case 1:
                newPos += lineStep
            case 2:
                newPos -= pageStep
            case 3:
                newPos += pageStep
            case 5, 4:
                newPos := (wParam >> 16) & 0xFFFF
            case 6:
                newPos := 0
            case 7:
                newPos := this.contentHeight
            default:
                return
        }

        this.ScrollTo(newPos)
        return 0
    }

    HandleMouseWheel(wParam, lParam, msg, hwnd) {
        if !this.IsGuiOrChildHwnd(hwnd)
            return

        delta := (wParam >> 16) & 0xFFFF
        if delta & 0x8000
            delta := -(0x10000 - delta)

        step := 120
        lines := Round(delta / step)
        if lines = 0
            return

        this.ScrollTo(this.scrollPos - (lines * 40))
        return 0
    }

    GetClientHeight() {
        x := 0, y := 0, w := 0, h := 0
        try WinGetClientPos(&x, &y, &w, &h, "ahk_id " this.gui.Hwnd)
        return h > 0 ? h : this.defaultGuiHeight
    }

    TrackScrollableControl(control) {
        x := 0, y := 0, w := 0, h := 0
        control.GetPos(&x, &y, &w, &h)
        this.scrollableControls.Push({
            control: control,
            x: x,
            y: y
        })
    }

    UpdateScrollableControlPositions() {
        for item in this.scrollableControls
            item.control.Move(item.x, item.y - this.scrollPos)
    }

    CalculateContentHeight(bottomPadding := 24) {
        maxBottom := 0
        for item in this.scrollableControls {
            x := 0, y := 0, w := 0, h := 0
            item.control.GetPos(&x, &y, &w, &h)
            maxBottom := Max(maxBottom, item.y + h)
        }
        return maxBottom + bottomPadding
    }

    MeasureTextBlockHeight(text, lineHeight := 20, padding := 18) {
        normalized := StrReplace(text, "`r")
        lineCount := 1
        for line in StrSplit(normalized, "`n")
            lineCount += Max(StrLen(line) // 72, 0)
        return (lineCount * lineHeight) + padding
    }

    IsGuiOrChildHwnd(hwnd) {
        return hwnd = this.gui.Hwnd || DllCall("IsChild", "ptr", this.gui.Hwnd, "ptr", hwnd, "int")
    }

    ApplyStartupFlags() {
        if HasCliFlag("--auto-scan") {
            delayMs := Max(GetCliIntValue("--scan-delay-ms", 3500), 0)
            timeoutMs := Max(GetCliIntValue("--scan-timeout-ms", 45000), 5000)
            this.ScheduleStartupScan(delayMs, timeoutMs)
        }
    }

    ScheduleStartupScan(delayMs, timeoutMs) {
        this.startupScanTimer := ObjBindMethod(this, "RunStartupScan", timeoutMs)
        SetTimer this.startupScanTimer, -delayMs
        this.logger.Info(
            "Startup auto-scan scheduled."
            . " DelayMs="
            . delayMs
            . " | TimeoutMs="
            . timeoutMs
        )
    }

    RunStartupScan(timeoutMs) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            hwnd := this.FindIllustratorDocumentWindow()
            if hwnd {
                Sleep 1200
                this.logger.Info("Illustrator document detected for startup auto-scan. Hwnd=0x" Format("{:X}", hwnd))
                this.RunScan(false)
                return
            }
            Sleep 400
        }

        this.logger.Warn("Startup auto-scan timed out waiting for an open Illustrator document.")
    }

    FindIllustratorDocumentWindow(programConfig := 0) {
        handles := WinGetList("ahk_exe Illustrator.exe")
        for hwnd in handles {
            if !this.IsStableIllustratorWindow(hwnd, programConfig)
                continue
            title := ""
            try title := WinGetTitle("ahk_id " hwnd)
            if this.IsLikelyIllustratorDocumentTitle(title)
                return hwnd
        }
        return 0
    }

    FindStableIllustratorWindow(programConfig := 0) {
        hwnd := this.FindIllustratorDocumentWindow(programConfig)
        if hwnd
            return hwnd

        handles := WinGetList("ahk_exe Illustrator.exe")
        for candidateHwnd in handles {
            if this.IsStableIllustratorWindow(candidateHwnd, programConfig)
                return candidateHwnd
        }

        return 0
    }

    IsStableIllustratorWindow(hwnd, programConfig := 0) {
        if !hwnd
            return false

        processPath := ""
        try processPath := WinGetProcessPath("ahk_id " hwnd)
        catch
            processPath := ""

        if processPath = ""
            return false

        lowerPath := StrLower(processPath)
        configuredExePath := ""
        if IsObject(programConfig) && programConfig.HasOwnProp("exePath")
            configuredExePath := StrLower(Trim(programConfig.exePath))
        if configuredExePath != ""
            return lowerPath = configuredExePath
        if InStr(lowerPath, "illustrator (beta)")
            return false

        return InStr(lowerPath, "\adobe illustrator 2026\") != 0
    }

    IsLikelyIllustratorDocumentTitle(title) {
        title := Trim(title)
        if title = ""
            return false
        lowerTitle := StrLower(title)
        if lowerTitle = "illustrator" || lowerTitle = "home" || lowerTitle = "start" || lowerTitle = "learn" || lowerTitle = "discover" || lowerTitle = "recent"
            return false
        if InStr(lowerTitle, "your files") || InStr(lowerTitle, "cloud documents") || InStr(lowerTitle, "creative cloud") || InStr(lowerTitle, "libraries")
            return false
        if RegExMatch(title, "i)^untitled-\d+\b")
            return true
        if InStr(lowerTitle, ".ai") || InStr(lowerTitle, ".aic") || InStr(lowerTitle, ".eps") || InStr(lowerTitle, ".svg") || InStr(lowerTitle, ".pdf")
            return true
        return RegExMatch(title, "i)@\s*\d+(?:\.\d+)?\s*%")
    }

    RunScan(isRescan := false) {
        actionWord := isRescan ? "Re-scan" : "Scan"
        progressWord := isRescan ? "Re-scanning" : "Scanning"
        this.SetScanBusy(true, progressWord "...")
        this.SetActionStatus(
            progressWord " Illustrator UI...`r`n"
            . "Inspecting Illustrator and the Layers-panel trash-can exposure.`r`n"
            . "Please wait."
            , true
        )
        this.logger.Info(actionWord " requested by user.")
        try {
            scanner := this.GetIllustratorScanner()
            this.scanResult := scanner.Scan()
            this.UpdateActionButtons(this.scanResult.readyForActions)
            this.SetActionStatus(scanner.BuildStatusText(this.scanResult), true)
            this.logger.Info(actionWord " completed. ReadyForActions=" BoolToWord(this.scanResult.readyForActions))
        } catch as err {
            this.scanResult := ""
            this.UpdateActionButtons(false)
            this.logger.Error("Scan failed.", err)
            this.SetActionStatus(
                actionWord " failed.`r`n"
                . err.Message "`r`n"
                . "Check the log for details."
                , true
            )
        } finally {
            this.SetScanBusy(false)
        }
    }

    RunAction(action, *) {
        if !this.EnsureActionReady(action, "button " action.Id)
            return

        this.logger.Info("Running action: " action.Id)
        try {
            result := action.Run(this.scanResult)
            this.logger.Info(
                "Action result: "
                . action.Id
                . " | Attempted="
                . BoolToWord(result.attempted)
                . " | DeliverySucceeded="
                . BoolToWord(result.deliverySucceeded)
                . " | EffectConfirmed="
                . BoolToWord(result.effectConfirmed)
                . " | Method="
                . result.method
            )
            this.SetActionStatus(this.BuildActionStatus(action, result))
        } catch as err {
            this.logger.Error("Action failed: " action.Id, err)
            this.SetActionStatus(
                action.Label "`r`n`r`n"
                . "Action failed before the Layers-panel delete attempt could be made.`r`n"
                . err.Message "`r`n"
                . "See the log for details."
            )
        }
    }

    EnsureActionScanReady(source) {
        if IsObject(this.scanResult) && this.scanResult.readyForActions
            return true

        this.logger.Info("Refreshing scan state for " source ".")
        this.SetScanBusy(true, "Auto-scanning...")
        this.SetActionStatus(
            "Auto-scanning before action run...`r`n"
            . "Refreshing the Illustrator UI scan for "
            . source
            . ".`r`nPlease wait."
            , true
        )
        try {
            scanner := this.GetIllustratorScanner()
            this.scanResult := scanner.Scan()
            this.UpdateActionButtons(this.scanResult.readyForActions)
            this.SetActionStatus(scanner.BuildStatusText(this.scanResult), true)
            if this.scanResult.readyForActions
                return true

            this.logger.Warn("Action request blocked because the scan did not expose the exact Layers delete control. Source=" source)
            return false
        } catch as err {
            this.scanResult := ""
            this.UpdateActionButtons(false)
            this.logger.Error("Auto-scan failed for " source ".", err)
            this.SetActionStatus(
                "Auto-scan failed before the Illustrator action could run.`r`n"
                . err.Message "`r`n"
                . "Check the log for details."
                , true
            )
            return false
        } finally {
            this.SetScanBusy(false)
        }
    }

    EnsureActionReady(action, source) {
        if !IsObject(action)
            return false
        if action.RequiresExactLayersScan
            return this.EnsureActionScanReady(source)
        if action.HasOwnProp("MacroPath")
            return true
        if !ProcessExist("Illustrator.exe") {
            this.SetActionStatus(
                "Illustrator is not running.`r`n"
                . "Open Illustrator first, then run "
                . action.Label
                . ".",
                true
            )
            return false
        }
        return true
    }

    BuildActionStatus(action, result) {
        lines := [
            action.Label,
            "",
            "Attempted: " BoolToWord(result.attempted),
            "Delivery succeeded: " BoolToWord(result.deliverySucceeded),
            "Effect confirmed: " BoolToWord(result.effectConfirmed),
            "Chosen method: " result.method,
            "Details: " result.detail
        ]

        if result.HasOwnProp("note") && result.note != ""
            lines.Push("Note: " result.note)

        return JoinLines(lines)
    }

    SetActionStatus(text, flush := false) {
        this.actionStatusText := text
        if this.isVisualHost && HasProp(this, "actionStatusEdit") && IsObject(this.actionStatusEdit) {
            this.actionStatusEdit.Value := text
        }
        if flush && this.isVisualHost && HasProp(this, "actionStatusEdit") && IsObject(this.actionStatusEdit)
            this.FlushUi(this.actionStatusEdit)
    }

    GetActionStatusText() {
        return this.actionStatusText
    }

    SetShortcutStatus(text) {
        this.shortcutStatusText := text
        if this.isVisualHost && HasProp(this, "shortcutStatusEdit") && IsObject(this.shortcutStatusEdit)
            this.shortcutStatusEdit.Value := text
    }

    UpdateActionButtons(enabled) {
        if !this.isVisualHost || !HasProp(this, "actionButtons") || !IsObject(this.actionButtons)
            return
        for button in this.actionButtons
            button.Enabled := enabled
    }

    SetScanBusy(isBusy, scanButtonText := "") {
        if !this.isVisualHost || !HasProp(this, "scanButton") || !IsObject(this.scanButton) || !HasProp(this, "rescanButton") || !IsObject(this.rescanButton)
            return
        this.scanButton.Enabled := !isBusy
        this.rescanButton.Enabled := !isBusy
        if isBusy {
            if scanButtonText != ""
                this.scanButton.Text := scanButtonText
            this.rescanButton.Text := "Working..."
        } else {
            this.scanButton.Text := "Scan Illustrator UI"
            this.rescanButton.Text := "Re-scan"
        }
        this.FlushUi()
    }

    FlushUi(control := "") {
        if !this.isVisualHost || !HasProp(this, "gui") || !IsObject(this.gui)
            return
        try {
            if IsObject(control)
                control.Redraw()
        }
        try this.gui.Redraw()
        Sleep -1
        DllCall("UpdateWindow", "ptr", this.gui.Hwnd)
    }

    OpenLog() {
        this.logger.Info("Open Log requested.")
        Run this.logger.logPath
    }

    OpenBindingsFile() {
        this.logger.Info("Open Bindings File requested.")
        if !FileExist(this.shortcutManager.bindingFilePath)
            this.shortcutManager.SaveToDisk()
        Run this.shortcutManager.bindingFilePath
    }

    CopyCandidateList() {
        A_Clipboard := this.BuildCandidateShortcutText()
        this.SetShortcutStatus(
            "Candidate shortcut list copied to the clipboard.`r`n"
            . "Bindings are handled by this utility while it is running."
        )
        this.logger.Info("Candidate shortcut list copied to clipboard.")
    }

    LoadBindings(isReload := false) {
        this.shortcutManager.LoadFromDisk()
        this.actionHotkeyManager.LoadFromDisk()
        this.shortcutManager.ApplyHotkeys()
        this.actionHotkeyManager.ApplyHotkey()
        this.RefreshBindingsView()
        this.UpdateCandidateDisplay()
        summary := this.BuildBindingSummary()
        this.SetShortcutStatus(summary)
        this.logger.Info((isReload ? "Bindings reloaded." : "Bindings loaded.") " " summary)
    }

    RefreshBindingsView() {
        this.bindingListView.Delete()
        this.bindingRowIds := []

        for actionBinding in this.actionHotkeyManager.GetBindingRecords() {
            this.bindingListView.Add("", actionBinding.shortcut, actionBinding.target, actionBinding.status)
            this.bindingRowIds.Push({
                kind: "action",
                id: actionBinding.id
            })
        }

        for binding in this.shortcutManager.bindings {
            this.bindingListView.Add("", binding.shortcut, binding.scriptPath, binding.status)
            this.bindingRowIds.Push({
                kind: "script",
                id: binding.id
            })
        }
        this.UpdateCandidateDisplay()
    }

    OpenBindingEditor(existingBinding := "") {
        if IsObject(this.editorDialog) {
            try this.editorDialog.gui.Show()
            return
        }

        this.editorDialog := BindingEditorDialog(this, existingBinding)
        this.editorDialog.Show()
    }

    OnBindingEditorClosed() {
        this.editorDialog := ""
    }

    SaveBindingFromEditor(existingRef, bindingType, shortcut, scriptPath, actionId := "") {
        if IsObject(existingRef) && existingRef.kind != bindingType {
            result := {
                ok: false,
                message: "Changing a binding from action to script, or script to action, is not supported here. Remove it and add the new binding."
            }
            MsgBox result.message, "Macros", "Iconx"
            this.SetShortcutStatus(result.message)
            return false
        }

        result := ""
        if bindingType = "action" {
            if actionId = "" {
                result := {
                    ok: false,
                    message: "Choose an action first."
                }
            } else {
            targetActionId := actionId
            if IsObject(existingRef) && existingRef.kind = "action" && existingRef.id != targetActionId {
                result := {
                    ok: false,
                    message: "Changing an action binding to a different action is not supported here."
                }
            } else if !IsObject(existingRef) && this.actionHotkeyManager.GetShortcut(targetActionId) != "" {
                result := {
                    ok: false,
                    message: "That action already has a saved binding. Select it and use Edit Binding."
                }
            } else {
                result := this.actionHotkeyManager.SetShortcut(targetActionId, shortcut)
            }
            }
        } else {
            existingId := IsObject(existingRef) && existingRef.kind = "script" ? existingRef.id : 0
            if existingId
                result := this.shortcutManager.UpdateBinding(existingId, shortcut, scriptPath)
            else
                result := this.shortcutManager.AddBinding(shortcut, scriptPath)
        }

        if !result.ok {
            MsgBox result.message, "Macros", "Iconx"
            this.SetShortcutStatus(result.message)
            return false
        }

        this.RefreshBindingsView()
        this.SetShortcutStatus(result.message)
        return true
    }

    EditSelectedBinding(*) {
        binding := this.GetSelectedBinding()
        if !IsObject(binding) {
            this.SetShortcutStatus("Select one binding first, then choose Edit Binding.")
            return
        }
        this.OpenBindingEditor(binding)
    }

    RemoveSelectedBinding(*) {
        binding := this.GetSelectedBinding()
        if !IsObject(binding) {
            this.SetShortcutStatus("Select one binding first, then choose Remove Binding.")
            return
        }

        answer := MsgBox(
            "Remove this binding?`r`n`r`nShortcut: "
            . binding.shortcut
            . "`r`nTarget: "
            . binding.target,
                "FlowCell",
            "YesNo Icon!"
        )
        if answer != "Yes"
            return

        if binding.kind = "action"
            result := this.actionHotkeyManager.ClearShortcut(binding.id)
        else
            result := this.shortcutManager.RemoveBinding(binding.id)
        this.RefreshBindingsView()
        this.SetShortcutStatus(result.message)
    }

    GetSelectedBinding() {
        row := this.bindingListView.GetNext()
        if !row
            return ""

        if row > this.bindingRowIds.Length
            return ""

        bindingRef := this.bindingRowIds[row]
        if bindingRef.kind = "action"
            return this.actionHotkeyManager.GetBindingRecord(bindingRef.id)
        return this.BuildScriptBindingRecord(this.shortcutManager.GetBindingById(bindingRef.id))
    }

    BuildBindingSummary() {
        totalCount := this.shortcutManager.bindings.Length + this.actionHotkeyManager.GetBindingCount()
        if totalCount = 0 {
            return JoinLines([
                "No bindings are saved yet.",
                "Use Add Binding to bind either a controller action or an Illustrator script."
            ])
        }

        activeCount := 0
        errorCount := 0
        for binding in this.shortcutManager.bindings {
            if binding.status = "Active"
                activeCount += 1
            else
                errorCount += 1
        }
        for actionBinding in this.actionHotkeyManager.GetBindingRecords() {
            if actionBinding.status = "Active"
                activeCount += 1
            else
                errorCount += 1
        }

        return JoinLines([
            "Bindings loaded: " totalCount,
            "Active: " activeCount,
            "Registration errors: " errorCount,
            "Actions and scripts are both managed from this list."
        ])
    }

    UpdateCandidateDisplay() {
        this.candidateEdit.Value := this.BuildCandidateShortcutText()
    }

    BuildCandidateShortcutText(includeShortcut := "") {
        available := this.GetAvailableCandidateShortcuts(includeShortcut)
        used := this.GetUsedCandidateShortcuts(includeShortcut)
        lines := [
            "Available now:",
            available.Length ? JoinLines(available) : "(none)",
            "",
            "Already used:",
            used.Length ? JoinLines(used) : "(none)",
            "",
            "Shortcut note:",
            "Suggested shortcuts assume the normal defaults are taken. Use the FlowCell picker for the filtered live list."
        ]
        return JoinLines(lines)
    }

    GetAvailableCandidateShortcuts(includeShortcut := "") {
        includeNorm := NormalizeShortcut(includeShortcut)
        used := this.BuildUsedShortcutMap(includeNorm)
        available := []
        for shortcut in this.shortcutManager.candidateShortcuts {
            normalized := NormalizeShortcut(shortcut)
            if normalized = includeNorm || !used.Has(normalized)
                available.Push(shortcut)
        }
        if includeNorm != "" {
            found := false
            for shortcut in available {
                if NormalizeShortcut(shortcut) = includeNorm {
                    found := true
                    break
                }
            }
            if !found
                available.InsertAt(1, includeShortcut)
        }
        return available
    }

    GetUsedCandidateShortcuts(includeShortcut := "") {
        includeNorm := NormalizeShortcut(includeShortcut)
        used := this.BuildUsedShortcutMap(includeNorm)
        usedShortcuts := []
        for shortcut in this.shortcutManager.candidateShortcuts {
            normalized := NormalizeShortcut(shortcut)
            if used.Has(normalized)
                usedShortcuts.Push(shortcut)
        }
        return usedShortcuts
    }

    BuildUsedShortcutMap(excludeShortcut := "") {
        excludeNorm := NormalizeShortcut(excludeShortcut)
        used := Map()
        for binding in this.shortcutManager.bindings {
            normalized := NormalizeShortcut(binding.shortcut)
            if normalized != "" && normalized != excludeNorm
                used[normalized] := true
        }
        for binding in this.shortcutManager.buttonBindings {
            normalized := NormalizeShortcut(binding.shortcut)
            if normalized != "" && normalized != excludeNorm
                used[normalized] := true
        }
        for binding in this.actionHotkeyManager.GetBindingRecords() {
            normalized := NormalizeShortcut(binding.shortcut)
            if normalized != "" && normalized != excludeNorm
                used[normalized] := true
        }
        return used
    }

    BuildScriptBindingRecord(binding) {
        if !IsObject(binding)
            return ""
        return {
            kind: "script",
            id: binding.id,
            shortcut: binding.shortcut,
            target: binding.scriptPath,
            status: binding.status,
            scriptPath: binding.scriptPath
        }
    }

    GetActionChoiceLabels() {
        labels := []
        for action in this.actions
            labels.Push(action.Label)
        return labels
    }

    GetActionIdByLabel(label) {
        for action in this.actions {
            if action.Label = label
                return action.Id
        }
        return ""
    }

    GetActionLabelById(actionId) {
        action := this.GetActionById(actionId)
        return IsObject(action) ? action.Label : actionId
    }

    HandleShortcutInvocation(binding) {
        global flowCellLastActionStatusPath
        if this.IsTempShotsScript(binding.scriptPath) {
            this.HandleTempShotsShortcutInvocation(binding)
            return
        }

        this.logger.Info("Script hotkey requested. Shortcut=" binding.shortcut " | Script=" binding.scriptPath)
        result := this.RunBackendScriptCommand(binding.scriptPath, binding.HasOwnProp("programTabId") ? binding.programTabId : 0, "hotkey " binding.shortcut)
        lines := [
            "Shortcut: " binding.shortcut,
            "Script: " binding.scriptPath,
            "Attempted: " BoolToWord(result.attempted),
            "Succeeded: " BoolToWord(result.succeeded),
            "Method: " result.method,
            "Details: " result.detail
        ]
        this.SetShortcutStatus(JoinLines(lines))
        WriteTextFile(flowCellLastActionStatusPath, JoinLines(lines))
        this.logger.Info("Script hotkey completed. Shortcut=" binding.shortcut " | Succeeded=" BoolToWord(result.succeeded) " | Method=" result.method " | Details=" result.detail)
    }

    IsTempShotsScript(scriptPath) {
        resolvedScriptPath := NormalizeFlowCellProgramPath(scriptPath)
        SplitPath resolvedScriptPath, &fileName
        return StrLower(Trim(fileName)) = "temp_shots.vbs"
    }

    HandleTempShotsShortcutInvocation(binding) {
        global flowCellLastActionStatusPath
        scriptPath := NormalizeFlowCellProgramPath(binding.scriptPath)
        this.logger.Info("Temp Shots hotkey requested. Shortcut=" binding.shortcut " | Script=" scriptPath)

        result := this.RunTempShotsScript(scriptPath)
        lines := [
            "Shortcut: " binding.shortcut,
            "Script: " scriptPath,
            "Attempted: " BoolToWord(result.attempted),
            "Succeeded: " BoolToWord(result.succeeded),
            "Method: " result.method,
            "Details: " result.detail
        ]
        statusText := JoinLines(lines)
        this.SetShortcutStatus(statusText)
        WriteTextFile(flowCellLastActionStatusPath, statusText)
        this.logger.Info("Temp Shots hotkey completed. Shortcut=" binding.shortcut " | Succeeded=" BoolToWord(result.succeeded) " | Method=" result.method " | Details=" result.detail)
    }

    RunTempShotsScript(launcherPath) {
        result := this.TryLaunchTempShotsFast(launcherPath)
        if result.attempted
            return result

        result := {
            attempted: true,
            succeeded: false,
            method: "temp_shots_wscript_async",
            detail: ""
        }
        launcherPath := NormalizeFlowCellProgramPath(launcherPath)
        if !FileExist(launcherPath) {
            result.detail := "Temp Shots launcher was not found."
            return result
        }

        wscriptPath := A_WinDir "\System32\wscript.exe"
        if !FileExist(wscriptPath)
            wscriptPath := "wscript.exe"
        try {
            Run('"' wscriptPath '" //nologo "' launcherPath '"', , "Hide")
            result.succeeded := true
            result.detail := "Temp Shots launched."
        } catch as err {
            result.detail := "Launching Temp Shots failed. " err.Message
        }
        return result
    }

    TryLaunchTempShotsFast(launcherPath) {
        global flowCellLastActionStatusPath
        result := {
            attempted: false,
            succeeded: false,
            method: "temp_shots_fast_async",
            detail: ""
        }

        psScript := this.ResolveTempShotsPowerShellScriptPath(launcherPath)
        if psScript = "" {
            result.detail := "Temp Shots PowerShell saver was not found."
            return result
        }

        if this.ReadTempShotsFastFolder() = "" {
            result.detail := "Temp Shots folder has not been selected yet."
            return result
        }

        initialSequence := DllCall("user32.dll\GetClipboardSequenceNumber", "UInt")
        if !this.StartTempShotsScreenSnip() {
            result.attempted := true
            result.detail := "Windows screen snip could not be started."
            return result
        }

        result.attempted := true
        try {
            command := 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Sta -File "' psScript '" -SaveStartedSnip -InitialSequence ' initialSequence
            Run(command, , "Hide")
            result.succeeded := true
            result.detail := "Temp Shots launched."
            WriteTextFile(flowCellLastActionStatusPath, "Temp Shots is waiting for a screen snip.")
        } catch as err {
            result.detail := "Launching Temp Shots saver failed. " err.Message
        }
        return result
    }

    ResolveTempShotsPowerShellScriptPath(launcherPath) {
        launcherPath := NormalizeFlowCellProgramPath(launcherPath)
        if launcherPath = ""
            return ""

        SplitPath launcherPath, , &launcherDir
        siblingScript := launcherDir "\Temp Shots.ps1"
        return FileExist(siblingScript) ? siblingScript : ""
    }

    ReadTempShotsFastFolder() {
        global flowCellLocalRoot
        folderCachePath := flowCellLocalRoot "\windows\temp-shots\temp-shots.folder.txt"
        if !FileExist(folderCachePath)
            return ""

        try {
            folder := Trim(ReadUtf8TextFileWithoutBom(folderCachePath), "`r`n`t ")
            return folder != "" && DirExist(folder) ? folder : ""
        } catch {
            return ""
        }
    }

    GetIllustratorScanner() {
        global flowCellScanStatePath
        if !IsObject(this.scanner)
            this.scanner := IllustratorScanner(this.logger, flowCellScanStatePath)
        return this.scanner
    }

    StartTempShotsScreenSnip() {
        try {
            explorerPath := A_WinDir "\explorer.exe"
            if FileExist(explorerPath) {
                Run('"' explorerPath '" ms-screenclip:', , "Hide")
                return true
            }
        } catch {
        }

        try {
            Run('SnippingTool.exe /clip', , "Hide")
            return true
        } catch {
            return false
        }
    }

    RunBackendCommand(commandId, payloadJson, programTabId := 0, programName := "", sourceButtonId := "", runAsync := false) {
        global flowCellCommandBackendPath, flowCellCommandTempDir, flowCellLastActionStatusPath
        result := {
            attempted: false,
            succeeded: false,
            method: "command_host",
            detail: "",
            exitCode: "",
            statusText: ""
        }

        if !FileExist(flowCellCommandBackendPath) {
            result.detail := "Command backend script was not found."
            return result
        }

        programConfig := this.GetProgramTabConfig(programTabId, programName)
        resolvedProgramLabel := Trim(programConfig.label != "" ? programConfig.label : programName)
        if resolvedProgramLabel = ""
            resolvedProgramLabel := this.GetProgramNameFromBinding(programTabId)
        resolvedProgramNormalized := StrLower(Trim(programConfig.normalizedName != "" ? programConfig.normalizedName : resolvedProgramLabel))
        resolvedRunMethod := Trim(programConfig.runMethod)

        token := A_TickCount "_" Random(1000, 9999)
        envelopePath := flowCellCommandTempDir "\command_" token ".json"
        resultPath := flowCellCommandTempDir "\result_" token ".json"
        envelopeJson := "{"
            . '"command_id":"' JsonEscape(commandId) '",'
            . '"source_button_id":"' JsonEscape(sourceButtonId) '",'
            . '"program_id":' Integer(programTabId) ','
            . '"panel_id":"",'
            . '"source_surface":"Hotkey",'
            . '"correlation_id":"' JsonEscape(token) '",'
            . '"program":{'
                . '"id":' Integer(programTabId) ','
                . '"label":"' JsonEscape(resolvedProgramLabel) '",'
                . '"normalized_name":"' JsonEscape(resolvedProgramNormalized) '",'
                . '"run_method":"' JsonEscape(resolvedRunMethod) '"'
            . '},'
            . '"payload":' payloadJson
            . "}"

        try {
            FileDelete envelopePath
            FileDelete resultPath
        } catch {
        }

        try {
            file := FileOpen(envelopePath, "w", "UTF-8")
            file.Write(envelopeJson)
            file.Close()
        } catch as err {
            result.detail := "Failed to write command envelope. " err.Message
            return result
        }

        result.attempted := true
        if runAsync {
            psScript := "& { try { & " PowerShellSingleQuote(flowCellCommandBackendPath)
                . " -EnvelopePath " PowerShellSingleQuote(envelopePath)
                . " -ResultPath " PowerShellSingleQuote(resultPath)
                . " } finally { Remove-Item -LiteralPath "
                . PowerShellSingleQuote(envelopePath)
                . ","
                . PowerShellSingleQuote(resultPath)
                . " -Force -ErrorAction SilentlyContinue } }"
            command := 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "' psScript '"'
            try {
                Run(command, , "Hide")
            } catch as err {
                try FileDelete envelopePath
                catch {
                }
                try FileDelete resultPath
                catch {
                }
                result.detail := "Launching the async command backend failed. " err.Message
                return result
            }
            result.succeeded := true
            result.method := "command_host_async"
            result.detail := "Command queued."
            result.statusText := result.detail
            return result
        }

        command := 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' flowCellCommandBackendPath '" -EnvelopePath "' envelopePath '" -ResultPath "' resultPath '"'
        try exitCode := RunWait(command, , "Hide")
        catch as err {
            result.detail := "Launching the command backend failed. " err.Message
            return result
        } finally {
            try FileDelete envelopePath
            catch {
            }
        }

        statusText := ""
        if FileExist(flowCellLastActionStatusPath) {
            try statusText := FileRead(flowCellLastActionStatusPath, "UTF-8")
            catch
                statusText := ""
        }

        try FileDelete resultPath
        catch {
        }

        result.exitCode := exitCode
        result.succeeded := exitCode = 0
        result.statusText := statusText
        result.detail := Trim(statusText) != "" ? statusText : (result.succeeded ? "Command completed." : "Command failed.")
        return result
    }

    RunBackendScriptCommand(scriptPath, programTabId := 0, source := "", runAsync := false) {
        programName := this.GetProgramNameFromBinding(programTabId, scriptPath)
        resolvedScriptPath := scriptPath
        label := scriptPath
        try {
            SplitPath resolvedScriptPath, &fileName
            if fileName != ""
                label := fileName
        }
        payloadJson := "{"
            . '"kind":"script",'
            . '"label":"' JsonEscape(label) '",'
            . '"target":"' JsonEscape(resolvedScriptPath) '",'
            . '"resolved_target":"' JsonEscape(resolvedScriptPath) '"'
            . "}"
        sourceButtonId := runAsync ? "hotkey_script_async" : "hotkey_script"
        return this.RunBackendCommand("flowcell.run_script", payloadJson, programTabId, programName, sourceButtonId, runAsync)
    }

    RunBackendActionCommand(actionId, shortcut := "") {
        payloadJson := "{"
            . '"kind":"macro",'
            . '"label":"' JsonEscape(this.GetActionLabelById(actionId)) '",'
            . '"target":"' JsonEscape(actionId) '",'
            . '"resolved_target":"' JsonEscape(actionId) '"'
            . "}"
        return this.RunBackendCommand("flowcell.run_macro", payloadJson, 0, "", "hotkey_action")
    }

    HandleActionHotkeyInvocation(actionId, shortcut) {
        global flowCellLastActionStatusPath
        action := this.GetActionById(actionId)
        if !IsObject(action)
            return

        this.logger.Info("Action hotkey requested. Action=" actionId " | Shortcut=" shortcut)
        if action.HasOwnProp("RunFromHotkeyDirect") && action.RunFromHotkeyDirect {
            try {
                result := action.Run("")
                statusText := this.BuildActionStatus(action, result)
                WriteTextFile(flowCellLastActionStatusPath, statusText)
                this.SetActionStatus(statusText)
                this.logger.Info(
                    "Action hotkey result: "
                    . action.Id
                    . " | Attempted="
                    . BoolToWord(result.attempted)
                    . " | DeliverySucceeded="
                    . BoolToWord(result.deliverySucceeded)
                    . " | EffectConfirmed="
                    . BoolToWord(result.effectConfirmed)
                    . " | Method="
                    . result.method
                )
            } catch as err {
                statusText := action.Label " failed.`r`n" err.Message
                WriteTextFile(flowCellLastActionStatusPath, statusText)
                this.SetActionStatus(statusText)
                this.logger.Error("Action hotkey failed: " action.Id, err)
            }
            return
        }

        result := this.RunBackendActionCommand(actionId, shortcut)
        statusText := Trim(result.statusText) != "" ? result.statusText : result.detail
        this.logger.Info("Action hotkey result: " action.Id " | Attempted=" BoolToWord(result.attempted) " | Succeeded=" BoolToWord(result.succeeded) " | Method=" result.method)
        this.SetActionStatus(statusText)
    }

    GetActionById(actionId) {
        for action in this.actions {
            if action.Id = actionId
                return action
        }
        return ""
    }

    GetProgramTabConfig(programTabId, programName := "") {
        config := {
            id: Integer(programTabId),
            label: Trim(programName),
            normalizedName: StrLower(Trim(programName)),
            scriptFolder: "",
            programType: "",
            exePath: "",
            runMethod: "",
            allowedScriptExtensions: [],
            bridgeFolder: "",
            requiresRestart: false,
            defaultPanels: [],
            processNames: []
        }

        if config.id <= 0
            return config

        bindingFilePath := this.shortcutManager.bindingFilePath
        if bindingFilePath = "" || !FileExist(bindingFilePath)
            return config

        section := "ProgramTab_" config.id
        try {
            label := IniRead(bindingFilePath, section, "Label", config.label)
            normalizedName := IniRead(bindingFilePath, section, "NormalizedName", "")
            config.label := label
            config.normalizedName := normalizedName != "" ? StrLower(Trim(normalizedName)) : StrLower(Trim(label))
            config.scriptFolder := NormalizeFlowCellProgramPath(IniRead(bindingFilePath, section, "ScriptFolder", ""))
            config.programType := IniRead(bindingFilePath, section, "ProgramType", "")
            config.exePath := IniRead(bindingFilePath, section, "ExePath", "")
            config.runMethod := IniRead(bindingFilePath, section, "RunMethod", "")
            config.allowedScriptExtensions := SplitConfigList(IniRead(bindingFilePath, section, "AllowedScriptExtensions", ""))
            config.bridgeFolder := IniRead(bindingFilePath, section, "BridgeFolder", "")
            config.requiresRestart := BoolConfigValue(IniRead(bindingFilePath, section, "RequiresRestart", "0"))
            config.defaultPanels := SplitConfigList(IniRead(bindingFilePath, section, "DefaultPanels", ""))
            config.processNames := SplitConfigList(IniRead(bindingFilePath, section, "ProcessNames", ""))
        } catch as err {
            this.logger.Warn("Failed to read program tab config. Section=" section " | Error=" err.Message)
        }

        return config
    }

    ResolveConfiguredProgramExePath(programConfig) {
        if !IsObject(programConfig) || !programConfig.HasOwnProp("exePath")
            return ""
        exePath := Trim(programConfig.exePath)
        if exePath = ""
            return ""
        return exePath
    }

    FindProcessWindowByExecutable(activateExe) {
        activateExe := Trim(activateExe "")
        if activateExe = ""
            return 0

        exeName := activateExe
        targetProcessPath := ""
        if InStr(activateExe, "\") {
            targetProcessPath := StrLower(activateExe)
            SplitPath activateExe, &exeName
        }

        for hwnd in WinGetList("ahk_exe " exeName) {
            if targetProcessPath != "" {
                candidateProcessPath := ""
                try candidateProcessPath := StrLower(WinGetProcessPath("ahk_id " hwnd))
                catch
                    candidateProcessPath := ""
                if candidateProcessPath = "" || candidateProcessPath != targetProcessPath
                    continue
            }
            return hwnd
        }

        return 0
    }

    TryActivateProgramWindow(activateExe) {
        hwnd := this.FindProcessWindowByExecutable(activateExe)
        if !hwnd
            return false
        try {
            WinActivate "ahk_id " hwnd
            Sleep 100
            return true
        } catch {
            return false
        }
    }

    GetPhotoshopApplication(timeoutMs := 250) {
        deadline := A_TickCount + Max(timeoutMs, 120)
        while A_TickCount <= deadline {
            for progId in ["Photoshop.Application.150", "Photoshop.Application"] {
                try {
                    app := ComObjActive(progId)
                    if IsObject(app)
                        return app
                } catch {
                }
            }
            Sleep(35)
        }
        throw Error("Photoshop is running, but no active COM automation handle was available.")
    }

    ReadFlowCellIllustratorScriptStatus() {
        global flowCellLogsDir
        statusPath := flowCellLogsDir "\illustrator-anchor-status.txt"
        if !FileExist(statusPath)
            return ""
        try return Trim(FileRead(statusPath, "UTF-8"))
        catch {
            return ""
        }
    }

    StartDirectScriptReceiver() {
        global flowCellDirectScriptReceiverTitle
        if this.HasProp("directScriptReceiverGui") && IsObject(this.directScriptReceiverGui)
            return

        this.directScriptBusy := false
        this.directScriptTimer := ""
        this.directScriptReceiverGui := Gui("+ToolWindow -Caption", flowCellDirectScriptReceiverTitle)
        this.directScriptReceiverGui.Show("Hide")
        this.directScriptCopyDataHandler := ObjBindMethod(this, "HandleDirectScriptCopyData")
        OnMessage(0x004A, this.directScriptCopyDataHandler)
        this.logger.Info(
            "Direct script receiver started. Hwnd=0x"
            . Format("{:X}", this.directScriptReceiverGui.Hwnd)
        )
    }

    StartIllustratorAutomationPrewarm() {
        if !IsFlowCellProgramRegistered("Illustrator")
            return
        if this.illustratorAutomationPrewarmTimer = ""
            this.illustratorAutomationPrewarmTimer := ObjBindMethod(this, "RunIllustratorAutomationPrewarm")
        SetTimer this.illustratorAutomationPrewarmTimer, -250
    }

    ScheduleIllustratorAutomationPrewarm(delayMs := 5000) {
        if this.illustratorAutomationPrewarmTimer = ""
            this.illustratorAutomationPrewarmTimer := ObjBindMethod(this, "RunIllustratorAutomationPrewarm")
        SetTimer this.illustratorAutomationPrewarmTimer, -Max(delayMs, 250)
    }

    MarkIllustratorAutomationWarm() {
        try {
            hwnd := this.FindStableIllustratorWindow()
            if hwnd {
                this.illustratorAutomationPrewarmPid := WinGetPID("ahk_id " hwnd)
                this.illustratorAutomationWarmed := true
                this.illustratorAutomationLastPrewarmTick := A_TickCount
            }
        } catch {
            this.illustratorAutomationWarmed := true
            this.illustratorAutomationLastPrewarmTick := A_TickCount
        }
    }

    RunIllustratorAutomationPrewarm(*) {
        if !IsFlowCellProgramRegistered("Illustrator") {
            this.illustratorAutomationWarmed := false
            this.illustratorAutomationPrewarmPid := 0
            return
        }
        if this.illustratorAutomationPrewarmInProgress {
            this.ScheduleIllustratorAutomationPrewarm(1000)
            return
        }

        if this.illustratorAutomationLastDirectActionTick > 0
            && A_TickCount - this.illustratorAutomationLastDirectActionTick < 2500 {
            this.ScheduleIllustratorAutomationPrewarm(2500)
            return
        }

        stableHwnd := this.FindStableIllustratorWindow()
        if !stableHwnd {
            if !ProcessExist("Illustrator.exe") {
                this.illustratorAutomationWarmed := false
                this.illustratorAutomationPrewarmPid := 0
            }
            this.ScheduleIllustratorAutomationPrewarm(2000)
            return
        }

        stablePid := 0
        try stablePid := WinGetPID("ahk_id " stableHwnd)
        catch {
            stablePid := 0
        }
        if stablePid && stablePid != this.illustratorAutomationPrewarmPid {
            this.illustratorAutomationWarmed := false
            this.illustratorAutomationPrewarmPid := stablePid
        }

        keepWarmIntervalMs := 300000
        if this.illustratorAutomationWarmed
            && this.illustratorAutomationLastPrewarmTick > 0
            && A_TickCount - this.illustratorAutomationLastPrewarmTick < keepWarmIntervalMs {
            this.ScheduleIllustratorAutomationPrewarm(5000)
            return
        }

        if this.HasProp("directScriptBusy") && this.directScriptBusy {
            this.ScheduleIllustratorAutomationPrewarm(1000)
            return
        }

        scriptPath := GetFlowCellIllustratorPrewarmScriptPath()
        if !FileExist(scriptPath) {
            this.logger.Warn("Illustrator automation prewarm script is missing. Path=" scriptPath)
            this.ScheduleIllustratorAutomationPrewarm(30000)
            return
        }

        this.illustratorAutomationPrewarmInProgress := true
        startedAt := A_TickCount
        try {
            wasAlreadyWarm := this.illustratorAutomationWarmed
            result := this.RunBoundScript(scriptPath, "illustrator automation prewarm", 0, "illustrator_automation")
            elapsedMs := A_TickCount - startedAt
            if result.succeeded {
                this.illustratorAutomationWarmed := true
                this.illustratorAutomationPrewarmPid := stablePid
                this.illustratorAutomationLastPrewarmTick := A_TickCount
                if !wasAlreadyWarm || elapsedMs >= 250
                    this.logger.Info("Illustrator automation prewarm completed in " elapsedMs " ms.")
                this.ScheduleIllustratorAutomationPrewarm(5000)
            } else {
                this.illustratorAutomationWarmed := false
                this.logger.Warn("Illustrator automation prewarm did not complete. Method=" result.method " | Details=" result.detail)
                this.ScheduleIllustratorAutomationPrewarm(3000)
            }
        } catch as err {
            this.illustratorAutomationWarmed := false
            this.logger.Error("Illustrator automation prewarm failed.", err)
            this.ScheduleIllustratorAutomationPrewarm(3000)
        } finally {
            this.illustratorAutomationPrewarmInProgress := false
        }
    }

    HandleDirectScriptCopyData(wParam, lParam, msg, hwnd) {
        global flowCellDirectScriptCopyDataId
        global flowCellDirectScriptAccepted, flowCellDirectScriptBusy
        global flowCellDirectScriptBadPayload, flowCellDirectScriptBadScript

        if !this.HasProp("directScriptReceiverGui") || hwnd != this.directScriptReceiverGui.Hwnd
            return 0

        try {
            copyDataId := NumGet(lParam, 0, "UPtr")
            if copyDataId != flowCellDirectScriptCopyDataId
                return 0

            byteCount := NumGet(lParam, A_PtrSize, "UInt")
            dataPtr := NumGet(lParam, 2 * A_PtrSize, "Ptr")
            if byteCount <= 0 || !dataPtr
                return flowCellDirectScriptBadPayload

            payload := RTrim(StrGet(dataPtr, byteCount // 2, "UTF-16"), Chr(0))
            command := JsonStringValue(payload, "command")
            scriptPath := JsonStringValue(payload, "scriptPath")
            programKey := JsonStringValue(payload, "programKey")
            requestId := JsonStringValue(payload, "requestId")
            if command != "run_script_now" || scriptPath = ""
                return flowCellDirectScriptBadPayload
            if programKey = ""
                programKey := "illustrator_automation"
            if requestId = ""
                requestId := "direct-ipc-" A_TickCount

            if this.illustratorAutomationPrewarmInProgress
                return flowCellDirectScriptBusy
            if this.directScriptBusy
                return flowCellDirectScriptBusy

            scriptPath := NormalizeFlowCellProgramPath(scriptPath)
            if !FileExist(scriptPath)
                return flowCellDirectScriptBadScript

            this.directScriptBusy := true
            request := {
                scriptPath: scriptPath,
                programKey: programKey,
                requestId: requestId
            }
            this.directScriptTimer := ObjBindMethod(this, "RunDirectScriptRequest", request)
            SetTimer this.directScriptTimer, -1
            this.logger.Info(
                "Direct script accepted. RequestId="
                . requestId
                . " | ProgramKey="
                . programKey
                . " | Script="
                . scriptPath
            )
            return flowCellDirectScriptAccepted
        } catch as err {
            this.logger.Error("Direct script request could not be accepted.", err)
            return flowCellDirectScriptBadPayload
        }
    }

    RunDirectScriptFromSelf(scriptPath, programKey := "illustrator_automation", requestId := "") {
        result := {
            attempted: false,
            succeeded: false,
            method: "direct_self_not_started",
            detail: ""
        }

        if requestId = ""
            requestId := "direct-self-" A_TickCount
        if programKey = ""
            programKey := "illustrator_automation"

        if !this.HasProp("directScriptBusy")
            this.directScriptBusy := false

        if this.illustratorAutomationPrewarmInProgress {
            result.detail := "Illustrator automation prewarm is in progress."
            return result
        }
        if this.directScriptBusy {
            result.detail := "FlowCell backend is already running an Illustrator script."
            return result
        }

        scriptPath := NormalizeFlowCellProgramPath(scriptPath)
        if !FileExist(scriptPath) {
            result.detail := "Script file not found."
            return result
        }

        this.directScriptBusy := true
        request := {
            scriptPath: scriptPath,
            programKey: programKey,
            requestId: requestId
        }
        this.directScriptTimer := ObjBindMethod(this, "RunDirectScriptRequest", request)
        SetTimer this.directScriptTimer, -1
        this.logger.Info(
            "Direct script accepted. RequestId="
            . requestId
            . " | ProgramKey="
            . programKey
            . " | Script="
            . scriptPath
        )
        result.attempted := true
        result.succeeded := true
        result.method := "direct_self"
        result.detail := "Accepted by live backend."
        return result
    }

    BuildDirectScriptStatusText(scriptPath, result) {
        return JoinLines([
            "Script: " scriptPath,
            "Attempted: " BoolToWord(result.attempted),
            "Succeeded: " BoolToWord(result.succeeded),
            "Method: " result.method,
            "Details: " result.detail
        ])
    }

    RunDirectScriptRequest(request, *) {
        global flowCellLastActionStatusPath
        startedAt := A_TickCount
        try {
            result := this.RunBoundScript(
                request.scriptPath,
                "direct ipc " request.requestId,
                0,
                request.programKey
            )
            statusText := this.BuildDirectScriptStatusText(request.scriptPath, result)
            if result.succeeded {
                try FileDelete flowCellLastActionStatusPath
                catch {
                }
                this.logger.Info(
                    "Direct script completed. RequestId="
                    . request.requestId
                    . " | Succeeded=yes | RuntimeMs="
                    . (A_TickCount - startedAt)
                    . " | Method="
                    . result.method
                    . " | Script="
                    . request.scriptPath
                )
            } else {
                WriteTextFile(flowCellLastActionStatusPath, statusText)
                this.logger.Warn(
                    "Direct script failed. RequestId="
                    . request.requestId
                    . " | RuntimeMs="
                    . (A_TickCount - startedAt)
                    . " | Method="
                    . result.method
                    . " | Details="
                    . result.detail
                    . " | Script="
                    . request.scriptPath
                )
            }
        } catch as err {
            errorText := "Direct script failed.`r`n" err.Message
            WriteTextFile(flowCellLastActionStatusPath, errorText)
            this.logger.Error(
                "Direct script failed with an exception. RequestId="
                . request.requestId
                . " | Script="
                . request.scriptPath,
                err
            )
        } finally {
            this.illustratorAutomationLastDirectActionTick := A_TickCount
            this.directScriptBusy := false
            this.directScriptTimer := ""
        }
    }

    RunIllustratorScript(scriptPath, source, programConfig := 0, allowProcessFallback := true, skipWindowActivation := false) {
        result := {
            attempted: false,
            succeeded: false,
            method: "not_started",
            detail: ""
        }

        stableHwnd := 0

        scriptPath := NormalizeFlowCellProgramPath(scriptPath)
        this.logger.Info("Script run requested. Source=" source " | Script=" scriptPath)

        if scriptPath = "" {
            result.detail := "No script path was provided."
            this.logger.Warn("Script run blocked because no script path was provided.")
            return result
        }

        if !FileExist(scriptPath) {
            result.detail := "Script file not found."
            this.logger.Warn("Script run blocked because the file was not found. Path=" scriptPath)
            return result
        }

        stableHwnd := this.FindStableIllustratorWindow(programConfig)
        if !stableHwnd {
            if !allowProcessFallback {
                result.detail := "Stable Illustrator 2026 is not running. Open Illustrator before using this FlowCell tool."
                this.logger.Warn("Automation-only script run blocked because no stable Illustrator 2026 window was found.")
                return result
            }
            configuredExePath := this.ResolveConfiguredProgramExePath(programConfig)
            if configuredExePath != "" {
                try {
                    Run('"' configuredExePath '" "' scriptPath '"')
                    result.attempted := true
                    result.succeeded := true
                    result.method := "illustrator_launch_configured_exe"
                    result.detail := "Launched the configured Illustrator executable with the script path argument."
                    return result
                } catch as err {
                    result.detail := "Configured Illustrator executable launch failed. " err.Message
                    this.logger.Warn("Script run blocked because configured Illustrator launch failed. ExePath=" configuredExePath " | Error=" err.Message)
                    return result
                }
            }

            result.detail := "Stable Illustrator 2026 is not running."
            this.logger.Warn("Script run blocked because no stable Illustrator 2026 window was found.")
            return result
        }

        result.attempted := true
        result.method := allowProcessFallback
            ? "illustrator_com_activeobject"
            : "illustrator_com_automation_only"
        skipComProbe := false
        try {
            if this.HasProp("IllustratorComRetryAfterTick") && Integer(this.IllustratorComRetryAfterTick) > A_TickCount
                skipComProbe := true
        } catch {
        }
        if skipComProbe && allowProcessFallback {
            fallback := this.TryRunIllustratorScriptViaProcess(scriptPath, stableHwnd, programConfig)
            if fallback.succeeded {
                this.logger.Info(
                    "Script run used cached fallback. Source="
                    . source
                    . " | Script="
                    . scriptPath
                    . " | Method="
                    . fallback.method
                )
                return fallback
            }
        }
        foregroundAutomationOnly := !allowProcessFallback && StrLower(Trim(source)) != "illustrator automation prewarm"
        shouldActivateWindow := (allowProcessFallback || foregroundAutomationOnly) && !skipWindowActivation
        try {
            if shouldActivateWindow {
                try {
                    WinActivate "ahk_id " stableHwnd
                    WinWaitActive "ahk_id " stableHwnd, , 2
                    Sleep 80
                } catch as activationErr {
                    this.logger.Warn("Could not activate the stable Illustrator 2026 window before COM. Continuing with COM. " activationErr.Message)
                }

                if !WinActive("ahk_id " stableHwnd) {
                    this.logger.Warn("Stable Illustrator 2026 window is not foreground before COM. Continuing with COM.")
                }
            }

            app := this.GetIllustratorApplication(250, shouldActivateWindow)
            returnValue := app.DoJavaScriptFile(scriptPath)
            this.IllustratorComRetryAfterTick := 0
            result.succeeded := true
            this.MarkIllustratorAutomationWarm()
            result.detail := "DoJavaScriptFile returned without raising an error."
            illustratorStatus := this.ReadFlowCellIllustratorScriptStatus()
            if illustratorStatus != ""
                result.detail .= " Status: " illustratorStatus
            if returnValue != ""
                result.detail .= " Return value: " ValueToText(returnValue)
            this.logger.Info(
                "Script run succeeded. Source="
                . source
                . " | Script="
                . scriptPath
                . " | Method="
                . result.method
            )
            return result
        } catch as err {
            this.IllustratorComRetryAfterTick := A_TickCount + 12000
            fallback := { method: "", detail: "" }
            if allowProcessFallback {
                fallback := this.TryRunIllustratorScriptViaProcess(scriptPath, stableHwnd, programConfig)
                if fallback.succeeded {
                    this.logger.Info(
                        "Script run succeeded via fallback. Source="
                        . source
                        . " | Script="
                        . scriptPath
                        . " | Method="
                        . fallback.method
                    )
                    return fallback
                }
            }

            result.succeeded := false
            result.method := fallback.method != "" ? fallback.method : result.method
            result.detail := "COM failed: " err.Message
            if fallback.detail != ""
                result.detail .= " Process fallback failed: " fallback.detail
            this.logger.Error(
                "Script run failed. Source="
                . source
                . " | Script="
                . scriptPath
                . " | Method="
                . result.method,
                err
            )
            return result
        }
    }

    TryRunIllustratorScriptViaProcess(scriptPath, hwnd := 0, programConfig := 0) {
        result := {
            attempted: true,
            succeeded: false,
            method: "illustrator_launch_with_script_path",
            detail: ""
        }

        if !hwnd
            hwnd := this.FindStableIllustratorWindow(programConfig)

        processPath := ""
        if hwnd {
            try {
                WinActivate "ahk_id " hwnd
                WinWaitActive "ahk_id " hwnd, , 2
                Sleep 80
            } catch as activationErr {
                this.logger.Warn("Could not activate Illustrator before process script launch. Continuing with launch. " activationErr.Message)
            }
            try processPath := WinGetProcessPath("ahk_id " hwnd)
            catch as err {
                result.detail := "Could not resolve the stable Illustrator executable path. " err.Message
                return result
            }
        } else {
            processPath := this.ResolveConfiguredProgramExePath(programConfig)
            if processPath = "" {
                result.detail := "No Illustrator executable was available for process fallback."
                return result
            }
        }

        try {
            Run('"' processPath '" "' scriptPath '"')
            result.succeeded := true
            result.detail := "Launched Illustrator with the script path argument."
            return result
        } catch as err {
            result.detail := "Launching Illustrator with the script path argument failed. " err.Message
            return result
        }
    }

    RunPhotoshopScript(scriptPath, source, programConfig := 0) {
        result := {
            attempted: false,
            succeeded: false,
            method: "not_started",
            detail: ""
        }

        scriptPath := NormalizeFlowCellProgramPath(scriptPath)
        this.logger.Info("Photoshop script run requested. Source=" source " | Script=" scriptPath)

        if scriptPath = "" {
            result.detail := "No script path was provided."
            return result
        }
        if !FileExist(scriptPath) {
            result.detail := "Script file not found."
            return result
        }

        configuredExePath := this.ResolveConfiguredProgramExePath(programConfig)
        if configuredExePath != ""
            this.TryActivateProgramWindow(configuredExePath)
        else
            this.TryActivateProgramWindow("Photoshop.exe")

        result.attempted := true
        result.method := "photoshop_com_activeobject"
        try {
            app := this.GetPhotoshopApplication()
            app.DoJavaScriptFile(scriptPath)
            result.succeeded := true
            result.detail := "DoJavaScriptFile returned without raising an error."
            return result
        } catch as err {
            fallbackExe := configuredExePath != "" ? configuredExePath : "Photoshop.exe"
            fallback := this.RunGenericScript(scriptPath, source, fallbackExe, "photoshop_launch_with_script_path")
            if fallback.succeeded
                return fallback

            result.succeeded := false
            result.method := fallback.method != "" ? fallback.method : result.method
            result.detail := "COM failed: " err.Message
            if fallback.detail != ""
                result.detail .= " Process fallback failed: " fallback.detail
            this.logger.Error("Photoshop script run failed. Source=" source " | Script=" scriptPath, err)
            return result
        }
    }

    TryRunIllustratorScriptViaMenu(scriptPath, hwnd := 0) {
        result := {
            attempted: true,
            succeeded: false,
            method: "illustrator_scripts_menu",
            detail: ""
        }

        if !hwnd
            hwnd := this.FindStableIllustratorWindow()
        if !hwnd {
            result.detail := "No stable Illustrator 2026 window was available for File > Scripts."
            return result
        }

        scriptFileName := ""
        scriptBaseName := ""
        SplitPath scriptPath, &scriptFileName, , , &scriptBaseName
        targetNames := []
        if scriptBaseName != ""
            targetNames.Push(scriptBaseName)
        if scriptFileName != "" && scriptFileName != scriptBaseName
            targetNames.Push(scriptFileName)

        try {
            WinActivate "ahk_id " hwnd
            WinWaitActive "ahk_id " hwnd, , 2
        } catch as err {
            result.detail := "Could not activate the stable Illustrator 2026 window. " err.Message
            return result
        }

        Sleep 150
        SendEvent "{Escape}"
        Sleep 80
        SendEvent "!f"

        desktop := ""
        try desktop := UIA.GetRootElement()
        catch as err {
            result.detail := "UI Automation root was not available. " err.Message
            return result
        }

        scriptsItem := ""
        try scriptsItem := desktop.WaitElement({Type:"MenuItem", Name:"Scripts", mm:"Substring"}, 1500)
        catch
            scriptsItem := ""
        if !IsObject(scriptsItem) {
            this.logger.Warn("The File > Scripts menu was not exposed in stable Illustrator 2026. Trying keyboard fallback.")
            return this.TryRunIllustratorScriptViaKeyboard(scriptPath, hwnd)
        }

        openMethod := this.TryMenuItemInvoke(scriptsItem, true)
        if openMethod = "" {
            SendEvent "{Escape}"
            this.logger.Warn("The File > Scripts menu could not be opened through UIA. Trying keyboard fallback.")
            return this.TryRunIllustratorScriptViaKeyboard(scriptPath, hwnd)
        }

        Sleep 150
        scriptItem := ""
        for targetName in targetNames {
            try scriptItem := desktop.WaitElement({Type:"MenuItem", Name:targetName, mm:"Substring"}, 1200)
            catch
                scriptItem := ""
            if IsObject(scriptItem)
                break
        }

        if !IsObject(scriptItem) {
            SendEvent "{Escape}"
            this.logger.Warn("The target script menu item was not found through UIA. Trying keyboard fallback.")
            return this.TryRunIllustratorScriptViaKeyboard(scriptPath, hwnd)
        }

        invokeMethod := this.TryMenuItemInvoke(scriptItem, false)
        if invokeMethod = "" {
            SendEvent "{Escape}"
            this.logger.Warn("The target script menu item could not be invoked through UIA. Trying keyboard fallback.")
            return this.TryRunIllustratorScriptViaKeyboard(scriptPath, hwnd)
        }

        result.succeeded := true
        result.detail := "Invoked File > Scripts > " (targetNames.Length ? targetNames[1] : scriptPath) " using " openMethod " then " invokeMethod "."
        return result
    }

    TryRunIllustratorScriptViaKeyboard(scriptPath, hwnd := 0) {
        result := {
            attempted: true,
            succeeded: false,
            method: "illustrator_scripts_menu_keyboard",
            detail: ""
        }

        if !hwnd
            hwnd := this.FindStableIllustratorWindow()
        if !hwnd {
            result.detail := "No stable Illustrator 2026 window was available for keyboard File > Scripts fallback."
            return result
        }

        scriptFileName := ""
        scriptBaseName := ""
        SplitPath scriptPath, &scriptFileName, , , &scriptBaseName
        if scriptBaseName = ""
            scriptBaseName := scriptFileName
        if scriptBaseName = "" {
            result.detail := "The target script name could not be resolved."
            return result
        }

        try {
            WinActivate "ahk_id " hwnd
            WinWaitActive "ahk_id " hwnd, , 2
        } catch as err {
            result.detail := "Could not activate the stable Illustrator 2026 window for keyboard fallback. " err.Message
            return result
        }

        Sleep 150
        SendEvent "{Escape}"
        Sleep 100
        SendEvent "!f"
        Sleep 220
        SendText "s"
        Sleep 220
        SendText scriptBaseName
        Sleep 220
        SendEvent "{Enter}"

        result.succeeded := true
        result.detail := "Invoked keyboard fallback for File > Scripts > " scriptBaseName "."
        return result
    }

    TryMenuItemInvoke(element, openSubmenu := false) {
        if !IsObject(element)
            return ""

        try {
            clickResult := element.Click()
            if clickResult
                return clickResult
        } catch as err {
            this.logger.Warn("UIA menu click failed: " err.Message)
        }

        try {
            element.SetFocus()
            Sleep 80
            SendEvent(openSubmenu ? "{Right}" : "{Enter}")
            return openSubmenu ? "focus_right" : "focus_enter"
        } catch as err {
            this.logger.Warn("UIA menu focus fallback failed: " err.Message)
        }

        return ""
    }

    RunBoundScript(scriptPath, source, programTabId := 0, programName := "") {
        if programName = ""
            programName := this.GetProgramNameFromBinding(programTabId, scriptPath)

        programConfig := this.GetProgramTabConfig(programTabId, programName)
        resolvedProgramName := Trim(programConfig.label != "" ? programConfig.label : programName)
        if resolvedProgramName = ""
            resolvedProgramName := this.GetProgramNameFromBinding(programTabId, scriptPath)
        resolvedProgramKey := StrLower(Trim(programConfig.runMethod))
        if resolvedProgramKey = ""
            resolvedProgramKey := StrLower(Trim(resolvedProgramName))

        switch resolvedProgramKey {
            case "illustrator_automation":
                return this.RunIllustratorScript(scriptPath, source, programConfig, false)
            case "illustrator_direct":
                return this.RunIllustratorScript(scriptPath, source, programConfig)
            case "illustrator_process":
                return this.TryRunIllustratorScriptViaProcess(scriptPath, 0, programConfig)
            case "photoshop_direct":
                return this.RunPhotoshopScript(scriptPath, source, programConfig)
            case "blender_bridge":
                activateExe := this.ResolveConfiguredProgramExePath(programConfig)
                if activateExe = ""
                    activateExe := "Blender.exe"
                return this.RunGenericScript(scriptPath, source, activateExe, "blender_bridge")
            case "generic":
                activateExe := this.ResolveConfiguredProgramExePath(programConfig)
                return this.RunGenericScript(scriptPath, source, activateExe, "generic")
            case "windows_generic":
                return this.RunGenericScript(scriptPath, source, "", "windows_generic")
        }

        return this.RunGenericScript(
            scriptPath,
            source,
            this.ResolveConfiguredProgramExePath(programConfig),
            "generic"
        )
    }

    GetProgramNameFromBinding(programTabId, scriptPath := "") {
        config := this.GetProgramTabConfig(programTabId)
        if Trim(config.label) != ""
            return Trim(config.label)
        normalizedPath := StrReplace(scriptPath, "/", "\")
        marker := "\Programs\"
        markerIndex := InStr(StrLower(normalizedPath), StrLower(marker))
        if markerIndex > 0 {
            remainder := SubStr(normalizedPath, markerIndex + StrLen(marker))
            separatorIndex := InStr(remainder, "\")
            if separatorIndex > 1
                return SubStr(remainder, 1, separatorIndex - 1)
        }
        return ""
    }

    RunGenericScript(scriptPath, source, activateExe := "", methodPrefix := "generic") {
        global flowCellLastActionStatusPath
        result := {
            attempted: false,
            succeeded: false,
            method: methodPrefix,
            detail: "",
            exitCode: "",
            statusText: ""
        }

        scriptPath := NormalizeFlowCellProgramPath(scriptPath)
        if scriptPath = "" {
            result.detail := "No script path was provided."
            return result
        }
        if !FileExist(scriptPath) {
            result.detail := "Script file not found."
            return result
        }

        if activateExe != "" {
            this.TryActivateProgramWindow(activateExe)
        }

        result.attempted := true
        try {
            statusBefore := ""
            if FileExist(flowCellLastActionStatusPath) {
                try statusBefore := FileRead(flowCellLastActionStatusPath, "UTF-8")
                catch
                    statusBefore := ""
            }

            SplitPath scriptPath, , , &extension
            extension := "." StrLower(extension)
            exitCode := 0
            if extension = ".ps1" {
                powershellArgs := '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Sta '
                exitCode := RunWait('powershell.exe ' powershellArgs '-File "' scriptPath '"', , "Hide")
            } else if extension = ".cmd" || extension = ".bat" {
                exitCode := RunWait(A_ComSpec ' /c "' scriptPath '"', , "Hide")
            } else {
                exitCode := RunWait('"' scriptPath '"')
            }

            statusAfter := ""
            if FileExist(flowCellLastActionStatusPath) {
                try statusAfter := FileRead(flowCellLastActionStatusPath, "UTF-8")
                catch
                    statusAfter := ""
            }
            if statusAfter = statusBefore
                statusAfter := ""

            result.exitCode := exitCode
            if statusAfter != ""
                result.statusText := RTrim(statusAfter, "`r`n")

            if exitCode = 0 {
                result.succeeded := true
                result.detail := result.statusText != "" ? result.statusText : "Script launched successfully."
            } else {
                result.succeeded := false
                result.method := methodPrefix "_exit_code"
                result.detail := result.statusText != "" ? result.statusText : "Script exited with code " exitCode "."
            }
        } catch as err {
            result.succeeded := false
            result.detail := err.Message
        }
        return result
    }

    ResetMacroStop() {
        this.macroStopRequested := false
    }

    HandleEmergencyMacroStop(*) {
        this.macroStopRequested := true
        this.logger.Warn("Emergency macro stop requested via Pause hotkey.")
        if HasProp(this, "actionStatusEdit") && IsObject(this.actionStatusEdit) {
            this.actionStatusEdit.Value := JoinLines([
                "Emergency stop requested.",
                "",
                "The current recorded macro will stop at the next safe step boundary.",
                "Hotkey: Pause"
            ])
        }
    }

    ThrowIfMacroStopRequested(context := "recorded macro") {
        if this.macroStopRequested
            throw Error("Stopped by Pause hotkey during " context ".")
    }

    SleepWithMacroStop(delayMs, context := "recorded macro delay") {
        remaining := Max(delayMs, 0)
        while remaining > 0 {
            this.ThrowIfMacroStopRequested(context)
            slice := remaining > 50 ? 50 : remaining
            Sleep slice
            remaining -= slice
        }
    }

    GetIllustratorApplication(timeoutMs := 250, activateWindow := true) {
        deadline := A_TickCount + Max(timeoutMs, 120)
        while A_TickCount <= deadline {
            hwnd := this.FindStableIllustratorWindow()

            if hwnd && activateWindow {
                try WinActivate "ahk_id " hwnd
                catch {
                }
                Sleep(35)
            }

            for progId in ["Illustrator.Application.30", "Illustrator.Application"] {
                try {
                    app := ComObjActive(progId)
                    if IsObject(app)
                        return app
                } catch {
                }
            }

            for candidateHwnd in WinGetList("ahk_exe Illustrator.exe") {
                if !this.IsStableIllustratorWindow(candidateHwnd)
                    continue
                if activateWindow {
                    try WinActivate "ahk_id " candidateHwnd
                    catch {
                    }
                    Sleep(20)
                }

                for progId in ["Illustrator.Application.30", "Illustrator.Application"] {
                    try {
                        app := ComObjActive(progId)
                        if IsObject(app)
                            return app
                    } catch {
                    }
                }
            }

            Sleep(25)
        }
        throw Error("Illustrator is running, but no active COM automation handle was available.")
    }
}

class IllustratorScanner {
    __New(logger, stateFilePath := "") {
        global flowCellScanStatePath
        this.logger := logger
        this.stateFilePath := stateFilePath != "" ? stateFilePath : flowCellScanStatePath
    }

    Scan() {
        result := {
            timestamp: FormatTime(, "yyyy-MM-dd HH:mm:ss"),
            illustratorOpen: false,
            windows: [],
            scannedRoots: [],
            scanMode: "full_scan",
            activeWindow: "",
            rootSummary: "",
            layersCandidates: [],
            relatedRoots: [],
            deleteCandidates: [],
            toolbarCandidates: [],
            exactDeleteControl: "",
            bottomToolbarControl: "",
            panelMenuButton: "",
            derivedDeleteSlot: "",
            readyForActions: false
        }

        this.logger.Info("Starting Illustrator UI scan.")

        if !ProcessExist("Illustrator.exe") {
            this.logger.Warn("Illustrator.exe is not running.")
            this.logger.WriteScanReport(this.BuildReport(result))
            return result
        }

        result.illustratorOpen := true
        handles := WinGetList("ahk_exe Illustrator.exe")
        for hwnd in handles
            result.windows.Push(this.BuildWindowInfo(hwnd))

        if result.windows.Length = 0 {
            this.logger.Warn("Illustrator process exists, but no top-level windows were returned by WinGetList.")
            this.logger.WriteScanReport(this.BuildReport(result))
            return result
        }

        result.activeWindow := this.ChooseTargetWindow(result.windows)
        rootInfos := []
        seenRootHandles := Map()
        for window in result.windows {
            this.TryAddRootInfo(rootInfos, seenRootHandles, result.scannedRoots, window, window.hwnd, "top-level")

            for childHwnd in this.GetChildWindowHandles(window.hwnd, 4)
                this.TryAddRootInfo(rootInfos, seenRootHandles, result.scannedRoots, window, childHwnd, "child")
        }

        if rootInfos.Length = 0 {
            this.logger.Warn("No usable UIA roots were returned for any Illustrator top-level window.")
            this.logger.WriteScanReport(this.BuildReport(result))
            return result
        }

        preferredRoot := this.GetRootInfoForWindow(rootInfos, result.activeWindow)
        if IsObject(preferredRoot)
            result.rootSummary := preferredRoot.rootSummary

        if this.TryFastPathScan(&result, rootInfos) {
            this.logger.WriteScanReport(this.BuildReport(result))
            return result
        }

        for rootInfo in rootInfos {
            windowCandidates := this.FindLayersCandidates(rootInfo.root, rootInfo.window, rootInfo.rootSummary)
            for candidate in windowCandidates
                result.layersCandidates.Push(candidate)
        }

        bestLayers := this.GetBestCandidate(result.layersCandidates)

        if IsObject(bestLayers) {
            this.PopulateActionTargets(result, bestLayers)
        } else {
            this.logger.Warn("No likely Layers-panel container was exposed in any scanned Illustrator window.")
        }

        this.logger.WriteScanReport(this.BuildReport(result))
        return result
    }

    TryFastPathScan(&result, rootInfos) {
        cachedRootInfo := this.MatchCachedRootInfo(rootInfos)
        if !IsObject(cachedRootInfo)
            return false

        this.logger.Info(
            "Fast-path cache probe matched root hwnd=0x"
            . Format("{:X}", cachedRootInfo.hwnd)
            . " | Class="
            . SafeDisplay(cachedRootInfo.className)
        )

        fastCandidates := this.FindLayersCandidates(cachedRootInfo.root, cachedRootInfo.window, cachedRootInfo.rootSummary)
        bestLayers := this.GetBestCandidate(fastCandidates)
        if !IsObject(bestLayers) {
            result.scanMode := "fast_path_cache_miss_then_full_scan"
            this.logger.Warn("Fast-path cache probe found no viable Layers candidate. Falling back to full scan.")
            return false
        }

        result.layersCandidates := fastCandidates
        this.PopulateActionTargets(result, bestLayers)
        if result.readyForActions {
            result.scanMode := "fast_path_cache_hit"
            this.logger.Info("Fast-path cache hit succeeded.")
            return true
        }

        result.scanMode := "fast_path_cache_miss_then_full_scan"
        result.layersCandidates := []
        result.relatedRoots := []
        result.deleteCandidates := []
        result.toolbarCandidates := []
        result.exactDeleteControl := ""
        result.bottomToolbarControl := ""
        result.panelMenuButton := ""
        result.derivedDeleteSlot := ""
        result.readyForActions := false
        this.logger.Warn("Fast-path cache probe did not expose the exact Layers delete control. Falling back to full scan.")
        return false
    }

    PopulateActionTargets(result, bestLayers) {
        result.activeWindow := bestLayers.window
        result.rootSummary := bestLayers.rootSummary
        result.relatedRoots := []
        searchRoots := this.GetRelatedRoots(bestLayers.element)
        for relatedRoot in searchRoots
            result.relatedRoots.Push(this.ElementSummary(relatedRoot))

        deleteCandidates := []
        toolbarCandidates := []
        result.exactDeleteControl := this.FindExactDeleteControl(searchRoots, &deleteCandidates)
        result.bottomToolbarControl := this.FindBottomToolbarControl(searchRoots, &toolbarCandidates)
        result.deleteCandidates := deleteCandidates
        result.toolbarCandidates := toolbarCandidates
        result.panelMenuButton := this.FindPanelMenuButton(searchRoots)
        result.derivedDeleteSlot := this.BuildDerivedDeleteSlot(bestLayers.element, result.bottomToolbarControl)
        result.readyForActions := IsObject(result.exactDeleteControl)

        if result.readyForActions {
            this.SaveSuccessfulRootCache(bestLayers)
            this.SaveExactDeleteControlCache(result.exactDeleteControl)
        }
    }

    BuildWindowInfo(hwnd) {
        title := ""
        className := ""
        try title := WinGetTitle("ahk_id " hwnd)
        try className := WinGetClass("ahk_id " hwnd)
        return {
            hwnd: hwnd,
            title: title,
            className: className,
            visible: this.IsWindowVisible(hwnd)
        }
    }

    TryAddRootInfo(rootInfos, seenRootHandles, scannedRoots, window, hwnd, source) {
        if !hwnd || seenRootHandles.Has(hwnd)
            return

        seenRootHandles[hwnd] := true
        root := ""
        try root := UIA.ElementFromHandle("ahk_id " hwnd, , false)
        catch as err {
            this.logger.Warn(
                "UIA.ElementFromHandle failed for "
                . source
                . " hwnd=0x"
                . Format("{:X}", hwnd)
                . " | "
                . err.Message
            )
            return
        }

        if !IsObject(root) {
            this.logger.Warn(
                "UIA.ElementFromHandle returned no element for "
                . source
                . " hwnd=0x"
                . Format("{:X}", hwnd)
            )
            return
        }

        info := this.BuildWindowInfo(hwnd)
        rootSummary := this.ElementSummary(root)
        rootInfos.Push({
            window: window,
            root: root,
            rootSummary: rootSummary,
            hwnd: hwnd,
            source: source,
            className: info.className,
            title: info.title,
            visible: info.visible
        })
        scannedRoots.Push({
            hwnd: hwnd,
            source: source,
            className: info.className,
            title: info.title,
            summary: rootSummary
        })
    }

    GetChildWindowHandles(rootHwnd, maxDepth := 3) {
        handles := []
        seen := Map()
        queue := [{ hwnd: rootHwnd, depth: 0 }]

        while queue.Length > 0 {
            item := queue.RemoveAt(1)
            if item.depth >= maxDepth
                continue

            childHandles := []
            try childHandles := WinGetControlsHwnd("ahk_id " item.hwnd)
            catch
                childHandles := []

            for childHwnd in childHandles {
                if !childHwnd || seen.Has(childHwnd)
                    continue
                seen[childHwnd] := true
                handles.Push(childHwnd)
                queue.Push({ hwnd: childHwnd, depth: item.depth + 1 })
            }
        }

        return handles
    }

    LoadSuccessfulRootCache() {
        if !FileExist(this.stateFilePath)
            return ""

        section := "LastSuccessfulLayersRoot"
        try {
            return {
                rootHwnd: Integer(IniRead(this.stateFilePath, section, "RootHwnd", "0")),
                className: IniRead(this.stateFilePath, section, "ClassName", ""),
                typeName: IniRead(this.stateFilePath, section, "TypeName", ""),
                x: Integer(IniRead(this.stateFilePath, section, "X", "0")),
                y: Integer(IniRead(this.stateFilePath, section, "Y", "0")),
                w: Integer(IniRead(this.stateFilePath, section, "W", "0")),
                h: Integer(IniRead(this.stateFilePath, section, "H", "0"))
            }
        } catch as err {
            this.logger.Warn("Failed to read fast-path scan cache. " err.Message)
            return ""
        }
    }

    SaveSuccessfulRootCache(candidate) {
        element := candidate.element
        rootHwnd := this.SafeProp(element, "NativeWindowHandle")
        if !rootHwnd
            return

        rect := this.GetElementRect(element)
        section := "LastSuccessfulLayersRoot"
        IniWrite rootHwnd, this.stateFilePath, section, "RootHwnd"
        IniWrite this.SafeText(this.SafeProp(element, "ClassName")), this.stateFilePath, section, "ClassName"
        IniWrite this.TypeName(this.SafeProp(element, "Type")), this.stateFilePath, section, "TypeName"
        IniWrite IsObject(rect) ? rect.x : 0, this.stateFilePath, section, "X"
        IniWrite IsObject(rect) ? rect.y : 0, this.stateFilePath, section, "Y"
        IniWrite IsObject(rect) ? rect.w : 0, this.stateFilePath, section, "W"
        IniWrite IsObject(rect) ? rect.h : 0, this.stateFilePath, section, "H"
        this.logger.Info("Saved fast-path cache for Layers root hwnd=0x" Format("{:X}", rootHwnd))
    }

    LoadExactDeleteControlCache() {
        if !FileExist(this.stateFilePath)
            return ""

        section := "LastSuccessfulExactDeleteControl"
        try {
            return {
                x: Integer(IniRead(this.stateFilePath, section, "X", "0")),
                y: Integer(IniRead(this.stateFilePath, section, "Y", "0")),
                w: Integer(IniRead(this.stateFilePath, section, "W", "0")),
                h: Integer(IniRead(this.stateFilePath, section, "H", "0"))
            }
        } catch as err {
            this.logger.Warn("Failed to read exact delete control cache. " err.Message)
            return ""
        }
    }

    SaveExactDeleteControlCache(candidate) {
        if !IsObject(candidate) || !IsObject(candidate.element)
            return

        rect := this.GetElementRect(candidate.element)
        if !IsObject(rect)
            return

        section := "LastSuccessfulExactDeleteControl"
        IniWrite rect.x, this.stateFilePath, section, "X"
        IniWrite rect.y, this.stateFilePath, section, "Y"
        IniWrite rect.w, this.stateFilePath, section, "W"
        IniWrite rect.h, this.stateFilePath, section, "H"
        this.logger.Info("Saved exact delete control cache. Bounds=" rect.x "," rect.y "," rect.w "," rect.h)
    }

    MatchCachedRootInfo(rootInfos) {
        signature := this.LoadSuccessfulRootCache()
        if !IsObject(signature)
            return ""

        best := ""
        for rootInfo in rootInfos {
            score := this.ScoreRootInfoAgainstCache(rootInfo, signature)
            if score <= 0
                continue
            if !IsObject(best) || score > best.score
                best := { rootInfo: rootInfo, score: score }
        }

        if IsObject(best) && best.score >= 140
            return best.rootInfo

        return ""
    }

    ScoreRootInfoAgainstCache(rootInfo, signature) {
        score := 0
        rootClass := StrLower(rootInfo.className)
        cachedClass := StrLower(signature.className)
        rootType := this.TypeName(this.SafeProp(rootInfo.root, "Type"))

        if signature.rootHwnd && rootInfo.hwnd = signature.rootHwnd
            score += 400
        if cachedClass != "" && rootClass = cachedClass
            score += 80
        if signature.typeName != "" && rootType = signature.typeName
            score += 50
        if rootInfo.source = "child"
            score += 10

        rect := this.GetElementRect(rootInfo.root)
        if IsObject(rect) {
            if Abs(rect.x - signature.x) <= 140
                score += 15
            if Abs(rect.y - signature.y) <= 140
                score += 15
            if Abs(rect.w - signature.w) <= 160
                score += 15
            if Abs(rect.h - signature.h) <= 220
                score += 15
        }

        return score
    }

    ChooseTargetWindow(windows) {
        activeHwnd := WinActive("ahk_exe Illustrator.exe")
        best := ""
        for window in windows {
            score := 0
            title := StrLower(window.title)
            className := StrLower(window.className)

            if window.visible
                score += 100
            if window.hwnd = activeHwnd
                score += 500
            if className = "illustrator"
                score += 180
            else if InStr(className, "owl.framedrawer")
                score -= 20
            else if InStr(className, "owl.shadowview")
                score -= 40
            if title != ""
                score += 120
            if InStr(title, "preview") || InStr(title, "%")
                score += 40

            if !IsObject(best) || score > best.score
                best := { window: window, score: score }
        }

        return IsObject(best) ? best.window : windows[1]
    }

    GetRootInfoForWindow(rootInfos, window) {
        if !IsObject(window)
            return ""
        for rootInfo in rootInfos {
            if rootInfo.window.hwnd = window.hwnd
                return rootInfo
        }
        return ""
    }

    FindLayersCandidates(root, window := "", rootSummary := "") {
        candidates := []
        seen := Map()
        elements := []
        layersAnchors := this.FindLayersAnchors(root)

        if layersAnchors.Length > 0 {
            for anchor in layersAnchors {
                for element in this.GetCandidateAncestors(anchor, root, 5)
                    elements.Push(element)
            }
        } else {
            this.logger.Warn(
                "No UIA anchor named Layers was exposed in this Illustrator window."
                . " Using constrained fallback panel search only."
            )
            try {
                extra := root.FindElements([
                    {Type:"Pane"},
                    {Type:"Group"},
                    {Type:"Custom"},
                    {Type:"Tree"},
                    {Type:"List"}
                ])
                for element in extra {
                    if this.IsConstrainedPanelCandidate(element, root)
                        elements.Push(element)
                }
            } catch as err {
                this.logger.Warn("Constrained Layers-candidate search failed: " err.Message)
            }
        }

        for element in elements {
            summary := this.ElementSummary(element)
            if seen.Has(summary)
                continue
            seen[summary] := true

            score := this.ScoreLayersCandidate(element)
            if score < 28
                continue

            candidate := {
                element: element,
                score: score,
                summary: summary,
                window: window,
                rootSummary: rootSummary,
                looksLikeActions: this.LooksLikeActionsPanel(element),
                hasLayersAnchor: this.HasLayersAnchor(element)
            }
            candidates.Push(candidate)
            this.logger.Info(
                "Layers candidate: "
                . candidate.summary
                . " | Score="
                . candidate.score
                . " | HasLayersAnchor="
                . BoolToWord(candidate.hasLayersAnchor)
                . " | LooksLikeActions="
                . BoolToWord(candidate.looksLikeActions)
                . " | WindowClass="
                . (IsObject(window) ? SafeDisplay(window.className) : "(unknown)")
            )
        }

        return candidates
    }

    ScoreLayersCandidate(element) {
        score := 0
        name := StrLower(this.SafeText(this.SafeProp(element, "Name")))
        typeName := this.TypeName(this.SafeProp(element, "Type"))
        rect := this.GetElementRect(element)
        descriptor := this.DescriptorText(element)

        if this.IsMainIllustratorWindow(element)
            return -1000

        if name = "layers"
            score += 40
        else if InStr(name, "layers")
            score += 25
        else if InStr(descriptor, "layers")
            score += 15

        if this.HasLayersAnchor(element)
            score += 120

        if name = "actions" || InStr(descriptor, "actions")
            score -= 120

        if this.LooksLikeActionsPanel(element)
            score -= 220

        if typeName = "Pane" || typeName = "Group" || typeName = "Custom" || typeName = "Window"
            score += 20
        else if typeName = "Tree" || typeName = "List"
            score += 12

        if IsObject(rect) {
            if rect.h > 180
                score += 12
            if rect.h > rect.w
                score += 8
            if rect.w > 140 && rect.w < 900
                score += 6
        }

        if this.HasBottomToolbarControls(element)
            score += 18

        if this.CountActionableDescendants(element) >= 4
            score += 8

        return score
    }

    HasBottomToolbarControls(element) {
        toolbarCandidates := []
        return IsObject(this.FindBottomToolbarControl([element], &toolbarCandidates))
    }

    GetBestCandidate(candidates) {
        best := ""
        for candidate in candidates {
            if !IsObject(best) || candidate.score > best.score
                best := candidate
        }
        return best
    }

    GetRelatedRoots(layersElement) {
        roots := [layersElement]
        try {
            parent := layersElement.Parent
            if IsObject(parent)
                roots.Push(parent)
        } catch {
        }
        return roots
    }

    FindExactDeleteControl(searchRoots, &candidateLog) {
        candidateLog := []
        matches := []
        seen := Map()

        for searchRoot in searchRoots {
            if this.LooksLikeActionsPanel(searchRoot) {
                this.logger.Warn("Skipping exact delete search inside a panel that matches Actions-panel signatures.")
                continue
            }

            for candidate in this.FindActionableDescendants(searchRoot) {
                descriptor := this.DescriptorText(candidate)
                if !(InStr(descriptor, "delete") || InStr(descriptor, "trash"))
                    continue

                summary := this.ElementSummary(candidate) " | Descriptor=`"`"" descriptor "`"`""
                candidateLog.Push(summary)

                if InStr(descriptor, "delete selection") || (InStr(descriptor, "delete") && InStr(descriptor, "selection")) {
                    key := this.ElementIdentity(candidate)
                    if seen.Has(key)
                        continue
                    seen[key] := true
                    matches.Push({
                        element: candidate,
                        summary: this.ElementSummary(candidate),
                        reason: "Accessible descriptor exposed Delete Selection on the control itself."
                    })
                }
            }
        }

        if matches.Length = 1
            return matches[1]

        if matches.Length > 1
            this.logger.Warn("Multiple exact delete-like controls were exposed. Refusing the exact method.")

        if candidateLog.Length = 0
            this.logger.Warn("No delete-like actionable controls were exposed around the Layers panel.")

        return ""
    }

    FindBottomToolbarControl(searchRoots, &candidateLog) {
        candidateLog := []
        best := ""

        for searchRoot in searchRoots {
            rootRect := this.GetElementRect(searchRoot)
            if !IsObject(rootRect)
                continue

            for candidate in this.FindActionableDescendants(searchRoot) {
                candidateRect := this.GetElementRect(candidate)
                if !IsObject(candidateRect)
                    continue
                if !this.IsBottomToolbarRect(candidateRect, rootRect)
                    continue
                if candidateRect.w < 10 || candidateRect.h < 10
                    continue
                if candidateRect.w > 90 || candidateRect.h > 90
                    continue

                descriptor := this.DescriptorText(candidate)
                centerX := candidateRect.x + Floor(candidateRect.w / 2)
                score := centerX
                if InStr(descriptor, "delete") || InStr(descriptor, "trash")
                    score += 5000

                summary := this.ElementSummary(candidate) " | Descriptor=`"`"" descriptor "`"`""
                candidateLog.Push(summary)

                if !IsObject(best) || score > best.score {
                    best := {
                        element: candidate,
                        summary: this.ElementSummary(candidate),
                        score: score,
                        reason: "Chosen as the rightmost exposed small control in the bottom strip of the scanned Layers panel."
                    }
                }
            }
        }

        if !IsObject(best) && candidateLog.Length = 0
            this.logger.Warn("No exposed bottom-toolbar controls were found around the Layers panel.")

        return best
    }

    FindPanelMenuButton(searchRoots) {
        candidates := []

        for searchRoot in searchRoots {
            rootRect := this.GetElementRect(searchRoot)
            if !IsObject(rootRect)
                continue

            elements := []
            try elements := searchRoot.FindElements([{Type:"Button"}, {Type:"SplitButton"}])
            catch
                elements := []

            for element in elements {
                rect := this.GetElementRect(element)
                if !IsObject(rect)
                    continue
                if rect.y + rect.h > rootRect.y + Floor(rootRect.h * 0.35)
                    continue

                descriptor := this.DescriptorText(element)
                if !(InStr(descriptor, "menu") || InStr(descriptor, "option") || InStr(descriptor, "more"))
                    continue

                candidates.Push({
                    element: element,
                    summary: this.ElementSummary(element)
                })
            }
        }

        if candidates.Length = 1
            return candidates[1]

        if candidates.Length > 1
            this.logger.Warn("Multiple possible Layers panel menu buttons were exposed. Refusing the menu-path method.")

        return ""
    }

    BuildDerivedDeleteSlot(layersElement, bottomToolbarControl) {
        if IsObject(bottomToolbarControl) {
            rect := this.GetElementRect(bottomToolbarControl.element)
            if IsObject(rect) {
                return {
                    x: rect.x + Floor(rect.w / 2),
                    y: rect.y + Floor(rect.h / 2),
                    reason: "Used the center point of the exposed rightmost bottom-toolbar control."
                }
            }
        }

        baseRect := this.GetElementRect(layersElement)
        if !IsObject(baseRect)
            return ""

        if baseRect.w < 80 || baseRect.h < 80
            return ""

        return {
            x: baseRect.x + baseRect.w - 18,
            y: baseRect.y + baseRect.h - 16,
            reason: "Derived from the scanned Layers-panel bounding rectangle because no exact delete control was exposed."
        }
    }

    FindActionableDescendants(root) {
        elements := []
        results := []
        try elements := root.FindElements([{Type:"Button"}, {Type:"SplitButton"}, {Type:"Custom"}])
        catch
            elements := []

        for element in elements
            results.Push(element)

        return results
    }

    CountActionableDescendants(root) {
        return this.FindActionableDescendants(root).Length
    }

    FindLayersAnchors(root) {
        anchors := []
        seen := Map()
        specs := [
            {Name:"Layers"},
            {Name:"Layers", mm:"Substring"}
        ]

        for spec in specs {
            found := []
            try found := root.FindElements(spec)
            catch
                found := []

            for anchor in found {
                summary := this.ElementSummary(anchor)
                if seen.Has(summary)
                    continue
                seen[summary] := true
                anchors.Push(anchor)
            }
        }

        return anchors
    }

    GetCandidateAncestors(element, stopRoot := "", maxDepth := 5) {
        ancestors := []
        current := element
        depth := 0

        while IsObject(current) && depth < maxDepth {
            if !this.IsMainIllustratorWindow(current)
                ancestors.Push(current)

            if IsObject(stopRoot) && this.ElementIdentity(current) = this.ElementIdentity(stopRoot)
                break

            next := ""
            try next := current.Parent
            catch
                next := ""

            if !IsObject(next)
                break

            current := next
            depth += 1
        }

        return ancestors
    }

    IsConstrainedPanelCandidate(element, root) {
        if !IsObject(element)
            return false

        if this.IsMainIllustratorWindow(element)
            return false

        typeName := this.TypeName(this.SafeProp(element, "Type"))
        if typeName = "Window"
            return false

        rect := this.GetElementRect(element)
        rootRect := this.GetElementRect(root)
        if !IsObject(rect) || !IsObject(rootRect)
            return false

        if rect.w < 120 || rect.h < 160
            return false

        if rect.w > Floor(rootRect.w * 0.65)
            return false

        if rect.h > rootRect.h + 2
            return false

        if rect.x < rootRect.x - 2 || rect.y < rootRect.y - 2
            return false

        if rect.x + rect.w > rootRect.x + rootRect.w + 2
            return false

        if rect.y + rect.h > rootRect.y + rootRect.h + 2
            return false

        candidateArea := rect.w * rect.h
        rootArea := rootRect.w * rootRect.h
        if rootArea > 0 && candidateArea > Floor(rootArea * 0.45)
            return false

        return true
    }

    HasLayersAnchor(element) {
        descriptor := this.DescriptorText(element)
        if InStr(descriptor, "layers")
            return true

        try {
            anchor := element.FindElement({Name:"Layers"}, 4)
            if IsObject(anchor)
                return true
        } catch {
        }

        try {
            anchor := element.FindElement({Name:"Layers", mm:"Substring"}, 4)
            if IsObject(anchor)
                return true
        } catch {
        }

        return false
    }

    LooksLikeActionsPanel(element) {
        descriptor := this.DescriptorText(element)
        if InStr(descriptor, "actions")
            return true

        signatures := [
            "begin recording",
            "stop playing/recording",
            "play current selection",
            "create new action",
            "create new set",
            "toggle dialog on/off",
            "toggle item on/off"
        ]

        for text in signatures {
            try {
                found := element.FindElement({Name:text, mm:"Substring"}, 4)
                if IsObject(found)
                    return true
            } catch {
            }
        }

        return false
    }

    ElementIdentity(element) {
        runtimeId := this.SafeText(this.SafeProp(element, "RuntimeId"))
        if runtimeId != ""
            return "rid:" runtimeId

        rect := this.GetElementRect(element)
        if IsObject(rect)
            return this.DescriptorText(element) "|rect:" rect.x "," rect.y "," rect.w "," rect.h

        return this.DescriptorText(element)
    }

    IsMainIllustratorWindow(element) {
        typeName := this.TypeName(this.SafeProp(element, "Type"))
        className := StrLower(this.SafeText(this.SafeProp(element, "ClassName")))
        name := StrLower(this.SafeText(this.SafeProp(element, "Name")))

        return typeName = "Window"
            && className = "illustrator"
            && (name = "mainwindow" || name = "")
    }

    IsLikelyLayersContainer(element) {
        name := StrLower(this.SafeText(this.SafeProp(element, "Name")))
        typeName := this.TypeName(this.SafeProp(element, "Type"))
        if InStr(name, "layers")
            return true
        return typeName = "Pane"
            || typeName = "Group"
            || typeName = "Custom"
            || typeName = "Window"
            || typeName = "Tree"
            || typeName = "List"
    }

    IsBottomToolbarRect(candidateRect, rootRect) {
        if candidateRect.x < rootRect.x || candidateRect.y < rootRect.y
            return false
        if candidateRect.x + candidateRect.w > rootRect.x + rootRect.w + 2
            return false
        if candidateRect.y + candidateRect.h > rootRect.y + rootRect.h + 2
            return false
        centerY := candidateRect.y + Floor(candidateRect.h / 2)
        return centerY >= rootRect.y + Floor(rootRect.h * 0.75)
    }

    BuildStatusText(result) {
        lines := [
            "Scan time: " result.timestamp,
            "Scan mode: " this.DescribeScanMode(result.scanMode),
            "Illustrator running: " BoolToWord(result.illustratorOpen),
            "Top-level Illustrator windows found: " result.windows.Length
        ]

        if IsObject(result.activeWindow) {
            lines.Push(
                "Chosen window: hwnd=0x"
                . Format("{:X}", result.activeWindow.hwnd)
                . " | Visible="
                . BoolToWord(result.activeWindow.visible)
                . " | Class="
                . SafeDisplay(result.activeWindow.className)
                . " | Title="
                . SafeDisplay(result.activeWindow.title)
            )
        } else {
            lines.Push("Chosen window: none")
        }

        lines.Push("UIA root summary: " (result.rootSummary != "" ? result.rootSummary : "not available"))
        lines.Push("Likely Layers-panel candidates: " result.layersCandidates.Length)

        best := this.GetBestCandidate(result.layersCandidates)
        if IsObject(best)
            lines.Push("Best Layers candidate: " best.summary " | Score=" best.score)
        else
            lines.Push("Best Layers candidate: none")

        lines.Push(
            "Exact trash-can control: "
            . (IsObject(result.exactDeleteControl) ? result.exactDeleteControl.summary : "not exposed")
        )
        lines.Push(
            "Bottom-toolbar fallback control: "
            . (IsObject(result.bottomToolbarControl) ? result.bottomToolbarControl.summary : "not exposed")
        )
        lines.Push(
            "Exact menu path entry: "
            . (IsObject(result.panelMenuButton) ? result.panelMenuButton.summary : "not exposed")
        )
        lines.Push(
            "Derived delete slot: "
            . (IsObject(result.derivedDeleteSlot) ? "(" result.derivedDeleteSlot.x ", " result.derivedDeleteSlot.y ")" : "not available")
        )
        lines.Push("Actions enabled: " BoolToWord(result.readyForActions))
        lines.Push("Delete safety mode: exact UIA Layers trash-can control required")
        lines.Push("")
            lines.Push("See local\logs\latest_scan.txt for the written scan report.")

        return JoinLines(lines)
    }

    BuildReport(result) {
        lines := [
                "FlowCell scan report",
            "Generated: " result.timestamp,
            ""
        ]

        lines.Push("Scan mode: " this.DescribeScanMode(result.scanMode))
        lines.Push("Illustrator running: " BoolToWord(result.illustratorOpen))
        lines.Push("Top-level Illustrator windows found: " result.windows.Length)
        for window in result.windows {
            lines.Push(
                "Window | hwnd=0x"
                . Format("{:X}", window.hwnd)
                . " | visible="
                . BoolToWord(window.visible)
                . " | class="
                . SafeDisplay(window.className)
                . " | title="
                . SafeDisplay(window.title)
            )
        }

        if IsObject(result.activeWindow) {
            lines.Push("")
            lines.Push(
                "Chosen window | hwnd=0x"
                . Format("{:X}", result.activeWindow.hwnd)
                . " | class="
                . SafeDisplay(result.activeWindow.className)
                . " | title="
                . SafeDisplay(result.activeWindow.title)
            )
        }

        lines.Push("")
        lines.Push("UIA root summary: " (result.rootSummary != "" ? result.rootSummary : "not available"))
        lines.Push("")
        lines.Push("UIA roots scanned:")
        if result.scannedRoots.Length = 0 {
            lines.Push("  none")
        } else {
            for rootInfo in result.scannedRoots {
                lines.Push(
                    "  "
                    . rootInfo.source
                    . " | hwnd=0x"
                    . Format("{:X}", rootInfo.hwnd)
                    . " | class="
                    . SafeDisplay(rootInfo.className)
                    . " | title="
                    . SafeDisplay(rootInfo.title)
                    . " | "
                    . rootInfo.summary
                )
            }
        }
        lines.Push("")
        lines.Push("Layers-panel candidates:")
        if result.layersCandidates.Length = 0 {
            lines.Push("  none")
        } else {
            for candidate in result.layersCandidates
                lines.Push("  score=" candidate.score " | " candidate.summary)
        }

        lines.Push("")
        lines.Push("Related roots searched:")
        if result.relatedRoots.Length = 0 {
            lines.Push("  none")
        } else {
            for rootSummary in result.relatedRoots
                lines.Push("  " rootSummary)
        }

        lines.Push("")
        lines.Push("Delete-like exposed controls:")
        if result.deleteCandidates.Length = 0 {
            lines.Push("  none")
        } else {
            for item in result.deleteCandidates
                lines.Push("  " item)
        }

        lines.Push("")
        lines.Push("Bottom-toolbar exposed controls:")
        if result.toolbarCandidates.Length = 0 {
            lines.Push("  none")
        } else {
            for item in result.toolbarCandidates
                lines.Push("  " item)
        }

        lines.Push("")
        lines.Push("Method selection:")
        lines.Push("  exact control: " (IsObject(result.exactDeleteControl) ? result.exactDeleteControl.summary : "not exposed"))
        if IsObject(result.exactDeleteControl)
            lines.Push("  exact control basis: " result.exactDeleteControl.reason)
        lines.Push("  bottom-toolbar fallback: " (IsObject(result.bottomToolbarControl) ? result.bottomToolbarControl.summary : "not exposed"))
        if IsObject(result.bottomToolbarControl)
            lines.Push("  bottom-toolbar basis: " result.bottomToolbarControl.reason)
        lines.Push("  menu path entry: " (IsObject(result.panelMenuButton) ? result.panelMenuButton.summary : "not exposed"))
        lines.Push("  derived delete slot: " (IsObject(result.derivedDeleteSlot) ? "(" result.derivedDeleteSlot.x ", " result.derivedDeleteSlot.y ") | " result.derivedDeleteSlot.reason : "not available"))
        lines.Push("  ready for actions: " BoolToWord(result.readyForActions))
        lines.Push("  delete safety mode: exact UIA Layers trash-can control required")

        return JoinLines(lines)
    }

    DescribeScanMode(scanMode) {
        switch scanMode {
            case "fast_path_cache_hit":
                return "fast-path cache hit"
            case "fast_path_cache_miss_then_full_scan":
                return "fast-path cache miss, then full scan"
            default:
                return "full scan"
        }
    }

    DescriptorText(element) {
        parts := [
            this.SafeText(this.SafeProp(element, "Name")),
            this.SafeText(this.SafeProp(element, "HelpText")),
            this.SafeText(this.SafeProp(element, "AutomationId")),
            this.SafeText(this.SafeProp(element, "FullDescription")),
            this.SafeText(this.SafeProp(element, "LegacyIAccessibleName")),
            this.SafeText(this.SafeProp(element, "LegacyIAccessibleDescription")),
            this.SafeText(this.SafeProp(element, "LocalizedControlType"))
        ]
        return StrLower(JoinLines(parts, " "))
    }

    ElementSummary(element) {
        typeName := this.TypeName(this.SafeProp(element, "Type"))
        parts := [
            "Type=" typeName
        ]

        name := this.SafeText(this.SafeProp(element, "Name"))
        if name != ""
            parts.Push("Name=`"`"" name "`"`"")

        automationId := this.SafeText(this.SafeProp(element, "AutomationId"))
        if automationId != ""
            parts.Push("AutomationId=`"`"" automationId "`"`"")

        className := this.SafeText(this.SafeProp(element, "ClassName"))
        if className != ""
            parts.Push("ClassName=`"`"" className "`"`"")

        helpText := this.SafeText(this.SafeProp(element, "HelpText"))
        if helpText != ""
            parts.Push("HelpText=`"`"" helpText "`"`"")

        rect := this.GetElementRect(element)
        if IsObject(rect)
            parts.Push("Bounds=" rect.x "," rect.y "," rect.w "," rect.h)

        nativeHwnd := this.SafeProp(element, "NativeWindowHandle")
        if nativeHwnd
            parts.Push("NativeHwnd=0x" Format("{:X}", nativeHwnd))

        return JoinLines(parts, " | ")
    }

    GetElementRect(element) {
        try {
            rect := element.Location
            if rect.w <= 0 || rect.h <= 0
                return ""
            return rect
        } catch {
            return ""
        }
    }

    SafeProp(element, propName) {
        try return element.%propName%
        catch
            return ""
    }

    SafeText(value) {
        if value = ""
            return ""
        try return Trim(value "")
        catch
            return ""
    }

    TypeName(typeValue) {
        if typeValue = ""
            return "Unknown"
        try return UIA.Type[typeValue]
        catch
            return typeValue ""
    }

    IsWindowVisible(hwnd) {
        return !!DllCall("user32\IsWindowVisible", "ptr", hwnd, "int")
    }
}

class ScriptShortcutManager {
    __New(app, bindingFilePath, logger) {
        this.app := app
        this.bindingFilePath := bindingFilePath
        this.logger := logger
        this.bindings := []
        this.buttonBindings := []
        this.nextId := 1
        this.registered := Map()
        this.candidateShortcuts := this.BuildCandidateShortcuts()
    }

    BuildCandidateShortcuts() {
        list := []
        functionKeys := ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]
        numberKeys := ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="]
        letterKeys := ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]
        for key in functionKeys
            list.Push("^+" key)
        for key in functionKeys
            list.Push("^!+" key)
        for key in numberKeys
            list.Push("^!" key)
        for key in numberKeys
            list.Push("^!+" key)
        for key in letterKeys
            list.Push("^!" key)
        for key in letterKeys
            list.Push("^!+" key)
        return list
    }

    GetCandidateShortcutText() {
        lines := [
            "Available now:",
            JoinLines(this.candidateShortcuts),
            "",
            "Shortcut note:",
            "Suggested shortcuts assume the normal defaults are taken. Use the FlowCell picker for the filtered live list."
        ]
        return JoinLines(lines)
    }

    LoadFromDisk() {
        this.bindings := []
        this.buttonBindings := []
        this.nextId := 1

        if !FileExist(this.bindingFilePath) {
            return
        }

        try {
            iniText := ReadUtf8TextFileWithoutBom(this.bindingFilePath)
            idText := GetIniTextValue(iniText, "Meta", "Ids", "")
            nextIdText := GetIniTextValue(iniText, "Meta", "NextId", "1")
            this.nextId := Max(Integer(nextIdText), 1)
        } catch as err {
            this.logger.Error("Failed to read the FlowCell bindings file.", err)
            this.bindings := []
            this.buttonBindings := []
            this.nextId := 1
            return
        }

        if idText = "" {
            return
        }

        for idToken in StrSplit(idText, "|") {
            idToken := Trim(idToken)
            if idToken = ""
                continue

            section := "Binding_" idToken
            try {
                shortcut := CanonicalizeShortcut(GetIniTextValue(iniText, section, "Shortcut"))
                programTabId := GetIniTextValue(iniText, section, "ProgramTabId", "0")
                targetKind := StrLower(Trim(GetIniTextValue(iniText, section, "TargetKind", "script")))
                if targetKind = "tool-set-child" || targetKind = "tool-set-owner" {
                    buttonId := Trim(GetIniTextValue(iniText, section, "ButtonId"))
                    ownerButtonId := Trim(GetIniTextValue(iniText, section, "OwnerButtonId"))
                    if shortcut = "" || buttonId = "" || ownerButtonId = "" {
                        this.logger.Warn("Ignored malformed " targetKind " binding section " section ".")
                        continue
                    }
                    this.buttonBindings.Push({
                        id: Integer(idToken),
                        shortcut: shortcut,
                        targetKind: targetKind,
                        buttonId: buttonId,
                        ownerButtonId: ownerButtonId,
                        programTabId: Integer(programTabId),
                        status: "Owned by running FlowCell"
                    })
                    continue
                }
                if targetKind != "" && targetKind != "script" {
                    this.logger.Warn("Ignored unsupported binding target kind in section " section ": " targetKind)
                    continue
                }
                scriptPath := NormalizeFlowCellProgramPath(GetIniTextValue(iniText, section, "ScriptPath"))
                this.bindings.Push({
                    id: Integer(idToken),
                    shortcut: shortcut,
                    scriptPath: scriptPath,
                    programTabId: Integer(programTabId),
                    status: "Loaded"
                })
            } catch as err {
                this.logger.Error("Failed to read binding section " section ".", err)
            }
        }

    }

    SaveToDisk() {
        preservedSections := ""
        preservedMetaEntries := []
        if FileExist(this.bindingFilePath) {
            existingText := ReadUtf8TextFileWithoutBom(this.bindingFilePath)
            preservedSections := GetPreservedBindingsIniSections(existingText)
            preservedMetaEntries := GetPreservedBindingsMetaEntries(existingText)
            FileDelete this.bindingFilePath
        }

        IniWrite this.nextId, this.bindingFilePath, "Meta", "NextId"
        IniWrite this.BuildIdList(), this.bindingFilePath, "Meta", "Ids"
        for entry in preservedMetaEntries
            IniWrite entry.value, this.bindingFilePath, "Meta", entry.key

        for binding in this.bindings {
            section := "Binding_" binding.id
            IniWrite binding.shortcut, this.bindingFilePath, section, "Shortcut"
            IniWrite binding.scriptPath, this.bindingFilePath, section, "ScriptPath"
            if binding.HasOwnProp("programTabId") && binding.programTabId
                IniWrite binding.programTabId, this.bindingFilePath, section, "ProgramTabId"
        }

        for binding in this.buttonBindings {
            section := "Binding_" binding.id
            IniWrite binding.shortcut, this.bindingFilePath, section, "Shortcut"
            IniWrite binding.targetKind, this.bindingFilePath, section, "TargetKind"
            IniWrite binding.buttonId, this.bindingFilePath, section, "ButtonId"
            IniWrite binding.ownerButtonId, this.bindingFilePath, section, "OwnerButtonId"
            if binding.HasOwnProp("programTabId") && binding.programTabId
                IniWrite binding.programTabId, this.bindingFilePath, section, "ProgramTabId"
        }

        ; IniWrite creates new files as UTF-16 (BOM FF FE). The Tauri/Rust side reads this
        ; file with a strict UTF-8 reader, so re-save as UTF-8 or the frontend bindings
        ; parser fails outright. FileRead auto-detects the source BOM/encoding.
        normalizedText := RTrim(FileRead(this.bindingFilePath), "`r`n")
        if preservedSections != ""
            normalizedText .= "`r`n`r`n" preservedSections "`r`n"
        FileDelete this.bindingFilePath
        FileAppend normalizedText, this.bindingFilePath, "UTF-8"
    }

    BuildIdList() {
        ids := []
        for binding in this.bindings
            ids.Push(binding.id)
        for binding in this.buttonBindings
            ids.Push(binding.id)
        return JoinLines(ids, "|")
    }

    ApplyHotkeys() {
        this.UnregisterHotkeys()
        for binding in this.bindings
            binding.status := this.TryRegisterBinding(binding)
    }

    TryRegisterBinding(binding) {
        binding.shortcut := CanonicalizeShortcut(binding.shortcut)
        callback := ObjBindMethod(this, "OnHotkeyPressed", binding.id)
        try {
            Hotkey binding.shortcut, callback, "On"
            this.registered[binding.id] := {
                shortcut: binding.shortcut,
                callback: callback
            }
            this.logger.Info("Registered shortcut binding. Shortcut=" binding.shortcut " | Script=" binding.scriptPath)
            return "Active"
        } catch as err {
            this.logger.Warn(
                "Failed to register shortcut binding. Shortcut="
                . binding.shortcut
                . " | Script="
                . binding.scriptPath
                . " | Error="
                . err.Message
            )
            return "Registration error: " err.Message
        }
    }

    UnregisterHotkeys() {
        for _, entry in this.registered {
            try Hotkey entry.shortcut, entry.callback, "Off"
            catch {
            }
        }
        this.registered := Map()
    }

    OnHotkeyPressed(bindingId, *) {
        binding := this.GetBindingById(bindingId)
        if !IsObject(binding)
            return
        this.app.HandleShortcutInvocation(binding)
    }

    AddBinding(shortcut, scriptPath) {
        shortcut := CanonicalizeShortcut(Trim(shortcut))
        scriptPath := NormalizeFlowCellProgramPath(Trim(scriptPath))
        validation := this.ValidateBindingFields(0, shortcut, scriptPath)
        if !validation.ok
            return validation

        backupBindings := CloneBindings(this.bindings)
        backupNextId := this.nextId

        bindingId := this.nextId
        this.nextId += 1
        this.bindings.Push({
            id: bindingId,
            shortcut: shortcut,
            scriptPath: scriptPath,
            status: "Pending"
        })

        this.ApplyHotkeys()
        binding := this.GetBindingById(bindingId)
        if !IsObject(binding) || binding.status != "Active" {
            message := IsObject(binding) ? binding.status : "The binding could not be applied."
            this.bindings := backupBindings
            this.nextId := backupNextId
            this.ApplyHotkeys()
            return {
                ok: false,
                message: "Binding was not saved because the shortcut could not be applied.`r`n" message
            }
        }

        this.SaveToDisk()
        return {
            ok: true,
            message: "Binding saved and applied.`r`nShortcut: " binding.shortcut "`r`nScript: " binding.scriptPath
        }
    }

    UpdateBinding(bindingId, shortcut, scriptPath) {
        shortcut := CanonicalizeShortcut(Trim(shortcut))
        scriptPath := NormalizeFlowCellProgramPath(Trim(scriptPath))
        validation := this.ValidateBindingFields(bindingId, shortcut, scriptPath)
        if !validation.ok
            return validation

        backupBindings := CloneBindings(this.bindings)

        binding := this.GetBindingById(bindingId)
        if !IsObject(binding) {
            return {
                ok: false,
                message: "The selected binding no longer exists."
            }
        }

        binding.shortcut := shortcut
        binding.scriptPath := scriptPath

        this.ApplyHotkeys()
        if binding.status != "Active" {
            message := binding.status
            this.bindings := backupBindings
            this.ApplyHotkeys()
            return {
                ok: false,
                message: "Binding was not saved because the updated shortcut could not be applied.`r`n" message
            }
        }

        this.SaveToDisk()
        return {
            ok: true,
            message: "Binding updated and applied.`r`nShortcut: " binding.shortcut "`r`nScript: " binding.scriptPath
        }
    }

    RemoveBinding(bindingId) {
        index := this.GetBindingIndexById(bindingId)
        if !index {
            return {
                ok: false,
                message: "The selected binding no longer exists."
            }
        }

        removed := this.bindings[index]
        this.bindings.RemoveAt(index)
        this.ApplyHotkeys()
        this.SaveToDisk()
        this.logger.Info("Removed shortcut binding. Shortcut=" removed.shortcut " | Script=" removed.scriptPath)
        return {
            ok: true,
            message: "Binding removed.`r`nShortcut: " removed.shortcut
        }
    }

    ValidateBindingFields(bindingId, shortcut, scriptPath) {
        if shortcut = "" {
            return {
                ok: false,
                message: "Choose or enter a shortcut."
            }
        }

        if scriptPath = "" {
            return {
                ok: false,
                message: "Choose an Illustrator script file first."
            }
        }

        if !FileExist(scriptPath) {
            return {
                ok: false,
                message: "Script file not found:`r`n" scriptPath
            }
        }

        for binding in this.bindings {
            if binding.id = bindingId
                continue
            if NormalizeShortcut(binding.shortcut) = NormalizeShortcut(shortcut) {
                return {
                    ok: false,
                    message: "That shortcut is already bound to:`r`n" binding.scriptPath
                }
            }
        }

        for binding in this.buttonBindings {
            if NormalizeShortcut(binding.shortcut) = NormalizeShortcut(shortcut) {
                return {
                    ok: false,
                    message: "That shortcut is already bound to a FlowCell Button:`r`n" binding.buttonId
                }
            }
        }

        for actionBinding in this.app.actionHotkeyManager.GetBindingRecords() {
            if NormalizeShortcut(actionBinding.shortcut) = NormalizeShortcut(shortcut) {
                return {
                    ok: false,
                    message: "That shortcut is already bound to an action:`r`n" actionBinding.target
                }
            }
        }

        return {
            ok: true,
            message: ""
        }
    }

    GetBindingById(bindingId) {
        for binding in this.bindings {
            if binding.id = bindingId
                return binding
        }
        return ""
    }

    GetBindingIndexById(bindingId) {
        for index, binding in this.bindings {
            if binding.id = bindingId
                return index
        }
        return 0
    }

    BuildStatusSummary() {
        if this.bindings.Length = 0 {
            return JoinLines([
                "No script shortcut bindings are saved yet.",
                "Use Add Binding to choose a .jsx or .js file and assign a shortcut."
            ])
        }

        activeCount := 0
        errorCount := 0
        for binding in this.bindings {
            if binding.status = "Active"
                activeCount += 1
            else
                errorCount += 1
        }

        return JoinLines([
            "Bindings loaded: " this.bindings.Length,
            "Active: " activeCount,
            "Registration errors: " errorCount,
            "Shortcuts run through this utility while it is open."
        ])
    }
}

class SetIllustratorAnchorAction {
    __New(app) {
        this.app := app
        this.Id := "illustrator_set_anchor"
        this.Label := "Set Anchor"
        this.RequiresExactLayersScan := false
        this.RunFromHotkeyDirect := true
        this.HotIfWinTitle := "ahk_exe Illustrator.exe"
        this.PassThroughHotkey := true
    }

    Run(scanResult) {
        helperPath := GetFlowCellIllustratorAnchorScriptPath()
        helperResult := this.app.RunIllustratorScript(
            helperPath,
            "set anchor hotkey",
            0,
            false,
            true
        )
        anchorSet := helperResult.succeeded && InStr(helperResult.detail, "Status: anchor set")
        return {
            attempted: helperResult.attempted,
            deliverySucceeded: helperResult.succeeded,
            effectConfirmed: anchorSet,
            method: helperResult.method,
            detail: helperResult.detail,
            note: anchorSet
                ? "Anchor bounds were captured from the keypress selection."
                : "Select one or more unlocked Illustrator objects, then run Set Anchor again."
        }
    }
}

class ActionHotkeyManager {
    __New(app, bindingFilePath, logger, candidateShortcuts) {
        this.app := app
        this.bindingFilePath := bindingFilePath
        this.logger := logger
        this.candidateShortcuts := candidateShortcuts
        this.shortcuts := Map()
        this.registered := Map()
        this.statuses := Map()
    }

    LoadFromDisk() {
        this.shortcuts := Map()
        this.statuses := Map()
        for action in this.app.actions {
            shortcut := ""
            try shortcut := IniRead(this.bindingFilePath, "ActionHotkeys", action.Id, "")
            catch
                shortcut := ""
            if shortcut != ""
                this.shortcuts[action.Id] := shortcut
        }
    }

    ApplyHotkey() {
        this.UnregisterHotkeys()
        for actionId, shortcut in this.shortcuts
            this.statuses[actionId] := this.TryRegisterHotkey(actionId, shortcut)
    }

    TryRegisterHotkey(actionId, shortcut) {
        callback := ObjBindMethod(this, "OnHotkeyPressed", actionId)
        action := this.app.GetActionById(actionId)
        registrationShortcut := ResolveActionHotkeyRegistrationShortcut(action, shortcut)
        hotIfWinTitle := IsObject(action) && action.HasOwnProp("HotIfWinTitle")
            ? Trim(action.HotIfWinTitle)
            : ""
        try {
            if hotIfWinTitle != ""
                HotIfWinActive hotIfWinTitle
            Hotkey registrationShortcut, callback, "On"
            if hotIfWinTitle != ""
                HotIfWinActive
            this.registered[actionId] := {
                shortcut: registrationShortcut,
                callback: callback,
                hotIfWinTitle: hotIfWinTitle
            }
            this.logger.Info("Registered action hotkey. Action=" actionId " | Shortcut=" shortcut " | RegisteredShortcut=" registrationShortcut " | Scope=" hotIfWinTitle)
            return "Active"
        } catch as err {
            if hotIfWinTitle != "" {
                try HotIfWinActive
                catch {
                }
            }
            this.logger.Warn(
                "Failed to register action hotkey. Action="
                . actionId
                . " | Shortcut="
                . shortcut
                . " | Error="
                . err.Message
            )
            return "Registration error: " err.Message
        }
    }

    UnregisterHotkeys() {
        for _, entry in this.registered {
            try {
                if entry.HasOwnProp("hotIfWinTitle") && entry.hotIfWinTitle != ""
                    HotIfWinActive entry.hotIfWinTitle
                Hotkey entry.shortcut, entry.callback, "Off"
                if entry.HasOwnProp("hotIfWinTitle") && entry.hotIfWinTitle != ""
                    HotIfWinActive
            } catch {
                try HotIfWinActive
                catch {
                }
            }
        }
        this.registered := Map()
    }

    OnHotkeyPressed(actionId, *) {
        shortcut := this.GetShortcut(actionId)
        if shortcut = ""
            return
        this.app.HandleActionHotkeyInvocation(actionId, shortcut)
    }

    GetShortcut(actionId) {
        return this.shortcuts.Has(actionId) ? this.shortcuts[actionId] : ""
    }

    GetBindingRecord(actionId) {
        shortcut := this.GetShortcut(actionId)
        if shortcut = ""
            return ""

        return {
            kind: "action",
            id: actionId,
            shortcut: shortcut,
            target: "Action: " this.app.GetActionLabelById(actionId),
            status: this.statuses.Has(actionId) ? this.statuses[actionId] : "Saved"
        }
    }

    GetBindingRecords() {
        records := []
        for actionId, _ in this.shortcuts {
            record := this.GetBindingRecord(actionId)
            if IsObject(record)
                records.Push(record)
        }
        return records
    }

    GetBindingCount() {
        return this.shortcuts.Count
    }

    SetShortcut(actionId, shortcut) {
        shortcut := Trim(shortcut)
        validation := this.ValidateShortcut(actionId, shortcut)
        if !validation.ok
            return validation

        previousShortcut := this.GetShortcut(actionId)
        if shortcut = ""
            this.shortcuts.Has(actionId) ? this.shortcuts.Delete(actionId) : ""
        else
            this.shortcuts[actionId] := shortcut

        this.ApplyHotkey()
        status := this.statuses.Has(actionId) ? this.statuses[actionId] : ""
        actionLabel := this.app.GetActionLabelById(actionId)
        if shortcut != "" && status != "Active" {
            if previousShortcut = ""
                this.shortcuts.Has(actionId) ? this.shortcuts.Delete(actionId) : ""
            else
                this.shortcuts[actionId] := previousShortcut
            this.ApplyHotkey()
            return {
                ok: false,
                message: "Action shortcut was not saved because the shortcut could not be applied.`r`n" status
            }
        }

        this.SaveToDisk(actionId)
        if shortcut = "" {
            return {
                ok: true,
                message: actionLabel " shortcut cleared."
            }
        }

        return {
            ok: true,
            message: actionLabel " shortcut saved and applied.`r`nShortcut: " shortcut
        }
    }

    ClearShortcut(actionId) {
        return this.SetShortcut(actionId, "")
    }

    SaveToDisk(actionId) {
        if actionId = ""
            return

        shortcut := this.GetShortcut(actionId)
        if shortcut = "" {
            try IniDelete(this.bindingFilePath, "ActionHotkeys", actionId)
            catch {
            }
            return
        }

        IniWrite shortcut, this.bindingFilePath, "ActionHotkeys", actionId
    }

    ValidateShortcut(actionId, shortcut) {
        if shortcut = "" {
            return {
                ok: true,
                message: ""
            }
        }

        for binding in this.app.shortcutManager.bindings {
            if NormalizeShortcut(binding.shortcut) = NormalizeShortcut(shortcut) {
                return {
                    ok: false,
                    message: "That shortcut is already bound to a script:`r`n" binding.scriptPath
                }
            }
        }

        for binding in this.app.shortcutManager.buttonBindings {
            if NormalizeShortcut(binding.shortcut) = NormalizeShortcut(shortcut) {
                return {
                    ok: false,
                    message: "That shortcut is already bound to a FlowCell Button:`r`n" binding.buttonId
                }
            }
        }

        for existingActionId, existingShortcut in this.shortcuts {
            if existingActionId = actionId
                continue
            if NormalizeShortcut(existingShortcut) = NormalizeShortcut(shortcut) {
                return {
                    ok: false,
                    message: "That shortcut is already used by another action binding."
                }
            }
        }

        return {
            ok: true,
            message: ""
        }
    }
}

class BindingEditorDialog {
    __New(app, existingBinding := "") {
        this.app := app
        this.existingBinding := existingBinding
        title := IsObject(existingBinding) ? "Edit Binding" : "Add Binding"
        dialog := Gui("+Owner" app.gui.Hwnd, title)
        dialog.SetFont("s9", "Segoe UI")
        this.gui := dialog

        dialog.AddText("x12 y14 w160", "Binding Type")
        this.bindingTypeCombo := dialog.AddDropDownList("x12 y34 w160", ["Action", "Script"])
        this.bindingTypeCombo.OnEvent("Change", (*) => this.UpdateTargetControls())

        dialog.AddText("x190 y14 w220", "Shortcut")
        availableShortcuts := this.app.GetAvailableCandidateShortcuts(IsObject(existingBinding) ? existingBinding.shortcut : "")
        this.shortcutCombo := dialog.AddComboBox("x190 y34 w220", availableShortcuts)

        dialog.AddText("x12 y76 w240", "Action")
        this.actionCombo := dialog.AddDropDownList("x12 y96 w300", this.app.GetActionChoiceLabels())

        dialog.AddText("x12 y136 w500", "Script File")
        this.pathEdit := dialog.AddEdit("x12 y156 w460 h48 ReadOnly")

        this.browseButton := dialog.AddButton("x482 y156 w90 h28", "Browse...")
        this.browseButton.OnEvent("Click", (*) => this.BrowseForScript())

        dialog.AddText("x12 y218 w560", "Choose either a controller action or an Illustrator script, then assign a shortcut.")

        this.saveButton := dialog.AddButton("x12 y248 w100 h30", "Save")
        this.saveButton.OnEvent("Click", (*) => this.Save())

        this.cancelButton := dialog.AddButton("x122 y248 w100 h30", "Cancel")
        this.cancelButton.OnEvent("Click", (*) => this.Close())

        if IsObject(existingBinding) {
            this.shortcutCombo.Text := existingBinding.shortcut
            if existingBinding.kind = "action" {
                this.bindingTypeCombo.Text := "Action"
                this.actionCombo.Text := this.app.GetActionLabelById(existingBinding.id)
            } else {
                this.bindingTypeCombo.Text := "Script"
                this.pathEdit.Value := existingBinding.scriptPath
            }
        } else {
            this.bindingTypeCombo.Text := "Script"
        }

        this.UpdateTargetControls()
        dialog.OnEvent("Close", (*) => this.Close())
    }

    Show() {
        this.gui.Show("w586 h294")
    }

    BrowseForScript() {
        initialDir := ""
        if this.pathEdit.Value != "" && FileExist(this.pathEdit.Value)
            SplitPath this.pathEdit.Value, , &initialDir
        scriptPath := FileSelect(1, initialDir, "Choose Illustrator script", "Illustrator Scripts (*.jsx; *.js)")
        if scriptPath != ""
            this.pathEdit.Value := scriptPath
    }

    Save() {
        bindingType := StrLower(this.bindingTypeCombo.Text)
        actionId := bindingType = "action" ? this.app.GetActionIdByLabel(this.actionCombo.Text) : ""
        if this.app.SaveBindingFromEditor(this.existingBinding, bindingType, this.shortcutCombo.Text, this.pathEdit.Value, actionId)
            this.Close()
    }

    UpdateTargetControls() {
        isAction := StrLower(this.bindingTypeCombo.Text) = "action"
        this.actionCombo.Enabled := isAction
        this.pathEdit.Enabled := !isAction
        this.browseButton.Enabled := !isAction

        if isAction && this.actionCombo.Text = ""
            this.actionCombo.Choose(1)
    }

    Close() {
        try this.gui.Destroy()
        this.app.OnBindingEditorClosed()
    }
}

class RecordedMacroStore {
    __New(rootDir, logger) {
        this.rootDir := rootDir
        this.logger := logger
        if !InStr(FileExist(this.rootDir), "D")
            DirCreate this.rootDir
    }

    LoadActions(app) {
        actions := []
        Loop Files, this.rootDir "\*.ini" {
            definition := this.ReadMacroDefinition(A_LoopFileFullPath, false)
            if !IsObject(definition)
                continue
            if definition.id = "" || definition.label = ""
                continue
            actions.Push(RecordedMacroAction(app, this, definition.id, definition.label, A_LoopFileFullPath))
        }
        return actions
    }

    ResolveMacroPathById(actionId) {
        normalizedId := StrLower(Trim(actionId))
        if normalizedId = ""
            return ""
        Loop Files, this.rootDir "\*.ini" {
            definition := this.ReadMacroDefinition(A_LoopFileFullPath, false)
            if IsObject(definition) && StrLower(Trim(definition.id)) = normalizedId
                return A_LoopFileFullPath
        }
        return ""
    }

    ReadMacroDefinition(path, includeSteps := true) {
        if !FileExist(path)
            return ""

        sections := Map()
        sectionOrder := []
        currentSection := ""
        text := FileRead(path, "UTF-8")
        for rawLine in StrSplit(StrReplace(text, "`r"), "`n") {
            trimmed := Trim(rawLine)
            if trimmed = "" || SubStr(trimmed, 1, 1) = ";"
                continue

            if RegExMatch(trimmed, "^\[(.+)\]$", &match) {
                currentSection := match[1]
                if !sections.Has(currentSection) {
                    sections[currentSection] := Map()
                    sectionOrder.Push(currentSection)
                }
                continue
            }

            if currentSection = ""
                continue

            equalsPos := InStr(trimmed, "=")
            if equalsPos {
                key := Trim(SubStr(trimmed, 1, equalsPos - 1))
                value := SubStr(trimmed, equalsPos + 1)
            } else {
                key := trimmed
                value := ""
            }
            sections[currentSection][key] := value
        }

        if !sections.Has("Action")
            return ""

        actionSection := sections["Action"]
        if !actionSection.Has("Id") || !actionSection.Has("Label")
            return ""

        definition := {
            id: actionSection["Id"],
            label: actionSection["Label"],
            path: path,
            steps: []
        }
        if !includeSteps
            return definition

        for sectionName in sectionOrder {
            if !RegExMatch(sectionName, "^Step_\d+$")
                continue
            stepSection := sections[sectionName]
            step := this.BuildStep(stepSection)
            if IsObject(step)
                definition.steps.Push(step)
        }
        return definition
    }

    BuildStep(stepSection) {
        if !IsObject(stepSection) || !stepSection.Has("Type")
            return ""

        scriptPath := stepSection.Has("ScriptPath") ? stepSection["ScriptPath"] : ""
        macroPath := stepSection.Has("MacroPath") ? stepSection["MacroPath"] : ""
        macroId := stepSection.Has("MacroId") ? stepSection["MacroId"] : ""
        type := (macroId != "" || macroPath != "") ? "Macro" : (scriptPath != "" ? "Script" : stepSection["Type"])
        if type = "Click" && stepSection.Has("Button") && StrLower(stepSection["Button"]) = "right"
            type := "RightClick"
        step := {
            type: type,
            delayMs: this.ParseInt(stepSection.Has("DelayMs") ? stepSection["DelayMs"] : "", 0)
        }

        switch type {
            case "Click":
                step.x := this.ParseInt(stepSection.Has("X") ? stepSection["X"] : "", 0)
                step.y := this.ParseInt(stepSection.Has("Y") ? stepSection["Y"] : "", 0)
                step.button := stepSection.Has("Button") ? stepSection["Button"] : "Left"
                step.count := this.ParseInt(stepSection.Has("Count") ? stepSection["Count"] : "", 1)
            case "RightClick":
                step.x := this.ParseInt(stepSection.Has("X") ? stepSection["X"] : "", 0)
                step.y := this.ParseInt(stepSection.Has("Y") ? stepSection["Y"] : "", 0)
                step.button := "Right"
                step.count := this.ParseInt(stepSection.Has("Count") ? stepSection["Count"] : "", 1)
            case "Wheel":
                step.x := this.ParseInt(stepSection.Has("X") ? stepSection["X"] : "", 0)
                step.y := this.ParseInt(stepSection.Has("Y") ? stepSection["Y"] : "", 0)
                step.direction := stepSection.Has("Direction") ? stepSection["Direction"] : "Down"
                step.count := this.ParseInt(stepSection.Has("Count") ? stepSection["Count"] : "", 1)
            case "Text":
                step.text := stepSection.Has("Text") ? stepSection["Text"] : ""
            case "Key":
                step.keys := stepSection.Has("Keys") ? stepSection["Keys"] : ""
            case "Script":
                step.scriptPath := scriptPath
                return step
            case "Macro":
                step.macroId := macroId
                step.macroPath := macroPath
                return step
            case "ActivateIllustrator":
            case "ActivateBlender":
            case "ActivatePhotoshop":
            case "ActivateWindows":
            default:
                if type != "ActivateIllustrator" && type != "ActivateBlender" && type != "ActivatePhotoshop" && type != "ActivateWindows"
                    return ""
        }

        return step
    }

    ParseInt(value, defaultValue := 0) {
        if value = ""
            return defaultValue
        try return Integer(value)
        catch
            return defaultValue
    }
}

class RecordedMacroAction {
    __New(app, store, id, label, macroPath) {
        this.app := app
        this.store := store
        this.Id := id
        this.Label := label
        this.MacroPath := macroPath
        this.RequiresExactLayersScan := false
    }

    Run(scanResult) {
        if this.IsMacroAlreadyInStack(this.MacroPath) {
            return {
                attempted: false,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "recorded_macro_recursion",
                detail: "This macro calls itself in a loop through nested macro steps.",
                note: "Remove the recursive macro step chain and try again."
            }
        }

        definition := this.store.ReadMacroDefinition(this.MacroPath)
        if !IsObject(definition) {
            return {
                attempted: false,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "recorded_macro_missing",
                detail: "The recorded macro file was not found or could not be parsed.",
                note: "Record the action again if the macro file was moved or deleted."
            }
        }

        if definition.steps.Length = 0 {
            return {
                attempted: false,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "recorded_macro_empty",
                detail: "The recorded macro contains no steps.",
                note: "Record the action again and make sure at least one click or key press is captured."
            }
        }

        hwnd := 0
        if IsObject(scanResult) && IsObject(scanResult.activeWindow)
            hwnd := scanResult.activeWindow.hwnd

        this.app.macroExecutionStack.Push(this.MacroPath)
        try {
            executedTypes := []
            isTopLevelMacro := this.app.macroExecutionStack.Length = 1
            if isTopLevelMacro
                this.app.ResetMacroStop()
            for index, step in definition.steps {
                delayMs := step.HasOwnProp("delayMs") ? step.delayMs : 0
                if delayMs > 0
                    this.app.SleepWithMacroStop(delayMs, "recorded macro delay before step " index)

                this.app.ThrowIfMacroStopRequested("recorded macro step " index)
                stepResult := this.ExecuteStep(step, hwnd)
                if !stepResult.ok {
                    return {
                        attempted: true,
                        deliverySucceeded: false,
                        effectConfirmed: false,
                        method: stepResult.method,
                        detail: "Recorded macro step " index " failed. " stepResult.detail,
                        note: "Recorded macros replay the saved clicks, wheel moves, text, keys, script steps, and nested macro steps."
                    }
                }
                executedTypes.Push(step.type)
            }
        } catch as err {
            if InStr(err.Message, "Stopped by Pause hotkey") {
                this.app.logger.Warn(
                    "Recorded macro stopped by emergency hotkey."
                    . " Action="
                    . this.Id
                    . " | Detail="
                    . err.Message
                )
                return {
                    attempted: true,
                    deliverySucceeded: false,
                    effectConfirmed: false,
                    method: "recorded_macro_stopped",
                    detail: err.Message,
                    note: "The Pause hotkey stopped recorded macro playback."
                }
            }
            throw err
        } finally {
            this.PopMacroFromStack(this.MacroPath)
        }

        this.app.logger.Info(
            "Recorded macro action succeeded. Action="
            . this.Id
            . " | Steps="
            . definition.steps.Length
            . " | Path="
            . this.MacroPath
        )

        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: false,
            method: "recorded_macro_playback",
            detail: "Played recorded macro " this.Label " with " definition.steps.Length " saved steps.",
            note: "Recorded macros replay the exact saved clicks, wheel moves, text, keys, script steps, and nested macro steps."
        }
    }

    PrepareIllustrator(scanResult) {
        hwnd := 0
        if IsObject(scanResult) && IsObject(scanResult.activeWindow)
            hwnd := scanResult.activeWindow.hwnd
        if !hwnd
            hwnd := WinActive("ahk_exe Illustrator.exe")
        if !hwnd
            hwnd := WinExist("ahk_exe Illustrator.exe")
        if !hwnd {
            return {
                ok: false,
                detail: "Illustrator is not running or no Illustrator window could be found."
            }
        }

        try WinActivate "ahk_id " hwnd
        try WinWaitActive "ahk_id " hwnd, , 2
        Sleep 120
        return {
            ok: true,
            hwnd: hwnd
        }
    }

    ExecuteStep(step, hwnd) {
        switch step.type {
            case "ActivateIllustrator":
                return this.ActivateIllustrator(hwnd)
            case "ActivateBlender":
                return this.ActivateTargetWindow("Blender.exe", "activate_blender", "Blender is not running or no Blender window could be found.")
            case "ActivatePhotoshop":
                return this.ActivateTargetWindow("Photoshop.exe", "activate_photoshop", "Photoshop is not running or no Photoshop window could be found.")
            case "ActivateWindows":
                return this.ActivateWindowsShell()
            case "Click":
                return this.ClickPoint(step.x, step.y, step.button, step.count)
            case "RightClick":
                return this.ClickPoint(step.x, step.y, "Right", step.count)
            case "Wheel":
                return this.SendWheel(step.x, step.y, step.direction, step.count)
            case "Text":
                return this.SendTextStep(step.text)
            case "Key":
                return this.SendKeyStep(step.keys)
            case "Script":
                return this.RunScriptStep(step.scriptPath)
            case "Macro":
                return this.RunMacroStep(step.HasOwnProp("macroId") ? step.macroId : "", step.macroPath, hwnd)
            default:
                return {
                    ok: false,
                    method: "recorded_macro_unknown_step",
                    detail: "Unsupported recorded step type: " step.type
                }
        }
    }

    ActivateIllustrator(hwnd) {
        if !hwnd
            hwnd := WinActive("ahk_exe Illustrator.exe")
        if !hwnd
            hwnd := WinExist("ahk_exe Illustrator.exe")
        if !hwnd
            return {
                ok: false,
                method: "recorded_macro_no_hwnd",
                detail: "Illustrator did not expose a usable window handle."
            }
        return this.ActivateHwnd(hwnd, "activate_illustrator")
    }

    ActivateTargetWindow(exeName, methodName, missingDetail) {
        hwnd := WinActive("ahk_exe " exeName)
        if !hwnd
            hwnd := WinExist("ahk_exe " exeName)
        if !hwnd {
            return {
                ok: false,
                method: methodName "_missing",
                detail: missingDetail
            }
        }
        return this.ActivateHwnd(hwnd, methodName)
    }

    ActivateWindowsShell() {
        hwnd := WinActive("ahk_class CabinetWClass")
        if !hwnd
            hwnd := WinExist("ahk_class CabinetWClass")
        if !hwnd
            hwnd := WinExist("ahk_class WorkerW")
        if !hwnd
            hwnd := WinExist("ahk_class Progman")
        if !hwnd {
            return {
                ok: false,
                method: "activate_windows_missing",
                detail: "No Windows shell or Explorer window could be found."
            }
        }
        return this.ActivateHwnd(hwnd, "activate_windows")
    }

    ActivateHwnd(hwnd, methodName) {
        try WinActivate "ahk_id " hwnd
        try WinWaitActive "ahk_id " hwnd, , 2
        this.app.SleepWithMacroStop(100, methodName)
        return {
            ok: true,
            method: methodName
        }
    }

    ClickPoint(x, y, button := "Left", count := 1) {
        buttonName := this.NormalizeMouseButton(button)
        MouseGetPos &origX, &origY
        try MouseMove x, y, 0
        catch as err {
            this.app.logger.Warn("Recorded macro mouse move failed: " err.Message)
            return {
                ok: false,
                method: "recorded_macro_mouse_move_failed",
                detail: err.Message
            }
        }

        Loop Max(count, 1)
            Click buttonName
        this.app.SleepWithMacroStop(80, "recorded macro click step")
        try MouseMove origX, origY, 0
        catch {
        }
        return {
            ok: true,
            method: "recorded_macro_click"
        }
    }

    SendWheel(x, y, direction := "Down", count := 1) {
        MouseGetPos &origX, &origY
        try MouseMove x, y, 0
        catch as err {
            this.app.logger.Warn("Recorded macro wheel move failed: " err.Message)
            return {
                ok: false,
                method: "recorded_macro_wheel_move_failed",
                detail: err.Message
            }
        }

        directionName := StrLower(direction) = "up" ? "WheelUp" : "WheelDown"
        SendEvent "{" directionName " " Max(count, 1) "}"
        this.app.SleepWithMacroStop(80, "recorded macro wheel step")
        try MouseMove origX, origY, 0
        catch {
        }
        return {
            ok: true,
            method: "recorded_macro_wheel"
        }
    }

    SendTextStep(text) {
        SendText text
        this.app.SleepWithMacroStop(60, "recorded macro text step")
        return {
            ok: true,
            method: "recorded_macro_text"
        }
    }

    SendKeyStep(keys) {
        if keys = "" {
            return {
                ok: false,
                method: "recorded_macro_key_empty",
                detail: "The recorded key step was empty."
            }
        }
        SendEvent keys
        this.app.SleepWithMacroStop(60, "recorded macro key step")
        return {
            ok: true,
            method: "recorded_macro_key"
        }
    }

    RunScriptStep(scriptPath) {
        result := this.app.RunBoundScript(scriptPath, "recorded macro step")
        return {
            ok: result.succeeded,
            method: result.succeeded ? "recorded_macro_script" : "recorded_macro_script_failed",
            detail: result.detail
        }
    }

    RunMacroStep(macroId, macroPath, hwnd) {
        resolvedMacroPath := macroPath
        if macroId != "" {
            resolvedById := this.store.ResolveMacroPathById(macroId)
            if resolvedById != ""
                resolvedMacroPath := resolvedById
        }
        if resolvedMacroPath = "" {
            return {
                ok: false,
                method: "recorded_macro_nested_missing",
                detail: "The nested macro step did not specify a macro id or file."
            }
        }

        definition := this.store.ReadMacroDefinition(resolvedMacroPath, false)
        if !IsObject(definition) {
            return {
                ok: false,
                method: "recorded_macro_nested_missing",
                detail: "The nested macro file was not found or could not be parsed."
            }
        }

        nestedAction := RecordedMacroAction(this.app, this.store, definition.id, definition.label, resolvedMacroPath)
        nestedResult := nestedAction.Run({activeWindow: {hwnd: hwnd}})
        return {
            ok: nestedResult.deliverySucceeded,
            method: nestedResult.method,
            detail: nestedResult.detail
        }
    }

    IsMacroAlreadyInStack(macroPath) {
        normalizedPath := StrLower(Trim(macroPath))
        for existingPath in this.app.macroExecutionStack {
            if StrLower(Trim(existingPath)) = normalizedPath
                return true
        }
        return false
    }

    PopMacroFromStack(macroPath) {
        normalizedPath := StrLower(Trim(macroPath))
        loop this.app.macroExecutionStack.Length {
            index := this.app.macroExecutionStack.Length - A_Index + 1
            if StrLower(Trim(this.app.macroExecutionStack[index])) = normalizedPath {
                this.app.macroExecutionStack.RemoveAt(index)
                return
            }
        }
    }

    NormalizeMouseButton(button) {
        normalized := StrLower(Trim(button))
        switch normalized {
            case "right":
                return "Right"
            case "middle":
                return "Middle"
            default:
                return "Left"
        }
    }
}

class ControllerLogger {
    __New(logDir) {
        this.logDir := logDir
        if !InStr(FileExist(this.logDir), "D")
            DirCreate this.logDir
        this.logPath := this.logDir "\controller.log"
        this.scanPath := this.logDir "\latest_scan.txt"
        if !FileExist(this.logPath)
            FileOpen(this.logPath, "w", "UTF-8").Close()
    }

    Info(message) {
        this.Write("INFO", message)
    }

    Warn(message) {
        this.Write("WARN", message)
    }

    Error(message, err := "") {
        if IsObject(err)
            message .= " | " err.Message
        this.Write("ERROR", message)
    }

    Write(level, message) {
        line := "[" FormatTime(, "yyyy-MM-dd HH:mm:ss") "] [" level "] " message "`r`n"
        file := FileOpen(this.logPath, "a", "UTF-8")
        file.Write(line)
        file.Close()
    }

    WriteScanReport(text) {
        file := FileOpen(this.scanPath, "w", "UTF-8")
        file.Write(text "`r`n")
        file.Close()
        this.Info("Scan report written to " this.scanPath)
    }
}

JoinLines(items, separator := "`r`n") {
    output := ""
    for index, item in items {
        if index > 1
            output .= separator
        output .= item
    }
    return output
}

EnsureFlowCellDir(path) {
    if !InStr(FileExist(path), "D")
        DirCreate path
    return path
}

BoolToWord(value) {
    return value ? "yes" : "no"
}

ResolveActionHotkeyRegistrationShortcut(action, shortcut) {
    registrationShortcut := CanonicalizeShortcut(shortcut)
    if registrationShortcut = ""
        return ""
    passThrough := IsObject(action)
        && action.HasOwnProp("PassThroughHotkey")
        && action.PassThroughHotkey
    if passThrough && SubStr(registrationShortcut, 1, 1) != "~"
        return "~" registrationShortcut
    return registrationShortcut
}

SafeDisplay(value) {
    if value = ""
        return "(blank)"
    return value
}

CanonicalizeShortcut(value) {
    compact := RegExReplace(Trim(value), "\s+", "")
    if compact = ""
        return ""

    altGrPlaceholder := "__FLOWCELL_ALTGR__"
    compact := StrReplace(compact, "<^>!", altGrPlaceholder)
    compact := StrReplace(compact, "<^", "^")
    compact := StrReplace(compact, ">^", "^")
    compact := StrReplace(compact, "<!", "!")
    compact := StrReplace(compact, ">!", "!")
    compact := StrReplace(compact, "<+", "+")
    compact := StrReplace(compact, ">+", "+")
    compact := StrReplace(compact, "<#", "#")
    compact := StrReplace(compact, ">#", "#")
    compact := StrReplace(compact, altGrPlaceholder, "<^>!")
    return compact
}

NormalizeShortcut(value) {
    return RegExReplace(StrLower(CanonicalizeShortcut(value)), "\s+", "")
}

PowerShellSingleQuote(value) {
    return "'" StrReplace(value "", "'", "''") "'"
}

CloneBindings(bindings) {
    clone := []
    for binding in bindings {
        clone.Push({
            id: binding.id,
            shortcut: binding.shortcut,
            scriptPath: binding.scriptPath,
            programTabId: binding.HasOwnProp("programTabId") ? binding.programTabId : 0,
            status: binding.status
        })
    }
    return clone
}

ValueToText(value) {
    if value = ""
        return "(blank)"
    try return value ""
    catch
        return "(unprintable value)"
}

WriteTextFile(path, text) {
    file := FileOpen(path, "w", "UTF-8")
    file.Write(text "`r`n")
    file.Close()
}

cliOneShotMode := runActionId != "" || runScriptPath != ""
app := FlowCellApp(logger, !cliOneShotMode)

if runActionId != "" {
    try {
        action := app.GetActionById(runActionId)
        if !IsObject(action)
            throw Error("Action not found: " runActionId)

        if !app.EnsureActionReady(action, "cli " runActionId) {
            text := app.GetActionStatusText()
            WriteTextFile(flowCellLastActionStatusPath, text)
            ExitApp(1)
        }

        result := action.Run(app.scanResult)
        statusText := app.BuildActionStatus(action, result)
        app.SetActionStatus(statusText)
        WriteTextFile(flowCellLastActionStatusPath, statusText)
        ExitApp(result.deliverySucceeded ? 0 : 1)
    } catch as err {
        errorText := "CLI action failed.`r`n" err.Message
        WriteTextFile(flowCellLastActionStatusPath, errorText)
        logger.Error("CLI run-action failed.", err)
        ExitApp(1)
    }
}

if runScriptPath != "" {
    try {
        result := app.RunBoundScript(runScriptPath, "cli script", runScriptProgramTabId, runScriptProgram)
        statusText := ""
        if result.HasOwnProp("statusText") && Trim(result.statusText) != ""
            statusText := result.statusText
        else
            statusText := "Script: " runScriptPath "`r`n"
                . "Attempted: " BoolToWord(result.attempted) "`r`n"
                . "Succeeded: " BoolToWord(result.succeeded) "`r`n"
                . "Method: " result.method "`r`n"
                . "Details: " result.detail
        WriteTextFile(flowCellLastActionStatusPath, statusText)
        ExitApp(result.succeeded ? 0 : 1)
    } catch as err {
        errorText := "CLI script failed.`r`n" err.Message
        WriteTextFile(flowCellLastActionStatusPath, errorText)
        logger.Error("CLI run-script failed.", err)
        ExitApp(1)
    }
}

app.StartDirectScriptReceiver()
if IsFlowCellProgramRegistered("Illustrator")
    app.StartIllustratorAutomationPrewarm()

if HasCliFlag("--headless") {
    logger.Info("Macro backend started in headless mode.")
    app.ApplyStartupFlags()
    return
}

app.Show()
app.ApplyStartupFlags()
return
