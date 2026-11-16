# Edit the owned monitor groups without changing displays or startup registration.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Toggle Monitors.vbs'
& (Join-Path $env:SystemRoot 'System32/cscript.exe') //nologo $launcher --configure-only
exit $LASTEXITCODE
