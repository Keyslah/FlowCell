# Description: Toggle all AutoHotkey processes off or back on for anti-cheat game sessions.
param([switch]$StatusOnly, [switch]$EnsureOn, [switch]$Quiet, [string]$FailureMessage = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory {
    param(
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

$script:FlowCellRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# The installed owner wins even when a previously assigned script refers to the
# source copy. Everything else resolves relative to the packaged resource root.
$installedSettings = Get-ItemProperty -LiteralPath 'HKCU:\Software\FlowCell' -ErrorAction SilentlyContinue
if ($installedSettings -and $installedSettings.PSObject.Properties['InstalledResourceRoot']) {
    $installedRoot = [string]$installedSettings.InstalledResourceRoot
    if (Test-Path -LiteralPath (Join-Path $installedRoot 'flowcell-installed.json') -PathType Leaf) { $script:FlowCellRoot = $installedRoot }
}
. (Join-Path $script:FlowCellRoot 'flowcellbackend\helpers\FlowCellPaths.ps1')
. (Join-Path $script:FlowCellRoot 'flowcellbackend\helpers\AutoHotkeyState.ps1')
$script:FlowCellRoot = $FlowCellResourceRoot
$script:ToggleRoot = Get-FlowCellAutoHotkeyStateRoot
$script:BackendLauncher = Join-Path $script:FlowCellRoot 'flowcellbackend\helpers\Start-FlowCellBackend.ps1'

$script:ToggleStatePath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleState.txt'
$script:ToggleStatusPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleStatus.json'
$script:ToggleSnapshotPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleSnapshot.json'
$script:ToggleLogPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggle.log'
$script:DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Toggle AutoHotkey.lnk'
$script:TogglePayloadRoot = Join-Path $script:FlowCellRoot 'tools\autohotkey v2 on off'
$script:BackendVbsPath = Join-Path $script:TogglePayloadRoot 'Toggle-AutoHotkey.vbs'
$script:OnIconPath = Join-Path $script:TogglePayloadRoot 'Toggle-AutoHotkey-On.ico'
$script:OffIconPath = Join-Path $script:TogglePayloadRoot 'Toggle-AutoHotkey-Off.ico'
$script:ManagedHotkeyLauncherListPaths = @(
    (Join-Path $script:ToggleRoot 'Managed-AutoHotkeyLaunchers.txt'),
    (Join-Path $FlowCellLocalRoot 'autohotkey-toggle\Managed-AutoHotkeyLaunchers.txt'),
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

    if ($env:FLOWCELL_BACKEND_ROLE -ne 'installed') {
        $paths += @('C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe', 'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe')
    }

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
        $legacySnapshot = Join-Path $FlowCellLocalRoot 'autohotkey-toggle\AutoHotkeyToggleSnapshot.json'
        if (-not (Test-Path -LiteralPath $legacySnapshot -PathType Leaf)) { return @() }
        $legacyEntries = Get-Content -LiteralPath $legacySnapshot -Raw | ConvertFrom-Json
        return @($legacyEntries)
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
    $known = @{}
    foreach ($running in Get-RunningHotkeySnapshot) {
        $known[([string]$running.ExecutablePath).Trim() + '|' + ([string]$running.ArgumentString).Trim()] = $true
    }
    foreach ($entry in @($Entries)) {
        if ($null -eq $entry) {
            continue
        }

        $exePath = [string]$entry.ExecutablePath
        $argumentString = [string]$entry.ArgumentString
        # Always use the current installed backend and bindings, never a saved
        # process command pointing at an old installed or development payload.
        if ($argumentString -match '(?i)FlowCellBackend\.ahk(?:"|\s|$)') { continue }
        $key = $exePath.Trim() + '|' + $argumentString.Trim()
        if ($known.ContainsKey($key)) { continue }
        if ([string]::IsNullOrWhiteSpace($exePath) -or (-not (Test-Path -LiteralPath $exePath -PathType Leaf))) {
            throw "Saved AutoHotkey executable was not found: $exePath"
        }

        if ([string]::IsNullOrWhiteSpace($argumentString)) {
            Start-Process -FilePath $exePath -WindowStyle Hidden | Out-Null
        }
        else {
            Start-Process -FilePath $exePath -ArgumentList $argumentString -WindowStyle Hidden | Out-Null
        }

        $startedCount++
        $known[$key] = $true
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
        if ([IO.Path]::GetFileName($launcherPath) -ieq 'FlowCellBackend.ahk') { continue }

        if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
            throw "Managed hotkey launcher not found: $launcherPath"
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

                $startedCount += Start-HotkeySnapshot -Entries @([pscustomobject]@{
                    ExecutablePath = $ahkExePath
                    ArgumentString = $argumentList -join ' '
                })
                continue
            }
            '.vbs' {
                $wscriptPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
                $argumentList = @('//B', '//Nologo', ('"{0}"' -f $launcherPath))
                if (-not [string]::IsNullOrWhiteSpace($launcherArguments)) {
                    $argumentList += $launcherArguments
                }

                Start-Process -FilePath $wscriptPath -ArgumentList $argumentList -WindowStyle Hidden | Out-Null
            }
            '.ps1' {
                $argumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $launcherPath))
                if (-not [string]::IsNullOrWhiteSpace($launcherArguments)) {
                    $argumentList += $launcherArguments
                }

                Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -WindowStyle Hidden | Out-Null
            }
            default {
                if ([string]::IsNullOrWhiteSpace($launcherArguments)) {
                    Start-Process -FilePath $launcherPath -WindowStyle Hidden | Out-Null
                }
                else {
                    Start-Process -FilePath $launcherPath -ArgumentList $launcherArguments -WindowStyle Hidden | Out-Null
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
        enabled = (Get-FlowCellAutoHotkeyState).Enabled
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
        [string]$State,
        [string]$Message = ''
    )

    if (-not (Test-Path -LiteralPath $script:BackendVbsPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $script:DesktopShortcutPath -PathType Leaf)) {
        return
    }

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($script:DesktopShortcutPath)
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
        $shortcut.Arguments = '"' + $script:BackendVbsPath + '"'
        $shortcut.WorkingDirectory = $script:TogglePayloadRoot
        $shortcut.Description = if ($Message) {
            'Toggle AutoHotkey. ' + ($Message -replace '\s+', ' ')
        }
        elseif ($State -eq 'on') {
            'Toggle AutoHotkey. Current state: ON. Green means AutoHotkey is active.'
        }
        else {
            'Toggle AutoHotkey. Current state: OFF. AutoHotkey processes were verified stopped.'
        }
        $shortcut.IconLocation = Get-ShortcutIconPath -State $State
        $shortcut.Save()
    }
    catch {
        throw "Could not update the desktop shortcut: $($_.Exception.Message)"
    }
}

function Show-StatusPopup {
    param(
        [string]$State,
        [string]$Message = ''
    )

    if ($Quiet) { return }
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
        $title = 'Toggle AutoHotkey - ' + $State.ToUpperInvariant()
        $flags = if ($State -eq 'error') { 0x10010 } else { 0x10040 }
        $null = $shell.Popup($Message, 5, $title, $flags)
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
    Set-DesktopShortcut -State $State -Message $Message
}

function Invoke-AutoHotkeyToggle {
    Ensure-Directory -Path $script:ToggleRoot
    $runningProcesses = @(Get-AllAutoHotkeyProcesses)

    if ($StatusOnly) {
        $state = if ($runningProcesses.Count -gt 0) { 'on' } else { 'off' }
        $message = "AutoHotkey is $($state.ToUpperInvariant()). $($runningProcesses.Count) process(es) active."
        if ($FailureMessage) { $message += "`n`n$FailureMessage" }
        Update-TogglePresentation -State $state -ProcessCount $runningProcesses.Count -Message $message
        Show-StatusPopup -State $state -Message $message
        return
    }
    $mutex = Enter-FlowCellAutoHotkeyLock
    try {
        $runningProcesses = @(Get-AllAutoHotkeyProcesses)
        if (-not $EnsureOn -and $runningProcesses.Count -gt 0) {
            $snapshot = @(Get-RunningHotkeySnapshot)
            if ($snapshot.Count -gt 0) { Save-HotkeySnapshot -Entries $snapshot }
            # Latch OFF before stopping anything so recovery and reload cannot
            # race the stop operation. A failed stop keeps this OFF preference.
            Set-FlowCellAutoHotkeyEnabled -Enabled $false
            Stop-AllAutoHotkeyProcesses | Out-Null
            $remainingProcesses = @(Wait-ForAutoHotkeyProcessCount -ExpectedCount 0 -TimeoutMilliseconds 3000)
            if ($remainingProcesses.Count -gt 0) {
                throw "AutoHotkey could not stop ($($remainingProcesses.Count) process(es) still active). Further FlowCell launches remain disabled."
            }
            $message = 'AutoHotkey is OFF. No AutoHotkey process is running.'
            Update-TogglePresentation -State 'off' -ProcessCount 0 -Message $message
            Show-StatusPopup -State 'off' -Message $message
            return
        }

        Set-FlowCellAutoHotkeyEnabled -Enabled $true
        # The backend launcher shares this reentrant mutex. It reuses the
        # installed owner and verifies its receiver before reporting success.
        Start-CurrentFlowCellBackend
        $savedSnapshot = @(Get-SavedHotkeySnapshot)
        if ($savedSnapshot.Count -gt 0) { Start-HotkeySnapshot -Entries $savedSnapshot | Out-Null }
        else { Start-ManagedHotkeyLaunchers | Out-Null }
        $finalProcesses = @(Wait-ForAutoHotkeyProcessCount -MinimumCount 1 -TimeoutMilliseconds 3000)
        if ($finalProcesses.Count -eq 0) { throw 'AutoHotkey did not restart successfully. No AutoHotkey process is running.' }
        Save-HotkeySnapshot -Entries (Get-RunningHotkeySnapshot)
        $message = "AutoHotkey is ON. $($finalProcesses.Count) process(es) active. Startup bindings are available."
        Update-TogglePresentation -State 'on' -ProcessCount $finalProcesses.Count -Message $message
        Show-StatusPopup -State 'on' -Message $message
    } finally {
        Exit-FlowCellAutoHotkeyLock -Mutex $mutex
    }
}

function Start-CurrentFlowCellBackend {
    & $script:BackendLauncher
}

function Write-ToggleLog {
    param([string]$Message)

    try {
        Add-Content -LiteralPath $script:ToggleLogPath -Value ("[{0}] {1}" -f (Get-Date).ToString('o'), $Message) -Encoding UTF8
    }
    catch {
        Write-Warning "Could not write the toggle log: $($_.Exception.Message)"
    }
}

function Invoke-ToggleWithFeedback {
    try {
        Invoke-AutoHotkeyToggle
        return $true
    }
    catch {
        $failure = $_
        Write-ToggleLog -Message ($failure.ToString() + [Environment]::NewLine + $failure.ScriptStackTrace)
        $message = "AutoHotkey toggle failed: $($failure.Exception.Message)"
        try {
            $processes = @(Get-AllAutoHotkeyProcesses)
            $state = if ($processes.Count -gt 0) { 'on' } else { 'off' }
            $message = "AutoHotkey is $($state.ToUpperInvariant()). $($processes.Count) process(es) active.`n`n$message"
            Update-TogglePresentation -State $state -ProcessCount $processes.Count -Message $message
        }
        catch {
            Write-ToggleLog -Message "Could not refresh status after failure: $($_.Exception.Message)"
        }
        Show-StatusPopup -State 'error' -Message $message
        return $false
    }
}

if (-not (Invoke-ToggleWithFeedback)) {
    exit 1
}
