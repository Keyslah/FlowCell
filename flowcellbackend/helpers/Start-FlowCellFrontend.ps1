# Description: Starts the FlowCell Tauri frontend and keeps the backend host on the existing path.
param(
    [switch]$ForceRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $projectRoot
$frontendRoot = Join-Path $repoRoot 'FlowCellFrontend'
$frontendReleaseExePath = Join-Path $frontendRoot 'src-tauri\target\release\flowcell_frontend.exe'
$frontendDebugExePath = Join-Path $frontendRoot 'src-tauri\target\debug\flowcell_frontend.exe'
$frontendExePath = $frontendReleaseExePath
$frontendSourceCommitPath = Join-Path $frontendRoot 'src-tauri\target\release\.flowcell_frontend_source_commit'
$frontendSourceStampPath = Join-Path $frontendRoot 'src-tauri\target\release\.flowcell_frontend_source_stamp'
$logsRoot = Join-Path $projectRoot 'local\logs'
$launcherLogPath = Join-Path $logsRoot 'frontend-launcher.log'
$preflightPath = Join-Path $PSScriptRoot 'Start-FlowCellPreflight.ps1'
$backendLauncherPath = Join-Path $projectRoot 'run_backend_hidden.vbs'
$npmCommand = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
$script:FlowCellFrontendLaunchWaited = $false
$script:FlowCellFrontendLauncherMutexName = 'Global\FlowCellFrontendLauncher'

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-LauncherLog([string]$Message) {
    Ensure-Directory -Path $logsRoot
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $entry = ('[{0}] {1}{2}' -f $timestamp, $Message, [Environment]::NewLine)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $fileStream = $null
        $writer = $null
        try {
            $fileStream = [System.IO.File]::Open(
                $launcherLogPath,
                [System.IO.FileMode]::Append,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::ReadWrite
            )
            $writer = New-Object System.IO.StreamWriter($fileStream, $utf8NoBom)
            $writer.Write($entry)
            $writer.Flush()
            return
        }
        catch {
            if ($attempt -ge 19) {
                throw
            }
            Start-Sleep -Milliseconds 50
        }
        finally {
            if ($writer) {
                $writer.Dispose()
            }
            elseif ($fileStream) {
                $fileStream.Dispose()
            }
        }
    }
}

function Acquire-FlowCellFrontendLaunchMutex {
    param(
        [int]$TimeoutMilliseconds = 30000
    )

    $mutex = New-Object System.Threading.Mutex($false, $script:FlowCellFrontendLauncherMutexName)
    try {
        try {
            if ($mutex.WaitOne(0)) {
                return $mutex
            }
        }
        catch [System.Threading.AbandonedMutexException] {
            Write-LauncherLog 'Recovered an abandoned frontend launcher lock.'
            return $mutex
        }

        $script:FlowCellFrontendLaunchWaited = $true
        Write-LauncherLog 'Another frontend launch is already running; waiting for launcher lock.'

        try {
            if ($mutex.WaitOne($TimeoutMilliseconds)) {
                Write-LauncherLog 'Frontend launcher lock acquired after waiting.'
                return $mutex
            }
        }
        catch [System.Threading.AbandonedMutexException] {
            Write-LauncherLog 'Recovered an abandoned frontend launcher lock after waiting.'
            return $mutex
        }

        throw "Timed out waiting for the FlowCell frontend launcher lock after $TimeoutMilliseconds ms."
    }
    catch {
        try {
            $mutex.Dispose()
        }
        catch {
        }
        throw
    }
}

function Release-FlowCellFrontendLaunchMutex([System.Threading.Mutex]$Mutex) {
    if (-not $Mutex) {
        return
    }

    try {
        $Mutex.ReleaseMutex()
    }
    catch {
    }

    try {
        $Mutex.Dispose()
    }
    catch {
    }
}

