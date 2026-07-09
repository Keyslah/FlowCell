# Toggle AutoHotkey for anti-cheat games

Use this when a game blocks or warns about running AutoHotkey. The toggle turns off every running `AutoHotkey*.exe` process, saves enough information to restore those scripts later, and creates a desktop shortcut named `Toggle AutoHotkey.lnk`. The shortcut uses a green icon when AutoHotkey is active and an off/red icon only after AutoHotkey processes are verified stopped.

Run the hidden launcher from any FlowCell checkout:

```text
C:\Windows\System32\wscript.exe "<repo>\tools\autohotkey v2 on off\Toggle-AutoHotkey.vbs"
```

The launcher resolves `Toggle-AutoHotkey.ps1` from its own folder, so it works from any GitHub clone path instead of an Aaron-specific shared-script path. The toggle source lives in `tools\autohotkey v2 on off`, not the Windows Utility script folder.

## How it works

1. If any AutoHotkey process is running, the script snapshots its executable path and command-line arguments, stops all `AutoHotkey*.exe` processes, waits for the process count to reach zero, then marks the state as `off` and shows a short popup. If any AutoHotkey process is still running, the shortcut stays green/on and the popup says AutoHotkey is still running.
2. If AutoHotkey is already off, the script restores the saved snapshot. If no snapshot exists, it falls back to the managed launcher list.
3. State files live in `flowcellbackend\local\autohotkey-toggle\`, which is ignored by Git. `AutoHotkeyToggleState.txt` stores `on` or `off`, and `AutoHotkeyToggleStatus.json` stores the process count, message, timestamp, and active/off colors.
4. `Toggle-AutoHotkey-On.ico` is the green active icon. `Toggle-AutoHotkey-Off.ico` is the verified-off icon.
5. AutoHotkey v2 is resolved from `flowcellbackend\runtime`, `flowcellbackend\local\bin`, or the default AutoHotkey v2 install folder under `C:\Program Files\AutoHotkey\v2`.

## Managed launchers

The first off-toggle usually captures everything needed to turn AutoHotkey back on. For a first-time on-toggle, or for scripts that should always restart from known launchers, create this ignored local file:

```text
<repo>\flowcellbackend\local\autohotkey-toggle\Managed-AutoHotkeyLaunchers.txt
```

Put one launcher per line. Quote paths that contain spaces. Optional arguments can follow the path. Blank lines and lines starting with `#` are ignored.

```text
# Examples:
"C:\Users\you\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\FlowCell Hotkeys Startup.vbs"
"C:\Users\you\Documents\Hotkeys\MyHotkeys.ahk"
"<repo>\flowcellbackend\FlowCellBackend.ahk" --headless
```

If no managed list exists inside a FlowCell checkout, the script starts `flowcellbackend\FlowCellBackend.ahk --headless` through its own portable AutoHotkey resolver.

## Full VBS launcher

Tracked source: [tools/autohotkey v2 on off/Toggle-AutoHotkey.vbs](../tools/autohotkey%20v2%20on%20off/Toggle-AutoHotkey.vbs)

```vbscript
Set fso = CreateObject("Scripting.FileSystemObject")
scriptFolder = fso.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = fso.BuildPath(scriptFolder, "Toggle-AutoHotkey.ps1")

Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & powerShellScript & """"
shell.Run command, 0, False
```

## Full PowerShell script

Tracked source: [tools/autohotkey v2 on off/Toggle-AutoHotkey.ps1](../tools/autohotkey%20v2%20on%20off/Toggle-AutoHotkey.ps1)

