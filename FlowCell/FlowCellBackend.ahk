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
flowCellLastActionStatusPath := flowCellLogsDir "\last_action_status.txt"

logger := ControllerLogger(flowCellLogsDir)

if HasCliFlag("--self-test") {
    try {
        logger.Info("Self-test started.")
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

class FlowCellApp {
    __New(logger) {
        global flowCellScanStatePath, flowCellBindingsPath, flowCellRecordedActionsDir
        this.projectRoot := A_ScriptDir
        this.logger := logger
        this.scanner := IllustratorScanner(this.logger, flowCellScanStatePath)
        this.shortcutManager := ScriptShortcutManager(this, flowCellBindingsPath, this.logger)
        this.actionHotkeyManager := ActionHotkeyManager(this, flowCellBindingsPath, this.logger, this.shortcutManager.candidateShortcuts)
        this.recordedActionStore := RecordedMacroStore(flowCellRecordedActionsDir, this.logger)
        this.macroExecutionStack := []
        this.actions := []
        this.actions.Push(SaveSelectedObjToProject3DAction(this))
        this.actions.Push(SaveSelectedObjToBlenderAction(this))
        this.actions.Push(SaveSelectedPngToBlenderLithoAction(this))
        for recordedAction in this.recordedActionStore.LoadActions(this)
            this.actions.Push(recordedAction)
        this.scanResult := ""
        this.macroStopRequested := false
        this.bindingRowIds := []
        this.editorDialog := ""
        this.BuildGui()
        this.vScrollHandler := ObjBindMethod(this, "HandleVScroll")
        this.mouseWheelHandler := ObjBindMethod(this, "HandleMouseWheel")
        OnMessage(0x115, this.vScrollHandler)
        OnMessage(0x20A, this.mouseWheelHandler)
        this.UpdateActionButtons(false)
        this.actionStatusEdit.Value := JoinLines([
            "Fresh session.",
            "This build is recorder-first.",
            "Use Record Action in the macro window, then bind the saved macro here if you want a hotkey.",
            "Emergency stop hotkey: Pause"
        ])
        this.LoadBindings()
        Hotkey "Pause", ObjBindMethod(this, "HandleEmergencyMacroStop"), "On"
        this.logger.Info("Application started.")
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

        this.scanButton := window.AddButton("x12 y12 w150 h30", "Scan Illustrator UI")
        this.scanButton.OnEvent("Click", (*) => this.RunScan(false))
        this.TrackScrollableControl(this.scanButton)

        this.rescanButton := window.AddButton("x172 y12 w100 h30", "Re-scan")
        this.rescanButton.OnEvent("Click", (*) => this.RunScan(true))
        this.TrackScrollableControl(this.rescanButton)

        this.logButton := window.AddButton("x282 y12 w100 h30", "Open Log")
        this.logButton.OnEvent("Click", (*) => this.OpenLog())
        this.TrackScrollableControl(this.logButton)

        this.reloadButton := window.AddButton("x392 y12 w100 h30", "Reload App")
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
            this.scanResult := this.scanner.Scan()
            this.UpdateActionButtons(this.scanResult.readyForActions)
            this.SetActionStatus(this.scanner.BuildStatusText(this.scanResult), true)
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
            this.scanResult := this.scanner.Scan()
            this.UpdateActionButtons(this.scanResult.readyForActions)
            this.SetActionStatus(this.scanner.BuildStatusText(this.scanResult), true)
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
        this.actionStatusEdit.Value := text
        if flush
            this.FlushUi(this.actionStatusEdit)
    }

    SetShortcutStatus(text) {
        this.shortcutStatusEdit.Value := text
    }

    UpdateActionButtons(enabled) {
        for button in this.actionButtons
            button.Enabled := enabled
    }

    SetScanBusy(isBusy, scanButtonText := "") {
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
            targetActionId := actionId != "" ? actionId : "layers_delete_selection"
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
        this.logger.Info("Script hotkey requested. Shortcut=" binding.shortcut " | Script=" binding.scriptPath)
        result := this.RunBoundScript(binding.scriptPath, "hotkey " binding.shortcut, binding.HasOwnProp("programTabId") ? binding.programTabId : 0)
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

    HandleActionHotkeyInvocation(actionId, shortcut) {
        action := this.GetActionById(actionId)
        if !IsObject(action)
            return

        this.logger.Info("Action hotkey requested. Action=" actionId " | Shortcut=" shortcut)
        if !this.EnsureActionReady(action, "hotkey " shortcut)
            return

        result := action.Run(this.scanResult)
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
        this.SetActionStatus(this.BuildActionStatus(action, result))
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
            config.scriptFolder := IniRead(bindingFilePath, section, "ScriptFolder", "")
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

    RunIllustratorScript(scriptPath, source, programConfig := 0) {
        result := {
            attempted: false,
            succeeded: false,
            method: "not_started",
            detail: ""
        }

        stableHwnd := 0

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
        result.method := "illustrator_com_activeobject"
        skipComProbe := false
        try {
            if this.HasProp("IllustratorComRetryAfterTick") && Integer(this.IllustratorComRetryAfterTick) > A_TickCount
                skipComProbe := true
        } catch {
        }
        if skipComProbe {
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
        try {
            app := this.GetIllustratorApplication()
            returnValue := app.DoJavaScriptFile(scriptPath)
            this.IllustratorComRetryAfterTick := 0
            result.succeeded := true
            result.detail := "DoJavaScriptFile returned without raising an error."
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
            case "illustrator_direct":
                return this.RunIllustratorScript(scriptPath, source, programConfig)
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
        }

        switch StrLower(Trim(resolvedProgramName)) {
            case "blender":
                return this.RunGenericScript(scriptPath, source, "Blender.exe", "blender_generic")
            case "photoshop":
                return this.RunPhotoshopScript(scriptPath, source, programConfig)
            case "windows":
                return this.RunGenericScript(scriptPath, source, "", "windows_generic")
            default:
                return this.RunIllustratorScript(scriptPath, source, programConfig)
        }
    }

    GetProgramNameFromBinding(programTabId, scriptPath := "") {
        switch Integer(programTabId) {
            case 1:
                return "Illustrator"
            case 2:
                return "Windows"
            case 3:
                return "Blender"
            case 4:
                return "Photoshop"
        }

        SplitPath scriptPath, , , &ext
        ext := "." StrLower(ext)
        if ext = ".jsx" || ext = ".js"
            return "Illustrator"
        return "Windows"
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
                if this.ScriptRequiresVisibleWindow(scriptPath) {
                    exitCode := RunWait('powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Sta -File "' scriptPath '"')
                } else {
                    exitCode := RunWait('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' scriptPath '"', , "Hide")
                }
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

    ScriptRequiresVisibleWindow(scriptPath) {
        SplitPath scriptPath, &fileName
        fileName := StrLower(Trim(fileName))
        return InStr(fileName, "rename_selected") > 0
            || InStr(fileName, "update_github") > 0
            || InStr(fileName, "fix_this_folder_from_explorer") > 0
            || InStr(fileName, "_dialog") > 0
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

    GetIllustratorApplication(timeoutMs := 250) {
        deadline := A_TickCount + Max(timeoutMs, 120)
        while A_TickCount <= deadline {
            hwnd := this.FindStableIllustratorWindow()

            if hwnd {
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
                try WinActivate "ahk_id " candidateHwnd
                catch {
                }
                Sleep(20)

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

class LayersDeleteSelectionAction {
    __New(app) {
        this.app := app
        this.Id := "layers_delete_selection"
        this.Label := "Run Layers panel Delete Selection"
        this.RequiresExactLayersScan := true
    }

    Run(scanResult) {
        if IsObject(scanResult) && scanResult.readyForActions {
            if attempt := this.TryExactDeleteControl(scanResult)
                return attempt

            if attempt := this.TryExactMenuPath(scanResult)
                return attempt

            if fallbackAttempt := this.TryFocusedFallback(scanResult)
                return fallbackAttempt
        }

        if cachedAttempt := this.TryCachedDeleteControl(scanResult)
            return cachedAttempt

        if !IsObject(scanResult) || !scanResult.readyForActions {
            return {
                attempted: false,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "no_cached_delete_target",
                detail: "No cached Layers delete target is available yet.",
                note: "Run Scan Illustrator UI once with the Layers panel visible, then try Delete Selection again."
            }
        }

        return {
            attempted: false,
            deliverySucceeded: false,
            effectConfirmed: false,
            method: "delete_target_failed",
            detail: "The exact Layers delete control was exposed, but it could not be delivered successfully.",
            note: "Re-scan with the Layers panel visible if the right-side panel layout changed."
        }
    }

    TryCachedDeleteControl(scanResult) {
        cached := this.app.scanner.LoadExactDeleteControlCache()
        if !IsObject(cached) || cached.w <= 0 || cached.h <= 0
            return ""

        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok
            return {
                attempted: false,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "illustrator_not_ready",
                detail: prep.detail,
                note: "Open Illustrator and the intended document, then try again."
            }

        clickMethod := this.ClickIllustratorClientRectCenter(prep.hwnd, cached.x, cached.y, cached.w, cached.h, "cached delete action")
        if clickMethod = ""
            clickMethod := this.ClickRectCenter(cached.x, cached.y, cached.w, cached.h, "cached delete action")
        if clickMethod = ""
            return ""

        confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1800)
        confirmDetail := confirmResult.HasOwnProp("detail") ? confirmResult.detail : "No Illustrator confirmation dialog appeared within the wait window."
        detail := "Attempted the cached Layers delete control using " clickMethod ". Cached bounds: " cached.x "," cached.y "," cached.w "," cached.h ". Confirmation dialog handling: " confirmDetail
        note := confirmResult.found
            ? "The cached delete target was invoked and the Illustrator confirmation was handled automatically."
            : "The cached delete target was clicked, but no Illustrator confirmation dialog was seen."

        this.app.logger.Info("Layers delete attempt via cached bounds. Method=" clickMethod " | Bounds=" cached.x "," cached.y "," cached.w "," cached.h)
        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: confirmResult.found,
            method: "cached_layers_delete_control",
            detail: detail,
            note: note
        }
    }

    TryExactDeleteControl(scanResult) {
        if !IsObject(scanResult.exactDeleteControl)
            return ""

        candidate := scanResult.exactDeleteControl
        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok
            return ""
        clickMethod := this.TryPatternClick(candidate.element)
        if clickMethod = ""
            clickMethod := this.TryCenterClick(candidate.element)
        if clickMethod = ""
            return ""

        confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1800)
        confirmDetail := confirmResult.HasOwnProp("detail") ? confirmResult.detail : "No Illustrator confirmation dialog appeared within the wait window."

        this.app.logger.Info(
            "Layers delete attempt via exact UIA delete control. Method="
            . clickMethod
            . " | Basis="
            . candidate.reason
        )

        detail := "Attempted the exposed Layers-panel delete control using " clickMethod ". " candidate.reason " Confirmation dialog handling: " confirmDetail
        note := confirmResult.found
            ? "The exact control was invoked and the Illustrator delete confirmation was handled automatically."
            : "The exact control was invoked, but no Illustrator confirmation dialog was seen."

        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: confirmResult.found,
            method: "true_uia_exact_layers_trash_control",
            detail: detail,
            note: note
        }
    }

    TryExactMenuPath(scanResult) {
        if !scanResult.HasOwnProp("panelMenuButton") || !IsObject(scanResult.panelMenuButton)
            return ""

        menuButton := scanResult.panelMenuButton
        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok
            return ""
        openMethod := this.TryPatternClick(menuButton.element)
        if openMethod = "" {
            this.app.logger.Warn("Layers panel menu button was present, but no UIA pattern could open it.")
            return ""
        }

        Sleep 200
        desktop := UIA.GetRootElement()
        deleteItem := ""
        try deleteItem := desktop.WaitElement({Type:"MenuItem", Name:"Delete Selection"}, 1200)
        catch
            deleteItem := ""

        if !IsObject(deleteItem) {
            SendEvent "{Escape}"
            this.app.logger.Warn("Exact menu item 'Delete Selection' was not exposed after opening the Layers panel menu.")
            return ""
        }

        invokeMethod := this.TryPatternClick(deleteItem)
        if invokeMethod = "" {
            SendEvent "{Escape}"
            this.app.logger.Warn("Exact menu item 'Delete Selection' was found but could not be invoked through UIA.")
            return ""
        }

        confirmResult := {found: false, detail: ""}
        confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1200)
        if !IsObject(confirmResult) || !confirmResult.found {
            SendEvent "{Escape}"
            this.app.logger.Warn("Exact menu item 'Delete Selection' was invoked, but no Illustrator confirmation dialog appeared.")
            return ""
        }

        confirmDetail := (IsObject(confirmResult) && confirmResult.HasOwnProp("detail")) ? confirmResult.detail : ""

        this.app.logger.Info(
            "Layers delete attempt via exact menu path. OpenMethod="
            . openMethod
            . " | ItemMethod="
            . invokeMethod
        )
        detailText := Format(
            "Opened the exposed Layers panel menu via {1} and invoked the exact menu item Delete Selection via {2}. Confirmation dialog handling: {3}",
            openMethod,
            invokeMethod,
            confirmDetail
        )
        noteText := "The exact Layers panel menu path was invoked and the Illustrator confirmation was handled automatically."
        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: false,
            method: "exact_layers_panel_menu_path_delete_selection",
            detail: detailText,
            note: noteText
        }
    }

    TryFocusedFallback(scanResult) {
        if !scanResult.HasOwnProp("fallbackTarget") || !IsObject(scanResult.fallbackTarget)
            return ""

        target := scanResult.fallbackTarget
        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok
            return ""

        try target.element.SetFocus()
        catch {
            this.app.logger.Warn("Fallback target existed but SetFocus() failed.")
            return ""
        }

        Sleep 100
        focused := ""
        try focused := UIA.GetFocusedElement()
        catch
            focused := ""

        if !IsObject(focused) || !UIA.CompareElementsEx(focused, target.element) {
            this.app.logger.Warn("Fallback refused because focus did not land on the scanned Layers-panel target.")
            return ""
        }

        SendEvent "{Delete}"
        confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1200)
        this.app.logger.Warn(
            "Layers delete attempt via fallback. Focused Layers-panel target and sent Delete. Target="
            . target.summary
        )

        detail := "Focused the scanned Layers-panel target and sent Delete as an explicit fallback."
        note := "This fallback is only allowed after a live scan found a focusable Layers-panel target. It does not substitute document-artwork delete."
        if confirmResult.found {
            detail .= " Confirmation dialog handling: " confirmResult.detail
            note := "The scanned Layers-panel target was focused, Delete was sent, and the Illustrator confirmation was handled automatically."
        }

        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: confirmResult.found,
            method: "fallback_layers_panel_focus_then_delete_key",
            detail: detail,
            note: note
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

        WinActivate "ahk_id " hwnd
        WinWaitActive "ahk_id " hwnd, , 2
        Sleep 120
        return {
            ok: true,
            hwnd: hwnd
        }
    }

    TryPatternClick(element) {
        try {
            result := element.Click()
            if result
                return result
        } catch as err {
            this.app.logger.Warn("UIA click failed: " err.Message)
        }
        return ""
    }

    TryActivateDeleteElement(element, hwnd, scanResult, context) {
        if !IsObject(element)
            return ""

        if clickMethod := this.TryPatternClick(element) {
            confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1000)
            if confirmResult.found
                return {method: clickMethod, confirm: confirmResult}
        }

        rect := this.GetElementRect(element)
        if !IsObject(rect)
            return ""

        return this.TryActivateDeleteRect(hwnd, scanResult, rect.x, rect.y, rect.w, rect.h, context)
    }

    TryActivateDeleteRect(hwnd, scanResult, x, y, w, h, context) {
        if hwnd {
            if clickMethod := this.ClickIllustratorClientRectCenter(hwnd, x, y, w, h, context) {
                confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1000)
                if confirmResult.found
                    return {method: clickMethod, confirm: confirmResult}
            }
        }

        if clickMethod := this.ClickRectCenter(x, y, w, h, context) {
            confirmResult := this.TryAcceptDeleteConfirmation(scanResult, 1000)
            if confirmResult.found
                return {method: clickMethod, confirm: confirmResult}
        }

        return ""
    }

    TryControlClick(element) {
        if !IsObject(element)
            return ""
        try element.SetFocus()
        catch {
        }
        return this.TryCenterClick(element)
    }

    TryCenterClick(element) {
        rect := this.GetElementRect(element)
        if !IsObject(rect)
            return ""

        return this.ClickRectCenter(rect.x, rect.y, rect.w, rect.h, "delete action")
    }

    ClickRectCenter(x, y, w, h, context := "delete action") {
        centerX := x + Floor(w / 2)
        centerY := y + Floor(h / 2)
        MouseGetPos &origX, &origY
        try MouseMove centerX, centerY, 0
        catch as err {
            this.app.logger.Warn("Screen-click move failed for " context ": " err.Message)
            return ""
        }

        Click
        Sleep 80
        try MouseMove origX, origY, 0
        catch {
        }
        this.app.logger.Info("Center-click delivered for " context ". Bounds=" x "," y "," w "," h)
        return "center_click"
    }

    ClickIllustratorClientRectCenter(hwnd, x, y, w, h, context := "delete action") {
        if !hwnd
            return ""

        centerX := x + Floor(w / 2)
        centerY := y + Floor(h / 2)
        point := Buffer(8, 0)
        NumPut("int", centerX, point, 0)
        NumPut("int", centerY, point, 4)
        if !DllCall("ScreenToClient", "ptr", hwnd, "ptr", point, "int") {
            this.app.logger.Warn("ScreenToClient failed for " context ".")
            return ""
        }

        clientX := NumGet(point, 0, "int")
        clientY := NumGet(point, 4, "int")
        try {
            ControlClick "x" clientX " y" clientY, "ahk_id " hwnd, , "Left", 1, "NA"
            Sleep 80
            this.app.logger.Info("ControlClick delivered for " context ". Client=" clientX "," clientY " | Bounds=" x "," y "," w "," h)
            return "control_click"
        } catch as err {
            this.app.logger.Warn("ControlClick failed for " context ": " err.Message)
            return ""
        }
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

    TryAcceptDeleteConfirmation(scanResult, timeoutMs := 4000) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            if hwnd := this.FindDeleteConfirmationWindowHandle(scanResult) {
                WinActivate "ahk_id " hwnd
                WinWaitActive "ahk_id " hwnd, , 1
                Sleep 60
                SendEvent "{Enter}"
                this.app.logger.Warn("Illustrator delete confirmation dialog was found and Enter was sent to accept it.")
                return {
                    found: true,
                    detail: "The Illustrator confirmation dialog was found and Enter was sent to accept it."
                }
            }

            dialog := this.FindDeleteConfirmationDialog()
            if IsObject(dialog) {
                yesButton := this.FindDialogYesButton(dialog)
                if IsObject(yesButton) {
                    clickMethod := this.TryControlClick(yesButton)
                    if clickMethod != "" {
                        this.app.logger.Info(
                            "Illustrator delete confirmation accepted automatically. Method="
                            . clickMethod
                        )
                        return {
                            found: true,
                            detail: "The Illustrator confirmation dialog was found and `"`"Yes`"`" was clicked via " clickMethod "."
                        }
                    }
                }
            }
            Sleep 75
        }

        this.app.logger.Info("No Illustrator delete confirmation dialog appeared after the exact Layers delete control was invoked.")
        return {
            found: false,
            detail: "No Illustrator delete confirmation dialog appeared within the wait window."
        }
    }

    FindDeleteConfirmationDialog() {
        desktop := UIA.GetRootElement()
        windows := []
        try windows := desktop.FindElements({Type:"Window"})
        catch
            windows := []

        for dialog in windows {
            descriptor := this.DescriptorText(dialog)
            if InStr(descriptor, "delete the selection") || (InStr(descriptor, "delete") && InStr(descriptor, "selection"))
                return dialog

            textNodes := []
            try textNodes := dialog.FindElements([{Type:"Text"}, {Type:"Document"}, {Type:"Pane"}])
            catch
                textNodes := []

            for textNode in textNodes {
                textDescriptor := this.DescriptorText(textNode)
                if InStr(textDescriptor, "delete the selection") || (InStr(textDescriptor, "delete") && InStr(textDescriptor, "selection"))
                    return dialog
            }
        }

        return ""
    }

    FindDeleteConfirmationWindowHandle(scanResult) {
        illustratorPid := 0
        if IsObject(scanResult) && IsObject(scanResult.activeWindow) {
            try illustratorPid := WinGetPID("ahk_id " scanResult.activeWindow.hwnd)
        }

        for hwnd in WinGetList() {
            try {
                if !WinExist("ahk_id " hwnd)
                    continue
                if !DllCall("IsWindowVisible", "ptr", hwnd, "int")
                    continue
                if illustratorPid {
                    pid := WinGetPID("ahk_id " hwnd)
                    if pid != illustratorPid
                        continue
                }
                title := StrLower(WinGetTitle("ahk_id " hwnd))
                text := ""
                try text := StrLower(WinGetText("ahk_id " hwnd))
                className := ""
                try className := WinGetClass("ahk_id " hwnd)
                if InStr(text, "delete the selection") || (InStr(text, "delete") && InStr(text, "selection"))
                    return hwnd
                if className = "#32770" && (InStr(title, "adobe illustrator") || InStr(text, "warning"))
                    return hwnd
            } catch {
            }
        }
        return 0
    }

    FindDialogYesButton(dialog) {
        buttons := []
        try buttons := dialog.FindElements({Type:"Button"})
        catch
            buttons := []

        for button in buttons {
            descriptor := this.DescriptorText(button)
            if InStr(descriptor, "yes")
                return button
        }

        return ""
    }

    DescriptorText(element) {
        parts := [
            this.SafePropText(element, "Name"),
            this.SafePropText(element, "HelpText"),
            this.SafePropText(element, "AutomationId"),
            this.SafePropText(element, "FullDescription"),
            this.SafePropText(element, "LegacyIAccessibleName"),
            this.SafePropText(element, "LegacyIAccessibleDescription"),
            this.SafePropText(element, "LocalizedControlType")
        ]
        return StrLower(JoinLines(parts, " "))
    }

    SafePropText(element, propName) {
        try {
            value := element.%propName%
            return value != "" ? value : ""
        } catch {
            return ""
        }
    }

}

class ThreeDExtrudeDepth16mmAction {
    __New(app) {
        this.app := app
        this.Id := "three_d_extrude_depth_16mm"
        this.Label := "3D Extrude Depth 16 mm"
        this.RequiresExactLayersScan := false
    }

    Run(scanResult) {
        panelContext := this.GetThreeDPanelContext(scanResult, false)
        if !panelContext.ok {
            return {
                attempted: false,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: panelContext.method,
                detail: panelContext.detail,
                note: panelContext.note
            }
        }

        panelClick := panelContext.method
        topMethod := this.ScrollPanelToTop(panelContext.panelRoot)
        extrude := this.FindExtrudeControl(panelContext.panelRoot)
        if !IsObject(extrude) {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "extrude_not_exposed",
                detail: "The Extrude control was not exposed inside the visible 3D and Materials panel.",
                note: "Keep the 3D and Materials panel visible on the Object tab, then try again."
            }
        }

        extrudeClick := this.TryUpperTileClick(extrude, "3D Extrude tile")
        if extrudeClick = "" {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "extrude_click_failed",
                detail: "The Extrude control inside the visible 3D and Materials panel could not be activated.",
                note: "Keep the 3D and Materials panel visible on the Object tab, then try again."
            }
        }

        Sleep 1300
        panelContext := this.GetThreeDPanelContext(scanResult, false)
        if !panelContext.ok {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: panelContext.method,
                detail: panelContext.detail,
                note: panelContext.note
            }
        }

        depthField := this.FindDepthField([panelContext.panelRoot])
        scrollMethod := topMethod != "" ? topMethod : "not_needed"
        if !IsObject(depthField) {
            scrollResult := this.TryScrollPanelForDepth(panelContext.panelRoot, scanResult)
            scrollMethod := scrollResult.method
            depthField := scrollResult.field
        }
        if !IsObject(depthField) {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "depth_field_not_exposed",
                detail: "The Depth input was not exposed through UI Automation after selecting Extrude.",
                note: "The panel may need to stay visible and the selected object must support 3D Extrude controls."
            }
        }

        setResult := this.SetDepthValue(depthField, panelContext.panelRoot, "16 mm")
        if !setResult.ok {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "depth_set_failed",
                detail: setResult.detail,
                note: "The action reached the Depth field, but the value could not be delivered."
            }
        }

        this.app.logger.Info(
            "3D Extrude Depth 16 mm action succeeded. PanelMethod="
            . panelClick
            . " | TopMethod="
            . scrollMethod
            . " | ExtrudeMethod="
            . extrudeClick
            . " | DepthMethod="
            . setResult.method
        )

        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: false,
            method: "uia_3d_extrude_depth_16mm",
                detail: "Used the visible 3D and Materials panel, selected Extrude, and delivered `"`"16 mm`"`" to the Depth field.",
                note: "This action now refuses to guess across other Illustrator panels."
        }
    }

    GetThreeDPanelContext(scanResult, allowPanelActivation := true) {
        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok {
            return {
                ok: false,
                method: "illustrator_not_ready",
                detail: prep.detail,
                note: "Open Illustrator and make the 3D and Materials panel visible."
            }
        }

        panelRoot := this.FindThreeDPanelRoot(prep.roots)
        if IsObject(panelRoot) {
            return {
                ok: true,
                method: "already_visible",
                detail: "The 3D and Materials panel is already visible.",
                note: "",
                panelRoot: panelRoot,
                roots: prep.roots
            }
        }

        if !allowPanelActivation {
            return {
                ok: false,
                method: "panel_not_visible",
                detail: "The 3D and Materials panel is not visible.",
                note: "Open the 3D and Materials panel, then try again."
            }
        }

        panelIcon := this.FindThreeDPanelIcon(prep.roots)
        if !IsObject(panelIcon) {
            return {
                ok: false,
                method: "panel_icon_not_exposed",
                detail: "The 3D and Materials panel icon was not exposed through UI Automation.",
                note: "Keep the right-side panel rail visible, then try again."
            }
        }

        openMethod := this.TryControlClick(panelIcon)
        if openMethod = "" {
            return {
                ok: false,
                method: "panel_icon_click_failed",
                detail: "The 3D and Materials panel icon was found, but it could not be clicked.",
                note: "Keep Illustrator frontmost and the right-side panel rail unobstructed, then try again."
            }
        }

        Sleep 220
        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok {
            return {
                ok: false,
                method: "illustrator_not_ready_after_panel_open",
                detail: prep.detail,
                note: "Open Illustrator and try again."
            }
        }

        panelRoot := this.FindThreeDPanelRoot(prep.roots)
        if !IsObject(panelRoot) {
            return {
                ok: false,
                method: "panel_not_visible_after_open",
                detail: "The 3D and Materials panel did not appear after clicking its icon.",
                note: "Open the 3D and Materials panel manually, then try again."
            }
        }

        return {
            ok: true,
            method: openMethod,
            detail: "Opened the 3D and Materials panel.",
            note: "",
            panelRoot: panelRoot,
            roots: prep.roots
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
        Sleep 150

        roots := []
        try {
            root := UIA.ElementFromHandle("ahk_id " hwnd, , false)
            if IsObject(root)
                roots.Push(root)
        }
        catch {
        }

        try {
            desktop := UIA.GetRootElement()
            if IsObject(desktop)
                roots.Push(desktop)
        }
        catch {
        }

        return {
            ok: roots.Length > 0,
            detail: roots.Length > 0 ? "" : "No UI Automation root could be created for the active Illustrator window.",
            roots: roots,
            hwnd: hwnd
        }
    }

    FindNamedControl(roots, nameText, allowedTypes) {
        candidates := this.FindNamedControls(roots, nameText, allowedTypes)
        return candidates.Length > 0 ? candidates[1] : ""
    }

    FindExtrudeControl(panelRoot) {
        if !IsObject(panelRoot)
            return ""
        panelRect := this.GetElementRect(panelRoot)
        candidates := this.FindNamedControls([panelRoot], "Extrude", ["Button", "TabItem", "RadioButton", "Text", "Custom"])
        best := ""
        bestScore := -1
        for candidate in candidates {
            rect := this.GetElementRect(candidate)
            if !IsObject(rect)
                continue
            if IsObject(panelRect) {
                if rect.y > panelRect.y + Floor(panelRect.h * 0.40)
                    continue
                if rect.x < panelRect.x || rect.x > panelRect.x + panelRect.w
                    continue
            }
            score := 100000 - Abs((rect.y + Floor(rect.h / 2)) - (panelRect.y + 160))
            if score > bestScore {
                best := candidate
                bestScore := score
            }
        }
        return best
    }

    FindNamedControls(roots, nameText, allowedTypes) {
        matches := []
        for root in roots {
            namedCandidates := []
            try namedCandidates := root.FindElements({Name:nameText, mm:"Substring"})
            catch
                namedCandidates := []

            for candidate in namedCandidates {
                if !this.MatchesType(candidate, allowedTypes)
                    continue
                if !this.IsVisibleElement(candidate)
                    continue
                matches.Push(candidate)
            }
        }
        return matches
    }

    FindDepthField(roots) {
        for root in roots {
            likelyField := this.FindLikelyDepthField(root)
            if IsObject(likelyField)
                return likelyField

            candidates := []
            try candidates := root.FindElements([{Type:"Edit"}, {Type:"Spinner"}, {Type:"ComboBox"}, {Type:"Custom"}])
            catch
                candidates := []

            for candidate in candidates {
                if !this.IsVisibleElement(candidate)
                    continue
                if InStr(this.DescriptorText(candidate), "depth")
                    return candidate
            }

            labels := []
            try labels := root.FindElements({Name:"Depth", mm:"Substring"})
            catch
                labels := []

            for label in labels {
                field := this.FindEditableNear(label)
                if IsObject(field)
                    return field
            }
        }
        return ""
    }

    FindLikelyDepthField(panelRoot) {
        if !IsObject(panelRoot)
            return ""
        panelRect := this.GetElementRect(panelRoot)
        if !IsObject(panelRect)
            return ""

        candidates := []
        try candidates := panelRoot.FindElements([{Type:"Edit"}, {Type:"Spinner"}, {Type:"ComboBox"}])
        catch
            candidates := []

        best := ""
        bestScore := -1
        for candidate in candidates {
            rect := this.GetElementRect(candidate)
            if !IsObject(rect)
                continue
            if rect.y < panelRect.y + 170 || rect.y > panelRect.y + Min(Floor(panelRect.h * 0.34), 360)
                continue
            if rect.x < panelRect.x + Floor(panelRect.w * 0.55)
                continue
            descriptor := this.DescriptorText(candidate)
            score := 0
            if InStr(descriptor, "mm")
                score += 2000
            score += 1200 - Abs(rect.y - (panelRect.y + 255))
            if score > bestScore {
                best := candidate
                bestScore := score
            }
        }
        return best
    }

    FindEditableNear(label) {
        searchRoots := [label]
        try {
            parent := label.Parent
            if IsObject(parent)
                searchRoots.Push(parent)
            if IsObject(parent) {
                grandParent := parent.Parent
                if IsObject(grandParent)
                    searchRoots.Push(grandParent)
            }
        }
        catch {
        }

        for searchRoot in searchRoots {
            candidates := []
            try candidates := searchRoot.FindElements([{Type:"Edit"}, {Type:"Spinner"}, {Type:"ComboBox"}, {Type:"Custom"}])
            catch
                candidates := []

            for candidate in candidates {
                if !this.IsVisibleElement(candidate)
                    continue
                descriptor := this.DescriptorText(candidate)
                if InStr(descriptor, "depth")
                    return candidate
            }
        }

        for searchRoot in searchRoots {
            candidates := []
            try candidates := searchRoot.FindElements([{Type:"Edit"}, {Type:"Spinner"}, {Type:"ComboBox"}])
            catch
                candidates := []
            for candidate in candidates {
                if this.IsVisibleElement(candidate)
                    return candidate
            }
        }

        return ""
    }

    SetDepthValue(field, panelRoot, valueText) {
        try field.SetFocus()
        catch {
        }

        clickMethod := this.TryControlClick(field)
        Sleep 120
        SendEvent "^a"
        Sleep 60
        SendText valueText
        Sleep 60
        SendEvent "{Enter}"
        Sleep 180

        if this.DepthFieldLooksUpdated(field, panelRoot, valueText) {
            return {
                ok: true,
                detail: "Focused the Depth field and sent `"`"" valueText "`"`" followed by Enter.",
                method: clickMethod != "" ? clickMethod "_plus_keyboard" : "keyboard_after_focus"
            }
        }

        return {
            ok: false,
            detail: "The action typed `"`"" valueText "`"`" into a likely field, but the visible field value did not read back as 16 mm.",
            method: clickMethod != "" ? clickMethod "_plus_keyboard" : "keyboard_after_focus"
        }
    }

    DepthFieldLooksUpdated(field, panelRoot, valueText) {
        normalizedTarget := StrLower(StrReplace(valueText, " ", ""))
        for candidate in [field, this.FindLikelyDepthField(panelRoot)] {
            if !IsObject(candidate)
                continue
            descriptor := StrLower(StrReplace(this.DescriptorText(candidate), " ", ""))
            value := StrLower(StrReplace(this.ReadFieldValue(candidate), " ", ""))
            if InStr(descriptor, normalizedTarget) || InStr(value, normalizedTarget)
                return true
        }
        return false
    }

    ReadFieldValue(field) {
        if !IsObject(field)
            return ""
        for propName in ["Value", "Name", "LegacyIAccessibleValue", "HelpText"] {
            try {
                value := field.%propName%
                if value != ""
                    return value
            } catch {
            }
        }
        return ""
    }

    TryControlClick(element) {
        if !IsObject(element)
            return ""
        try element.SetFocus()
        catch {
        }
        return this.TryCenterClick(element)
    }

    TryUpperTileClick(element, context := "3D tile") {
        if !IsObject(element)
            return ""
        try element.SetFocus()
        catch {
        }
        rect := this.GetElementRect(element)
        if !IsObject(rect)
            return ""

        targetX := rect.x + Floor(rect.w * 0.28)
        targetY := rect.y + Floor(rect.h * 0.18)
        return this.ClickPoint(targetX, targetY, context)
    }

    TryPatternClick(element) {
        try {
            result := element.Click()
            if result
                return result
        } catch as err {
            this.app.logger.Warn("UIA click failed for 3D action: " err.Message)
        }
        return ""
    }

    TryCenterClick(element) {
        rect := this.GetElementRect(element)
        if !IsObject(rect)
            return ""

        centerX := rect.x + Floor(rect.w / 2)
        centerY := rect.y + Floor(rect.h / 2)
        return this.ClickPoint(centerX, centerY, "3D action")
    }

    ClickPoint(x, y, context := "3D action") {
        MouseGetPos &origX, &origY
        try MouseMove x, y, 0
        catch as err {
            this.app.logger.Warn("Screen-click move failed for 3D action: " err.Message)
            return ""
        }

        Click
        Sleep 80
        try MouseMove origX, origY, 0
        catch {
        }
        this.app.logger.Info("Point-click delivered for " context ". Target=" x "," y)
        return "point_click"
    }

    FindThreeDPanelRoot(roots) {
        exactRoots := []
        for root in roots {
            namedCandidates := []
            try namedCandidates := root.FindElements({Name:"3D and Materials"})
            catch
                namedCandidates := []
            for candidate in namedCandidates {
                rect := this.GetElementRect(candidate)
                if !IsObject(rect)
                    continue
                className := this.SafePropText(candidate, "ClassName")
                if rect.w >= 240 && rect.w <= 520 && rect.h >= 320 && rect.h <= 1600 && className = "DroverLord - Window Class"
                    exactRoots.Push(candidate)
            }
        }
        if exactRoots.Length > 0
            return exactRoots[1]
        return ""
    }

    FindThreeDPanelIcon(roots) {
        candidates := this.FindNamedControls(roots, "3D and Materials", ["Button", "Custom", "Group", "Text"])
        best := ""
        bestScore := -1
        for candidate in candidates {
            rect := this.GetElementRect(candidate)
            if !IsObject(rect)
                continue
            if rect.w < 18 || rect.h < 18 || rect.w > 120 || rect.h > 120
                continue
            if Abs(rect.w - rect.h) > 40
                continue
            score := rect.x + rect.y + 1000 - Abs(rect.w - rect.h)
            if score > bestScore {
                best := candidate
                bestScore := score
            }
        }
        return best
    }

    ContainsNamedVisibleControl(root, nameText) {
        if !IsObject(root)
            return false
        candidates := []
        try candidates := root.FindElements({Name:nameText, mm:"Substring"})
        catch
            candidates := []
        for candidate in candidates {
            if this.IsVisibleElement(candidate)
                return true
        }
        return false
    }

    TryScrollPanelForDepth(panelRoot, scanResult) {
        if !IsObject(panelRoot) {
            return {
                field: "",
                method: "panel_scroll_unavailable"
            }
        }

        rect := this.GetElementRect(panelRoot)
        if !IsObject(rect) {
            return {
                field: "",
                method: "panel_rect_unavailable"
            }
        }

        targetX := rect.x + Floor(rect.w / 2)
        targetY := rect.y + Floor(rect.h * 0.60)
        if targetY > rect.y + rect.h - 40
            targetY := rect.y + rect.h - 40
        if targetY < rect.y + 80
            targetY := rect.y + 80

        MouseGetPos &origX, &origY
        Loop 3 {
            MouseMove targetX, targetY, 0
            SendEvent "{WheelDown 3}"
            Sleep 140
            refreshedContext := this.GetThreeDPanelContext(scanResult, false)
            if refreshedContext.ok {
                field := this.FindDepthField([refreshedContext.panelRoot])
                if IsObject(field) {
                    try MouseMove origX, origY, 0
                    catch {
                    }
                    return {
                        field: field,
                        method: "panel_mouse_wheel_scroll"
                    }
                }
            }
        }

        try MouseMove origX, origY, 0
        catch {
        }
        return {
            field: "",
            method: "panel_mouse_wheel_scroll_failed"
        }
    }

    ScrollPanelToTop(panelRoot) {
        rect := this.GetElementRect(panelRoot)
        if !IsObject(rect)
            return ""

        targetX := rect.x + Floor(rect.w / 2)
        targetY := rect.y + Min(140, Floor(rect.h * 0.20))
        MouseGetPos &origX, &origY
        try {
            MouseMove targetX, targetY, 0
            SendEvent "{WheelUp 6}"
            Sleep 120
        } catch {
            return ""
        } finally {
            try MouseMove origX, origY, 0
            catch {
            }
        }
        return "panel_scroll_top"
    }

    ClickPanelRelative(panelRoot, xRatio, yRatio, context) {
        rect := this.GetElementRect(panelRoot)
        if !IsObject(rect)
            return ""

        targetW := 18
        targetH := 18
        targetX := rect.x + Floor(rect.w * xRatio) - Floor(targetW / 2)
        targetY := rect.y + Floor(rect.h * yRatio) - Floor(targetH / 2)
        return this.ClickRectCenter(targetX, targetY, targetW, targetH, context)
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

    MatchesType(element, allowedTypes) {
        try typeName := UIA.Type[element.Type]
        catch
            typeName := ""
        if typeName = ""
            return false
        for allowedType in allowedTypes {
            if typeName = allowedType
                return true
        }
        return false
    }

    IsVisibleElement(element) {
        try rect := element.Location
        catch
            rect := ""
        return IsObject(rect) && rect.w > 0 && rect.h > 0
    }

    DescriptorText(element) {
        parts := [
            this.SafePropText(element, "Name"),
            this.SafePropText(element, "HelpText"),
            this.SafePropText(element, "AutomationId"),
            this.SafePropText(element, "FullDescription"),
            this.SafePropText(element, "LegacyIAccessibleName"),
            this.SafePropText(element, "LegacyIAccessibleDescription"),
            this.SafePropText(element, "LocalizedControlType")
        ]
        return StrLower(JoinLines(parts, " "))
    }

    SafePropText(element, propName) {
        try {
            value := element.%propName%
            return value != "" ? value : ""
        } catch {
            return ""
        }
    }
}

class SaveSelectedObjToProject3DAction extends ThreeDExtrudeDepth16mmAction {
    __New(app) {
        this.app := app
        this.Id := "save_selected_obj_to_project_3d"
        this.Label := "save obj"
        this.RequiresExactLayersScan := false
    }

    Run(scanResult) {
        return this.RunExportToProject3D(scanResult)
    }

    RunExportToProject3D(scanResult) {
        helperPath := this.GetWorkspaceHelperScriptPath()
        contextPath := A_Temp "\FlowCell_Selected_OBJ_Export_Context.txt"

        if FileExist(contextPath) {
            try FileDelete contextPath
            catch {
            }
        }

        helperResult := this.app.RunIllustratorScript(helperPath, "action " this.Id)
        if !helperResult.succeeded {
            return {
                attempted: helperResult.attempted,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: helperResult.method,
                detail: helperResult.detail != "" ? helperResult.detail : "The Illustrator prep script did not run.",
                note: "The export button needs Illustrator frontmost with a valid selection."
            }
        }

        openResult := this.OpenExportSelectionWindow(scanResult, 14000)
        if !openResult.ok {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: openResult.method,
                detail: openResult.detail,
                note: openResult.note
            }
        }

        context := this.WaitForContextFile(contextPath, 8000)
        if !context.HasOwnProp("Status") {
            this.CloseExportSelectionWindowIfPresent()
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "context_missing",
                detail: "The prep script finished but did not write export context.",
                note: "Make sure the selection is inside one named asset layer and try again."
            }
        }

        if context.Status != "Ready" {
            this.CloseExportSelectionWindowIfPresent()
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "context_error",
                detail: context.HasOwnProp("Message") ? context.Message : "The prep script blocked the export.",
                note: "This button exports the current selection from the resolved asset layer."
            }
        }

        exportFolder := context.HasOwnProp("AssetFolder") ? context.AssetFolder : ""
        targetStem := context.HasOwnProp("AssetName") ? context.AssetName : ""
        if exportFolder = "" || targetStem = "" {
            this.CloseExportSelectionWindowIfPresent()
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "export_path_missing",
                detail: "The prep script did not resolve the target OBJ name and folder.",
                note: "The current selection must resolve to a named asset layer in the project."
            }
        }

        flowResult := this.RunExportSelectionFlowFromWindow(openResult.window, openResult.method, exportFolder, targetStem)
        if !flowResult.ok {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: flowResult.method,
                detail: flowResult.detail,
                note: flowResult.note
            }
        }

        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: flowResult.effectConfirmed,
            method: flowResult.method,
            detail: "Exported the current selection to " flowResult.finalPath ".",
            note: flowResult.effectConfirmed
                ? "The OBJ filename came from the resolved asset layer above the current selection."
                : flowResult.note,
            finalPath: flowResult.finalPath
        }
    }

    GetWorkspaceHelperScriptPath() {
        return A_ScriptDir "\..\Illustrator\HelperScripts\18_Prepare_Selected_OBJ_Export.jsx"
    }

    GetInstalledHelperScriptPath() {
        return "C:\Program Files\Adobe\Adobe Illustrator 2026\Presets\en_US\Scripts\18_Prepare_Selected_OBJ_Export.jsx"
    }

    SyncInstalledHelperScript() {
        sourcePath := this.GetWorkspaceHelperScriptPath()
        targetPath := this.GetInstalledHelperScriptPath()
        if !FileExist(sourcePath)
            return false

        targetExists := FileExist(targetPath)
        if targetExists {
            try {
                sourceSize := FileGetSize(sourcePath)
                targetSize := FileGetSize(targetPath)
                sourceStamp := FileGetTime(sourcePath, "M")
                targetStamp := FileGetTime(targetPath, "M")
                if sourceSize = targetSize && sourceStamp = targetStamp
                    return true
            } catch {
            }
        }

        try {
            FileCopy sourcePath, targetPath, 1
            return true
        } catch {
            return false
        }
    }

    TryRunInstalledHelperScriptFast(scriptPath, contextPath, scanResult) {
        result := {
            attempted: false,
            succeeded: false,
            method: "helper_fast_not_started",
            detail: ""
        }

        if !FileExist(scriptPath) {
            result.detail := "Installed helper script was not found."
            return result
        }

        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok {
            result.detail := prep.detail
            return result
        }

        scriptFileName := ""
        scriptBaseName := ""
        SplitPath scriptPath, &scriptFileName, , , &scriptBaseName
        if scriptBaseName = ""
            scriptBaseName := scriptFileName
        if scriptBaseName = "" {
            result.detail := "The installed helper script name could not be resolved."
            return result
        }

        result.attempted := true
        this.app.logger.Info("Trying fast installed helper script path. Script=" scriptPath)
        SendEvent "{Escape}"
        Sleep 40
        SendEvent "!f"
        Sleep 140
        SendEvent "{Home}"
        Sleep 30
        SendEvent "{Down 21}"
        Sleep 50
        SendEvent "{Right}"
        Sleep 100

        root := UIA.GetRootElement()
        scriptItem := ""
        try scriptItem := root.WaitElement({Type:"MenuItem", Name:scriptBaseName, mm:"Substring"}, 900)
        catch
            scriptItem := ""

        if IsObject(scriptItem) {
            invokeMethod := this.TryMenuItemInvoke(scriptItem, false)
            if invokeMethod = "" {
                SendEvent "{Escape}"
                result.detail := "The installed helper script menu item was exposed but could not be invoked."
                return result
            }
            result.method := "helper_fast_menu_item"
        } else {
            SendText scriptBaseName
            Sleep 40
            SendEvent "{Enter}"
            result.method := "helper_fast_keyboard_name"
        }

        context := this.WaitForContextFile(contextPath, 1800)
        if context.HasOwnProp("Status") {
            result.succeeded := true
            result.detail := "The installed helper script ran through File > Scripts."
            return result
        }

        SendEvent "{Escape}"
        Sleep 40
        result.detail := "The fast helper script path did not produce context in time."
        result.succeeded := false
        return result
    }

    ReadContextFile(contextPath) {
        context := {}
        if !FileExist(contextPath)
            return context

        text := ""
        try text := FileRead(contextPath, "UTF-8")
        catch
            return context

        for rawLine in StrSplit(text, "`n", "`r") {
            line := Trim(rawLine, "`r`n")
            if line = ""
                continue
            separatorAt := InStr(line, "=")
            if separatorAt <= 1
                continue
            key := Trim(SubStr(line, 1, separatorAt - 1))
            if SubStr(key, 1, 1) = Chr(0xFEFF)
                key := SubStr(key, 2)
            value := SubStr(line, separatorAt + 1)
            if key != ""
                context.%key% := value
        }
        return context
    }

    WaitForContextFile(contextPath, timeoutMs := 5000) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            context := this.ReadContextFile(contextPath)
            if context.HasOwnProp("Status")
                return context
            Sleep 40
        }
        return {}
    }

    RunExportSelectionFlow(scanResult, exportFolder, targetStem) {
        openResult := this.OpenExportSelectionWindow(scanResult)
        if !openResult.ok
            return openResult
        return this.RunExportSelectionFlowFromWindow(openResult.window, openResult.method, exportFolder, targetStem)
    }

    RunExportSelectionFlowFromWindow(exportWin, openMethod, exportFolder, targetStem) {
        exportStem := this.FindHighestNumberedAssetName(exportWin)
        if exportStem = "" {
            return {
                ok: false,
                method: openMethod "_asset_not_found",
                detail: "The Export Selection dialog did not expose any Asset N entries.",
                note: "The current selection needs to exist as the newest export asset in Illustrator."
            }
        }

        initialState := this.CaptureStemFileState(exportFolder, exportStem)

        folderResult := this.SetExportSelectionFolder(exportWin, exportFolder)
        if !folderResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method,
                detail: folderResult.detail,
                note: folderResult.note
            }
        }

        formatResult := this.EnsureExportSelectionObjFormat(exportWin)
        if !formatResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method,
                detail: formatResult.detail,
                note: formatResult.note
            }
        }

        exportResult := this.ClickExportAssetButton(exportWin)
        if !exportResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method,
                detail: exportResult.detail,
                note: exportResult.note
            }
        }

        writeResult := this.WaitForStemWrite(exportFolder, exportStem, initialState, 15000)
        if !writeResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method "_" writeResult.method,
                detail: writeResult.detail,
                note: writeResult.note
            }
        }

        renameResult := this.RenameStemFiles(exportFolder, exportStem, targetStem)
        if !renameResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method "_" writeResult.method "_" renameResult.method,
                detail: renameResult.detail,
                note: renameResult.note
            }
        }

        this.CloseExportSelectionWindowIfPresent()
        return {
            ok: true,
            method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method "_" writeResult.method "_" renameResult.method,
            detail: renameResult.detail,
            note: "",
            effectConfirmed: true,
            finalPath: renameResult.finalPath
        }
    }

    OpenExportSelectionWindow(scanResult, timeoutMs := 2500) {
        this.CloseExportSelectionWindowIfPresent()

        prep := this.PrepareIllustrator(scanResult)
        if !prep.ok {
            return {
                ok: false,
                method: "illustrator_not_ready",
                detail: prep.detail,
                note: "Open Illustrator and keep the selection active."
            }
        }

        SendEvent "{Escape}"
        Sleep 30
        this.app.logger.Info("Opening Export Selection via File menu.")
        menuItem := ""
        roots := []
        try {
            root := UIA.ElementFromHandle("ahk_id " prep.hwnd, , false)
            if IsObject(root)
                roots.Push(root)
        }
        catch {
        }
        try {
            desktop := UIA.GetRootElement()
            if IsObject(desktop)
                roots.Push(desktop)
        }
        catch {
        }

        Loop 2 {
            SendEvent "!f"
            Sleep 180
            menuItem := this.FindNamedControl(roots, "Export Selection", ["MenuItem", "Text", "Custom"])
            if IsObject(menuItem)
                break
            this.app.logger.Info("Export Selection menu item was not exposed on attempt " A_Index ".")
            SendEvent "{Escape}"
            Sleep 40
        }

        invokeMethod := ""
        if IsObject(menuItem) {
            try {
                result := menuItem.Click()
                if result
                    invokeMethod := "uia_click"
            } catch {
            }
            if invokeMethod = "" {
                try menuItem.SetFocus()
                catch {
                }
                SendEvent "{Enter}"
                invokeMethod := "menu_enter"
            }
        } else {
            this.app.logger.Info("Falling back to deterministic keyboard navigation for File > Export Selection.")
            SendEvent "!f"
            Sleep 120
            SendEvent "{Home}"
            Sleep 25
            SendEvent "{Down 19}"
            Sleep 30
            SendEvent "{Enter}"
            invokeMethod := "file_menu_home_down_19"
        }

        exportWin := this.WaitForExportSelectionWindow(timeoutMs)
        if !IsObject(exportWin) {
            this.app.logger.Warn("Export for Screens dialog did not appear after invoking Export Selection.")
            return {
                ok: false,
                method: invokeMethod "_dialog_missing",
                detail: "Export Selection was invoked, but the Export for Screens dialog did not appear.",
                note: "The current selection may not be exportable yet."
            }
        }

        this.app.logger.Info("Export Selection dialog opened. Method=" invokeMethod)

        return {
            ok: true,
            method: invokeMethod,
            detail: "Opened Illustrator's Export Selection dialog.",
            note: "",
            window: exportWin
        }
    }

    WaitForExportSelectionWindow(timeoutMs := 5000) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            exportWin := this.FindExportSelectionWindow()
            if IsObject(exportWin)
                return exportWin
            Sleep 40
        }
        return ""
    }

    FindExportSelectionWindow() {
        exportHwnd := this.FindExportSelectionWindowHwnd()
        if exportHwnd {
            try {
                exportWin := UIA.ElementFromHandle("ahk_id " exportHwnd, , false)
                if IsObject(exportWin)
                    return exportWin
            }
            catch {
            }
        }

        root := UIA.GetRootElement()
        windows := []
        try windows := root.FindElements({Type:"Window"})
        catch
            windows := []

        for win in windows {
            try name := win.Name
            catch
                name := ""
            if InStr(name, "Export for Screens") {
                if this.IsVisibleElement(win)
                    return win
            }
        }
        return ""
    }

    FindExportSelectionWindowHwnd() {
        for hwnd in WinGetList() {
            title := ""
            try title := WinGetTitle("ahk_id " hwnd)
            catch
                title := ""
            if !InStr(title, "Export for Screens")
                continue
            try {
                if !DllCall("IsWindowVisible", "ptr", hwnd, "int")
                    continue
            } catch {
            }
            return hwnd
        }
        return 0
    }

    CloseExportSelectionWindowIfPresent() {
        exportWin := this.FindExportSelectionWindow()
        if !IsObject(exportWin)
            return

        cancelButton := this.FindNamedControl([exportWin], "Cancel", ["Button"])
        if IsObject(cancelButton) {
            this.TryControlClick(cancelButton)
            Sleep 40
            return
        }

        SendEvent "{Escape}"
        Sleep 40
    }

    FindHighestNumberedAssetName(exportWin) {
        if !IsObject(exportWin)
            return ""

        labels := []
        try labels := exportWin.FindElements({Type:"Text"})
        catch
            labels := []

        bestName := ""
        bestNumber := -1
        for label in labels {
            try name := label.Name
            catch
                name := ""
            if RegExMatch(name, "i)^Asset\s+(\d+)$", &match) {
                number := Integer(match[1])
                if number > bestNumber {
                    bestNumber := number
                    bestName := name
                }
            }
        }

        return bestName
    }

    SetExportSelectionFolder(exportWin, exportFolder) {
        folderEdit := this.FindNamedControl([exportWin], "ExportLocationEditBox", ["Edit"])
        if !IsObject(folderEdit) {
            return {
                ok: false,
                method: "folder_edit_missing",
                detail: "The export-folder field was not exposed in the Export Selection dialog.",
                note: "The dialog layout may have changed."
            }
        }

        clickMethod := this.TryControlClick(folderEdit)
        if clickMethod = "" {
            return {
                ok: false,
                method: "folder_edit_click_failed",
                detail: "The export-folder field was found, but focus could not be moved into it.",
                note: "Try again with Illustrator unobstructed."
            }
        }

        Sleep 50
        SendEvent "^a"
        Sleep 30
        SendText exportFolder
        Sleep 30
        SendEvent "{Enter}"
        Sleep 60
        return {
            ok: true,
            method: clickMethod "_folder_set",
            detail: "Updated the export folder in the Export Selection dialog.",
            note: ""
        }
    }

    EnsureExportSelectionObjFormat(exportWin) {
        combo := this.FindNamedControl([exportWin], "type of file", ["ComboBox"])
        if !IsObject(combo) {
            return {
                ok: false,
                method: "format_combo_missing",
                detail: "The export format combo box was not exposed in the Export Selection dialog.",
                note: "The dialog layout may have changed."
            }
        }

        if this.ExportFormatLooksLikeObj(combo, exportWin) {
            return {
                ok: true,
                method: "obj_already_selected",
                detail: "The Export Selection dialog already showed OBJ as the file type.",
                note: ""
            }
        }

        clickMethod := this.TryControlClick(combo)
        if clickMethod = "" {
            return {
                ok: false,
                method: "format_combo_click_failed",
                detail: "The export format combo box was found, but it could not be opened.",
                note: "Try again with Illustrator unobstructed."
            }
        }

        Sleep 80
        ; Use deterministic keyboard navigation inside the format combo because
        ; Illustrator exposes multiple visible OBJ texts that are not always the
        ; actual selectable dropdown item.
        SendEvent "{Home}"
        Sleep 30
        SendEvent "{Down 8}"
        Sleep 30
        SendEvent "{Enter}"
        Sleep 80
        if this.ExportFormatLooksLikeObj(combo, exportWin) {
            return {
                ok: true,
                method: clickMethod "_obj_keyboard_index",
                detail: "Set the Export Selection format to OBJ through deterministic keyboard navigation.",
                note: ""
            }
        }

        SendText "OBJ"
        Sleep 30
        SendEvent "{Enter}"
        Sleep 80
        if this.ExportFormatLooksLikeObj(combo, exportWin) {
            return {
                ok: true,
                method: clickMethod "_obj_keyboard_text",
                detail: "Set the Export Selection format to OBJ by typing OBJ into the format combo box.",
                note: ""
            }
        }

        return {
            ok: false,
            method: clickMethod "_obj_verify_failed",
            detail: "The export format did not change to OBJ.",
            note: "The action stopped before export so it would not save the wrong file type."
        }
    }

    FindDesktopNamedElement(nameText, allowedTypes) {
        root := UIA.GetRootElement()
        candidates := []
        try candidates := root.FindElements({Name:nameText, mm:"Exact"})
        catch
            candidates := []

        for candidate in candidates {
            if !this.MatchesType(candidate, allowedTypes)
                continue
            if !this.IsVisibleElement(candidate)
                continue
            return candidate
        }
        return ""
    }

    FindDesktopNamedElementBelow(nameText, allowedTypes, anchorRect) {
        root := UIA.GetRootElement()
        candidates := []
        try candidates := root.FindElements({Name:nameText, mm:"Exact"})
        catch
            candidates := []

        for candidate in candidates {
            if !this.MatchesType(candidate, allowedTypes)
                continue
            if !this.IsVisibleElement(candidate)
                continue
            rect := this.GetElementRect(candidate)
            if !IsObject(rect)
                continue
            if !IsObject(anchorRect)
                return candidate
            if rect.y <= anchorRect.y + anchorRect.h
                continue
            if rect.x + rect.w < anchorRect.x - 80 || rect.x > anchorRect.x + anchorRect.w + 140
                continue
            return candidate
        }
        return ""
    }

    ExportFormatLooksLikeObj(combo, exportWin) {
        currentDescriptor := StrLower(this.DescriptorText(combo) " " this.ReadFieldValue(combo))
        if InStr(currentDescriptor, "obj")
            return true

        comboRect := this.GetElementRect(combo)
        if !IsObject(comboRect)
            return false

        texts := []
        try texts := exportWin.FindElements({Type:"Text"})
        catch
            texts := []

        for textNode in texts {
            rect := this.GetElementRect(textNode)
            if !IsObject(rect)
                continue
            if rect.x < comboRect.x - 4 || rect.x > comboRect.x + comboRect.w + 4
                continue
            if rect.y < comboRect.y - 4 || rect.y > comboRect.y + comboRect.h + 4
                continue
            try name := textNode.Name
            catch
                name := ""
            if InStr(StrLower(name), "obj")
                return true
        }

        return false
    }

    EnsureExportSelectionPngFormat(exportWin) {
        combo := this.FindNamedControl([exportWin], "type of file", ["ComboBox"])
        if !IsObject(combo) {
            return {
                ok: false,
                method: "format_combo_missing",
                detail: "The export format combo box was not exposed in the Export Selection dialog.",
                note: "The dialog layout may have changed."
            }
        }

        if this.ExportFormatLooksLikePng(combo, exportWin) {
            return {
                ok: true,
                method: "png_already_selected",
                detail: "The Export Selection dialog already showed PNG as the file type.",
                note: ""
            }
        }

        clickMethod := this.TryControlClick(combo)
        if clickMethod = "" {
            return {
                ok: false,
                method: "format_combo_click_failed",
                detail: "The export format combo box was found, but it could not be opened.",
                note: "Try again with Illustrator unobstructed."
            }
        }

        Sleep 80
        SendEvent "{Home}"
        Sleep 30
        SendEvent "{Enter}"
        Sleep 80
        if this.ExportFormatLooksLikePng(combo, exportWin) {
            return {
                ok: true,
                method: clickMethod "_png_keyboard_home",
                detail: "Set the Export Selection format to PNG through deterministic keyboard navigation.",
                note: ""
            }
        }

        SendText "PNG"
        Sleep 30
        SendEvent "{Enter}"
        Sleep 80
        if this.ExportFormatLooksLikePng(combo, exportWin) {
            return {
                ok: true,
                method: clickMethod "_png_keyboard_text",
                detail: "Set the Export Selection format to PNG by typing PNG into the format combo box.",
                note: ""
            }
        }

        return {
            ok: false,
            method: clickMethod "_png_verify_failed",
            detail: "The export format did not change to PNG.",
            note: "The action stopped before export so it would not save the wrong file type."
        }
    }

    ExportFormatLooksLikePng(combo, exportWin) {
        currentValue := StrLower(Trim(this.ReadFieldValue(combo)))
        if currentValue = "png"
            return true

        currentDescriptor := StrLower(this.DescriptorText(combo))
        if RegExMatch(currentDescriptor, "(^|[^a-z])png([^a-z0-9]|$)") && !InStr(currentDescriptor, "png 8")
            return true

        comboRect := this.GetElementRect(combo)
        if !IsObject(comboRect)
            return false

        texts := []
        try texts := exportWin.FindElements({Type:"Text"})
        catch
            texts := []

        for textNode in texts {
            rect := this.GetElementRect(textNode)
            if !IsObject(rect)
                continue
            if rect.x < comboRect.x - 4 || rect.x > comboRect.x + comboRect.w + 4
                continue
            if rect.y < comboRect.y - 4 || rect.y > comboRect.y + comboRect.h + 4
                continue
            try name := Trim(textNode.Name)
            catch
                name := ""
            if StrLower(name) = "png"
                return true
        }

        return false
    }

    ClickExportAssetButton(exportWin) {
        exportButton := this.FindNamedControl([exportWin], "Export Asset", ["Button"])
        if !IsObject(exportButton) {
            return {
                ok: false,
                method: "export_button_missing",
                detail: "The Export Asset button was not exposed in the Export Selection dialog.",
                note: "The dialog layout may have changed."
            }
        }

        clickMethod := this.TryControlClick(exportButton)
        if clickMethod = ""
            clickMethod := this.TryPatternClick(exportButton)
        if clickMethod = "" {
            return {
                ok: false,
                method: "export_button_click_failed",
                detail: "The Export Asset button was found, but it could not be clicked.",
                note: "Keep Illustrator unobstructed and try again."
            }
        }

        return {
            ok: true,
            method: clickMethod,
            detail: "Clicked Export Asset.",
            note: ""
        }
    }

    CaptureStemFileState(exportFolder, stem) {
        state := Map()
        Loop Files, exportFolder "\" stem ".*", "F" {
            stamp := ""
            try stamp := FileGetTime(A_LoopFileFullPath, "M")
            catch
                stamp := ""
            state[A_LoopFileFullPath] := stamp
        }
        return state
    }

    WaitForStemWrite(exportFolder, stem, initialState, timeoutMs := 7000) {
        return this.WaitForStemWriteByExtension(exportFolder, stem, "obj", initialState, timeoutMs)
    }

    WaitForStemWriteByExtension(exportFolder, stem, extension, initialState, timeoutMs := 7000) {
        primaryPath := exportFolder "\" stem "." extension
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            if FileExist(primaryPath) {
                currentStamp := ""
                try currentStamp := FileGetTime(primaryPath, "M")
                catch
                    currentStamp := ""
                previousStamp := initialState.Has(primaryPath) ? initialState[primaryPath] : ""
                if previousStamp = "" || currentStamp != previousStamp {
                    return {
                        ok: true,
                        method: extension "_written",
                        detail: "Illustrator wrote the exported " StrUpper(extension) " to disk.",
                        note: ""
                    }
                }
            }
            Sleep 50
        }

        return {
            ok: false,
            method: extension "_not_written",
            detail: "The exported " StrUpper(extension) " file for the selected asset did not appear or update before timeout.",
            note: "Check whether the current selection is already a valid export asset in Illustrator."
        }
    }

    RenameStemFiles(exportFolder, oldStem, newStem) {
        return this.RenameStemFilesWithPrimaryExtension(exportFolder, oldStem, newStem, "obj")
    }

    RenameStemFilesWithPrimaryExtension(exportFolder, oldStem, newStem, primaryExtension) {
        if oldStem = "" || newStem = "" {
            return {
                ok: false,
                method: "rename_inputs_missing",
                detail: "The export stem or target stem was blank.",
                note: ""
            }
        }

        if oldStem = newStem {
            return {
                ok: true,
                method: "rename_not_needed",
                detail: "The exported asset name already matched the target layer name.",
                note: "",
                finalPath: exportFolder "\" newStem "." primaryExtension
            }
        }

        filesToRename := []
        Loop Files, exportFolder "\" oldStem ".*", "F" {
            filesToRename.Push(A_LoopFileFullPath)
        }

        if filesToRename.Length = 0 {
            existingTarget := exportFolder "\" newStem "." primaryExtension
            if FileExist(existingTarget) {
                return {
                    ok: true,
                    method: "rename_already_done",
                    detail: "The exported files already matched the target asset name.",
                    note: "",
                    finalPath: existingTarget
                }
            }
            return {
                ok: false,
                method: "exported_files_missing",
                detail: "No exported files were found for the temporary asset name " oldStem ".",
                note: ""
            }
        }

        for sourcePath in filesToRename {
            SplitPath sourcePath, , , &extension
            targetPath := exportFolder "\" newStem "." extension
            if FileExist(targetPath) {
                try FileRecycle targetPath
                catch as err {
                    return {
                        ok: false,
                        method: "target_recycle_failed",
                        detail: "Could not move the existing target file to the Recycle Bin. " err.Message,
                        note: ""
                    }
                }
            }
        }

        for sourcePath in filesToRename {
            SplitPath sourcePath, , , &extension
            targetPath := exportFolder "\" newStem "." extension
            moved := false
            lastMessage := ""
            Loop 40 {
                try {
                    FileMove sourcePath, targetPath, 0
                    moved := true
                } catch as err {
                    lastMessage := err.Message
                    Sleep 75
                }
                if moved
                    break
                if !FileExist(sourcePath) && FileExist(targetPath) {
                    moved := true
                    break
                }
            }
            if !moved {
                return {
                    ok: false,
                    method: "rename_failed",
                    detail: "Could not rename the exported file " sourcePath " to " targetPath ". " lastMessage,
                    note: ""
                }
            }
        }

        return {
            ok: true,
            method: "rename_complete",
            detail: "Renamed the exported asset files from " oldStem " to " newStem ".",
            note: "",
            finalPath: exportFolder "\" newStem "." primaryExtension
        }
    }

    FindExportButton(panelRoot) {
        button := this.FindNamedControl([panelRoot], "Export 3D object", ["Button", "MenuItem", "Text", "Custom"])
        if IsObject(button)
            return button
        return this.FindNamedControl([panelRoot], "Export", ["Button", "MenuItem", "Text", "Custom"])
    }

    CompleteExportFlow(scanResult, exportPath, initialStamp) {
        immediate := this.WaitForExportFile(exportPath, initialStamp, 1200)
        if immediate.confirmed {
            return {
                ok: true,
                method: immediate.method,
                detail: immediate.detail,
                note: "",
                effectConfirmed: true
            }
        }

        dialogHwnd := this.WaitForExportSaveDialog(scanResult, 5000)
        if !dialogHwnd {
            followUp := this.WaitForExportFile(exportPath, initialStamp, 1800)
            if followUp.confirmed {
                return {
                    ok: true,
                    method: followUp.method,
                    detail: followUp.detail,
                    note: "",
                    effectConfirmed: true
                }
            }
            return {
                ok: false,
                method: "export_ui_missing",
                detail: "The Export 3D flow did not surface a save dialog and no OBJ file appeared.",
                note: "Keep the 3D and Materials panel visible and make sure the selected d# layer contains a live 3D object."
            }
        }

        submitResult := this.SubmitExportSaveDialog(dialogHwnd, exportPath)
        if !submitResult.ok {
            return {
                ok: false,
                method: submitResult.method,
                detail: submitResult.detail,
                note: "The save dialog appeared, but the target path could not be delivered."
            }
        }

        overwriteResult := this.TryAcceptOverwriteConfirmation(scanResult, 2500)
        waitResult := this.WaitForExportFile(exportPath, initialStamp, 8000)

        if waitResult.confirmed {
            return {
                ok: true,
                method: submitResult.method "_" waitResult.method,
                detail: waitResult.detail,
                note: overwriteResult.found ? overwriteResult.detail : "",
                effectConfirmed: true
            }
        }

        return {
            ok: true,
            method: submitResult.method,
            detail: "Submitted the save dialog for " exportPath ".",
            note: overwriteResult.found ? overwriteResult.detail : "The export was submitted, but the OBJ file write could not be confirmed before timeout.",
            effectConfirmed: false
        }
    }

    WaitForExportSaveDialog(scanResult, timeoutMs := 5000) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            if hwnd := this.FindExportSaveDialogWindowHandle(scanResult)
                return hwnd
            Sleep 75
        }
        return 0
    }

    FindExportSaveDialogWindowHandle(scanResult) {
        illustratorPid := this.GetIllustratorPid(scanResult)
        for hwnd in WinGetList() {
            try {
                if !WinExist("ahk_id " hwnd)
                    continue
                if !DllCall("IsWindowVisible", "ptr", hwnd, "int")
                    continue
                if illustratorPid {
                    pid := WinGetPID("ahk_id " hwnd)
                    if pid != illustratorPid
                        continue
                }
                title := StrLower(WinGetTitle("ahk_id " hwnd))
                text := ""
                try text := StrLower(WinGetText("ahk_id " hwnd))
                className := ""
                try className := WinGetClass("ahk_id " hwnd)
                if className != "#32770"
                    continue
                if InStr(title, "save") || InStr(title, "export") || InStr(text, "file name") || InStr(text, ".obj")
                    return hwnd
            } catch {
            }
        }
        return 0
    }

    SubmitExportSaveDialog(hwnd, exportPath) {
        try {
            WinActivate "ahk_id " hwnd
            WinWaitActive "ahk_id " hwnd, , 2
        } catch as err {
            return {
                ok: false,
                method: "dialog_activate_failed",
                detail: "Could not activate the export save dialog. " err.Message
            }
        }

        for controlName in ["Edit1", "RichEdit20W1", "RichEdit50W1"] {
            try {
                ControlFocus controlName, "ahk_id " hwnd
                Sleep 80
                ControlSetText exportPath, controlName, "ahk_id " hwnd
                Sleep 120
                ControlSend "{Enter}", controlName, "ahk_id " hwnd
                return {
                    ok: true,
                    method: "control_set_text",
                    detail: "Delivered the export path through the save dialog edit control."
                }
            } catch {
            }
        }

        try {
            SendEvent "!n"
            Sleep 120
            SendEvent "^a"
            Sleep 60
            SendText exportPath
            Sleep 120
            SendEvent "{Enter}"
            return {
                ok: true,
                method: "keyboard_alt_n",
                detail: "Delivered the export path through the save dialog keyboard shortcut."
            }
        } catch as err {
            return {
                ok: false,
                method: "keyboard_submit_failed",
                detail: "Could not send the export path to the save dialog. " err.Message
            }
        }
    }

    TryAcceptOverwriteConfirmation(scanResult, timeoutMs := 2500) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            if hwnd := this.FindOverwriteConfirmationWindowHandle(scanResult) {
                try {
                    WinActivate "ahk_id " hwnd
                    WinWaitActive "ahk_id " hwnd, , 1
                    Sleep 60
                    SendEvent "!y"
                    Sleep 80
                    SendEvent "{Enter}"
                    return {
                        found: true,
                        detail: "An overwrite confirmation appeared and was accepted automatically."
                    }
                } catch {
                }
            }
            Sleep 75
        }

        return {
            found: false,
            detail: ""
        }
    }

    FindOverwriteConfirmationWindowHandle(scanResult) {
        illustratorPid := this.GetIllustratorPid(scanResult)
        for hwnd in WinGetList() {
            try {
                if !WinExist("ahk_id " hwnd)
                    continue
                if !DllCall("IsWindowVisible", "ptr", hwnd, "int")
                    continue
                if illustratorPid {
                    pid := WinGetPID("ahk_id " hwnd)
                    if pid != illustratorPid
                        continue
                }
                title := StrLower(WinGetTitle("ahk_id " hwnd))
                text := ""
                try text := StrLower(WinGetText("ahk_id " hwnd))
                className := ""
                try className := WinGetClass("ahk_id " hwnd)
                if className != "#32770"
                    continue
                if InStr(title, "confirm save as") || InStr(text, "already exists") || InStr(text, "replace it") || InStr(text, "overwrite")
                    return hwnd
            } catch {
            }
        }
        return 0
    }

    WaitForExportFile(exportPath, initialStamp, timeoutMs := 6000) {
        deadline := A_TickCount + timeoutMs
        while A_TickCount < deadline {
            if FileExist(exportPath) {
                if initialStamp = "" {
                    return {
                        confirmed: true,
                        method: "file_created",
                        detail: "The OBJ file appeared at " exportPath "."
                    }
                }

                currentStamp := ""
                try currentStamp := FileGetTime(exportPath, "M")
                catch
                    currentStamp := ""
                if currentStamp != "" && currentStamp != initialStamp {
                    return {
                        confirmed: true,
                        method: "file_updated",
                        detail: "The OBJ file timestamp updated at " exportPath "."
                    }
                }
            }
            Sleep 120
        }

        return {
            confirmed: false,
            method: "file_not_confirmed",
            detail: "The OBJ file was not confirmed on disk before timeout."
        }
    }

    GetIllustratorPid(scanResult) {
        if IsObject(scanResult) && IsObject(scanResult.activeWindow) {
            try return WinGetPID("ahk_id " scanResult.activeWindow.hwnd)
        }
        try return ProcessExist("Illustrator.exe")
        catch
            return 0
    }
}