function Resolve-CargoCommand {
    $cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
    if ($cargoCommand) {
        return $cargoCommand.Source
    }

    $userCargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
    if (Test-Path -LiteralPath $userCargo -PathType Leaf) {
        return $userCargo
    }

    throw 'Rust Cargo was not found. Install the Rust toolchain before starting the Tauri frontend.'
}

function Test-FlowCellFrontendBuildRequired {
    $sourceRoots = Get-FlowCellFrontendSourceRoots

    $sourceCommit = Get-FlowCellFrontendGitCommit
    $sourceStamp = Get-FlowCellFrontendSourceStamp -SourceRoots $sourceRoots

    if ([string]::IsNullOrWhiteSpace($sourceCommit) -or -not (Test-Path -LiteralPath $frontendSourceCommitPath -PathType Leaf)) {
        return $true
    }
    if ((Get-Content -LiteralPath $frontendSourceCommitPath -ErrorAction SilentlyContinue | Select-Object -First 1).Trim() -ne $sourceCommit) {
        return $true
    }
    if ((Get-Content -LiteralPath $frontendSourceStampPath -ErrorAction SilentlyContinue -Raw).Trim() -ne $sourceStamp) {
        return $true
    }

    if (-not (Test-Path -LiteralPath $frontendExePath -PathType Leaf)) {
        return $true
    }

    $exeWriteTime = (Get-Item -LiteralPath $frontendExePath).LastWriteTimeUtc

    foreach ($sourceRoot in $sourceRoots) {
        if (-not (Test-Path -LiteralPath $sourceRoot)) {
            continue
        }

        $newerItem = if ((Get-Item -LiteralPath $sourceRoot).PSIsContainer) {
            Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $exeWriteTime } | Select-Object -First 1
        }
        else {
            $item = Get-Item -LiteralPath $sourceRoot
            if ($item.LastWriteTimeUtc -gt $exeWriteTime) { $item } else { $null }
        }

        if ($newerItem) {
            return $true
        }
    }

    return $false
}

function Get-FlowCellFrontendSourceRoots {
    return @(
        (Join-Path $frontendRoot 'src'),
        (Join-Path $frontendRoot 'src-tauri\src'),
        (Join-Path $frontendRoot 'src-tauri\capabilities'),
        (Join-Path $frontendRoot 'src-tauri\icons'),
        (Join-Path $frontendRoot 'src-tauri\Cargo.toml'),
        (Join-Path $frontendRoot 'src-tauri\Cargo.lock'),
        (Join-Path $frontendRoot 'src-tauri\build.rs'),
        (Join-Path $frontendRoot 'src-tauri\tauri.conf.json'),
        (Join-Path $frontendRoot 'package.json'),
        (Join-Path $frontendRoot 'vite.config.ts'),
        (Join-Path $frontendRoot 'index.html'),
        (Join-Path $frontendRoot 'tsconfig.json')
    )
}

function Get-FlowCellFrontendSourceStamp {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$SourceRoots
    )

    $entries = [System.Collections.Generic.List[string]]::new()
    foreach ($sourceRoot in $SourceRoots) {
        if (-not (Test-Path -LiteralPath $sourceRoot)) {
            continue
        }

        $rootItem = Get-Item -LiteralPath $sourceRoot
        if (-not $rootItem.PSIsContainer) {
            $entries.Add(('{0}|{1}|{2}' -f $rootItem.FullName.Substring($frontendRoot.Length), $rootItem.Length, $rootItem.LastWriteTimeUtc.Ticks))
            continue
        }

        $files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            $entries.Add(('{0}|{1}|{2}' -f $file.FullName.Substring($frontendRoot.Length), $file.Length, $file.LastWriteTimeUtc.Ticks))
        }
    }

    return [string]::Join("`n", ($entries | Sort-Object))
}

