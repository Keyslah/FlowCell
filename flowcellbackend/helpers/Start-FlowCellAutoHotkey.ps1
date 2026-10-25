<#
Purpose: Serialize an AutoHotkey child launch with the per-user manual OFF choice.
The lock covers only process creation; OFF can still stop a long-running child.
Arguments are UTF-8 JSON encoded as hex so PowerShell/native quoting cannot change them.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ExecutablePath,
    [Parameter(Mandatory=$true)][string]$ArgumentsHex,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [switch]$Detach
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AutoHotkeyState.ps1')
try {
    if ($ArgumentsHex -notmatch '^(?:[0-9a-fA-F]{2})+$') { throw 'Invalid AutoHotkey argument encoding.' }
    $bytes = New-Object byte[] ($ArgumentsHex.Length / 2)
    for ($index = 0; $index -lt $bytes.Length; $index++) {
        $bytes[$index] = [Convert]::ToByte($ArgumentsHex.Substring($index * 2, 2), 16)
    }
    $arguments = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($bytes))
    $quotedArguments = @($arguments | ForEach-Object {
        $value = [string]$_
        '"' + (($value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
    }) -join ' '
    $lock = Enter-FlowCellAutoHotkeyLock
    try {
        if (-not (Get-FlowCellAutoHotkeyState).Enabled) {
            throw 'AutoHotkey is OFF for this Windows sign-in session. Turn Toggle AutoHotkey ON to run this action.'
        }
        $child = New-Object Diagnostics.Process
        $child.StartInfo.FileName = $ExecutablePath
        $child.StartInfo.Arguments = $quotedArguments
        $child.StartInfo.WorkingDirectory = $WorkingDirectory
        $child.StartInfo.UseShellExecute = $false
        $child.StartInfo.CreateNoWindow = $true
        $child.StartInfo.RedirectStandardOutput = -not $Detach
        $child.StartInfo.RedirectStandardError = -not $Detach
        if (-not $child.Start()) { throw 'AutoHotkey process creation failed.' }
    } finally { Exit-FlowCellAutoHotkeyLock -Mutex $lock }
    if ($Detach) { $child.Dispose(); exit 0 }
    $stdoutCopy = $child.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $stderrCopy = $child.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    $child.WaitForExit()
    $null = $stdoutCopy.GetAwaiter().GetResult()
    $null = $stderrCopy.GetAwaiter().GetResult()
    $result = $child.ExitCode
    $child.Dispose()
    exit $result
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