class SaveSelectedObjToBlenderAction extends SaveSelectedObjToProject3DAction {
    __New(app) {
        this.app := app
        this.Id := "save_selected_obj_to_blender"
        this.Label := "blender obj"
        this.RequiresExactLayersScan := false
    }

    Run(scanResult) {
        exportResult := this.RunExportToProject3D(scanResult)
        if !exportResult.deliverySucceeded || !exportResult.effectConfirmed
            return exportResult

        finalPath := exportResult.HasOwnProp("finalPath") ? exportResult.finalPath : ""
        importResult := this.ImportObjIntoBlender(finalPath)
        if !importResult.succeeded {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: exportResult.method "_" importResult.method,
                detail: "Exported the OBJ to " finalPath ". Blender import failed: " importResult.detail,
                note: importResult.note
            }
        }

        detail := "Exported the current selection to " finalPath " and sent it to Blender."
        if importResult.detail != ""
            detail .= " " importResult.detail
        note := importResult.note != "" ? importResult.note : "The OBJ was exported from the resolved asset layer and sent to Blender."
        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: true,
            method: exportResult.method "_" importResult.method,
            detail: detail,
            note: note,
            finalPath: finalPath
        }
    }

    ImportObjIntoBlender(objPath) {
        result := {
            attempted: false,
            succeeded: false,
            method: "blender_import_not_started",
            detail: "",
            note: ""
        }

        if objPath = "" {
            result.detail := "The exported OBJ path was blank."
            return result
        }
        if !FileExist(objPath) {
            result.detail := "The exported OBJ file was not found."
            return result
        }

        helperPath := A_ScriptDir "\..\Blender\FlowCellButtons\Import-FlowCellObjIntoBlender.ps1"
        if !FileExist(helperPath) {
            result.detail := "The Blender import helper script was not found."
            result.note := "The helper should exist under Blender\\FlowCellButtons."
            return result
        }

        resultPath := A_Temp "\FlowCell_Blender_OBJ_Import_Result.txt"
        if FileExist(resultPath) {
            try FileDelete resultPath
            catch {
            }
        }

        result.attempted := true
        command := 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' helperPath '" -ObjPath "' objPath '" -ResultPath "' resultPath '"'
        try exitCode := RunWait(command, , "Hide")
        catch as err {
            result.detail := "Launching the Blender import helper failed. " err.Message
            result.method := "blender_import_helper_launch_failed"
            result.note := "Make sure PowerShell is available and Blender helper scripts are present."
            return result
        }

        importContext := this.ReadContextFile(resultPath)
        if exitCode = 0 {
            result.succeeded := true
            result.method := importContext.HasOwnProp("Method") && importContext.Method != ""
                ? importContext.Method
                : "blender_import_helper"
            result.detail := importContext.HasOwnProp("Message") && importContext.Message != ""
                ? importContext.Message
                : "The OBJ was sent to Blender."
            launchedBlender := importContext.HasOwnProp("LaunchedBlender") ? StrLower(Trim(importContext.LaunchedBlender)) : ""
            if launchedBlender = "yes" {
                result.note := "Blender was launched, then the OBJ was imported."
            }
            return result
        }

        result.method := importContext.HasOwnProp("Method") && importContext.Method != ""
            ? importContext.Method
            : "blender_import_helper_failed"
        result.detail := importContext.HasOwnProp("Message") && importContext.Message != ""
            ? importContext.Message
            : "The Blender import helper returned a failure exit code."
        result.note := importContext.HasOwnProp("Note") ? importContext.Note : "If Blender was already open before this update, reload the addon or restart Blender once."
        return result
    }
}

