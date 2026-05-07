@echo off
setlocal

set "APP_ROOT=%~dp0FlowCell"
set "RUN_CMD=%APP_ROOT%\run.cmd"
set "HIDDEN_RUN=%APP_ROOT%\run_hidden.vbs"

if not exist "%RUN_CMD%" (
    echo FlowCell launcher was not found:
    echo   %RUN_CMD%
    exit /b 1
)

if "%~1"=="" (
    if exist "%HIDDEN_RUN%" (
        wscript //nologo "%HIDDEN_RUN%"
        exit /b 0
    )
)

call "%RUN_CMD%" %*
exit /b %ERRORLEVEL%