function Get-FlowCellFrontendGitCommit {
    try {
        Push-Location $repoRoot
        try {
            $commit = (& git rev-parse HEAD) 2>$null
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
                return $null
            }
            return $commit.Trim()
        }
        finally {
            Pop-Location
        }
    }
    catch {
        return $null
    }
}

function Get-FlowCellFrontendProcess {
    $runningFrontend = Get-Process -Name 'flowcell_frontend' -ErrorAction SilentlyContinue
    if (-not $runningFrontend) {
        return @()
    }

    $knownExePaths = @(
        $frontendReleaseExePath,
        $frontendDebugExePath
    ) | Where-Object {
        Test-Path -LiteralPath $_ -PathType Leaf
    } | ForEach-Object {
        [System.IO.Path]::GetFullPath($_)
    }

    $matches = foreach ($process in @($runningFrontend)) {
        $processPath = ''
        try {
            $processPath = [string]$process.Path
        }
        catch {
            $processPath = ''
        }

        if (
            $knownExePaths.Count -gt 0 -and
            -not [string]::IsNullOrWhiteSpace($processPath) -and
            (-not ($knownExePaths -contains [System.IO.Path]::GetFullPath($processPath)))
        ) {
            continue
        }

        $process
    }

    return @($matches)
}

function Ensure-FlowCellWindowInterop {
    if ('FlowCellWindowInterop' -as [type]) {
        return
    }

    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class FlowCellWindowInterop {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
}
'@
}

function Get-FlowCellFrontendMainWindowHandle([System.Diagnostics.Process]$Process) {
    if (-not $Process) {
        return [IntPtr]::Zero
    }

    Ensure-FlowCellWindowInterop

    $targetProcessId = [uint32]$Process.Id
    $candidateHandles = New-Object 'System.Collections.Generic.List[System.IntPtr]'

    [FlowCellWindowInterop]::EnumWindows({
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        $windowProcessId = [uint32]0
        [void][FlowCellWindowInterop]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId)
        if ($windowProcessId -ne $targetProcessId) {
            return $true
        }

        if (-not [FlowCellWindowInterop]::IsWindowVisible($hWnd)) {
            return $true
        }

        $titleBuilder = New-Object System.Text.StringBuilder 512
        [void][FlowCellWindowInterop]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
        $title = $titleBuilder.ToString()
        if ($title -ne 'FlowCell') {
            return $true
        }

        $classBuilder = New-Object System.Text.StringBuilder 256
        [void][FlowCellWindowInterop]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity)
        $className = $classBuilder.ToString()
        if ($className -ne 'Tauri Window') {
            return $true
        }

        $bounds = New-Object FlowCellWindowInterop+RECT
        [void][FlowCellWindowInterop]::GetWindowRect($hWnd, [ref]$bounds)
        $width = $bounds.Right - $bounds.Left
        $height = $bounds.Bottom - $bounds.Top
        if ((-not [FlowCellWindowInterop]::IsIconic($hWnd)) -and ($width -lt 300 -or $height -lt 240)) {
            return $true
        }

        $candidateHandles.Add($hWnd) | Out-Null
        return $false
    }, [IntPtr]::Zero) | Out-Null

    if ($candidateHandles.Count -gt 0) {
        return $candidateHandles[0]
    }

    return [IntPtr]::Zero
}

