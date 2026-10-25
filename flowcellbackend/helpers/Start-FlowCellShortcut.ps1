<#
Purpose: Preserve normal Windows shortcut launching while gating AutoHotkey targets.
Context: FlowCell Button execution; installed paths resolve from adjacent resources.
Changes: Starts the shortcut target only; never changes the shortcut or preference.
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ShortcutPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'FlowCellPaths.ps1')
. (Join-Path $PSScriptRoot 'AutoHotkeyState.ps1')

function Invoke-FlowCellShortcut {
    param([Parameter(Mandatory=$true)][string]$Path)
    $Path = [IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetExtension($Path) -ine '.lnk' -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Windows shortcut was not found: $Path"
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $target = [string]$shortcut.TargetPath
    $isAhkScript = [IO.Path]::GetExtension($target) -ieq '.ahk'
    $isAhkRuntime = [IO.Path]::GetFileName($target) -like 'AutoHotkey*.exe'
    if (-not $isAhkScript -and -not $isAhkRuntime) {
        # Let Windows retain this shortcut's target, arguments and presentation.
        Start-Process -FilePath $Path | Out-Null
        return
    }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "AutoHotkey shortcut target was not found: $target" }
    $arguments = [string]$shortcut.Arguments
    $workingDirectory = [string]$shortcut.WorkingDirectory
    if ([string]::IsNullOrWhiteSpace($workingDirectory)) { $workingDirectory = Split-Path -Parent $Path }
    $executable = $target
    if ($isAhkScript) {
        $candidates = @(
            (Join-Path $FlowCellResourceRoot 'flowcellbackend/runtime/AutoHotkey64.exe'),
            (Join-Path $FlowCellResourceRoot 'flowcellbackend/runtime/AutoHotkey.exe')
        )
        if ($env:FLOWCELL_BACKEND_ROLE -ne 'installed') {
            $candidates += @(
                (Join-Path $FlowCellResourceRoot 'flowcellbackend/local/bin/AutoHotkey64.exe'),
                (Join-Path $env:ProgramFiles 'AutoHotkey/v2/AutoHotkey64.exe')
            )
        }
        $executable = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if (-not $executable) { throw 'The bundled AutoHotkey runtime was not found for this shortcut.' }
        $arguments = '"' + $target + '"' + $(if ($arguments) { ' ' + $arguments } else { '' })
    }
    $mutex = Enter-FlowCellAutoHotkeyLock
    try {
        if (-not (Get-FlowCellAutoHotkeyState).Enabled) {
            throw 'AutoHotkey is OFF for this Windows sign-in session. Turn Toggle AutoHotkey ON to run this shortcut.'
        }
        $launch = @{ FilePath = $executable; WorkingDirectory = $workingDirectory; WindowStyle = 'Hidden' }
        if ($arguments) { $launch.ArgumentList = $arguments }
        Start-Process @launch | Out-Null
    } finally { Exit-FlowCellAutoHotkeyLock -Mutex $mutex }
}

try { Invoke-FlowCellShortcut -Path $ShortcutPath }
catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
