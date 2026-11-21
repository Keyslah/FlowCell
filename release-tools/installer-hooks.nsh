; Purpose: Maintain the installed background backend, sign-in entry and optional desktop toggle.
; Context: Tauri NSIS hooks, $INSTDIR is the selected application directory.
; Inputs: Current bundled stop helper. Changes: Only that installation's backend processes.
; Startup shortcut removal uses the Recycle Bin; user Programs/Local Scripts are preserved.
; These callbacks attach to the first (Welcome) page in Tauri's standard template.
; Keeping the option here avoids copying and maintaining Tauri's entire NSIS template.
Var FlowCellToggleCheckbox
Var FlowCellToggleSelection
Var FlowCellStartupCheckbox
Var FlowCellFilesCheckbox
Var FlowCellFilesSelection
Var FlowCellUtilityCheckbox
Var FlowCellUtilitySelection
!define FLOWCELL_STOP_HELPER_SOURCE "${__FILEDIR__}\..\flowcellbackend\helpers\Stop-InstalledBackend.ps1"
!ifndef FLOWCELL_VERIFY_HELPER_SOURCE
  !define FLOWCELL_VERIFY_HELPER_SOURCE "${__FILEDIR__}\Verify-InstallerPayload.ps1"
!endif
!ifndef FLOWCELL_RUNTIME_SOURCE
  !define FLOWCELL_RUNTIME_SOURCE "${__FILEDIR__}\..\dist\installer-resources\flowcellbackend\runtime\AutoHotkey64.exe"
!endif
!define MUI_WELCOMEPAGE_TEXT "Setup includes the required Windows Startup panel and background service.$\r$\n$\r$\nChoose the optional Windows panels and desktop shortcut below."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FlowCellWelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE FlowCellWelcomeLeave
Function FlowCellWelcomeShow
  ${NSD_CreateCheckbox} 120u 101u 195u 18u "Windows Startup panel (required)"
  Pop $FlowCellStartupCheckbox
  ${NSD_Check} $FlowCellStartupCheckbox
  EnableWindow $FlowCellStartupCheckbox 0
  SetCtlColors $FlowCellStartupCheckbox "000000" "FFFFFF"
  System::Call 'user32::SetWindowPos(p $FlowCellStartupCheckbox, p 0, i 0, i 0, i 0, i 0, i 0x0053)'
  ${NSD_CreateCheckbox} 120u 121u 195u 18u "Windows Files panel"
  Pop $FlowCellFilesCheckbox
  SetCtlColors $FlowCellFilesCheckbox "000000" "FFFFFF"
  System::Call 'user32::SetWindowPos(p $FlowCellFilesCheckbox, p 0, i 0, i 0, i 0, i 0, i 0x0053)'
  ${If} $FlowCellFilesSelection != "0"
    ${NSD_Check} $FlowCellFilesCheckbox
  ${EndIf}
  ${NSD_CreateCheckbox} 120u 141u 195u 18u "Windows Utility panel"
  Pop $FlowCellUtilityCheckbox
  SetCtlColors $FlowCellUtilityCheckbox "000000" "FFFFFF"
  System::Call 'user32::SetWindowPos(p $FlowCellUtilityCheckbox, p 0, i 0, i 0, i 0, i 0, i 0x0053)'
  ${If} $FlowCellUtilitySelection != "0"
    ${NSD_Check} $FlowCellUtilityCheckbox
  ${EndIf}
  ${NSD_CreateCheckbox} 120u 161u 195u 24u "Toggle AutoHotkey desktop shortcut"
  Pop $FlowCellToggleCheckbox
  SetCtlColors $FlowCellToggleCheckbox "000000" "FFFFFF"
  ; MUI's Welcome text label spans y=45..175u, including its blank lower area.
  ; nsDialogs gives siblings WS_CLIPSIBLINGS; the earlier label otherwise clips
  ; these checkboxes. Raise them above that label without moving it.
  System::Call 'user32::SetWindowPos(p $FlowCellToggleCheckbox, p 0, i 0, i 0, i 0, i 0, i 0x0053)'
  ${If} $FlowCellToggleSelection != "0"
    ${NSD_Check} $FlowCellToggleCheckbox
  ${EndIf}
