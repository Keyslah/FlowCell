# Description: Open the saved Chrome workspace.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne [System.Threading.ApartmentState]::STA) {
    & 'powershell.exe' @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Sta',
        '-File', $PSCommandPath
    )
    exit $LASTEXITCODE
}

. (Join-Path $PSScriptRoot 'ChromeWorkspaceHelpers.ps1')

Invoke-OpenChromeWorkspace