class SaveSelectedPngToBlenderLithoAction extends SaveSelectedObjToProject3DAction {
    __New(app) {
        this.app := app
        this.Id := "save_selected_png_to_blender_litho"
        this.Label := "blender litho"
        this.RequiresExactLayersScan := false
    }

    Run(scanResult) {
        exportResult := this.RunExportPngForLitho(scanResult)
        if !exportResult.deliverySucceeded || !exportResult.effectConfirmed
            return exportResult

        pngPath := exportResult.HasOwnProp("finalPath") ? exportResult.finalPath : ""
        dpi := exportResult.HasOwnProp("dpi") ? exportResult.dpi : 300
        importResult := this.ImportPngAsLithophaneIntoBlender(pngPath, dpi)
        if !importResult.succeeded {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: exportResult.method "_" importResult.method,
                detail: "Saved the PNG to " pngPath ". Blender lithophane import failed: " importResult.detail,
                note: importResult.note
            }
        }

        detail := "Saved the PNG to " pngPath " and sent it to Blender Lithophane."
        if importResult.detail != ""
            detail .= " " importResult.detail
        note := importResult.note != "" ? importResult.note : "The PNG was saved with a size suffix, and Blender used that size to build the lithophane."
        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: true,
            method: exportResult.method "_" importResult.method,
            detail: detail,
            note: note,
            finalPath: pngPath
        }
    }

    RunExportPngForLitho(scanResult) {
        helperPath := A_ScriptDir "\..\Illustrator\HelperScripts\19_Prepare_Selected_Litho_PNG.jsx"
        contextPath := A_Temp "\FlowCell_Selected_Litho_PNG_Context.txt"
        this.PrepareLithoDefaultImagesFolderFile()

        if FileExist(contextPath) {
            try FileDelete contextPath
            catch {
            }
        }

        helperResult := this.app.RunIllustratorScript(helperPath, "action " this.Id)
        if !helperResult.succeeded {
            return {
                attempted: helperResult.attempted,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: helperResult.method,
                detail: helperResult.detail != "" ? helperResult.detail : "The Illustrator PNG prep script did not run.",
                note: "The litho button needs Illustrator frontmost with a valid selection."
            }
        }

        openResult := this.OpenExportSelectionWindow(scanResult, 14000)
        if !openResult.ok {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: openResult.method,
                detail: openResult.detail,
                note: openResult.note
            }
        }

        context := this.WaitForContextFile(contextPath, 8000)
        if !context.HasOwnProp("Status") {
            this.CloseExportSelectionWindowIfPresent()
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "png_context_missing",
                detail: "The PNG prep script finished but did not write export context.",
                note: "Make sure the selection is valid and the Illustrator file is saved in the project."
            }
        }

        if context.Status != "Ready" {
            this.CloseExportSelectionWindowIfPresent()
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "png_context_error",
                detail: context.HasOwnProp("Message") ? context.Message : "The PNG prep script blocked the export.",
                note: "The litho button saves the current selection as a PNG before sending it to Blender."
            }
        }

        exportFolder := context.HasOwnProp("AssetFolder") ? context.AssetFolder : ""
        targetStem := context.HasOwnProp("AssetName") ? context.AssetName : ""
        if exportFolder = "" || targetStem = "" {
            this.CloseExportSelectionWindowIfPresent()
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: "png_export_path_missing",
                detail: "The PNG prep script did not resolve the target PNG name and folder.",
                note: "Try again with the Illustrator document saved and the selection visible."
            }
        }
        this.StoreLithoImagesFolder(exportFolder)

        flowResult := this.RunExportSelectionPngFlowFromWindow(openResult.window, openResult.method, exportFolder, targetStem)
        if !flowResult.ok {
            return {
                attempted: true,
                deliverySucceeded: false,
                effectConfirmed: false,
                method: flowResult.method,
                detail: flowResult.detail,
                note: flowResult.note
            }
        }

        pngPath := flowResult.finalPath
        dpi := 300
        if context.HasOwnProp("WidthMm") && context.HasOwnProp("HeightMm") {
            dpi := 72
        }

        return {
            attempted: true,
            deliverySucceeded: true,
            effectConfirmed: true,
            method: flowResult.method,
            detail: "Saved the current selection as a PNG.",
            note: "The PNG was exported through Illustrator's Export Selection dialog.",
            finalPath: pngPath,
            dpi: dpi
        }
    }

    PrepareLithoDefaultImagesFolderFile() {
        path := this.GetLithoDefaultImagesFolderPath()
        folder := this.ResolvePreferredLithoImagesFolder()
        if folder = "" {
            try FileDelete path
            catch {
            }
            return
        }
        try FileDelete path
        catch {
        }
        try FileAppend(folder, path, "UTF-8")
        catch {
        }
    }

    GetLithoDefaultImagesFolderPath() {
        return A_Temp "\FlowCell_Litho_Default_Images_Folder.txt"
    }

    StoreLithoImagesFolder(folder) {
        if folder = ""
            return
        path := this.GetLithoDefaultImagesFolderPath()
        try FileDelete path
        catch {
        }
        try FileAppend(folder, path, "UTF-8")
        catch {
        }
    }

    ResolvePreferredLithoImagesFolder() {
        folder := this.TryResolveImagesFolderFromVisibleBlender()
        if folder != ""
            return folder
        return this.ReadStoredLithoImagesFolder()
    }

    ReadStoredLithoImagesFolder() {
        path := this.GetLithoDefaultImagesFolderPath()
        if !FileExist(path)
            return ""
        try text := Trim(FileRead(path, "UTF-8"))
        catch
            return ""
        return text
    }

    TryResolveImagesFolderFromVisibleBlender() {
        for hwnd in WinGetList("ahk_exe blender.exe") {
            try {
                if !DllCall("IsWindowVisible", "ptr", hwnd, "int")
                    continue
            } catch {
                continue
            }
            title := ""
            try title := WinGetTitle("ahk_id " hwnd)
            catch
                title := ""
            if !RegExMatch(title, "\[([A-Za-z]:\\[^\]]+\.blend)\]", &match)
                continue
            blendPath := match[1]
            SplitPath blendPath, , &blendDir
            srcRoot := this.FindSrcRootFromFolder(blendDir)
            if srcRoot = ""
                continue
            return srcRoot "\04 assets\01 images"
        }
        return ""
    }

    FindSrcRootFromFolder(startFolder) {
        current := startFolder
        while current != "" {
            SplitPath current, &folderName
            if folderName = "01 src"
                return current
            parent := ""
            SplitPath current, , &parent
            if parent = "" || parent = current
                break
            current := parent
        }

        current := startFolder
        while current != "" {
            candidate := current "\01 src"
            if DirExist(candidate)
                return candidate
            parent := ""
            SplitPath current, , &parent
            if parent = "" || parent = current
                break
            current := parent
        }
        return ""
    }

    RunExportSelectionPngFlowFromWindow(exportWin, openMethod, exportFolder, targetStem) {
        exportStem := this.FindHighestNumberedAssetName(exportWin)
        if exportStem = "" {
            return {
                ok: false,
                method: openMethod "_asset_not_found",
                detail: "The Export Selection dialog did not expose any Asset N entries.",
                note: "The current selection needs to exist as the newest export asset in Illustrator."
            }
        }

        initialState := this.CaptureStemFileState(exportFolder, exportStem)

        folderResult := this.SetExportSelectionFolder(exportWin, exportFolder)
        if !folderResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method,
                detail: folderResult.detail,
                note: folderResult.note
            }
        }

        formatResult := this.EnsureExportSelectionPngFormat(exportWin)
        if !formatResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method,
                detail: formatResult.detail,
                note: formatResult.note
            }
        }

        exportResult := this.ClickExportAssetButton(exportWin)
        if !exportResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method,
                detail: exportResult.detail,
                note: exportResult.note
            }
        }

        writeResult := this.WaitForStemWriteByExtension(exportFolder, exportStem, "png", initialState, 15000)
        if !writeResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method "_" writeResult.method,
                detail: writeResult.detail,
                note: writeResult.note
            }
        }

        renameResult := this.RenameStemFilesWithPrimaryExtension(exportFolder, exportStem, targetStem, "png")
        if !renameResult.ok {
            return {
                ok: false,
                method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method "_" writeResult.method "_" renameResult.method,
                detail: renameResult.detail,
                note: renameResult.note
            }
        }

        this.CloseExportSelectionWindowIfPresent()
        return {
            ok: true,
            method: openMethod "_" folderResult.method "_" formatResult.method "_" exportResult.method "_" writeResult.method "_" renameResult.method,
            detail: renameResult.detail,
            note: "",
            finalPath: renameResult.finalPath
        }
    }

    ImportPngAsLithophaneIntoBlender(pngPath, dpi := 300) {
        result := {
            attempted: false,
            succeeded: false,
            method: "blender_litho_not_started",
            detail: "",
            note: ""
        }

        if pngPath = "" {
            result.detail := "The exported PNG path was blank."
            return result
        }
        if !FileExist(pngPath) {
            result.detail := "The exported PNG file was not found."
            return result
        }

        helperPath := A_ScriptDir "\..\Blender\FlowCellButtons\Import-FlowCellPngAsLithophane.ps1"
        if !FileExist(helperPath) {
            result.detail := "The Blender lithophane import helper script was not found."
            result.note := "The helper should exist under Blender\\FlowCellButtons."
            return result
        }

        resultPath := A_Temp "\FlowCell_Blender_Litho_Import_Result.txt"
        if FileExist(resultPath) {
            try FileDelete resultPath
            catch {
            }
        }

        result.attempted := true
        command := 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' helperPath '" -PngPath "' pngPath '" -Dpi "' dpi '" -ResultPath "' resultPath '"'
        try exitCode := RunWait(command, , "Hide")
        catch as err {
            result.detail := "Launching the Blender lithophane helper failed. " err.Message
            result.method := "blender_litho_helper_launch_failed"
            result.note := "Make sure PowerShell is available and Blender helper scripts are present."
            return result
        }

        importContext := this.ReadContextFile(resultPath)
        if exitCode = 0 {
            result.succeeded := true
            result.method := importContext.HasOwnProp("Method") && importContext.Method != ""
                ? importContext.Method
                : "blender_litho_helper"
            result.detail := importContext.HasOwnProp("Message") && importContext.Message != ""
                ? importContext.Message
                : "The PNG was sent to Blender and turned into a lithophane."
            launchedBlender := importContext.HasOwnProp("LaunchedBlender") ? StrLower(Trim(importContext.LaunchedBlender)) : ""
            if launchedBlender = "yes" {
                result.note := "Blender was launched, then the lithophane was created."
            }
            return result
        }

        result.method := importContext.HasOwnProp("Method") && importContext.Method != ""
            ? importContext.Method
            : "blender_litho_helper_failed"
        result.detail := importContext.HasOwnProp("Message") && importContext.Message != ""
            ? importContext.Message
            : "The Blender lithophane helper returned a failure exit code."
        result.note := importContext.HasOwnProp("Note") ? importContext.Note : "If Blender was already open before this update, reload the addon or restart Blender once."
        return result
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
        this.nextId := 1

        if !FileExist(this.bindingFilePath)
            return

        try {
            idText := IniRead(this.bindingFilePath, "Meta", "Ids", "")
            nextIdText := IniRead(this.bindingFilePath, "Meta", "NextId", "1")
            this.nextId := Max(Integer(nextIdText), 1)
        } catch as err {
            this.logger.Error("Failed to read the FlowCell bindings file.", err)
            this.bindings := []
            this.nextId := 1
            return
        }

        if idText = ""
            return

        for idToken in StrSplit(idText, "|") {
            idToken := Trim(idToken)
            if idToken = ""
                continue

            section := "Binding_" idToken
            try {
                shortcut := CanonicalizeShortcut(IniRead(this.bindingFilePath, section, "Shortcut"))
                scriptPath := IniRead(this.bindingFilePath, section, "ScriptPath")
                programTabId := IniRead(this.bindingFilePath, section, "ProgramTabId", "0")
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
        if FileExist(this.bindingFilePath)
            FileDelete this.bindingFilePath

        IniWrite this.nextId, this.bindingFilePath, "Meta", "NextId"
        IniWrite this.BuildIdList(), this.bindingFilePath, "Meta", "Ids"

        for binding in this.bindings {
            section := "Binding_" binding.id
            IniWrite binding.shortcut, this.bindingFilePath, section, "Shortcut"
            IniWrite binding.scriptPath, this.bindingFilePath, section, "ScriptPath"
            if binding.HasOwnProp("programTabId") && binding.programTabId
                IniWrite binding.programTabId, this.bindingFilePath, section, "ProgramTabId"
        }
    }

    BuildIdList() {
        ids := []
        for binding in this.bindings
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
        scriptPath := Trim(scriptPath)
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
        scriptPath := Trim(scriptPath)
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
        try {
            Hotkey shortcut, callback, "On"
            this.registered[actionId] := {
                shortcut: shortcut,
                callback: callback
            }
            this.logger.Info("Registered action hotkey. Action=" actionId " | Shortcut=" shortcut)
            return "Active"
        } catch as err {
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
            try Hotkey entry.shortcut, entry.callback, "Off"
            catch {
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
        type := macroPath != "" ? "Macro" : (scriptPath != "" ? "Script" : stepSection["Type"])
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
                return this.RunMacroStep(step.macroPath, hwnd)
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

    RunMacroStep(macroPath, hwnd) {
        if macroPath = "" {
            return {
                ok: false,
                method: "recorded_macro_nested_missing",
                detail: "The nested macro step did not specify a macro file."
            }
        }

        definition := this.store.ReadMacroDefinition(macroPath, false)
        if !IsObject(definition) {
            return {
                ok: false,
                method: "recorded_macro_nested_missing",
                detail: "The nested macro file was not found or could not be parsed."
            }
        }

        nestedAction := RecordedMacroAction(this.app, this.store, definition.id, definition.label, macroPath)
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

app := FlowCellApp(logger)

if runActionId != "" {
    try {
        action := app.GetActionById(runActionId)
        if !IsObject(action)
            throw Error("Action not found: " runActionId)

        if !app.EnsureActionReady(action, "cli " runActionId) {
            text := app.actionStatusEdit.Value
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

if HasCliFlag("--headless") {
    logger.Info("Macro backend started in headless mode.")
    app.ApplyStartupFlags()
    return
}

app.Show()
app.ApplyStartupFlags()
return