function Focus-FlowCellFrontendWindow([System.Diagnostics.Process]$Process) {
    if (-not $Process) {
        return $false
    }

    Ensure-FlowCellWindowInterop

    try {
        $Process.Refresh()
    }
    catch {
    }

    $windowHandle = Get-FlowCellFrontendMainWindowHandle -Process $Process
    if ($windowHandle -eq [IntPtr]::Zero) {
        Start-Sleep -Milliseconds 150
        try {
            $Process.Refresh()
        }
        catch {
        }
        $windowHandle = Get-FlowCellFrontendMainWindowHandle -Process $Process
    }

    if ($windowHandle -eq [IntPtr]::Zero) {
        return $false
    }

    [FlowCellWindowInterop]::ShowWindowAsync($windowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 50
    [FlowCellWindowInterop]::BringWindowToTop($windowHandle) | Out-Null
    if ([FlowCellWindowInterop]::SetForegroundWindow($windowHandle)) {
        return $true
    }

    try {
        $shell = New-Object -ComObject WScript.Shell
        if ($shell.AppActivate($Process.Id)) {
            return $true
        }
    }
    catch {
    }

    return $true
}

function Stop-FlowCellFrontendProcess {
    $runningFrontend = @(Get-FlowCellFrontendProcess)
    if (-not $runningFrontend) {
        return
    }

    foreach ($process in @($runningFrontend)) {
        Write-LauncherLog ("Stopping existing FlowCell frontend process {0} before restart/build." -f $process.Id)
        try {
            if ($process.HasExited) {
                continue
            }
        }
        catch {
        }

        try {
            Stop-Process -Id $process.Id -ErrorAction Stop
        }
        catch {
            if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
                continue
            }

            try {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
            }
            catch {
                if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
                    continue
                }

                throw
            }
        }

        try {
            Wait-Process -Id $process.Id -Timeout 10 -ErrorAction Stop
        }
        catch {
        }
    }
}

Ensure-Directory -Path $logsRoot
Write-LauncherLog 'Frontend launch requested.'
$launchMutex = Acquire-FlowCellFrontendLaunchMutex