```powershell
# Description: Toggle all AutoHotkey processes off or back on for anti-cheat game sessions.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-FlowCellRoot {
    param(
        [string]$StartPath
    )

    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }

        $currentPath = $parentPath
    }

    throw 'Could not locate the FlowCell repository root.'
}

function Ensure-Directory {
    param(
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

$script:FlowCellRoot = try { Find-FlowCellRoot -StartPath $PSScriptRoot } catch { $null }
$script:ToggleRoot = if ($null -ne $script:FlowCellRoot) {
    Join-Path $script:FlowCellRoot 'flowcellbackend\local\autohotkey-toggle'
}
else {
    $PSScriptRoot
}

Ensure-Directory -Path $script:ToggleRoot

$script:ToggleStatePath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleState.txt'
$script:ToggleStatusPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleStatus.json'
$script:ToggleSnapshotPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleSnapshot.json'
$script:DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Toggle AutoHotkey.lnk'
$script:BackendVbsPath = Join-Path $PSScriptRoot 'Toggle-AutoHotkey.vbs'
$script:OnIconPath = Join-Path $PSScriptRoot 'Toggle-AutoHotkey-On.ico'
$script:OffIconPath = Join-Path $PSScriptRoot 'Toggle-AutoHotkey-Off.ico'
$script:ManagedHotkeyLauncherListPaths = @(
    (Join-Path $script:ToggleRoot 'Managed-AutoHotkeyLaunchers.txt'),
    (Join-Path $PSScriptRoot 'Managed-AutoHotkeyLaunchers.txt')
)

function Get-AutoHotkeyExePath {
    $paths = @()
    if ($null -ne $script:FlowCellRoot) {
        $paths += @(
            (Join-Path $script:FlowCellRoot 'flowcellbackend\runtime\AutoHotkey64.exe'),
            (Join-Path $script:FlowCellRoot 'flowcellbackend\runtime\AutoHotkey.exe'),
            (Join-Path $script:FlowCellRoot 'flowcellbackend\local\bin\AutoHotkey64.exe'),
            (Join-Path $script:FlowCellRoot 'flowcellbackend\local\bin\AutoHotkey.exe')
        )
    }

    $paths += @(
        'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe',
        'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe'
    )

    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            return $path
        }
    }

    throw 'AutoHotkey v2 was not found. Install AutoHotkey v2 or place AutoHotkey64.exe in flowcellbackend\runtime or flowcellbackend\local\bin.'
}

function Get-ManagedHotkeyLauncherListPath {
    foreach ($path in $script:ManagedHotkeyLauncherListPaths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            return $path
        }
    }

    return $script:ManagedHotkeyLauncherListPaths[0]
}

function ConvertTo-ManagedLauncherEntry {
    param(
        [string]$Text
    )

    $trimmedText = $Text.Trim()
    $match = [regex]::Match($trimmedText, '^\s*(?:"([^"]+)"|(\S+))(?:\s+(.*))?$')
    if (-not $match.Success) {
        return [pscustomobject]@{
            LauncherPath = $trimmedText
            ArgumentString = ''
        }
    }

    $launcherPath = if (-not [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
        $match.Groups[1].Value
    }
    else {
        $match.Groups[2].Value
    }

    return [pscustomobject]@{
        LauncherPath = $launcherPath
        ArgumentString = $match.Groups[3].Value.Trim()
    }
}

function Get-ManagedHotkeyLauncherPaths {
    $listPath = Get-ManagedHotkeyLauncherListPath
    if (Test-Path -LiteralPath $listPath -PathType Leaf) {
        return @(
            Get-Content -LiteralPath $listPath |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ -and (-not $_.StartsWith('#')) } |
                ForEach-Object { ConvertTo-ManagedLauncherEntry -Text $_ }
        )
    }

    if ($null -ne $script:FlowCellRoot) {
        $flowCellBackendScript = Join-Path $script:FlowCellRoot 'flowcellbackend\FlowCellBackend.ahk'
        if (Test-Path -LiteralPath $flowCellBackendScript -PathType Leaf) {
            return @(
                [pscustomobject]@{
                    LauncherPath = $flowCellBackendScript
                    ArgumentString = '--headless'
                }
            )
        }
    }

    return @()
}

function Get-AllAutoHotkeyProcesses {
    @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'AutoHotkey*.exe' })
}

function Wait-ForAutoHotkeyProcessCount {
    param(
        [int]$ExpectedCount = -1,
        [int]$MinimumCount = -1,
        [int]$TimeoutMilliseconds = 3000
    )

    $deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
    do {
        $processes = @(Get-AllAutoHotkeyProcesses)
        if ($ExpectedCount -ge 0 -and $processes.Count -eq $ExpectedCount) {
            return $processes
        }

        if ($MinimumCount -ge 0 -and $processes.Count -ge $MinimumCount) {
            return $processes
        }

        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)

    return @(Get-AllAutoHotkeyProcesses)
}

function Get-ProcessArgumentString {
    param(
        [string]$CommandLine
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return ''
    }

    $match = [regex]::Match($CommandLine, '^\s*(?:"[^"]+"|\S+)\s*(.*)$')
    if ($match.Success) {
        return $match.Groups[1].Value.Trim()
    }

    return ''
}

function Get-RunningHotkeySnapshot {
    $defaultExePath = $null

    return @(
        foreach ($process in Get-AllAutoHotkeyProcesses) {
            $exePath = [string]$process.ExecutablePath
            if ([string]::IsNullOrWhiteSpace($exePath)) {
                if ($null -eq $defaultExePath) {
                    $defaultExePath = try { Get-AutoHotkeyExePath } catch { '' }
                }

                $exePath = $defaultExePath
            }

            if ([string]::IsNullOrWhiteSpace($exePath)) {
                Write-Warning "Skipping AutoHotkey process $($process.ProcessId) because its executable path could not be read."
                continue
            }

            [pscustomobject]@{
                ExecutablePath = $exePath
                ArgumentString = Get-ProcessArgumentString -CommandLine $process.CommandLine
            }
        }
    )
}

function Save-HotkeySnapshot {
    param(
        [object[]]$Entries
    )

    Ensure-Directory -Path $script:ToggleRoot
    $json = @($Entries) | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath $script:ToggleSnapshotPath -Value $json -Encoding UTF8
}

function Get-SavedHotkeySnapshot {
    if (-not (Test-Path -LiteralPath $script:ToggleSnapshotPath -PathType Leaf)) {
        return @()
    }

    try {
        $entries = Get-Content -LiteralPath $script:ToggleSnapshotPath -Raw | ConvertFrom-Json
        if ($null -eq $entries) {
            return @()
        }

        if ($entries -is [System.Array]) {
            return @($entries)
        }

        return @($entries)
    }
    catch {
        return @()
    }
}

function Stop-AllAutoHotkeyProcesses {
    $processes = @(Get-AllAutoHotkeyProcesses)
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    return $processes
}

function Start-HotkeySnapshot {
    param(
        [object[]]$Entries
    )

    $startedCount = 0
    foreach ($entry in @($Entries)) {
        if ($null -eq $entry) {
            continue
        }

        $exePath = [string]$entry.ExecutablePath
        $argumentString = [string]$entry.ArgumentString
        if ([string]::IsNullOrWhiteSpace($exePath) -or (-not (Test-Path -LiteralPath $exePath -PathType Leaf))) {
            Write-Warning "Saved AutoHotkey executable was not found: $exePath"
            continue
        }

        if ([string]::IsNullOrWhiteSpace($argumentString)) {
            Start-Process -FilePath $exePath | Out-Null
        }
        else {
            Start-Process -FilePath $exePath -ArgumentList $argumentString | Out-Null
        }

        $startedCount++
    }

    return $startedCount
}

function Start-ManagedHotkeyLaunchers {
    $launchers = @(Get-ManagedHotkeyLauncherPaths)
    if ($launchers.Count -eq 0) {
        return 0
    }

    $ahkExePath = $null
    $startedCount = 0

    foreach ($launcher in $launchers) {
        $entry = if ($launcher -is [string]) { ConvertTo-ManagedLauncherEntry -Text $launcher } else { $launcher }
        $launcherPath = [string]$entry.LauncherPath
        $launcherArguments = [string]$entry.ArgumentString

        if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
            Write-Warning "Managed hotkey launcher not found: $launcherPath"
            continue
        }

        switch ([System.IO.Path]::GetExtension($launcherPath).ToLowerInvariant()) {
            '.ahk' {
                if ($null -eq $ahkExePath) {
                    $ahkExePath = Get-AutoHotkeyExePath
                }

                $argumentList = @('"{0}"' -f $launcherPath)
                if (-not [string]::IsNullOrWhiteSpace($launcherArguments)) {
                    $argumentList += $launcherArguments
                }

                Start-Process -FilePath $ahkExePath -ArgumentList $argumentList | Out-Null
            }
            '.vbs' {
                $wscriptPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
                $argumentList = @('//B', '//Nologo', ('"{0}"' -f $launcherPath))
                if (-not [string]::IsNullOrWhiteSpace($launcherArguments)) {
                    $argumentList += $launcherArguments
                }

                Start-Process -FilePath $wscriptPath -ArgumentList $argumentList | Out-Null
            }
            '.ps1' {
                $argumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $launcherPath))
                if (-not [string]::IsNullOrWhiteSpace($launcherArguments)) {
                    $argumentList += $launcherArguments
                }

                Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList | Out-Null
            }
            default {
                if ([string]::IsNullOrWhiteSpace($launcherArguments)) {
                    Start-Process -FilePath $launcherPath | Out-Null
                }
                else {
                    Start-Process -FilePath $launcherPath -ArgumentList $launcherArguments | Out-Null
                }
            }
        }

        $startedCount++
    }

    return $startedCount
}

function Save-ToggleStatus {
    param(
        [string]$State,
        [int]$ProcessCount,
        [string]$Message
    )

    Ensure-Directory -Path $script:ToggleRoot
    $status = [pscustomobject]@{
        state = $State
        processCount = $ProcessCount
        message = $Message
        updatedAt = (Get-Date).ToString('o')
        activeColor = 'green'
        inactiveColor = 'red'
    }

    $status | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $script:ToggleStatusPath -Encoding UTF8
}

function Set-ToggleState {
    param(
        [string]$State,
        [int]$ProcessCount = -1,
        [string]$Message = ''
    )

    Ensure-Directory -Path $script:ToggleRoot
    if ($ProcessCount -lt 0) {
        $ProcessCount = @(Get-AllAutoHotkeyProcesses).Count
    }

    if ([string]::IsNullOrWhiteSpace($Message)) {
        $Message = if ($State -eq 'on') {
            'AutoHotkey is ON.'
        }
        else {
            'AutoHotkey is OFF.'
        }
    }

    Set-Content -LiteralPath $script:ToggleStatePath -Value $State -NoNewline -Encoding UTF8
    Save-ToggleStatus -State $State -ProcessCount $ProcessCount -Message $Message
}

function Get-ShortcutIconPath {
    param(
        [string]$State
    )

    $iconPath = if ($State -eq 'on') { $script:OnIconPath } else { $script:OffIconPath }
    if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
        return $iconPath
    }

    return (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',1'
}

function Set-DesktopShortcut {
    param(
        [string]$State
    )

    if (-not (Test-Path -LiteralPath $script:BackendVbsPath -PathType Leaf)) {
        return
    }

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($script:DesktopShortcutPath)
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
        $shortcut.Arguments = '"' + $script:BackendVbsPath + '"'
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.Description = if ($State -eq 'on') {
            'Toggle AutoHotkey. Current state: ON. Green means AutoHotkey is active.'
        }
        else {
            'Toggle AutoHotkey. Current state: OFF. AutoHotkey processes were verified stopped.'
        }
        $shortcut.IconLocation = Get-ShortcutIconPath -State $State
        $shortcut.Save()
    }
    catch {
        Write-Warning "Could not update the desktop shortcut: $($_.Exception.Message)"
    }
}

function Show-StatusPopup {
    param(
        [string]$State,
        [string]$Message = ''
    )

    if ([string]::IsNullOrWhiteSpace($Message)) {
        $Message = if ($State -eq 'on') {
            'AutoHotkey is ON. Active scripts restarted.'
        }
        else {
            'AutoHotkey is OFF. No AutoHotkey process is running.'
        }
    }

    try {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup($Message, 2, 'Toggle AutoHotkey', 64)
    }
    catch {
        Write-Warning "Could not show the status popup: $($_.Exception.Message)"
    }
}

function Update-TogglePresentation {
    param(
        [string]$State,
        [int]$ProcessCount = -1,
        [string]$Message = ''
    )

    Set-ToggleState -State $State -ProcessCount $ProcessCount -Message $Message
    Set-DesktopShortcut -State $State
}

$runningProcesses = @(Get-AllAutoHotkeyProcesses)

if ($runningProcesses.Count -gt 0) {
    $snapshot = @(Get-RunningHotkeySnapshot)
    if ($snapshot.Count -gt 0) {
        Save-HotkeySnapshot -Entries $snapshot
    }

    Stop-AllAutoHotkeyProcesses | Out-Null
    $remainingProcesses = @(Wait-ForAutoHotkeyProcessCount -ExpectedCount 0 -TimeoutMilliseconds 3000)
    if ($remainingProcesses.Count -gt 0) {
        $message = "AutoHotkey is still running ($($remainingProcesses.Count) process(es))."
        Update-TogglePresentation -State 'on' -ProcessCount $remainingProcesses.Count -Message $message
        Show-StatusPopup -State 'on' -Message $message
        throw $message
    }

    $message = 'AutoHotkey is OFF. No AutoHotkey process is running.'
    Update-TogglePresentation -State 'off' -ProcessCount 0 -Message $message
    Show-StatusPopup -State 'off' -Message $message
    exit 0
}

$startedCount = 0
$savedSnapshot = @(Get-SavedHotkeySnapshot)
if ($savedSnapshot.Count -gt 0) {
    $startedCount = Start-HotkeySnapshot -Entries $savedSnapshot
}

if ($startedCount -eq 0) {
    $startedCount = Start-ManagedHotkeyLaunchers
}

if ($startedCount -eq 0) {
    $message = 'AutoHotkey is OFF. No saved AutoHotkey snapshot or managed launcher list was found.'
    Update-TogglePresentation -State 'off' -ProcessCount 0 -Message $message
    Show-StatusPopup -State 'off' -Message $message
    throw $message
}

$finalProcesses = @(Wait-ForAutoHotkeyProcessCount -MinimumCount 1 -TimeoutMilliseconds 3000)

$finalState = if ($finalProcesses.Count -gt 0) { 'on' } else { 'off' }
if ($finalState -eq 'on') {
    Save-HotkeySnapshot -Entries (Get-RunningHotkeySnapshot)
}

$message = if ($finalState -eq 'on') {
    "AutoHotkey is ON. $($finalProcesses.Count) process(es) active."
}
else {
    'AutoHotkey is OFF. Restart was requested, but no AutoHotkey process is running.'
}

Update-TogglePresentation -State $finalState -ProcessCount $finalProcesses.Count -Message $message
Show-StatusPopup -State $finalState -Message $message

if ($finalState -ne 'on') {
    throw 'AutoHotkey did not restart successfully.'
}
```
