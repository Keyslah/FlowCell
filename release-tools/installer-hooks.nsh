; Purpose: Maintain this installation's background backend and per-user sign-in shortcut.
; Context: Tauri NSIS hooks, $INSTDIR is the selected application directory.
; Inputs: Existing bundled helper. Changes: Only that installation's backend processes.
; Startup shortcut removal uses the Recycle Bin; user Programs/Local Scripts are preserved.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" 0 +3
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" -ResourceRoot "$INSTDIR"'
    Pop $0
!macroend
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" -ResourceRoot "$INSTDIR" -Action Register -Start'
  Pop $0
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" 0 +3
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Stop-InstalledBackend.ps1" -ResourceRoot "$INSTDIR"'
    Pop $0
  IfFileExists "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" 0 +3
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\flowcellbackend\helpers\Configure-InstalledBackendStartup.ps1" -ResourceRoot "$INSTDIR" -Action Remove'
    Pop $0
!macroend
