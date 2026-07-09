@echo off
setlocal

set "ROOT=%~dp0"
set "APP_EXE=%ROOT%FlowCell.exe"
set "AHK_EXE=%ROOT%flowcellbackend\runtime\AutoHotkey64.exe"
set "AHK_SCRIPT=%ROOT%flowcellbackend\FlowCellBackend.ahk"
set "PREFLIGHT=%ROOT%flowcellbackend\helpers\Start-FlowCellPreflight.ps1"

if not exist "%APP_EXE%" (
  echo [FlowCell] Missing FlowCell.exe next to Start FlowCell.cmd.
  echo [FlowCell] Re-extract the portable ZIP or rebuild the portable package.
  pause
  exit /b 1
)

if not exist "%AHK_EXE%" (
  echo [FlowCell] Missing bundled AutoHotkey runtime:
  echo "%AHK_EXE%"
  echo [FlowCell] Rebuild the portable package with release-tools\package-portable.ps1.
  pause
  exit /b 1
)

if not exist "%AHK_SCRIPT%" (
  echo [FlowCell] Missing backend script:
  echo "%AHK_SCRIPT%"
  echo [FlowCell] Re-extract the portable ZIP or rebuild the portable package.
  pause
  exit /b 1
)

if not exist "%PREFLIGHT%" (
  echo [FlowCell] Missing startup preflight script:
  echo "%PREFLIGHT%"
  echo [FlowCell] Re-extract the portable ZIP or rebuild the portable package.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PREFLIGHT%"
if errorlevel 1 (
  echo [FlowCell] Startup preflight failed. FlowCell was not started.
  pause
  exit /b 1
)

start "FlowCell Backend" "%AHK_EXE%" "%AHK_SCRIPT%"
start "FlowCell" "%APP_EXE%"
exit /b 0