FunctionEnd
Function FlowCellWelcomeLeave
  ${NSD_GetState} $FlowCellToggleCheckbox $FlowCellToggleSelection
  ${NSD_GetState} $FlowCellFilesCheckbox $FlowCellFilesSelection
  ${NSD_GetState} $FlowCellUtilityCheckbox $FlowCellUtilitySelection
FunctionEnd

!macro FlowCellCheckExistingInstall RESOURCE_ROOT
  ${If} ${FileExists} "${RESOURCE_ROOT}\flowcell-installed.json"
  ${OrIf} ${FileExists} "${RESOURCE_ROOT}\flowcellbackend\runtime\AutoHotkey64.exe"
  ${OrIf} ${FileExists} "${RESOURCE_ROOT}\flowcell_frontend.exe"
    ; Check both critical executables before copying files or changing metadata.
    ; An unmarked existing installation must fail closed rather than be replaced.
    InitPluginsDir
    File "/oname=$PLUGINSDIR\FlowCell-Stop-InstalledBackend.ps1" "${FLOWCELL_STOP_HELPER_SOURCE}"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\FlowCell-Stop-InstalledBackend.ps1" -ResourceRoot "${RESOURCE_ROOT}"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "FlowCell could not release an application file. No application files were replaced. Close FlowCell in all Windows sessions and run Setup again. Review the installation details for the reason." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREINSTALL
  !insertmacro FlowCellCheckExistingInstall "$INSTDIR"
!macroend
!macro FlowCellAbortOnCopyFailure
  ${If} ${Errors}
    DetailPrint "FlowCell could not copy an installation file. Version information and shortcuts were not updated."
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend
; Called by the pinned Tauri template after copying payload and before any
; version registry entries or shortcuts. The expected bytes are embedded at
; build time, so this also detects a copy that silently left an older binary.
!macro NSIS_HOOK_VERIFY_PAYLOAD
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\FlowCell-Verify-InstallerPayload.ps1" "${FLOWCELL_VERIFY_HELPER_SOURCE}"
  !insertmacro FlowCellAbortOnCopyFailure
  ClearErrors
  File "/oname=$PLUGINSDIR\FlowCell-Expected-Frontend.exe" "${MAINBINARYSRCPATH}"
  !insertmacro FlowCellAbortOnCopyFailure
  ClearErrors
  File "/oname=$PLUGINSDIR\FlowCell-Expected-AutoHotkey.exe" "${FLOWCELL_RUNTIME_SOURCE}"
  !insertmacro FlowCellAbortOnCopyFailure
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\FlowCell-Verify-InstallerPayload.ps1" -ResourceRoot "$INSTDIR" -ExpectedFrontend "$PLUGINSDIR\FlowCell-Expected-Frontend.exe" -ExpectedRuntime "$PLUGINSDIR\FlowCell-Expected-AutoHotkey.exe"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "FlowCell could not verify its installed application files. Setup did not update version information or shortcuts. Run Setup again after resolving the installation error." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend
!macro NSIS_HOOK_POSTINSTALL
  ; Silent/passive installs use the same checked default. /NS still suppresses shortcuts.
  StrCpy $1 "Install"
  ${If} $FlowCellToggleSelection == "0"
  ${OrIf} $NoShortcutMode == 1
    StrCpy $1 "Skip"
  ${EndIf}
  StrCpy $2 "Install"
  ${If} $FlowCellFilesSelection == "0"
    StrCpy $2 "Skip"
  ${EndIf}
  StrCpy $3 "Install"
  ${If} $FlowCellUtilitySelection == "0"
    StrCpy $3 "Skip"
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" -ResourceRoot "$INSTDIR" -Action Register -DesktopToggle $1 -WindowsFiles $2 -WindowsUtility $3 -Start'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "FlowCell was copied, but its background startup or AutoHotkey shortcut setup failed. Review the installation details and run Setup again to repair it." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" -ResourceRoot "$INSTDIR"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "FlowCell could not release its background runtime. Uninstall was stopped before removing application files. Close the process using this FlowCell installation and run Uninstall again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  IfFileExists "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" 0 +3
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" -ResourceRoot "$INSTDIR" -Action Remove'
    Pop $0
!macroend
