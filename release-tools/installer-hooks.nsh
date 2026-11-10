; Purpose: Maintain the installed background backend, sign-in entry and optional desktop toggle.
; Context: Tauri NSIS hooks, $INSTDIR is the selected application directory.
; Inputs: Current bundled stop helper. Changes: Only that installation's backend processes.
; Startup shortcut removal uses the Recycle Bin; user Programs/Local Scripts are preserved.
; These callbacks attach to the first (Welcome) page in Tauri's standard template.
; Keeping the option here avoids copying and maintaining Tauri's entire NSIS template.
Var FlowCellToggleCheckbox
Var FlowCellToggleSelection
!define FLOWCELL_STOP_HELPER_SOURCE "${__FILEDIR__}\..\flowcellbackend\helpers\Stop-InstalledBackend.ps1"
!define MUI_WELCOMEPAGE_TEXT "Setup installs FlowCell and its background shortcut service for your Windows account.$\r$\n$\r$\nYour Startup shortcuts become available when you sign in, even while FlowCell is closed.$\r$\n$\r$\nClick Next to continue."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FlowCellWelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE FlowCellWelcomeLeave
Function FlowCellWelcomeShow
  ${NSD_CreateCheckbox} 120u 150u 195u 24u "Create a Toggle AutoHotkey desktop shortcut"
  Pop $FlowCellToggleCheckbox
  SetCtlColors $FlowCellToggleCheckbox "000000" "FFFFFF"
  ; MUI's Welcome text label spans y=45..175u, including its blank lower area.
  ; nsDialogs gives siblings WS_CLIPSIBLINGS; the earlier label otherwise clips
  ; this checkbox at y=150..174u. Raise it above that label without moving it.
  System::Call 'user32::SetWindowPos(p $FlowCellToggleCheckbox, p 0, i 0, i 0, i 0, i 0, i 0x0053)'
  ${If} $FlowCellToggleSelection != "0"
    ${NSD_Check} $FlowCellToggleCheckbox
  ${EndIf}
FunctionEnd
Function FlowCellWelcomeLeave
  ${NSD_GetState} $FlowCellToggleCheckbox $FlowCellToggleSelection
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\flowcell-installed.json"
  ${OrIf} ${FileExists} "$INSTDIR\flowcellbackend\runtime\AutoHotkey64.exe"
    ; Older releases do not wait for their runtime to unlock. Run this installer's
    ; current helper before replacing any application files, even on old upgrades.
    InitPluginsDir
    File "/oname=$PLUGINSDIR\FlowCell-Stop-InstalledBackend.ps1" "${FLOWCELL_STOP_HELPER_SOURCE}"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\FlowCell-Stop-InstalledBackend.ps1" -ResourceRoot "$INSTDIR"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "FlowCell could not release its background runtime. No application files were replaced. Close the process using this FlowCell installation and run Setup again. Review the installation details for the reason." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
!macroend
!macro NSIS_HOOK_POSTINSTALL
  ; Silent/passive installs use the same checked default. /NS still suppresses shortcuts.
  StrCpy $1 "Install"
  ${If} $FlowCellToggleSelection == "0"
  ${OrIf} $NoShortcutMode == 1
    StrCpy $1 "Skip"
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" -ResourceRoot "$INSTDIR" -Action Register -DesktopToggle $1 -Start'
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