try {
    if (-not (Test-Path -LiteralPath $preflightPath -PathType Leaf)) {
        throw "FlowCell startup preflight script was not found: $preflightPath"
    }

    Write-LauncherLog 'Running startup preflight before frontend load.'
    & $preflightPath
    Write-LauncherLog 'Startup preflight completed before frontend load.'

    if (-not (Test-Path -LiteralPath $frontendRoot -PathType Container)) {
        throw "FlowCell frontend folder was not found: $frontendRoot"
    }

    $cargoCommandPath = Resolve-CargoCommand
    $cargoCommandDirectory = Split-Path -Parent $cargoCommandPath
    if ($env:Path -notlike "*$cargoCommandDirectory*") {
        $env:Path = $cargoCommandDirectory + ';' + $env:Path
    }

    if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'node_modules') -PathType Container)) {
        Write-LauncherLog 'Installing FlowCell frontend npm dependencies.'
        Push-Location $frontendRoot
        try {
            cmd.exe /d /c ('"{0}" install >> "{1}" 2>&1' -f $npmCommand, $launcherLogPath)
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE."
            }
        }
        finally {
            Pop-Location
        }
    }

    if (Test-Path -LiteralPath $backendLauncherPath -PathType Leaf) {
        Write-LauncherLog 'Ensuring backend stays on the existing hidden launch path.'
        Start-Process -FilePath 'wscript.exe' -ArgumentList @('//nologo', $backendLauncherPath) -WindowStyle Hidden
    }

    $buildRequired = Test-FlowCellFrontendBuildRequired

    if ($script:FlowCellFrontendLaunchWaited -and (-not $buildRequired)) {
        $runningFrontend = @(Get-FlowCellFrontendProcess)
        if ($runningFrontend.Count -gt 0) {
            $existingProcess = $runningFrontend[0]
            if (Focus-FlowCellFrontendWindow -Process $existingProcess) {
                Write-LauncherLog ("Coalesced overlapping launch request into existing frontend process {0}." -f $existingProcess.Id)
                return
            }
            else {
                Write-LauncherLog ("Overlapping launch request found frontend process {0} without a usable main window; restarting frontend." -f $existingProcess.Id)
                Stop-FlowCellFrontendProcess
            }
        }
    }

    if ((-not $buildRequired) -and (-not $ForceRestart)) {
        $runningFrontend = @(Get-FlowCellFrontendProcess)
        if ($runningFrontend.Count -gt 0) {
            $existingProcess = $runningFrontend[0]
            if (Focus-FlowCellFrontendWindow -Process $existingProcess) {
                Write-LauncherLog ("Frontend already running in process {0}; focused existing window." -f $existingProcess.Id)
                return
            }
            else {
                Write-LauncherLog ("Frontend already running in process {0} without a usable main window; restarting frontend." -f $existingProcess.Id)
                Stop-FlowCellFrontendProcess
            }
        }
    }

    Push-Location $frontendRoot
    try {
        $hadRunningFrontendBeforeLaunch = (@(Get-FlowCellFrontendProcess).Count -gt 0)
        $frontendStoppedForRestart = $false
        if ($ForceRestart) {
            Write-LauncherLog 'Force-restart launch requested; bypassing running-frontend reuse.'
            Stop-FlowCellFrontendProcess
            $frontendStoppedForRestart = $true
        }

        if ($buildRequired) {
            Write-LauncherLog 'Frontend source changed; stopping any running compiled frontend before rebuild.'
            if (-not $frontendStoppedForRestart) {
                Stop-FlowCellFrontendProcess
                $frontendStoppedForRestart = $true
            }
            Write-LauncherLog 'Building Tauri frontend release binary.'
            cmd.exe /d /c ('"{0}" run tauri build >> "{1}" 2>&1' -f $npmCommand, $launcherLogPath)
            $buildExitCode = $LASTEXITCODE
            if ($buildExitCode -ne 0) {
                $restoredPreviousFrontend = $false
                if ($hadRunningFrontendBeforeLaunch -and (Test-Path -LiteralPath $frontendExePath -PathType Leaf)) {
                    try {
                        Write-LauncherLog ("Tauri frontend build exited with code {0}; restarting previous compiled frontend." -f $buildExitCode)
                        Start-Process -FilePath $frontendExePath -WorkingDirectory $frontendRoot
                        $restoredPreviousFrontend = $true
                    }
                    catch {
                        Write-LauncherLog ("Failed to restart previous compiled frontend after build failure: {0}" -f $_.Exception.Message)
                    }
                }

                if ($restoredPreviousFrontend) {
                    throw "Tauri frontend build exited with code $buildExitCode. Previous compiled frontend was restarted."
                }

                throw "Tauri frontend build exited with code $buildExitCode."
            }

            $sourceCommit = Get-FlowCellFrontendGitCommit
            if (-not [string]::IsNullOrWhiteSpace($sourceCommit)) {
                Set-Content -LiteralPath $frontendSourceCommitPath -Value $sourceCommit -Encoding UTF8
            }
            $sourceStamp = Get-FlowCellFrontendSourceStamp -SourceRoots (Get-FlowCellFrontendSourceRoots)
            Set-Content -LiteralPath $frontendSourceStampPath -Value $sourceStamp -Encoding UTF8
        }

        if (-not (Test-Path -LiteralPath $frontendExePath -PathType Leaf)) {
            throw "Tauri frontend executable was not found after build: $frontendExePath"
        }

        $runningFrontend = @(Get-FlowCellFrontendProcess)
        if ((-not $frontendStoppedForRestart) -and $runningFrontend.Count -gt 0) {
            $existingProcess = $runningFrontend[0]
            if (Focus-FlowCellFrontendWindow -Process $existingProcess) {
                Write-LauncherLog ("Frontend already running in process {0}; focused existing window after launch request." -f $existingProcess.Id)
                return
            }
            else {
                Write-LauncherLog ("Frontend already running in process {0} without a usable main window after launch request; restarting frontend." -f $existingProcess.Id)
                Stop-FlowCellFrontendProcess
            }
        }

        Write-LauncherLog 'Starting compiled Tauri frontend.'
        Start-Process -FilePath $frontendExePath -WorkingDirectory $frontendRoot
    }
    finally {
        Pop-Location
    }
}
finally {
    Release-FlowCellFrontendLaunchMutex -Mutex $launchMutex
}
