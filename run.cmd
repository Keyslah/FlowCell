@echo off
setlocal

set "APP_ROOT=%~dp0flowcellbackend"
set "RUN_CMD=%APP_ROOT%\run.cmd"
if not exist "%RUN_CMD%" (
    echo FlowCell launcher was not found:
    echo   %RUN_CMD%
    exit /b 1
)

call "%RUN_CMD%" %*
exit /b %ERRORLEVEL%
