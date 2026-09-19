; Purpose: Stop this installation's backend before upgrade/uninstall replaces its runtime.
; Context: Tauri NSIS hooks, $INSTDIR is the selected application directory.
; Inputs: Existing bundled helper. Changes: Only that installation's backend processes.
; No data deletion, migration, registration, or writes to user Programs/Local Scripts.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" 0 +3
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" -ResourceRoot "$INSTDIR"'
    Pop $0
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" 0 +3
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" -ResourceRoot "$INSTDIR"'
    Pop $0
!macroend
