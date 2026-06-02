# Description: Main FlowCell desktop shell for program tabs, panel tools, popouts, and script/macro execution.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CodexWin32 {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnableWindow(IntPtr hWnd, bool bEnable);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string AppID);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private static readonly IntPtr HWND_TOP = new IntPtr(0);
    private const int GWLP_HWNDPARENT = -8;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;

    public class WindowInfo {
        public int ProcessId { get; set; }
        public string Title { get; set; }
        public string ClassName { get; set; }
        public long Handle { get; set; }
    }

    public static List<WindowInfo> GetVisibleWindowsForProcesses(int[] processIds) {
        var windows = new List<WindowInfo>();
        var pidSet = new HashSet<int>(processIds ?? Array.Empty<int>());
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) {
                return true;
            }

            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (!pidSet.Contains((int)processId)) {
                return true;
            }

            var titleBuilder = new StringBuilder(512);
            GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);

            var classBuilder = new StringBuilder(256);
            GetClassName(hWnd, classBuilder, classBuilder.Capacity);

            windows.Add(new WindowInfo {
                ProcessId = (int)processId,
                Title = titleBuilder.ToString(),
                ClassName = classBuilder.ToString(),
                Handle = hWnd.ToInt64()
            });
            return true;
        }, IntPtr.Zero);

        return windows;
    }

public static int GetForegroundProcessId() {
    var hWnd = GetForegroundWindow();
    if (hWnd == IntPtr.Zero) {
        return 0;
        }

        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        return (int)processId;
    }

    public static string GetForegroundWindowTitle() {
        var hWnd = GetForegroundWindow();
        if (hWnd == IntPtr.Zero) {
            return string.Empty;
        }

        var titleBuilder = new StringBuilder(512);
    GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
    return titleBuilder.ToString();
}

public static long GetForegroundWindowHandle() {
    var hWnd = GetForegroundWindow();
    return hWnd == IntPtr.Zero ? 0 : hWnd.ToInt64();
}

public static void SetTopmost(long handle, bool isTopmost) {
    if (handle == 0) {
        return;
        }

        SetWindowPos(
            new IntPtr(handle),
            isTopmost ? HWND_TOPMOST : HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
        );
    }

public static void SetEnabled(long handle, bool isEnabled) {
    if (handle == 0) {
        return;
    }

    EnableWindow(new IntPtr(handle), isEnabled);
}

public static long GetOwner(long handle) {
    if (handle == 0) {
        return 0;
    }

    if (IntPtr.Size == 8) {
        return GetWindowLongPtr64(new IntPtr(handle), GWLP_HWNDPARENT).ToInt64();
    }

    return GetWindowLong32(new IntPtr(handle), GWLP_HWNDPARENT);
}

public static void SetOwner(long handle, long ownerHandle) {
    if (handle == 0) {
        return;
    }

    var hWnd = new IntPtr(handle);
    var owner = new IntPtr(ownerHandle);
    if (IntPtr.Size == 8) {
        SetWindowLongPtr64(hWnd, GWLP_HWNDPARENT, owner);
    }
    else {
        SetWindowLong32(hWnd, GWLP_HWNDPARENT, owner.ToInt32());
    }

    SetWindowPos(hWnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

public static void PlaceNormalTop(long handle) {
    if (handle == 0) {
        return;
    }

    SetWindowPos(new IntPtr(handle), HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}
}
"@
Add-Type @"
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("56FDF344-FD6D-11D0-958A-006097C9A090")]
[ClassInterface(ClassInterfaceType.None)]
public class TaskbarList {}

[ComImport]
[Guid("EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList3 {
    void HrInit();
    void AddTab(IntPtr hwnd);
    void DeleteTab(IntPtr hwnd);
    void ActivateTab(IntPtr hwnd);
    void SetActiveAlt(IntPtr hwnd);
    void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
    void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
    void SetProgressState(IntPtr hwnd, int tbpFlags);
    void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
    void UnregisterTab(IntPtr hwndTab);
    void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
    void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint dwReserved);
    void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButton);
    void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButton);
    void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
    void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, string pszDescription);
    void SetThumbnailTooltip(IntPtr hwnd, string pszTip);
    void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
}

public static class FlowCellTaskbarTabs {
    private static ITaskbarList3 taskbar;

    private static ITaskbarList3 Taskbar {
        get {
            if (taskbar == null) {
                taskbar = (ITaskbarList3)new TaskbarList();
                taskbar.HrInit();
            }
            return taskbar;
        }
    }

    public static void RegisterTab(long childHandle, long ownerHandle) {
        if (childHandle == 0 || ownerHandle == 0 || childHandle == ownerHandle) {
            return;
        }

        var child = new IntPtr(childHandle);
        var owner = new IntPtr(ownerHandle);
        Taskbar.RegisterTab(child, owner);
        Taskbar.SetTabOrder(child, IntPtr.Zero);
    }

    public static void UnregisterTab(long childHandle) {
        if (childHandle == 0) {
            return;
        }

        Taskbar.UnregisterTab(new IntPtr(childHandle));
    }

    public static void SetTabActive(long childHandle, long ownerHandle) {
        if (childHandle == 0 || ownerHandle == 0) {
            return;
        }

        Taskbar.SetTabActive(new IntPtr(childHandle), new IntPtr(ownerHandle), 0);
    }
}
"@

$script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:FlowCellHomeRoot = [System.IO.Path]::GetFullPath((Join-Path $script:ProjectRoot '..'))
$script:FlowCellLocalRoot = Join-Path $script:ProjectRoot 'local'
$script:FlowCellPrivateRoot = Join-Path $script:FlowCellLocalRoot 'private'
$script:FlowCellPrivateSettingsPath = Join-Path $script:FlowCellPrivateRoot 'local.settings.json'
$script:FlowCellLocalAppDataRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FlowCell'
$script:LegacyFlowCellIllustratorScriptsDir = Join-Path $script:FlowCellLocalAppDataRoot 'Programs\Illustrator\Scripts'
$script:AhkScriptPath = Join-Path $script:ProjectRoot 'FlowCellBackend.ahk'
$script:MacroRecorderPath = Join-Path $script:ProjectRoot 'helpers\RecordMacro.ahk'
$script:RecordedActionsDir = Join-Path $script:FlowCellLocalRoot 'recorded_actions'
$script:BindingsPath = Join-Path $script:FlowCellLocalRoot 'bindings.ini'
$script:FlowCellStatePath = Join-Path $script:FlowCellLocalRoot 'flowcell_state.json'
$script:FlowCellPanelSavesRoot = Join-Path $script:FlowCellLocalRoot 'panel_saves'
$script:FlowCellLayoutsRoot = Join-Path $script:FlowCellLocalRoot 'layouts'
$script:FlowCellTempRoot = Join-Path $script:FlowCellLocalRoot 'temp'
$script:FlowCellCommandHostTempRoot = Join-Path $script:FlowCellTempRoot 'command_host'
$script:FlowCellLastPanelSaveFolder = $script:FlowCellPanelSavesRoot
$script:FlowCellLastLayoutFolder = $script:FlowCellLayoutsRoot
$script:LegacyIllustratorScriptsDir = 'C:\Program Files\Adobe\Adobe Illustrator 2026\Presets\en_US\Scripts'
$script:IllustratorScriptsDir = Join-Path $script:FlowCellHomeRoot 'Programs\Illustrator\Illustrator Git Scripts'
$script:PhotoshopScriptsDir = Join-Path $script:FlowCellHomeRoot 'Programs\Photoshop\Photoshop Git Scripts'
$script:WindowsScriptsDir = Join-Path $script:FlowCellHomeRoot 'Programs\Windows\Windows Git Scripts'
$script:IllustratorHelperScriptsDir = Join-Path $script:FlowCellHomeRoot 'Programs\Illustrator\HelperScripts'
$script:FlowCellCommandHostScriptPath = Join-Path $script:ProjectRoot 'FlowCellCommandBackend.ps1'
$script:LogsDir = Join-Path $script:FlowCellLocalRoot 'logs'
$script:ControllerLogPath = Join-Path $script:LogsDir 'controller.log'
$script:CommandHostLogPath = Join-Path $script:LogsDir 'command_host.log'
$script:UiLogPath = Join-Path $script:LogsDir 'ui.log'
$script:ScanStatusPath = Join-Path $script:LogsDir 'latest_scan.txt'
$script:LastActionStatusPath = Join-Path $script:LogsDir 'last_action_status.txt'
$script:Window = $null
$script:BindingsList = $null
$script:ActionStatus = $null
$script:ShortcutStatus = $null
$script:CandidateText = $null
$script:ActionSelector = $null
$script:FlowCellWindow = $null
$script:FlowCellState = $null
$script:FlowCellPanelWindows = @{}
$script:FlowCellToolPopoutWindows = @{}
$script:FlowCellToolPopoutTargets = @{}
$script:FlowCellPopoutClusters = @{}
$script:FlowCellTaskbarAppId = 'FlowCell.Desktop.PopoutWorkspace'
$script:FlowCellUseExternalProgramWindowOwners = $true
$script:FlowCellPopoutFirstStartupPending = $true
$script:FlowCellStartupRestoreInProgress = $false
$script:FlowCellPopoutSnapThreshold = 40.0
$script:FlowCellPopoutDetachThreshold = 84.0
$script:FlowCellClusterTouchTolerance = 12.0
$script:FlowCellPopoutSnapInsetX = 0.0
$script:FlowCellPopoutSnapInsetY = 0.0
$script:FlowCellSelectedButtonKeys = @{}
$script:FlowCellMainArrangeModeEnabled = $false
$script:FlowCellMainArrangePendingPointer = $null
$script:FlowCellMainArrangeDragState = $null
$script:FlowCellPendingBinding = $null
$script:FlowCellPendingShortcutBinding = $null
$script:AzeronProfilePath = ''
$script:AzeronProfileName = ''
$script:DirectoryOpusConfigRoot = ''
$script:CachedAzeronReservedShortcuts = $null
$script:CachedAzeronReservedStamp = ''
$script:CachedOpusReservedShortcuts = $null
$script:CachedOpusReservedStamp = ''
$script:MacroLabProgramContext = ''
$script:ProgramTabStrip = $null
$script:ProgramTabStatus = $null
$script:FlowCellMainHoverStatusText = $null
$script:FlowCellMainHoverDelayMs = 2000
$script:FlowCellMainHoverHintText = 'Hover over a button for 2 seconds to see what it does.'
$script:FlowCellStyleGroupRoot = Join-Path $script:FlowCellLocalRoot 'style_groups'
$script:FlowCellDevStyleGroupRoot = Join-Path $script:ProjectRoot 'dev\visual-style-sandbox\style_groups'
$script:FlowCellStyleGroupCache = @{}
$script:FlowCellHostLayerVersion = 'state-host-skin-v1'
$script:State = $null
$script:BackendStartedByUi = $false
$script:DocumentPollTimer = $null
$script:CliWatchTimer = $null
$script:PendingCliOperation = $null
$script:IsControllerBusy = $false
$script:IsDocumentAutoScanRunning = $false
$script:LastAutoScannedDocumentKey = ''
$script:BuiltInActions = @(
    [pscustomobject]@{
        Id = 'save_selected_obj_to_project_3d'
        Label = 'save obj'
        Tooltip = 'Export the current Illustrator selection from a d# sublayer to 01 src\00 assets\03 3d, naming the OBJ after the parent asset layer.'
    },
    [pscustomobject]@{
        Id = 'save_selected_obj_to_blender'
        Label = 'blender obj'
        Tooltip = 'Export the current Illustrator selection as an OBJ, then send that OBJ to the active Blender session or launch Blender and import it.'
    },
    [pscustomobject]@{
        Id = 'save_selected_png_to_blender_litho'
        Label = 'blender litho'
        Tooltip = 'Save the current Illustrator selection as a PNG like save png, then send it to Blender to build a lithophane.'
    }
)
$script:Actions = @()

function Write-UiLog([string]$Message) {
    try {
        if (-not (Test-Path -LiteralPath $script:LogsDir -PathType Container)) {
            New-Item -ItemType Directory -Path $script:LogsDir -Force | Out-Null
        }
    }
    catch {
        return
    }

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = '[{0}] {1}' -f $timestamp, $Message
    $encoding = New-Object System.Text.UTF8Encoding($false)
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $stream = $null
        $writer = $null
        try {
            $stream = [System.IO.File]::Open(
                $script:UiLogPath,
                [System.IO.FileMode]::Append,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::ReadWrite
            )
            $writer = New-Object System.IO.StreamWriter($stream, $encoding)
            $writer.WriteLine($line)
            return
        }
        catch {
            Start-Sleep -Milliseconds (25 * $attempt)
        }
        finally {
            if ($writer) {
                $writer.Dispose()
                $stream = $null
            }
            if ($stream) {
                $stream.Dispose()
            }
        }
    }
}

function Get-FlowCellLocalSettings {
    $settings = [ordered]@{
        AzeronProfilePath = ''
        AzeronProfileName = ''
        DirectoryOpusConfigRoot = ''
    }

    if (-not (Test-Path -LiteralPath $script:FlowCellPrivateSettingsPath -PathType Leaf)) {
        return [pscustomobject]$settings
    }

    try {
        $raw = Get-Content -LiteralPath $script:FlowCellPrivateSettingsPath -Raw
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return [pscustomobject]$settings
        }

        $loaded = $raw | ConvertFrom-Json
        foreach ($name in @($settings.Keys)) {
            if ($loaded -and $loaded.PSObject.Properties[$name]) {
                $settings[$name] = [string]$loaded.$name
            }
        }
    }
    catch {
    }

    return [pscustomobject]$settings
}

function Initialize-FlowCellLocalStorage {
    foreach ($path in @(
        $script:FlowCellLocalRoot,
        $script:FlowCellPrivateRoot,
        $script:RecordedActionsDir,
        $script:FlowCellPanelSavesRoot,
        $script:FlowCellLayoutsRoot,
        $script:LogsDir,
        $script:FlowCellTempRoot,
        $script:FlowCellCommandHostTempRoot,
        (Join-Path $script:FlowCellLocalRoot 'bin'),
        $script:IllustratorScriptsDir,
        $script:PhotoshopScriptsDir
    )) {
        if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }

    $localSettings = Get-FlowCellLocalSettings
    $script:AzeronProfilePath = [string]$localSettings.AzeronProfilePath
    $script:AzeronProfileName = [string]$localSettings.AzeronProfileName
    $script:DirectoryOpusConfigRoot = [string]$localSettings.DirectoryOpusConfigRoot
}

function Set-FlowCellContentWithRetry([string]$Path, [string]$Value, [string]$Encoding = 'UTF8') {
    $mutex = $null
    $mutexOwned = $false
    $lastError = $null
    $textEncoding = switch -Regex ([string]$Encoding) {
        '^utf-?8$' { New-Object System.Text.UTF8Encoding($false); break }
        '^unicode$' { [System.Text.Encoding]::Unicode; break }
        '^utf-?16$' { [System.Text.Encoding]::Unicode; break }
        '^ascii$' { [System.Text.Encoding]::ASCII; break }
        default { [System.Text.Encoding]::GetEncoding([string]$Encoding); break }
    }

    try {
        $mutex = New-Object System.Threading.Mutex($false, 'Global\FlowCellStateWriteMutex')
        try {
            $mutexOwned = $mutex.WaitOne(10000)
        }
        catch [System.Threading.AbandonedMutexException] {
            $mutexOwned = $true
        }

        if (-not $mutexOwned) {
            throw 'Timed out waiting for FlowCell state write access.'
        }

        $directory = Split-Path -Parent $Path
        if (-not [string]::IsNullOrWhiteSpace([string]$directory)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }

        $bytes = $textEncoding.GetBytes([string]$Value)
        for ($attempt = 1; $attempt -le 18; $attempt++) {
            try {
                $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
                try {
                    $fileStream.Write($bytes, 0, $bytes.Length)
                    $fileStream.Flush($true)
                }
                finally {
                    if ($fileStream) { $fileStream.Dispose() }
                }
                return
            }
            catch {
                $lastError = $_
                Start-Sleep -Milliseconds (60 * $attempt)
            }
        }
    }
    finally {
        if ($mutex -and $mutexOwned) {
            try { $mutex.ReleaseMutex() } catch {}
        }
        if ($mutex) {
            try { $mutex.Dispose() } catch {}
        }
    }

    if ($lastError) {
        throw $lastError
    }
}

function Get-AhkExePath {
    foreach ($path in @('C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe', 'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe')) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
    throw 'AutoHotkey v2 was not found in the default install path.'
}

function ConvertTo-SingleQuotedPowerShellLiteral([string]$Value) {
    return "'" + ($Value -replace "'", "''") + "'"
}

function Get-AhkScriptPowerShellArgumentList([string]$ScriptPath, [string[]]$Arguments) {
    $parts = @(
        '&',
        (ConvertTo-SingleQuotedPowerShellLiteral (Get-AhkExePath)),
        (ConvertTo-SingleQuotedPowerShellLiteral $ScriptPath)
    )
    foreach ($argument in @($Arguments)) {
        $parts += (ConvertTo-SingleQuotedPowerShellLiteral ([string]$argument))
    }
    $commandText = (($parts -join ' ') + '; exit $LASTEXITCODE')
    return @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $commandText)
}

function Invoke-ControllerCli([string[]]$Arguments) {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList (Get-AhkScriptPowerShellArgumentList -ScriptPath $script:AhkScriptPath -Arguments $Arguments) -PassThru -Wait -WindowStyle Hidden
    return $process.ExitCode
}

function Start-AhkScriptProcess([string]$ScriptPath, [string[]]$Arguments, [string]$WindowStyle = 'Hidden') {
    return Start-Process -FilePath 'powershell.exe' -ArgumentList (Get-AhkScriptPowerShellArgumentList -ScriptPath $ScriptPath -Arguments $Arguments) -PassThru -WindowStyle $WindowStyle
}

function Get-PowerShellScriptArgumentList([string]$ScriptPath, [string[]]$Arguments) {
    $resolvedArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath)
    foreach ($argument in @($Arguments)) {
        $resolvedArguments += [string]$argument
    }
    return ,$resolvedArguments
}

function Start-PowerShellScriptProcess([string]$ScriptPath, [string[]]$Arguments, [string]$WindowStyle = 'Hidden') {
    return Start-Process -FilePath 'powershell.exe' -ArgumentList (Get-PowerShellScriptArgumentList -ScriptPath $ScriptPath -Arguments $Arguments) -PassThru -WindowStyle $WindowStyle
}

function Get-BackendProcesses {
    $escaped = [regex]::Escape($script:AhkScriptPath)
    @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'AutoHotkey' -and $_.CommandLine -match $escaped -and $_.CommandLine -match '--headless' })
}

function Start-Backend {
    if (@(Get-BackendProcesses).Count -gt 0) {
        $script:BackendStartedByUi = $false
        Write-UiLog 'Reused existing headless backend.'
        return
    }

    Start-Process -FilePath 'powershell.exe' -ArgumentList (Get-AhkScriptPowerShellArgumentList -ScriptPath $script:AhkScriptPath -Arguments @('--headless')) -WindowStyle Hidden | Out-Null
    $script:BackendStartedByUi = $true
    Write-UiLog 'Started headless backend.'
}

function Stop-Backend {
    foreach ($process in @(Get-BackendProcesses)) {
        try { Stop-Process -Id $process.ProcessId -Force } catch {}
    }
    Write-UiLog 'Stopped headless backend.'
}

function Restart-Backend {
    Stop-Backend
    Start-Backend
}

function Read-AllText([string]$Path, [string]$Default = '') {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Default }
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return Get-Content -LiteralPath $Path -Raw }
    return $Default
}

function Get-ControlSelectedItem($Control) {
    if ($null -eq $Control) { return $null }
    if ($Control.PSObject.Properties['SelectedItem']) { return $Control.SelectedItem }
    return $null
}

function Set-ControlTextValue($Control, [string]$Value) {
    if ($null -eq $Control) { return }
    if ($Control.PSObject.Properties['Text']) {
        $Control.Text = $Value
    }
}

function Confirm-UiAction([string]$Message, [string]$Title = 'Confirm', $OwnerWindow = $null) {
    if ($OwnerWindow -and $OwnerWindow -is [System.Windows.Window]) {
        return ([System.Windows.MessageBox]::Show($OwnerWindow, $Message, $Title, 'YesNo', 'Question') -eq 'Yes')
    }

    $dialogOwner = Get-DialogOwnerWindow
    if ($dialogOwner -and $dialogOwner -is [System.Windows.Window]) {
        return ([System.Windows.MessageBox]::Show($dialogOwner, $Message, $Title, 'YesNo', 'Question') -eq 'Yes')
    }

    return ([System.Windows.MessageBox]::Show($Message, $Title, 'YesNo', 'Question') -eq 'Yes')
}

function Show-UiError([string]$Summary, [System.Exception]$Exception) {
    $message = $Summary
    if ($Exception -and $Exception.Message) {
        $message = "{0}`r`n`r`n{1}" -f $Summary, $Exception.Message
    }

    Write-UiLog ('{0} {1}' -f $Summary, $(if ($Exception) { $Exception.ToString() } else { '' }))
    try {
        Set-ActionStatus $message
    }
    catch {
    }
    $ownerWindow = Get-DialogOwnerWindow
    if ($ownerWindow) {
        [System.Windows.MessageBox]::Show($ownerWindow, $message, 'Macros') | Out-Null
    }
    else {
        [System.Windows.MessageBox]::Show($message, 'Macros') | Out-Null
    }
}

function Invoke-UiSafe([string]$Summary, [scriptblock]$Action) {
    try {
        & $Action
    }
    catch {
        Show-UiError $Summary $_.Exception
    }
}

function Get-DialogOwnerWindow {
    if ($script:FlowCellWindow -and $script:FlowCellWindow.IsLoaded -and $script:FlowCellWindow.IsVisible) {
        return $script:FlowCellWindow
    }
    if ($script:Window -and $script:Window.IsLoaded -and $script:Window.IsVisible) {
        return $script:Window
    }
    return $null
}

function Set-ControllerBusyState([bool]$IsBusy) {
    $script:IsControllerBusy = $IsBusy
    if (-not $script:Window) { return }

    foreach ($controlName in @(
        'ScanButton',
        'RescanButton',
        'ActionPickerCombo',
        'RunSelectedActionButton',
        'RecordActionButton',
        'ReloadBackendButton',
        'AddActionBindingButton',
        'AddScriptBindingButton',
        'EditMacroButton',
        'EditBindingButton',
        'RemoveBindingButton',
        'ReloadBindingsButton'
    )) {
        $control = $script:Window.FindName($controlName)
        if ($control) {
            $control.IsEnabled = -not $IsBusy
        }
    }

    $scanButton = $script:Window.FindName('ScanButton')
    $rescanButton = $script:Window.FindName('RescanButton')
    $runSelectedActionButton = $script:Window.FindName('RunSelectedActionButton')
    $recordActionButton = $script:Window.FindName('RecordActionButton')

    if ($scanButton) { $scanButton.Content = 'Scan Illustrator UI' }
    if ($rescanButton) { $rescanButton.Content = 'Re-scan' }
    if ($runSelectedActionButton) { $runSelectedActionButton.Content = 'Run Selected Action' }
    if ($recordActionButton) { $recordActionButton.Content = 'Record Action' }

    if ($IsBusy -and $script:PendingCliOperation) {
        switch ($script:PendingCliOperation.Kind) {
            'scan' {
                if ($script:PendingCliOperation.IsRescan) {
                    if ($rescanButton) { $rescanButton.Content = 'Working...' }
                }
                else {
                    if ($scanButton) { $scanButton.Content = 'Working...' }
                }
            }
            'action' {
                if ($runSelectedActionButton) { $runSelectedActionButton.Content = 'Working...' }
            }
            'record' {
                if ($recordActionButton) { $recordActionButton.Content = 'Recording...' }
            }
        }
    }
}

function Complete-PendingCliOperation {
    if (-not $script:PendingCliOperation) { return }

    $operation = $script:PendingCliOperation
    $script:PendingCliOperation = $null
    $script:IsControllerBusy = $false
    Set-ControllerBusyState -IsBusy $false

    try {
        $exitCode = if ($operation.ExitCodeOverride -ne $null) { [int]$operation.ExitCodeOverride } else { [int]$operation.Process.ExitCode }
        $onComplete = $operation.OnComplete
        if ($onComplete -is [scriptblock]) {
            & $onComplete $exitCode
        }
    }
    catch {
        Show-UiError ('{0} failed.' -f $operation.Description) $_.Exception
    }
}

function Ensure-CliWatchTimer {
    if ($script:CliWatchTimer) { return }

    $script:CliWatchTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:CliWatchTimer.Interval = [TimeSpan]::FromMilliseconds(250)
    $script:CliWatchTimer.Add_Tick({
        if (-not $script:PendingCliOperation) {
            $script:CliWatchTimer.Stop()
            return
        }

        try {
            $elapsedSeconds = ([DateTime]::UtcNow - $script:PendingCliOperation.StartedAtUtc).TotalSeconds
            if (-not $script:PendingCliOperation.Process.HasExited -and $elapsedSeconds -ge $script:PendingCliOperation.TimeoutSeconds) {
                try {
                    $script:PendingCliOperation.Process.Kill()
                    $script:PendingCliOperation.Process.WaitForExit(2000) | Out-Null
                }
                catch {
                }
                $script:PendingCliOperation.ExitCodeOverride = 124
                Write-UiLog ('Timed out {0} after {1:N0}s.' -f $script:PendingCliOperation.Description, $script:PendingCliOperation.TimeoutSeconds)
            }

            $script:PendingCliOperation.Process.Refresh()
            if (-not $script:PendingCliOperation.Process.HasExited) {
                return
            }
        }
        catch {
            $script:CliWatchTimer.Stop()
            $script:PendingCliOperation = $null
            $script:IsControllerBusy = $false
            Set-ControllerBusyState -IsBusy $false
            Show-UiError 'Macro backend monitoring failed.' $_.Exception
            return
        }

        $script:CliWatchTimer.Stop()
        Complete-PendingCliOperation
    })
}

function Start-ControllerOperation([string]$Description, [string]$Kind, [string[]]$Arguments, [scriptblock]$OnComplete, [hashtable]$Metadata = @{}) {
    if ($script:IsControllerBusy -or $script:PendingCliOperation) {
        Set-ActionStatus ('FlowCell is already busy. Wait for the current {0} to finish.' -f $(if ($script:PendingCliOperation) { $script:PendingCliOperation.Description } else { 'operation' }))
        return $false
    }

    try {
        $resolvedScriptPath = if ($Metadata.ContainsKey('ScriptPath')) { [string]$Metadata['ScriptPath'] } else { $script:AhkScriptPath }
        $resolvedWindowStyle = if ($Metadata.ContainsKey('WindowStyle')) { [string]$Metadata['WindowStyle'] } else { 'Hidden' }
        $launcher = if ($Metadata.ContainsKey('Launcher')) { [string]$Metadata['Launcher'] } else { 'AutoHotkey' }
        switch ([string]$launcher) {
            'PowerShell' {
                $process = Start-PowerShellScriptProcess -ScriptPath $resolvedScriptPath -Arguments $Arguments -WindowStyle $resolvedWindowStyle
            }
            default {
                $process = Start-AhkScriptProcess -ScriptPath $resolvedScriptPath -Arguments $Arguments -WindowStyle $resolvedWindowStyle
            }
        }
    }
    catch {
        if ($Metadata.ContainsKey('AutoTriggered') -and $Metadata['AutoTriggered']) { $script:IsDocumentAutoScanRunning = $false }
        throw
    }

    $actionId = if ($Metadata.ContainsKey('ActionId')) { [string]$Metadata['ActionId'] } else { '' }
    $isRescan = if ($Metadata.ContainsKey('IsRescan')) { [bool]$Metadata['IsRescan'] } else { $false }
    $timeoutSeconds = if ($Metadata.ContainsKey('TimeoutSeconds')) { [int]$Metadata['TimeoutSeconds'] } else { 45 }
    $script:PendingCliOperation = [pscustomobject]@{
        Description = $Description
        Kind = $Kind
        Process = $process
        OnComplete = $OnComplete
        ActionId = $actionId
        IsRescan = $isRescan
        StartedAtUtc = [DateTime]::UtcNow
        TimeoutSeconds = [Math]::Max($timeoutSeconds, 5)
        ExitCodeOverride = $null
    }
    $script:IsControllerBusy = $true
    Set-ControllerBusyState -IsBusy $true
    Ensure-CliWatchTimer
    $script:CliWatchTimer.Start()
    Write-UiLog ('Started {0}. PID={1}' -f $Description, $process.Id)
    return $true
}

function Test-IsIllustratorDocumentTitle([string]$Title) {
    if ([string]::IsNullOrWhiteSpace($Title)) { return $false }

    $trimmed = $Title.Trim()
    if ($trimmed -match '^(?i)(illustrator|home|start|learn|discover|recent)$') { return $false }
    if ($trimmed -match '(?i)(your files|cloud documents|creative cloud|libraries)$') { return $false }

    return $trimmed -match '(?i)(^untitled-\d+\b|\.ai\b|\.aic\b|\.eps\b|\.svg\b|\.pdf\b|@\s*\d+(?:\.\d+)?\s*%)'
}

function Get-IllustratorDocumentState {
    $processes = @(Get-Process -Name Illustrator -ErrorAction SilentlyContinue)
    if (@($processes).Count -eq 0) {
        return [pscustomobject]@{
            IllustratorOpen = $false
            HasDocumentWindow = $false
            DocumentKey = ''
            DocumentTitle = ''
        }
    }

    $windows = @([CodexWin32]::GetVisibleWindowsForProcesses([int[]]@($processes | ForEach-Object { $_.Id })))
    $documentWindows = @($windows | Where-Object { Test-IsIllustratorDocumentTitle $_.Title })
    $document = $documentWindows | Select-Object -First 1
    return [pscustomobject]@{
        IllustratorOpen = $true
        HasDocumentWindow = ($null -ne $document)
        DocumentKey = $(if ($null -ne $document) { '{0}|{1}' -f $document.Handle, $document.Title } else { '' })
        DocumentTitle = $(if ($null -ne $document) { $document.Title } else { '' })
    }
}

function Parse-Ini([string]$Path) {
    $data = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $data }
    $section = ''
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^\[(.+)\]$') {
            $section = $matches[1]
            if (-not $data.Contains($section)) { $data[$section] = [ordered]@{} }
        }
        elseif ($section -ne '' -and $trimmed -and -not $trimmed.StartsWith(';')) {
            $pair = $trimmed -split '=', 2
            $data[$section][$pair[0]] = if ($pair.Count -gt 1) { $pair[1] } else { '' }
        }
    }
    return $data
}

function Read-MacroDefinition([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }

    $ini = Parse-Ini -Path $Path
    if (-not $ini.Contains('Action')) { return $null }
    $action = $ini.Action
    if (-not $action.Contains('Id') -or -not $action.Contains('Label')) { return $null }

    $steps = @()
    foreach ($sectionName in @($ini.Keys | Where-Object { $_ -match '^Step_\d+$' } | Sort-Object)) {
        $section = $ini[$sectionName]
        $step = [ordered]@{
            Section = $sectionName
            Type = [string]$section.Type
            DelayMs = if ($section.Contains('DelayMs') -and $section.DelayMs -match '^-?\d+$') { [int]$section.DelayMs } else { 0 }
        }
        foreach ($key in @('X','Y','Button','Count','Direction','Text','Keys','ScriptPath','MacroPath')) {
            if ($section.Contains($key)) { $step[$key] = [string]$section[$key] }
        }
        $steps += [pscustomobject]$step
    }

        return [pscustomobject]@{
            Path = $Path
            FileName = [System.IO.Path]::GetFileNameWithoutExtension($Path)
            Id = [string]$action.Id
            Label = [string]$action.Label
            CreatedAt = if ($action.Contains('CreatedAt')) { [string]$action.CreatedAt } else { '' }
            Steps = @($steps)
        }
}

function Save-MacroDefinition($Definition) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('[Action]')
    $lines.Add('Id={0}' -f $Definition.Id)
    $lines.Add('Label={0}' -f $Definition.Label)
    if ($Definition.CreatedAt) { $lines.Add('CreatedAt={0}' -f $Definition.CreatedAt) }
    $lines.Add('')

    $index = 1
    foreach ($step in @($Definition.Steps)) {
        $lines.Add('[Step_{0}]' -f $index.ToString('000'))
        $lines.Add('Type={0}' -f $step.Type)
        $lines.Add('DelayMs={0}' -f ([int]$step.DelayMs))
        switch ($step.Type) {
            'Click' {
                $lines.Add('X={0}' -f $step.X)
                $lines.Add('Y={0}' -f $step.Y)
                $lines.Add('Button={0}' -f $step.Button)
                $lines.Add('Count={0}' -f $step.Count)
            }
            'Wheel' {
                $lines.Add('X={0}' -f $step.X)
                $lines.Add('Y={0}' -f $step.Y)
                $lines.Add('Direction={0}' -f $step.Direction)
                $lines.Add('Count={0}' -f $step.Count)
            }
            'Text' {
                $lines.Add('Text={0}' -f ([string]$step.Text -replace "[`r`n]", ' '))
            }
            'Key' {
                $lines.Add('Keys={0}' -f ([string]$step.Keys -replace "[`r`n]", ' '))
            }
            'Script' {
                $lines.Add('ScriptPath={0}' -f [string]$step.ScriptPath)
            }
            'Macro' {
                $lines.Add('MacroPath={0}' -f [string]$step.MacroPath)
            }
        }
        $lines.Add('')
        $index += 1
    }

    Set-Content -LiteralPath $Definition.Path -Value (($lines -join [Environment]::NewLine).TrimEnd()) -Encoding UTF8
}

function Get-RecordedActionById([string]$ActionId) {
    $action = $script:Actions | Where-Object { $_.Id -eq $ActionId -and $_.Kind -eq 'recorded' } | Select-Object -First 1
    if ($null -eq $action) { return $null }
    return $action
}

function Get-SelectedRecordedAction {
    $selectedBinding = Get-ControlSelectedItem $script:BindingsList
    if ($null -ne $selectedBinding -and $selectedBinding.Kind -eq 'action') {
        $action = Get-RecordedActionById -ActionId ([string]$selectedBinding.Id)
        if ($null -ne $action) { return $action }
    }

    $selectedActionItem = Get-ControlSelectedItem $script:ActionSelector
    if ($selectedActionItem) {
        $action = $selectedActionItem
        if ($action.Kind -eq 'recorded') { return $action }
    }

    return $null
}

function Get-StepSummary($Step) {
    switch ($Step.Type) {
        'ActivateIllustrator' { return 'Activate Illustrator' }
        'ActivateBlender' { return 'Activate Blender' }
        'ActivatePhotoshop' { return 'Activate Photoshop' }
        'ActivateWindows' { return 'Activate Windows' }
        'Click' {
            if ([string]$Step.Button -ieq 'Right') { return 'Right Click at {0},{1}' -f $Step.X, $Step.Y }
            return 'Click {0} at {1},{2}' -f $Step.Button, $Step.X, $Step.Y
        }
        'RightClick' { return 'Right Click at {0},{1}' -f $Step.X, $Step.Y }
        'Wheel' { return 'Wheel {0} at {1},{2} x{3}' -f $Step.Direction, $Step.X, $Step.Y, $Step.Count }
        'Text' { return 'Text: {0}' -f $Step.Text }
        'Key' { return 'Keys: {0}' -f $Step.Keys }
        'Script' { return 'Script: {0}' -f $Step.ScriptPath }
        'Macro' { return 'Macro: {0}' -f [System.IO.Path]::GetFileNameWithoutExtension([string]$Step.MacroPath) }
        default { return $Step.Type }
    }
}

function ConvertTo-FlowCellConfigList($Value) {
    $items = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Value) { return @() }

    if ($Value -is [System.Array]) {
        foreach ($entry in @($Value)) {
            $text = [string]$entry
            if (-not [string]::IsNullOrWhiteSpace($text)) {
                [void]$items.Add($text.Trim())
            }
        }
        return @($items | Select-Object -Unique)
    }

    foreach ($entry in ([string]$Value -split '[|;]')) {
        if (-not [string]::IsNullOrWhiteSpace([string]$entry)) {
            [void]$items.Add(([string]$entry).Trim())
        }
    }
    return @($items | Select-Object -Unique)
}

function Get-ProgramLabelKey([string]$Label) {
    $normalizedLabel = if ($null -eq $Label) { '' } else { $Label.Trim().ToLowerInvariant() }
    switch -Regex ($normalizedLabel) {
        'illustrator' { return 'illustrator' }
        'blender' { return 'blender' }
        'photoshop' { return 'photoshop' }
        '^windows$' { return 'windows' }
        default { return (($normalizedLabel -replace '[^a-z0-9]+', '_').Trim('_')) }
    }
}

function Get-FlowCellProgramStorageName([string]$ProgramName) {
    $safeName = (($ProgramName -replace '[^A-Za-z0-9]+', '_').Trim('_'))
    if ([string]::IsNullOrWhiteSpace($safeName)) { return 'Program' }
    return $safeName
}

function Get-FlowCellProgramTemplateKey([string]$ProgramName, [string]$ExePath = '') {
    $normalizedExePath = [string]$ExePath
    if (-not [string]::IsNullOrWhiteSpace($normalizedExePath)) {
        $exeName = ''
        try {
            $normalizedExePath = [System.IO.Path]::GetFullPath($normalizedExePath).ToLowerInvariant()
            $exeName = [System.IO.Path]::GetFileNameWithoutExtension($normalizedExePath)
        }
        catch {
            $normalizedExePath = $normalizedExePath.Trim().ToLowerInvariant()
            try {
                $exeName = [System.IO.Path]::GetFileNameWithoutExtension($normalizedExePath)
            }
            catch {
                $exeName = ''
            }
        }

        switch -Regex ($normalizedExePath) {
            '(^|\\)blender(\.exe)?$' { return 'blender' }
            '(^|\\)illustrator(\.exe)?$' { return 'illustrator' }
            '(^|\\)photoshop(\.exe)?$' { return 'photoshop' }
        }

        if (-not [string]::IsNullOrWhiteSpace($exeName)) {
            $normalizedExeName = $exeName.Trim().ToLowerInvariant()
            if ($normalizedExeName.Contains('blender')) { return 'blender' }
            if ($normalizedExeName.Contains('illustrator')) { return 'illustrator' }
            if ($normalizedExeName.Contains('photoshop')) { return 'photoshop' }
            if ($normalizedExeName.Contains('explorer')) { return 'windows' }
        }
    }

    return (Get-ProgramLabelKey $ProgramName)
}

function Get-FlowCellSuggestedProgramNameFromExecutable([string]$ExePath) {
    if ([string]::IsNullOrWhiteSpace($ExePath)) { return '' }
    switch (Get-FlowCellProgramTemplateKey -ProgramName '' -ExePath $ExePath) {
        'blender' { return 'Blender' }
        'illustrator' { return 'Illustrator' }
        'photoshop' { return 'Photoshop' }
        'windows' { return 'Windows' }
    }

    try {
        $stem = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFullPath($ExePath))
    }
    catch {
        $stem = [System.IO.Path]::GetFileNameWithoutExtension([string]$ExePath)
    }

    if ([string]::IsNullOrWhiteSpace($stem)) { return '' }
    $displayName = ($stem -replace '[_\-]+', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($displayName)) { return '' }
    return [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ToTitleCase($displayName.ToLowerInvariant())
}

function Get-FlowCellProgramExecutableProcessNames([string]$ExePath) {
    if ([string]::IsNullOrWhiteSpace($ExePath)) { return @() }
    try {
        $fileName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFullPath($ExePath))
        if (-not [string]::IsNullOrWhiteSpace($fileName)) {
            return @($fileName.Trim().ToLowerInvariant())
        }
    }
    catch {
    }
    return @()
}

function Get-FlowCellProgramDefaultPanels([string]$ProgramName, [string]$ProgramType = '', [string]$ExePath = '') {
    switch (Get-FlowCellProgramTemplateKey $ProgramName $ExePath) {
        'blender' { return @('Collections', 'Files', 'Utility') }
        'illustrator' { return @('Layers', 'Files', 'Utility') }
        'photoshop' { return @('Layers', 'Files', 'Utility') }
        default {
            if ([string]$ProgramType -eq 'generic') {
                return @('Files', 'Utility')
            }
            return @('Layers', 'Files', 'Utility')
        }
    }
}

function New-FlowCellProgramTab {
    param(
        [int]$Id,
        [string]$Label,
        [string]$ScriptFolder = '',
        [string]$ProgramType = '',
        [string]$ExePath = '',
        [string]$RunMethod = '',
        $AllowedScriptExtensions = @(),
        [string]$BridgeFolder = '',
        [bool]$RequiresRestart = $false,
        $DefaultPanels = @(),
        $ProcessNames = @(),
        [string]$NormalizedName = ''
    )

    $resolvedLabel = [string]$Label
    if ([string]::IsNullOrWhiteSpace($resolvedLabel)) {
        $resolvedLabel = 'program_{0}' -f $Id
    }
    $resolvedNormalizedName = if ([string]::IsNullOrWhiteSpace($NormalizedName)) { $resolvedLabel.Trim().ToLowerInvariant() } else { [string]$NormalizedName.Trim().ToLowerInvariant() }
    $resolvedProgramType = [string]$ProgramType
    if ([string]::IsNullOrWhiteSpace($resolvedProgramType)) {
        switch (Get-FlowCellProgramTemplateKey $resolvedLabel $ExePath) {
            'illustrator' { $resolvedProgramType = 'adobe_direct_script_runner' }
            'photoshop' { $resolvedProgramType = 'adobe_direct_script_runner' }
            'blender' { $resolvedProgramType = 'bridge_runner' }
            default { $resolvedProgramType = 'generic' }
        }
    }
    $resolvedRunMethod = [string]$RunMethod
    if ([string]::IsNullOrWhiteSpace($resolvedRunMethod)) {
        switch (Get-FlowCellProgramTemplateKey $resolvedLabel) {
            'illustrator' { $resolvedRunMethod = 'illustrator_direct' }
            'photoshop' { $resolvedRunMethod = 'photoshop_direct' }
            'blender' { $resolvedRunMethod = 'blender_bridge' }
            default { $resolvedRunMethod = 'generic' }
        }
    }
    $resolvedAllowedScriptExtensions = @(ConvertTo-FlowCellConfigList $AllowedScriptExtensions)
    if (@($resolvedAllowedScriptExtensions).Count -eq 0 -and ($resolvedProgramType -eq 'adobe_direct_script_runner')) {
        $resolvedAllowedScriptExtensions = @('.jsx', '.js')
    }
    $resolvedDefaultPanels = @(ConvertTo-FlowCellConfigList $DefaultPanels)
    if (@($resolvedDefaultPanels).Count -eq 0) {
        $resolvedDefaultPanels = @(Get-FlowCellProgramDefaultPanels -ProgramName $resolvedLabel -ProgramType $resolvedProgramType -ExePath $ExePath)
    }
    $resolvedProcessNames = @(ConvertTo-FlowCellConfigList $ProcessNames)
    if (@($resolvedProcessNames).Count -eq 0) {
        $resolvedProcessNames = @(Get-FlowCellProgramExecutableProcessNames -ExePath $ExePath)
    }
    if (@($resolvedProcessNames).Count -eq 0) {
        switch (Get-FlowCellProgramTemplateKey $resolvedLabel $ExePath) {
            'illustrator' { $resolvedProcessNames = @('illustrator') }
            'blender' { $resolvedProcessNames = @('blender', 'blender-launcher') }
            'photoshop' { $resolvedProcessNames = @('photoshop') }
            'windows' { $resolvedProcessNames = @('explorer', 'dopus', 'dopusrt') }
            default { $resolvedProcessNames = @() }
        }
    }

    return [pscustomobject]@{
        Id = [int]$Id
        Label = $resolvedLabel
        NormalizedName = $resolvedNormalizedName
        ScriptFolder = [string]$ScriptFolder
        ProgramType = $resolvedProgramType
        ExePath = [string]$ExePath
        RunMethod = $resolvedRunMethod
        AllowedScriptExtensions = @($resolvedAllowedScriptExtensions)
        BridgeFolder = [string]$BridgeFolder
        RequiresRestart = [bool]$RequiresRestart
        DefaultPanels = @($resolvedDefaultPanels)
        ProcessNames = @($resolvedProcessNames)
    }
}

function Get-DefaultProgramTabs {
    return @(
        (New-FlowCellProgramTab -Id 1 -Label 'Illustrator' -ScriptFolder $script:IllustratorScriptsDir -ProgramType 'adobe_direct_script_runner' -RunMethod 'illustrator_direct' -AllowedScriptExtensions @('.jsx', '.js') -DefaultPanels @('Layers', 'Files', 'Utility')),
        (New-FlowCellProgramTab -Id 2 -Label 'Windows' -ScriptFolder $script:WindowsScriptsDir -ProgramType 'generic' -RunMethod 'generic' -DefaultPanels @('Files', 'Utility')),
        (New-FlowCellProgramTab -Id 3 -Label 'Blender' -ScriptFolder (Get-FlowCellBlenderScriptsFolder) -ProgramType 'bridge_runner' -RunMethod 'blender_bridge' -AllowedScriptExtensions @('.ps1', '.py', '.blend', '.exe', '.lnk') -BridgeFolder (Join-Path $script:FlowCellHomeRoot 'Programs\Blender') -DefaultPanels @('Collections', 'Files', 'Utility')),
        (New-FlowCellProgramTab -Id 4 -Label 'Photoshop' -ScriptFolder $script:PhotoshopScriptsDir -ProgramType 'adobe_direct_script_runner' -RunMethod 'photoshop_direct' -AllowedScriptExtensions @('.jsx', '.js') -DefaultPanels @('Layers', 'Files', 'Utility'))
    )
}

function Get-FlowCellProgramConfig($ProgramTab, $ProgramConfig = $null) {
    $label = if ($ProgramTab -and $ProgramTab.PSObject.Properties['Label']) { [string]$ProgramTab.Label } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['NormalizedName']) { [string]$ProgramConfig.NormalizedName } else { '' }
    $programType = if ($ProgramTab -and $ProgramTab.PSObject.Properties['ProgramType']) { [string]$ProgramTab.ProgramType } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['ProgramType']) { [string]$ProgramConfig.ProgramType } else { '' }
    $resolvedExePath = if ($ProgramTab -and $ProgramTab.PSObject.Properties['ExePath']) { [string]$ProgramTab.ExePath } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['ExePath']) { [string]$ProgramConfig.ExePath } else { '' }
    if ([string]::IsNullOrWhiteSpace($programType)) {
        switch (Get-FlowCellProgramTemplateKey $label $resolvedExePath) {
            'illustrator' { $programType = 'adobe_direct_script_runner' }
            'photoshop' { $programType = 'adobe_direct_script_runner' }
            'blender' { $programType = 'bridge_runner' }
            'windows' { $programType = 'generic' }
            default { $programType = 'generic' }
        }
    }

    $runMethod = if ($ProgramTab -and $ProgramTab.PSObject.Properties['RunMethod']) { [string]$ProgramTab.RunMethod } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['RunMethod']) { [string]$ProgramConfig.RunMethod } else { '' }
    if ([string]::IsNullOrWhiteSpace($runMethod)) {
        switch (Get-FlowCellProgramTemplateKey $label $resolvedExePath) {
            'illustrator' { $runMethod = 'illustrator_direct' }
            'photoshop' { $runMethod = 'photoshop_direct' }
            'blender' { $runMethod = 'blender_bridge' }
            default { $runMethod = 'generic' }
        }
    }

    $allowedScriptExtensions = if ($ProgramTab -and $ProgramTab.PSObject.Properties['AllowedScriptExtensions']) {
        @(ConvertTo-FlowCellConfigList $ProgramTab.AllowedScriptExtensions)
    }
    elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['AllowedScriptExtensions']) {
        @(ConvertTo-FlowCellConfigList $ProgramConfig.AllowedScriptExtensions)
    }
    else {
        @()
    }
    if (@($allowedScriptExtensions).Count -eq 0) {
        switch (Get-FlowCellProgramTemplateKey $label $resolvedExePath) {
            'illustrator' { $allowedScriptExtensions = @('.jsx', '.js') }
            'photoshop' { $allowedScriptExtensions = @('.jsx', '.js') }
            'blender' { $allowedScriptExtensions = @('.ps1', '.py', '.blend', '.exe', '.lnk') }
            default { $allowedScriptExtensions = @() }
        }
    }

    $defaultPanels = if ($ProgramTab -and $ProgramTab.PSObject.Properties['DefaultPanels']) {
        @(ConvertTo-FlowCellConfigList $ProgramTab.DefaultPanels)
    }
    elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['DefaultPanels']) {
        @(ConvertTo-FlowCellConfigList $ProgramConfig.DefaultPanels)
    }
    else {
        @()
    }
    if (@($defaultPanels).Count -eq 0) {
        $defaultPanels = @(Get-FlowCellProgramDefaultPanels -ProgramName $label -ProgramType $programType -ExePath $resolvedExePath)
    }

    $processNames = if ($ProgramTab -and $ProgramTab.PSObject.Properties['ProcessNames']) {
        @(ConvertTo-FlowCellConfigList $ProgramTab.ProcessNames)
    }
    elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['ProcessNames']) {
        @(ConvertTo-FlowCellConfigList $ProgramConfig.ProcessNames)
    }
    else {
        @()
    }
    if (@($processNames).Count -eq 0 -and $ProgramTab -and $ProgramTab.PSObject.Properties['ExePath']) {
        $processNames = @(Get-FlowCellProgramExecutableProcessNames -ExePath ([string]$ProgramTab.ExePath))
    }
    if (@($processNames).Count -eq 0) {
        $processNames = @(Get-FlowCellProgramExecutableProcessNames -ExePath $(if ($ProgramConfig -and $ProgramConfig.PSObject.Properties['ExePath']) { [string]$ProgramConfig.ExePath } else { '' }))
    }

    $tabValue = if ($ProgramTab) { $ProgramTab } else { $null }
    return [pscustomobject]@{
        NormalizedName = if ($ProgramTab -and $ProgramTab.PSObject.Properties['NormalizedName']) { [string]$ProgramTab.NormalizedName } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['NormalizedName']) { [string]$ProgramConfig.NormalizedName } else { $label.Trim().ToLowerInvariant() }
        ProgramType = $programType
        ExePath = $resolvedExePath
        ScriptFolder = if ($ProgramTab -and $ProgramTab.PSObject.Properties['ScriptFolder']) { [string]$ProgramTab.ScriptFolder } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['ScriptFolder']) { [string]$ProgramConfig.ScriptFolder } else { '' }
        RunMethod = $runMethod
        AllowedScriptExtensions = @($allowedScriptExtensions)
        BridgeFolder = if ($ProgramTab -and $ProgramTab.PSObject.Properties['BridgeFolder']) { [string]$ProgramTab.BridgeFolder } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['BridgeFolder']) { [string]$ProgramConfig.BridgeFolder } else { '' }
        RequiresRestart = [bool]$(if ($ProgramTab -and $ProgramTab.PSObject.Properties['RequiresRestart']) { $ProgramTab.RequiresRestart } elseif ($ProgramConfig -and $ProgramConfig.PSObject.Properties['RequiresRestart']) { $ProgramConfig.RequiresRestart } else { $false })
        DefaultPanels = @($defaultPanels)
        ProcessNames = @($processNames)
    }
}

function Get-FlowCellProgramProcessNames {
    param(
        [Alias('ProgramLabel')]
        $ProgramReference
    )
    $programTab = $null
    if ($null -ne $ProgramReference -and $ProgramReference.PSObject.Properties['Label']) {
        $programTab = $ProgramReference
    }
    elseif ($ProgramReference -is [int]) {
        $programTab = Get-FlowCellProgramTab -ProgramTabId ([int]$ProgramReference)
    }
    elseif (-not [string]::IsNullOrWhiteSpace([string]$ProgramReference)) {
        $programLabel = [string]$ProgramReference
        $programTab = @($(if ($script:State -and $script:State.PSObject.Properties['ProgramTabs']) { $script:State.ProgramTabs } else { @() }) | Where-Object { [string]$_.Label -eq $programLabel } | Select-Object -First 1)
        if (@($programTab).Count -gt 0) {
            $programTab = $programTab[0]
        }
        else {
            $programTab = New-FlowCellProgramTab -Id 0 -Label $programLabel
        }
    }

    $programConfig = Get-FlowCellProgramConfig -ProgramTab $programTab
    if (@($programConfig.ProcessNames).Count -gt 0) {
        return @($programConfig.ProcessNames | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    }

    return @()
}

function Test-FlowCellProgramRunning([string]$ProgramLabel) {
    $processNames = @(Get-FlowCellProgramProcessNames -ProgramLabel $ProgramLabel)
    if (@($processNames).Count -eq 0) { return $false }
    try {
        $matchingProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            @($processNames) -contains ([string]$_.ProcessName).ToLowerInvariant()
        })
        return (@($matchingProcesses).Count -gt 0)
    }
    catch {
        return $false
    }
}

function Test-FlowCellProgramForeground($ProgramTab) {
    if ($null -eq $ProgramTab) { return $false }
    $processNames = @(Get-FlowCellProgramProcessNames -ProgramLabel ([string]$ProgramTab.Label))
    if (@($processNames).Count -eq 0) { return $false }
    try {
        $foregroundProcessId = [CodexWin32]::GetForegroundProcessId()
        if ($foregroundProcessId -gt 0) {
            $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction Stop
            if (@($processNames) -contains ([string]$foregroundProcess.ProcessName).ToLowerInvariant()) {
                return $true
            }
        }

        return $false
    }
    catch {
        return $false
    }
}

function Test-FlowCellWindowForeground($Window) {
    if ($null -eq $Window) { return $false }
    try {
        $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $handle = $interopHelper.Handle
        if ($handle -eq [IntPtr]::Zero) { return $false }
        return ([CodexWin32]::GetForegroundWindowHandle() -eq $handle.ToInt64())
    }
    catch {
        return $false
    }
}

function Test-FlowCellProgramUsesExternalOwner($ProgramTab) {
    if ($null -eq $ProgramTab) { return $false }
    switch (Get-ProgramLabelKey ([string]$ProgramTab.Label)) {
        'illustrator' { return [bool]$script:FlowCellUseExternalProgramWindowOwners }
        default { return [bool]$script:FlowCellUseExternalProgramWindowOwners }
    }
}

function Get-FlowCellProgramVisibleWindows($ProgramTab) {
    if ($null -eq $ProgramTab) { return @() }
    $processNames = @(Get-FlowCellProgramProcessNames -ProgramLabel ([string]$ProgramTab.Label))
    if (@($processNames).Count -eq 0) { return @() }

    try {
        $processIds = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            @($processNames) -contains ([string]$_.ProcessName).ToLowerInvariant()
        } | ForEach-Object { [int]$_.Id })
        if (@($processIds).Count -eq 0) { return @() }

        return @([CodexWin32]::GetVisibleWindowsForProcesses([int[]]$processIds) | Where-Object {
            -not [string]::IsNullOrWhiteSpace([string]$_.Title)
        })
    }
    catch {
        return @()
    }
}

function Find-FlowCellVisibleWindowByHandle([object[]]$Windows, [long]$Handle) {
    if ($Handle -eq 0) { return $null }
    foreach ($window in @($Windows)) {
        if ($null -eq $window) { continue }
        if ([long]$window.Handle -eq $Handle) {
            return $window
        }
    }

    return $null
}

function Get-FlowCellProgramOwnerWindowHandle {
    param(
        $ProgramTab,
        [long]$CurrentOwnerHandle = 0
    )

    if (-not (Test-FlowCellProgramUsesExternalOwner $ProgramTab)) { return 0 }
    if ($null -eq $ProgramTab) { return 0 }
    $programKey = Get-ProgramLabelKey ([string]$ProgramTab.Label)
    $windows = @(Get-FlowCellProgramVisibleWindows $ProgramTab)
    if (@($windows).Count -eq 0) { return 0 }

    $currentOwnerWindow = Find-FlowCellVisibleWindowByHandle -Windows $windows -Handle $CurrentOwnerHandle
    $foregroundHandle = 0L
    $foregroundWindow = $null

    try {
        if (Test-FlowCellProgramForeground $ProgramTab) {
            $foregroundHandle = [long][CodexWin32]::GetForegroundWindowHandle()
            $foregroundWindow = Find-FlowCellVisibleWindowByHandle -Windows $windows -Handle $foregroundHandle
        }
    }
    catch {
    }

    switch ($programKey) {
        'illustrator' {
            if ($foregroundWindow -and (Test-IsIllustratorDocumentTitle ([string]$foregroundWindow.Title))) {
                return [long]$foregroundWindow.Handle
            }
            if ($currentOwnerWindow) {
                return [long]$currentOwnerWindow.Handle
            }

            $documentCandidate = @($windows | Where-Object { Test-IsIllustratorDocumentTitle ([string]$_.Title) } | Select-Object -First 1)
            if (@($documentCandidate).Count -gt 0) {
                return [long]$documentCandidate[0].Handle
            }
            if ($foregroundWindow) {
                return [long]$foregroundWindow.Handle
            }
            return [long]$windows[0].Handle
        }
        default {
            if ($foregroundWindow) {
                return [long]$foregroundWindow.Handle
            }
            if ($currentOwnerWindow) {
                return [long]$currentOwnerWindow.Handle
            }
            return [long]$windows[0].Handle
        }
    }
}

function Initialize-FlowCellTaskbarGrouping {
    try {
        if ([string]::IsNullOrWhiteSpace([string]$script:FlowCellTaskbarAppId)) { return }
        [void][CodexWin32]::SetCurrentProcessExplicitAppUserModelID([string]$script:FlowCellTaskbarAppId)
        Write-UiLog ('FlowCell taskbar AppUserModelID initialized: {0}' -f [string]$script:FlowCellTaskbarAppId)
    }
    catch {
        Write-UiLog ('FlowCell taskbar AppUserModelID initialization failed: {0}' -f $_.Exception.ToString())
    }
}

function Set-FlowCellWindowTopmostState($Window, [bool]$IsTopmost) {
    if ($null -eq $Window) { return }
    try {
        $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $handle = $interopHelper.Handle
        if ($handle -eq [IntPtr]::Zero) { return }
        [CodexWin32]::SetTopmost($handle.ToInt64(), $IsTopmost)
        $Window.Topmost = $IsTopmost
    }
    catch {
    }
}

function Set-FlowCellWindowOwnerHandle($Window, [long]$OwnerHandle) {
    if ($null -eq $Window) { return }
    try {
        $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $handle = $interopHelper.Handle
        if ($handle -eq [IntPtr]::Zero) { return }
        if ([CodexWin32]::GetOwner($handle.ToInt64()) -eq $OwnerHandle) { return }
        [CodexWin32]::SetOwner($handle.ToInt64(), $OwnerHandle)
    }
    catch {
    }
}

function Get-FlowCellWindowHandle($Window) {
    if ($null -eq $Window) { return 0 }
    try {
        $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $handle = $interopHelper.Handle
        if ($handle -eq [IntPtr]::Zero) { return 0 }
        return [long]$handle.ToInt64()
    }
    catch {
        return 0
    }
}

function Register-FlowCellTaskbarPreviewTab($Window) {
    if ($null -eq $Window -or -not $script:FlowCellWindow) { return }
    try {
        try {
            if ([bool]$Window.Resources['FlowCellTaskbarPreviewTabRegistered']) { return }
        }
        catch {
        }
        $childHandle = Get-FlowCellWindowHandle $Window
        $ownerHandle = Get-FlowCellWindowHandle $script:FlowCellWindow
        if ($childHandle -eq 0 -or $ownerHandle -eq 0 -or $childHandle -eq $ownerHandle) { return }
        [FlowCellTaskbarTabs]::RegisterTab($childHandle, $ownerHandle)
        try { $Window.Resources['FlowCellTaskbarPreviewTabRegistered'] = $true } catch {}
        Write-UiLog ('Registered FlowCell taskbar preview tab. Title={0}; Hwnd={1}; Owner={2}' -f [string]$Window.Title, $childHandle, $ownerHandle)
    }
    catch {
        Write-UiLog ('FlowCell taskbar preview tab registration failed. Title={0}; Error={1}' -f $(if ($Window) { [string]$Window.Title } else { '' }), $_.Exception.ToString())
    }
}

function Unregister-FlowCellTaskbarPreviewTab($Window) {
    if ($null -eq $Window) { return }
    try {
        try {
            if (-not [bool]$Window.Resources['FlowCellTaskbarPreviewTabRegistered']) { return }
        }
        catch {
        }
        $childHandle = Get-FlowCellWindowHandle $Window
        if ($childHandle -eq 0) { return }
        [FlowCellTaskbarTabs]::UnregisterTab($childHandle)
        try { $Window.Resources['FlowCellTaskbarPreviewTabRegistered'] = $false } catch {}
        Write-UiLog ('Unregistered FlowCell taskbar preview tab. Title={0}; Hwnd={1}' -f [string]$Window.Title, $childHandle)
    }
    catch {
        Write-UiLog ('FlowCell taskbar preview tab unregister failed. Title={0}; Error={1}' -f $(if ($Window) { [string]$Window.Title } else { '' }), $_.Exception.ToString())
    }
}

function Push-FlowCellWindowAboveOwner($Window) {
    if ($null -eq $Window) { return }
    try {
        $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $handle = $interopHelper.Handle
        if ($handle -eq [IntPtr]::Zero) { return }
        [CodexWin32]::PlaceNormalTop($handle.ToInt64())
    }
    catch {
    }
}

function Invoke-FlowCellWindowFrontPulse($Window) {
    if ($null -eq $Window) { return }
    try {
        if ($Window.WindowState -eq 'Minimized') {
            $Window.WindowState = 'Normal'
        }
        $Window.Show()
        $Window.Activate() | Out-Null
        Push-FlowCellWindowAboveOwner -Window $Window
    }
    catch {
    }
}

function Update-FlowCellPopoutWindowOwnership($Window, $ProgramTab, $WindowEntry) {
    if ($null -eq $Window -or $null -eq $ProgramTab -or $null -eq $WindowEntry) {
        return [pscustomobject]@{
            OwnerChanged = $false
            OwnerHandle = 0L
        }
    }

    $currentOwnerHandle = [long]$(if ($WindowEntry.PSObject.Properties['CurrentOwnerHandle']) { $WindowEntry.CurrentOwnerHandle } else { 0 })
    $ownerHandle = [long](Get-FlowCellProgramOwnerWindowHandle -ProgramTab $ProgramTab -CurrentOwnerHandle $currentOwnerHandle)
    $ownerChanged = ($currentOwnerHandle -ne $ownerHandle)
    if ($ownerChanged) {
        Set-FlowCellWindowOwnerHandle -Window $Window -OwnerHandle $ownerHandle
        if ($WindowEntry.PSObject.Properties['CurrentOwnerHandle']) {
            $WindowEntry.CurrentOwnerHandle = $ownerHandle
        }
    }

    $windowIsTopmost = $false
    try {
        $windowIsTopmost = [bool]$Window.Topmost
    }
    catch {
    }

    if (($WindowEntry.PSObject.Properties['CurrentTopmost'] -and [bool]$WindowEntry.CurrentTopmost) -or $windowIsTopmost) {
        Set-FlowCellWindowTopmostState -Window $Window -IsTopmost $false
        $WindowEntry.CurrentTopmost = $false
    }

    return [pscustomobject]@{
        OwnerChanged = [bool]$ownerChanged
        OwnerHandle = [long]$ownerHandle
    }
}

function Set-FlowCellWindowEnabledState($Window, [bool]$IsEnabled) {
    if ($null -eq $Window) { return }
    try {
        $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $handle = $interopHelper.Handle
        if ($handle -eq [IntPtr]::Zero) { return }
        [CodexWin32]::SetEnabled($handle.ToInt64(), $IsEnabled)
        $Window.IsEnabled = $IsEnabled
    }
    catch {
    }
}

function Enable-FlowCellTaskbarCloseSupport($Window) {
    if ($null -eq $Window) { return }
    $wmClose = 0x0010
    $wmSysCommand = 0x0112
    $scClose = 0xF060
    $Window.Add_SourceInitialized({
        try {
            $interopHelper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
            $handle = $interopHelper.Handle
            if ($handle -eq [IntPtr]::Zero) { return }
            $source = [System.Windows.Interop.HwndSource]::FromHwnd($handle)
            if ($null -eq $source) { return }
            $hook = [System.Windows.Interop.HwndSourceHook]{
                param($hwnd, $msg, $wParam, $lParam, [ref]$handled)
                $messageId = [int64]$msg
                $commandId = [int64]$wParam
                if ($messageId -ne $wmClose -and -not ($messageId -eq $wmSysCommand -and (($commandId -band 0xFFF0) -eq $scClose))) {
                    return [IntPtr]::Zero
                }
                $handled.Value = $true
                try {
                    $closeAction = [System.Action]{
                        try {
                            if ($Window -and $Window.IsLoaded -and [string]$Window.Tag -ne 'closing' -and [string]$Window.Tag -ne 'shutdown') {
                                $Window.Close()
                            }
                        }
                        catch {
                        }
                    }
                    [void]$Window.Dispatcher.BeginInvoke($closeAction, [System.Windows.Threading.DispatcherPriority]::Normal)
                }
                catch {
                }
                return [IntPtr]::Zero
            }
            $source.AddHook($hook)
            try {
                $Window.Resources['FlowCellTaskbarCloseHook'] = $hook
            }
            catch {
            }
        }
        catch {
        }
    }.GetNewClosure())
}

function Get-FlowCellBlenderScriptsFolder {
    return (Join-Path $script:FlowCellHomeRoot 'Programs\Blender\Blender Git Scripts')
}

function Get-FlowCellBlenderSupportFolder {
    return (Join-Path $script:FlowCellHomeRoot 'Programs\Blender\SupportScripts')
}

function Test-FlowCellPathUnderScriptDump([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }

    try {
        $currentPath = [System.IO.Path]::GetFullPath([string]$Path)
    }
    catch {
        return $false
    }

    while (-not [string]::IsNullOrWhiteSpace($currentPath)) {
        $leafName = Split-Path -Path $currentPath -Leaf
        if ([string]$leafName -ieq 'ScriptDump') {
            return $true
        }

        $parentPath = Split-Path -Path $currentPath -Parent
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }

        $currentPath = $parentPath
    }

    return $false
}

function Test-FlowCellBlenderLegacyScriptPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $normalizedPath = Get-FlowCellNormalizedPath $Path
    $managedFolder = Get-FlowCellNormalizedPath (Get-FlowCellBlenderScriptsFolder)
    if ($managedFolder -and $normalizedPath -eq $managedFolder) { return $false }

    $legacyRepoFolder = Get-FlowCellNormalizedPath (Join-Path $script:FlowCellHomeRoot 'Blender')
    if ($legacyRepoFolder -and $normalizedPath -eq $legacyRepoFolder) { return $true }

    $legacyLocalFolder = Get-FlowCellNormalizedPath (Join-Path $script:FlowCellLocalAppDataRoot 'Programs\Blender\Scripts')
    if ($legacyLocalFolder -and $normalizedPath -eq $legacyLocalFolder) { return $true }

    return ($normalizedPath -match '\\appdata\\roaming\\blender foundation\\blender\\[^\\]+\\scripts\\addons(?:\\.*)?$')
}

function Get-ProgramDefaultScriptFolder([string]$Label) {
    switch (Get-ProgramLabelKey $Label) {
        'illustrator' { return $script:IllustratorScriptsDir }
        'blender' { return (Get-FlowCellBlenderScriptsFolder) }
        'photoshop' { return $script:PhotoshopScriptsDir }
        'windows' { return $script:WindowsScriptsDir }
        default { return $script:ProjectRoot }
    }
}

function Get-FlowCellProgramsRoot {
    return (Ensure-FlowCellDirectory -Path (Join-Path $script:FlowCellHomeRoot 'Programs'))
}

function Test-FlowCellValidFolderName([string]$Name) {
    $resolvedName = [string]$Name
    if ([string]::IsNullOrWhiteSpace($resolvedName)) { return $false }
    $resolvedName = $resolvedName.Trim()
    if ($resolvedName -eq '.' -or $resolvedName -eq '..') { return $false }
    return ($resolvedName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -lt 0)
}

function Get-FlowCellChildDirectoryItems([string]$RootPath) {
    if ([string]::IsNullOrWhiteSpace($RootPath) -or -not (Test-Path -LiteralPath $RootPath -PathType Container)) {
        return @()
    }

    return @(
        Get-ChildItem -LiteralPath $RootPath -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name |
            ForEach-Object {
                [pscustomobject]@{
                    Name = [string]$_.Name
                    Path = [string]$_.FullName
                }
            }
    )
}

function Get-FlowCellNamedChildDirectory([string]$RootPath, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($RootPath) -or [string]::IsNullOrWhiteSpace($Name) -or -not (Test-Path -LiteralPath $RootPath -PathType Container)) {
        return $null
    }

    $match = @(
        Get-ChildItem -LiteralPath $RootPath -Directory -ErrorAction SilentlyContinue |
            Where-Object { [string]$_.Name -ieq [string]$Name } |
            Select-Object -First 1
    )
    if (@($match).Count -eq 0) { return $null }
    return $match[0]
}

function Get-FlowCellProgramFolderPath([string]$ProgramName, [switch]$Create) {
    $programsRoot = Get-FlowCellProgramsRoot
    $existing = Get-FlowCellNamedChildDirectory -RootPath $programsRoot -Name $ProgramName
    if ($existing) { return [string]$existing.FullName }
    if (-not $Create) { return '' }
    return [string](Ensure-FlowCellDirectory -Path (Join-Path $programsRoot ([string]$ProgramName)))
}

function Get-FlowCellProgramPanelsRoot([string]$ProgramName, [switch]$Create) {
    $programFolder = Get-FlowCellProgramFolderPath -ProgramName $ProgramName -Create:$Create
    if ([string]::IsNullOrWhiteSpace($programFolder)) { return '' }
    $panelsRoot = Join-Path $programFolder 'panels'
    if ($Create) {
        return [string](Ensure-FlowCellDirectory -Path $panelsRoot)
    }
    if (Test-Path -LiteralPath $panelsRoot -PathType Container) {
        return [string]$panelsRoot
    }
    return ''
}

function Get-FlowCellPanelFolderPath([string]$ProgramName, [string]$PanelName, [switch]$Create) {
    $panelsRoot = Get-FlowCellProgramPanelsRoot -ProgramName $ProgramName -Create:$Create
    if ([string]::IsNullOrWhiteSpace($panelsRoot)) { return '' }
    $existing = Get-FlowCellNamedChildDirectory -RootPath $panelsRoot -Name $PanelName
    if ($existing) { return [string]$existing.FullName }
    if (-not $Create) { return '' }
    return [string](Ensure-FlowCellDirectory -Path (Join-Path $panelsRoot ([string]$PanelName)))
}

function Get-FlowCellProgramRailTabs {
    if (-not $script:State) { return @() }

    $programsRoot = Get-FlowCellProgramsRoot
    $didStateChange = $false
    $didFlowCellStateChange = $false
    $existingProgramFolders = @(Get-FlowCellChildDirectoryItems -RootPath $programsRoot)
    $retainedProgramTabs = @()
    foreach ($programTab in @($script:State.ProgramTabs)) {
        if ($null -eq $programTab -or [string]::IsNullOrWhiteSpace([string]$programTab.Label)) {
            $didStateChange = $true
            continue
        }
        if (-not (Get-FlowCellNamedChildDirectory -RootPath $programsRoot -Name ([string]$programTab.Label))) {
            $didStateChange = $true
            continue
        }
        $retainedProgramTabs += $programTab
    }
    if ($didStateChange) {
        $script:State.ProgramTabs = @($retainedProgramTabs)
    }
    if ($script:FlowCellState -and $script:FlowCellState.PSObject.Properties['Programs']) {
        $validProgramTabIds = @($script:State.ProgramTabs | ForEach-Object { [int]$_.Id })
        $retainedPrograms = @(
            foreach ($program in @($script:FlowCellState.Programs)) {
                if ($null -eq $program) {
                    $didFlowCellStateChange = $true
                    continue
                }
                if (@($validProgramTabIds) -contains [int]$program.ProgramTabId) {
                    $program
                }
                else {
                    $didFlowCellStateChange = $true
                }
            }
        )
        if ($didFlowCellStateChange) {
            $script:FlowCellState.Programs = @($retainedPrograms)
        }
    }

    $railTabs = @()
    foreach ($folder in @($existingProgramFolders)) {
        $existing = @($script:State.ProgramTabs | Where-Object { [string]$_.Label -ieq [string]$folder.Name } | Select-Object -First 1)
        $programTab = $null
        if (@($existing).Count -gt 0) {
            $programTab = $existing[0]
        }
        else {
            $result = Add-FlowCellProgramTab -ProgramName ([string]$folder.Name) -ExePath '' -Persist:$false -SelectCreatedProgram:$false
            if (-not [bool]$result.Succeeded -or $null -eq $result.ProgramTab) {
                Write-UiLog ('Program rail skipped folder because a matching program tab could not be created. Folder={0}; Message={1}' -f [string]$folder.Name, [string]$result.Message)
                continue
            }
            $programTab = $result.ProgramTab
            $didStateChange = $true
            $didFlowCellStateChange = $true
        }
        $railTabs += $programTab
    }

    if (@($railTabs).Count -gt 0) {
        $selectedProgramTabId = if ($script:FlowCellState -and $script:FlowCellState.PSObject.Properties['SelectedProgramTabId']) {
            [int]$script:FlowCellState.SelectedProgramTabId
        }
        else {
            [int]$script:State.SelectedProgramTabId
        }
        if (-not (@($railTabs).Id -contains $selectedProgramTabId)) {
            $script:State.SelectedProgramTabId = [int]$railTabs[0].Id
            $didStateChange = $true
            if ($script:FlowCellState) {
                $script:FlowCellState.SelectedProgramTabId = [int]$railTabs[0].Id
                $didFlowCellStateChange = $true
            }
        }
    }
    else {
        if ([int]$script:State.SelectedProgramTabId -ne 0) {
            $script:State.SelectedProgramTabId = 0
            $didStateChange = $true
        }
        if ($script:FlowCellState -and [int]$script:FlowCellState.SelectedProgramTabId -ne 0) {
            $script:FlowCellState.SelectedProgramTabId = 0
            $didFlowCellStateChange = $true
        }
    }

    if ($didStateChange) {
        Save-State
    }
    if ($didFlowCellStateChange) {
        Save-FlowCellState
    }

    return @($railTabs)
}

function Get-FlowCellPanelRailPanels($ProgramTab) {
    if ($null -eq $ProgramTab -or -not $ProgramTab.PSObject.Properties['Id']) { return @() }

    $programState = Get-FlowCellProgramState -ProgramTabId ([int]$ProgramTab.Id)
    if ($null -eq $programState) { return @() }

    $panelsRoot = Get-FlowCellProgramPanelsRoot -ProgramName ([string]$ProgramTab.Label)
    $panelFolders = @(Get-FlowCellChildDirectoryItems -RootPath $panelsRoot)
    $didStateChange = $false
    $retainedPanels = @()
    foreach ($panel in @($programState.Panels)) {
        if ($null -eq $panel -or [string]::IsNullOrWhiteSpace([string]$panel.Name)) {
            $didStateChange = $true
            continue
        }
        if (-not (Get-FlowCellNamedChildDirectory -RootPath $panelsRoot -Name ([string]$panel.Name))) {
            $didStateChange = $true
            continue
        }
        $retainedPanels += $panel
    }
    if ($didStateChange) {
        $programState.Panels = @($retainedPanels)
    }

    $railPanels = @()
    foreach ($folder in @($panelFolders)) {
        $existing = @($programState.Panels | Where-Object { [string]$_.Name -ieq [string]$folder.Name } | Select-Object -First 1)
        $panel = $null
        if (@($existing).Count -gt 0) {
            $panel = $existing[0]
        }
        else {
            $panel = New-FlowCellPanelState -Name ([string]$folder.Name) -Id (Get-FlowCellDefaultPanelId -Name ([string]$folder.Name))
            $programState.Panels += $panel
            $didStateChange = $true
        }
        $railPanels += $panel
    }

    if (@($railPanels).Count -gt 0 -and -not (@($railPanels).Id -contains [string]$programState.SelectedPanelId)) {
        $programState.SelectedPanelId = [string]$railPanels[0].Id
        $didStateChange = $true
    }
    elseif (@($railPanels).Count -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$programState.SelectedPanelId)) {
        $programState.SelectedPanelId = ''
        $didStateChange = $true
    }

    if ($didStateChange) {
        Save-FlowCellState
    }

    return @($railPanels)
}

function Get-FlowCellDisplayButtonLabelFromPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $label = [System.IO.Path]::GetFileNameWithoutExtension([string]$Path)
    if ([string]::IsNullOrWhiteSpace($label)) { return [string]$Path }
    foreach ($prefix in @('file_', 'util_', 'org_')) {
        if ($label.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and $label.Length -gt $prefix.Length) {
            return $label.Substring($prefix.Length)
        }
    }
    return $label
}

function Get-FlowCellUniqueDestinationPath([string]$FolderPath, [string]$PreferredFileName) {
    if ([string]::IsNullOrWhiteSpace($FolderPath) -or [string]::IsNullOrWhiteSpace($PreferredFileName)) {
        return ''
    }
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($PreferredFileName)
    $extension = [System.IO.Path]::GetExtension($PreferredFileName)
    if ([string]::IsNullOrWhiteSpace($baseName)) {
        $baseName = 'button_script'
    }
    if ([string]::IsNullOrWhiteSpace($extension)) {
        $extension = '.ps1'
    }

    $candidatePath = Join-Path $FolderPath ($baseName + $extension)
    $suffix = 2
    while (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
        $candidatePath = Join-Path $FolderPath ('{0}_{1}{2}' -f $baseName, $suffix, $extension)
        $suffix++
    }
    return $candidatePath
}

function Resolve-FlowCellButtonTargetPath($ProgramTab, [string]$SelectedPath) {
    if ([string]::IsNullOrWhiteSpace($SelectedPath)) {
        return [pscustomobject]@{
            Succeeded = $false
            Path = ''
            Imported = $false
            Message = 'No script path was selected.'
        }
    }

    try {
        $fullSelectedPath = [System.IO.Path]::GetFullPath([string]$SelectedPath)
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            Path = ''
            Imported = $false
            Message = ('Invalid path: {0}' -f [string]$SelectedPath)
        }
    }

    $programLabel = if ($ProgramTab -and $ProgramTab.PSObject.Properties['Label']) { [string]$ProgramTab.Label } else { '' }
    $programKey = Get-ProgramLabelKey $programLabel
    if ([string]$programKey -ne 'blender') {
        return [pscustomobject]@{
            Succeeded = $true
            Path = $fullSelectedPath
            Imported = $false
            Message = ''
        }
    }

    $managedFolder = Get-FlowCellBlenderScriptsFolder
    if ([string]::IsNullOrWhiteSpace($managedFolder)) {
        return [pscustomobject]@{
            Succeeded = $true
            Path = $fullSelectedPath
            Imported = $false
            Message = ''
        }
    }

    try {
        if (-not (Test-Path -LiteralPath $managedFolder -PathType Container)) {
            New-Item -ItemType Directory -Path $managedFolder -Force | Out-Null
        }
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            Path = ''
            Imported = $false
            Message = ('Could not prepare Blender button folder: {0}' -f $_.Exception.Message)
        }
    }

    $normalizedSelected = Get-FlowCellNormalizedPath $fullSelectedPath
    $normalizedManaged = Get-FlowCellNormalizedPath $managedFolder
    if ($normalizedSelected.StartsWith(($normalizedManaged + '\'))) {
        return [pscustomobject]@{
            Succeeded = $true
            Path = $fullSelectedPath
            Imported = $false
            Message = ''
        }
    }

    $fileName = [System.IO.Path]::GetFileName($fullSelectedPath)
    if ([string]::IsNullOrWhiteSpace($fileName)) {
        $fileName = 'button_script.ps1'
    }
    $destinationPath = Get-FlowCellUniqueDestinationPath -FolderPath $managedFolder -PreferredFileName $fileName
    if ([string]::IsNullOrWhiteSpace($destinationPath)) {
        return [pscustomobject]@{
            Succeeded = $false
            Path = ''
            Imported = $false
            Message = 'Could not resolve a destination path for the imported script.'
        }
    }

    try {
        Copy-Item -LiteralPath $fullSelectedPath -Destination $destinationPath -Force:$false
        return [pscustomobject]@{
            Succeeded = $true
            Path = $destinationPath
            Imported = $true
            Message = ('Imported to {0}' -f $destinationPath)
        }
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            Path = ''
            Imported = $false
            Message = ('Failed to import script into FlowCell structure: {0}' -f $_.Exception.Message)
        }
    }
}

function Get-ProgramInitialScriptFolder($ProgramTab) {
    $label = if ($ProgramTab -and $ProgramTab.PSObject.Properties['Label']) { [string]$ProgramTab.Label } else { '' }
    if ($ProgramTab -and $ProgramTab.PSObject.Properties['ScriptFolder']) {
        $scriptFolder = [string]$ProgramTab.ScriptFolder
        $isLegacyBlenderFolder = ((Get-ProgramLabelKey $label) -eq 'blender') -and (Test-FlowCellBlenderLegacyScriptPath $scriptFolder)
        if (-not $isLegacyBlenderFolder -and -not [string]::IsNullOrWhiteSpace($scriptFolder) -and (Test-Path -LiteralPath $scriptFolder -PathType Container)) {
            return $scriptFolder
        }
    }
    return (Get-ProgramDefaultScriptFolder -Label $label)
}

function Set-ProgramLastScriptFolder($ProgramTab, [string]$FilePath) {
    if ($null -eq $ProgramTab -or [string]::IsNullOrWhiteSpace($FilePath)) { return }
    $folderPath = Split-Path -Parent $FilePath
    if ([string]::IsNullOrWhiteSpace($folderPath)) { return }
    $ProgramTab.ScriptFolder = [string]$folderPath
}

function Get-ActivationStepTypeForProgram([string]$Label) {
    switch (Get-ProgramLabelKey $Label) {
        'blender' { return 'ActivateBlender' }
        'photoshop' { return 'ActivatePhotoshop' }
        'windows' { return 'ActivateWindows' }
        default { return 'ActivateIllustrator' }
    }
}

function Get-FlowCellDefaultPanelId([string]$Name) {
    $safeName = (($Name -replace '[^A-Za-z0-9]+', '_').Trim('_')).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($safeName)) {
        return ('panel_{0}' -f [guid]::NewGuid().ToString('N'))
    }
    return ('panel_{0}' -f $safeName)
}

function New-FlowCellPanelState([string]$Name, [string]$Id = '') {
    $resolvedId = if ([string]::IsNullOrWhiteSpace($Id)) { 'panel_{0}' -f [guid]::NewGuid().ToString('N') } else { $Id }
    return [pscustomobject]@{
        Id = $resolvedId
        Name = [string]$Name
        IsPoppedOut = $false
        PopoutBounds = $null
        Buttons = @()
    }
}

function New-DefaultFlowCellPanels($PanelNames = @('Layers', 'Files', 'Utility')) {
    $panels = @()
    foreach ($panelName in @(ConvertTo-FlowCellConfigList $PanelNames)) {
        $panels += (New-FlowCellPanelState -Name ([string]$panelName) -Id (Get-FlowCellDefaultPanelId -Name ([string]$panelName)))
    }
    if (@($panels).Count -eq 0) {
        $panels += (New-FlowCellPanelState -Name 'Files' -Id 'panel_files')
    }
    return @($panels)
}

function New-FlowCellProgramState($ProgramTab, $ProgramConfig = $null) {
    if ($null -eq $ProgramTab) { return $null }
    $resolvedProgramConfig = Get-FlowCellProgramConfig -ProgramTab $ProgramTab -ProgramConfig $ProgramConfig
    $defaultPanels = @(New-DefaultFlowCellPanels -PanelNames $resolvedProgramConfig.DefaultPanels)
    $programState = [pscustomobject]@{
        ProgramTabId = [int]$ProgramTab.Id
        SelectedPanelId = [string]$defaultPanels[0].Id
        Panels = $defaultPanels
        ProgramConfig = $resolvedProgramConfig
    }
    Ensure-FlowCellRequiredButtons -ProgramState $programState
    return $programState
}

function Ensure-FlowCellRequiredButtons($ProgramState) {
    if ($null -eq $ProgramState) { return }

    $programTab = Get-FlowCellProgramTab -ProgramTabId ([int]$ProgramState.ProgramTabId)
    $programConfig = if ($ProgramState.PSObject.Properties['ProgramConfig']) { $ProgramState.ProgramConfig } else { $null }
    $programName = if ($programConfig -and $programConfig.PSObject.Properties['NormalizedName']) {
        [string]$programConfig.NormalizedName
    }
    elseif ($programTab -and $programTab.PSObject.Properties['Label']) {
        [string]$programTab.Label
    }
    else {
        ''
    }
    $exePath = if ($programConfig -and $programConfig.PSObject.Properties['ExePath']) {
        [string]$programConfig.ExePath
    }
    elseif ($programTab -and $programTab.PSObject.Properties['ExePath']) {
        [string]$programTab.ExePath
    }
    else {
        ''
    }
    $scriptFolder = if ($programConfig -and $programConfig.PSObject.Properties['ScriptFolder']) {
        [string]$programConfig.ScriptFolder
    }
    elseif ($programTab -and $programTab.PSObject.Properties['ScriptFolder']) {
        [string]$programTab.ScriptFolder
    }
    else {
        ''
    }
    $programTemplateKey = Get-FlowCellProgramTemplateKey -ProgramName $programName -ExePath $exePath

    $filesPanel = @($ProgramState.Panels | Where-Object { [string]$_.Id -eq 'panel_files' } | Select-Object -First 1)
    if (@($filesPanel).Count -eq 0) { return }
    $filesPanel = $filesPanel[0]

    $requiredButtons = @()
    switch ($programTemplateKey) {
        'illustrator' {
            $requiredButtons = @(
                [pscustomobject]@{
                    Id = 'button_illustrator_save_selected_obj_to_project_3d'
                    Kind = 'macro'
                    Label = 'save obj'
                    Target = 'save_selected_obj_to_project_3d'
                    Shortcut = ''
                    BindingId = 0
                    style_group_id = ''
                },
                [pscustomobject]@{
                    Id = 'button_illustrator_save_selected_obj_to_blender'
                    Kind = 'macro'
                    Label = 'blender obj'
                    Target = 'save_selected_obj_to_blender'
                    Shortcut = ''
                    BindingId = 0
                    style_group_id = ''
                },
                [pscustomobject]@{
                    Id = 'button_illustrator_save_selected_png_to_blender_litho'
                    Kind = 'macro'
                    Label = 'blender litho'
                    Target = 'save_selected_png_to_blender_litho'
                    Shortcut = ''
                    BindingId = 0
                    style_group_id = ''
                }
            )
            break
        }
        'windows' {
            $resolvedScriptFolder = if ([string]::IsNullOrWhiteSpace($scriptFolder)) {
                $script:WindowsScriptsDir
            }
            else {
                $scriptFolder
            }
            $requiredButtons = @(
                [pscustomobject]@{
                    Id = 'button_windows_update_github'
                    Kind = 'script'
                    Label = 'Update GitHub'
                    Target = [string](Join-Path $resolvedScriptFolder 'file_update_github.ps1')
                    Tooltip = 'Stage, commit, and push the active Explorer Git repository to GitHub.'
                    Shortcut = ''
                    BindingId = 0
                    style_group_id = ''
                },
                [pscustomobject]@{
                    Id = 'button_windows_pull_github'
                    Kind = 'script'
                    Label = 'GitHub Pull'
                    Target = [string](Join-Path $resolvedScriptFolder 'file_pull_github.ps1')
                    Tooltip = 'Fetch and fast-forward pull the active Explorer Git repository from GitHub.'
                    Shortcut = ''
                    BindingId = 0
                    style_group_id = ''
                }
            )
            break
        }
    }
    if (@($requiredButtons).Count -eq 0) { return }

    foreach ($requiredButton in @($requiredButtons)) {
        $existing = @($filesPanel.Buttons | Where-Object {
            [string]$_.Kind -eq [string]$requiredButton.Kind -and
            [string]$_.Target -eq [string]$requiredButton.Target
        } | Select-Object -First 1)
        if (@($existing).Count -gt 0) { continue }
        $filesPanel.Buttons += $requiredButton
    }
}

function Ensure-FlowCellProgramState($ProgramState, $ProgramTab) {
    if ($null -eq $ProgramTab) { return $null }
    if ($null -eq $ProgramState) {
        return (New-FlowCellProgramState -ProgramTab $ProgramTab)
    }

    $panels = @()
    foreach ($panel in @($ProgramState.Panels)) {
        $panels += [pscustomobject]@{
            Id = if ($panel.PSObject.Properties['Id'] -and $panel.Id) { [string]$panel.Id } else { 'panel_{0}' -f [guid]::NewGuid().ToString('N') }
            Name = if ($panel.PSObject.Properties['Name'] -and $panel.Name) { [string]$panel.Name } else { 'Panel' }
            IsPoppedOut = [bool]$(if ($panel.PSObject.Properties['IsPoppedOut']) { $panel.IsPoppedOut } else { $false })
            PopoutBounds = if ($panel.PSObject.Properties['PopoutBounds'] -and $panel.PopoutBounds) {
                [pscustomobject]@{
                    Left = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Left']) { $panel.PopoutBounds.Left } else { 0 })
                    Top = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Top']) { $panel.PopoutBounds.Top } else { 0 })
                    Width = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Width']) { $panel.PopoutBounds.Width } else { 820 })
                    Height = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Height']) { $panel.PopoutBounds.Height } else { 620 })
                }
            } else { $null }
            Buttons = @(
                foreach ($button in @($panel.Buttons)) {
                    [pscustomobject]@{
                        Id = if ($button.PSObject.Properties['Id'] -and $button.Id) { [string]$button.Id } else { 'button_{0}' -f [guid]::NewGuid().ToString('N') }
                        Kind = [string]$button.Kind
                        command_id = [string](Get-FlowCellButtonCommandId $button)
                        Label = [string]$button.Label
                        Target = [string]$button.Target
                        Tooltip = if ($button.PSObject.Properties['Tooltip']) { [string]$button.Tooltip } else { '' }
                        Shortcut = if ($button.PSObject.Properties['Shortcut']) { [string]$button.Shortcut } else { '' }
                        BindingId = if ($button.PSObject.Properties['BindingId'] -and [string]$button.BindingId -match '^\d+$') { [int]$button.BindingId } else { 0 }
                        style_group_id = [string]$(if ($button.PSObject.Properties['style_group_id']) { $button.style_group_id } elseif ($button.PSObject.Properties['StyleGroupId']) { $button.StyleGroupId } else { '' })
                        compound_tool_id = [string]$(if ($button.PSObject.Properties['compound_tool_id']) { $button.compound_tool_id } elseif ($button.PSObject.Properties['CompoundToolId']) { $button.CompoundToolId } elseif (Test-FlowCellLegacyAlignmentToolTarget ([string]$button.Target)) { 'alignment' } else { '' })
                    }
                }
            )
        }
    }

    $selectedPanelId = if ($ProgramState.PSObject.Properties['SelectedPanelId']) { [string]$ProgramState.SelectedPanelId } else { '' }
    if (@($panels).Count -gt 0 -and ([string]::IsNullOrWhiteSpace($selectedPanelId) -or -not (@($panels).Id -contains $selectedPanelId))) {
        $selectedPanelId = [string]$panels[0].Id
    }
    elseif (@($panels).Count -eq 0) {
        $selectedPanelId = ''
    }

    $resolvedProgramConfig = Get-FlowCellProgramConfig -ProgramTab $ProgramTab -ProgramConfig $(if ($ProgramState.PSObject.Properties['ProgramConfig']) { $ProgramState.ProgramConfig } else { $null })
    $programState = [pscustomobject]@{
        ProgramTabId = [int]$ProgramTab.Id
        SelectedPanelId = $selectedPanelId
        Panels = @($panels)
        ProgramConfig = $resolvedProgramConfig
    }
    Ensure-FlowCellRequiredButtons -ProgramState $programState
    return $programState
}

function Get-DefaultFlowCellState {
    $programStates = @()
    foreach ($programTab in @($script:State.ProgramTabs)) {
        $programStates += (New-FlowCellProgramState -ProgramTab $programTab)
    }
    return [pscustomobject]@{
        SelectedProgramTabId = [int]$script:State.SelectedProgramTabId
        ButtonScale = 1.0
        StartupRestorePopoutsOnly = $true
        MainWindowBounds = $null
        Programs = @($programStates)
        AlignmentToolStates = @()
        ToolOptionStates = @()
        ToolPopouts = @()
        PopoutClusters = @()
    }
}

function Test-FlowCellStartupRestorePopoutsOnlyEnabled {
    if (-not $script:FlowCellState) { return $true }
    if ($script:FlowCellState.PSObject.Properties['StartupRestorePopoutsOnly']) {
        return [bool]$script:FlowCellState.StartupRestorePopoutsOnly
    }
    return $true
}

function Set-FlowCellStartupRestorePopoutsOnly([bool]$Enabled) {
    if (-not $script:FlowCellState) { return }
    if ($script:FlowCellState.PSObject.Properties['StartupRestorePopoutsOnly']) {
        $script:FlowCellState.StartupRestorePopoutsOnly = [bool]$Enabled
    }
    else {
        $script:FlowCellState | Add-Member -MemberType NoteProperty -Name StartupRestorePopoutsOnly -Value ([bool]$Enabled)
    }
}

function New-FlowCellPoint([double]$X, [double]$Y) {
    return [pscustomobject]@{
        X = [double]$X
        Y = [double]$Y
    }
}

function Get-FlowCellPanelPopoutId([int]$ProgramTabId, [string]$PanelId) {
    return ('panel|{0}|{1}' -f [int]$ProgramTabId, [string]$PanelId)
}

function Get-FlowCellToolButtonPopoutId([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    $button = @()
    if ($panel) {
        $button = @($panel.Buttons | Where-Object { [string]$_.Id -eq [string]$ButtonId } | Select-Object -First 1)
    }
    if (@($button).Count -gt 0 -and (Test-FlowCellSmartAxisStateButton $button[0])) {
        return ('tool|{0}|{1}|smart_axis_unit' -f [int]$ProgramTabId, [string]$PanelId)
    }
    return ('tool|{0}|{1}|{2}' -f [int]$ProgramTabId, [string]$PanelId, [string]$ButtonId)
}

function ConvertTo-FlowCellPopoutClusterState($Cluster) {
    if ($null -eq $Cluster) { return $null }
    $memberIds = @(
        if ($Cluster.PSObject.Properties['MemberIds']) {
            foreach ($memberId in @($Cluster.MemberIds)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$memberId)) {
                    [string]$memberId
                }
            }
        }
    )
    $memberIds = @($memberIds | Select-Object -Unique)
    if (@($memberIds).Count -lt 2) { return $null }

    $offset = if ($Cluster.PSObject.Properties['GrabberOffset'] -and $Cluster.GrabberOffset) {
        New-FlowCellPoint -X ([double]$(if ($Cluster.GrabberOffset.PSObject.Properties['X']) { $Cluster.GrabberOffset.X } else { 0 })) -Y ([double]$(if ($Cluster.GrabberOffset.PSObject.Properties['Y']) { $Cluster.GrabberOffset.Y } else { -28 }))
    }
    else {
        New-FlowCellPoint -X 0 -Y -28
    }

    return [pscustomobject]@{
        Id = [string]$(if ($Cluster.PSObject.Properties['Id'] -and -not [string]::IsNullOrWhiteSpace([string]$Cluster.Id)) { $Cluster.Id } else { 'cluster_{0}' -f [guid]::NewGuid().ToString('N') })
        MemberIds = @($memberIds)
        GrabberOffset = $offset
    }
}

function Get-FlowCellNormalizedToolPopoutLayoutMode([string]$LayoutMode) {
    switch ([string]$LayoutMode) {
        'Individual' { return 'Individual' }
        'Group' { return 'Group' }
        'Horizontal' { return 'Group' }
        'Vertical' { return 'Group' }
        default { return 'Group' }
    }
}

function Get-FlowCellLegacyToolPopoutExpansion($ToolPopout) {
    if ($null -eq $ToolPopout) { return @() }
    return @($ToolPopout)
}

function ConvertTo-FlowCellToolPopoutState($ToolPopout) {
    if ($null -eq $ToolPopout) { return $null }
    $programTabId = [int]$(if ($ToolPopout.PSObject.Properties['ProgramTabId']) { $ToolPopout.ProgramTabId } else { 0 })
    $panelId = [string]$(if ($ToolPopout.PSObject.Properties['PanelId']) { $ToolPopout.PanelId } else { '' })
    $buttonIds = @(
        if ($ToolPopout.PSObject.Properties['ButtonIds']) {
            foreach ($buttonId in @($ToolPopout.ButtonIds)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$buttonId)) { [string]$buttonId }
            }
        }
    )
    if ($programTabId -le 0 -or [string]::IsNullOrWhiteSpace($panelId) -or @($buttonIds).Count -eq 0) { return $null }

    $layoutMode = Get-FlowCellNormalizedToolPopoutLayoutMode -LayoutMode $(if ($ToolPopout.PSObject.Properties['LayoutMode']) { [string]$ToolPopout.LayoutMode } else { 'Group' })

    return [pscustomobject]@{
        ProgramTabId = $programTabId
        PanelId = $panelId
        ButtonIds = @($buttonIds)
        LayoutMode = $layoutMode
        Bounds = if ($ToolPopout.PSObject.Properties['Bounds'] -and $ToolPopout.Bounds) {
            New-FlowCellPopoutBounds -Left ([double]$ToolPopout.Bounds.Left) -Top ([double]$ToolPopout.Bounds.Top) -Width ([double]$ToolPopout.Bounds.Width) -Height ([double]$ToolPopout.Bounds.Height)
        } else { $null }
    }
}

function New-FlowCellAlignmentToolState([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId) {
    return [pscustomobject]@{
        ProgramTabId = [int]$ProgramTabId
        PanelId = [string]$PanelId
        OwnerButtonId = [string]$OwnerButtonId
        Modifiers = [pscustomobject]@{
            X = ''
            Y = ''
            Z = ''
        }
    }
}

function ConvertTo-FlowCellAlignmentToolState($ToolState) {
    if ($null -eq $ToolState) { return $null }
    $programTabId = [int]$(if ($ToolState.PSObject.Properties['ProgramTabId']) { $ToolState.ProgramTabId } else { 0 })
    $panelId = [string]$(if ($ToolState.PSObject.Properties['PanelId']) { $ToolState.PanelId } else { '' })
    $ownerButtonId = [string]$(if ($ToolState.PSObject.Properties['OwnerButtonId']) { $ToolState.OwnerButtonId } else { '' })
    if ($programTabId -le 0 -or [string]::IsNullOrWhiteSpace($ownerButtonId)) { return $null }

    $modifierSource = if ($ToolState.PSObject.Properties['Modifiers']) { $ToolState.Modifiers } else { $null }
    $normalizedModifiers = [ordered]@{}
    foreach ($axis in @('X', 'Y', 'Z')) {
        $modifierValue = ''
        if ($modifierSource -and $modifierSource.PSObject.Properties[$axis]) {
            $modifierValue = [string]$modifierSource.$axis
        }
        switch ([string]$modifierValue) {
            'SURFACE' { $normalizedModifiers[$axis] = 'SURFACE' }
            'GEOCENTER' { $normalizedModifiers[$axis] = 'GEOCENTER' }
            default { $normalizedModifiers[$axis] = '' }
        }
    }

    return [pscustomobject]@{
        ProgramTabId = $programTabId
        PanelId = $panelId
        OwnerButtonId = $ownerButtonId
        Modifiers = [pscustomobject]$normalizedModifiers
    }
}

function New-FlowCellToolOptionState([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId, [string]$ToolId) {
    $resolvedToolId = [string]$ToolId
    $values = switch ([string]$resolvedToolId) {
        'flatten_revolve' {
            [pscustomobject]@{
                FlattenAxis = 'Y'
                RevolveAxis = 'Z'
                CenterMode = 'GEOMETRY'
                AngleDeg = 360.0
                RevolveSteps = 128
                MergeDistance = 0.0001
            }
        }
        'smart_axis_lock' {
            [pscustomobject]@{
                Modes = [pscustomobject]@{
                    X = 'NONE'
                    Y = 'NONE'
                    Z = 'NONE'
                }
                LiveEnabled = $false
                RunnerActive = $false
                Selected = 0
                EnabledToolCount = 0
                Registered = $false
                LastMessage = 'Smart Axis Lock ready.'
            }
        }
        default {
            [pscustomobject]@{}
        }
    }

    return [pscustomobject]@{
        ProgramTabId = [int]$ProgramTabId
        PanelId = [string]$PanelId
        OwnerButtonId = [string]$OwnerButtonId
        ToolId = [string]$resolvedToolId
        Values = $values
    }
}

function ConvertTo-FlowCellToolOptionState($ToolState) {
    if ($null -eq $ToolState) { return $null }
    $programTabId = [int]$(if ($ToolState.PSObject.Properties['ProgramTabId']) { $ToolState.ProgramTabId } else { 0 })
    $panelId = [string]$(if ($ToolState.PSObject.Properties['PanelId']) { $ToolState.PanelId } else { '' })
    $ownerButtonId = [string]$(if ($ToolState.PSObject.Properties['OwnerButtonId']) { $ToolState.OwnerButtonId } else { '' })
    $toolId = [string]$(if ($ToolState.PSObject.Properties['ToolId']) { $ToolState.ToolId } else { '' })
    if ($programTabId -le 0 -or [string]::IsNullOrWhiteSpace($ownerButtonId) -or [string]::IsNullOrWhiteSpace($toolId)) { return $null }

    $defaultState = New-FlowCellToolOptionState -ProgramTabId $programTabId -PanelId $panelId -OwnerButtonId $ownerButtonId -ToolId $toolId
    $values = $defaultState.Values
    $valueSource = if ($ToolState.PSObject.Properties['Values']) { $ToolState.Values } else { $null }

    switch ([string]$toolId) {
        'flatten_revolve' {
            if ($valueSource) {
                $values = [pscustomobject]@{
                    FlattenAxis = [string]$(if ($valueSource.PSObject.Properties['FlattenAxis']) { $valueSource.FlattenAxis } else { $defaultState.Values.FlattenAxis })
                    RevolveAxis = [string]$(if ($valueSource.PSObject.Properties['RevolveAxis']) { $valueSource.RevolveAxis } else { $defaultState.Values.RevolveAxis })
                    CenterMode = [string]$(if ($valueSource.PSObject.Properties['CenterMode']) { $valueSource.CenterMode } else { $defaultState.Values.CenterMode })
                    AngleDeg = [double]$(if ($valueSource.PSObject.Properties['AngleDeg']) { $valueSource.AngleDeg } else { $defaultState.Values.AngleDeg })
                    RevolveSteps = [int]$(if ($valueSource.PSObject.Properties['RevolveSteps']) { $valueSource.RevolveSteps } else { $defaultState.Values.RevolveSteps })
                    MergeDistance = [double]$(if ($valueSource.PSObject.Properties['MergeDistance']) { $valueSource.MergeDistance } else { $defaultState.Values.MergeDistance })
                }
            }
        }
        'smart_axis_lock' {
            $modeSource = if ($valueSource -and $valueSource.PSObject.Properties['Modes']) { $valueSource.Modes } else { $null }
            $values = [pscustomobject]@{
                Modes = [pscustomobject]@{
                    X = [string]$(if ($modeSource -and $modeSource.PSObject.Properties['X']) { $modeSource.X } else { $defaultState.Values.Modes.X })
                    Y = [string]$(if ($modeSource -and $modeSource.PSObject.Properties['Y']) { $modeSource.Y } else { $defaultState.Values.Modes.Y })
                    Z = [string]$(if ($modeSource -and $modeSource.PSObject.Properties['Z']) { $modeSource.Z } else { $defaultState.Values.Modes.Z })
                }
                LiveEnabled = [bool]$(if ($valueSource -and $valueSource.PSObject.Properties['LiveEnabled']) { $valueSource.LiveEnabled } else { $defaultState.Values.LiveEnabled })
                RunnerActive = [bool]$(if ($valueSource -and $valueSource.PSObject.Properties['RunnerActive']) { $valueSource.RunnerActive } else { $defaultState.Values.RunnerActive })
                Selected = [int]$(if ($valueSource -and $valueSource.PSObject.Properties['Selected']) { $valueSource.Selected } else { $defaultState.Values.Selected })
                EnabledToolCount = [int]$(if ($valueSource -and $valueSource.PSObject.Properties['EnabledToolCount']) { $valueSource.EnabledToolCount } else { $defaultState.Values.EnabledToolCount })
                Registered = [bool]$(if ($valueSource -and $valueSource.PSObject.Properties['Registered']) { $valueSource.Registered } else { $defaultState.Values.Registered })
                LastMessage = [string]$(if ($valueSource -and $valueSource.PSObject.Properties['LastMessage']) { $valueSource.LastMessage } else { $defaultState.Values.LastMessage })
            }
        }
    }

    return [pscustomobject]@{
        ProgramTabId = $programTabId
        PanelId = $panelId
        OwnerButtonId = $ownerButtonId
        ToolId = $toolId
        Values = $values
    }
}

function Get-FlowCellSpecialToolButtonId([object]$Button) {
    if ($null -eq $Button) { return '' }
    if (Test-FlowCellFlattenRevolveToolButton $Button) { return 'flatten_revolve' }
    if (Test-FlowCellSmartAxisLockToolButton $Button) { return 'smart_axis_lock' }
    return ''
}

function Ensure-FlowCellToolOptionStateCollection($FlowCellState) {
    if ($null -eq $FlowCellState) { return $false }

    $existingEntries = @()
    if ($FlowCellState.PSObject.Properties['ToolOptionStates']) {
        foreach ($entry in @($FlowCellState.ToolOptionStates)) {
            $convertedEntry = ConvertTo-FlowCellToolOptionState $entry
            if ($convertedEntry) {
                $existingEntries += $convertedEntry
            }
        }
    }
    else {
        $FlowCellState | Add-Member -MemberType NoteProperty -Name ToolOptionStates -Value @()
    }

    $resolvedEntries = @()
    foreach ($programState in @($FlowCellState.Programs)) {
        foreach ($panel in @($programState.Panels)) {
            foreach ($button in @($panel.Buttons)) {
                $toolId = Get-FlowCellSpecialToolButtonId -Button $button
                if ([string]::IsNullOrWhiteSpace($toolId)) { continue }

                $match = @(
                    $existingEntries |
                        Where-Object {
                            [int]$_.ProgramTabId -eq [int]$programState.ProgramTabId -and
                            [string]$_.OwnerButtonId -eq [string]$button.Id -and
                            [string]$_.ToolId -eq [string]$toolId
                        } |
                        Select-Object -First 1
                )
                $resolvedEntry = if (@($match).Count -gt 0) {
                    $existingEntry = $match[0]
                    $existingEntry.PanelId = [string]$panel.Id
                    $existingEntry
                }
                else {
                    New-FlowCellToolOptionState -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id) -OwnerButtonId ([string]$button.Id) -ToolId ([string]$toolId)
                }
                $resolvedEntries += (ConvertTo-FlowCellToolOptionState $resolvedEntry)
            }
        }
    }

    $didChange = ($existingEntries.Count -ne $resolvedEntries.Count)
    if (-not $didChange) {
        for ($index = 0; $index -lt $resolvedEntries.Count; $index++) {
            $oldEntry = $existingEntries[$index]
            $newEntry = $resolvedEntries[$index]
            $oldJson = $oldEntry | ConvertTo-Json -Depth 8 -Compress
            $newJson = $newEntry | ConvertTo-Json -Depth 8 -Compress
            if ($oldJson -ne $newJson) {
                $didChange = $true
                break
            }
        }
    }

    $FlowCellState.ToolOptionStates = @($resolvedEntries)
    return $didChange
}

function Ensure-FlowCellAlignmentStateCollection($FlowCellState) {
    if ($null -eq $FlowCellState) { return $false }

    $existingEntries = @()
    if ($FlowCellState.PSObject.Properties['AlignmentToolStates']) {
        foreach ($entry in @($FlowCellState.AlignmentToolStates)) {
            $convertedEntry = ConvertTo-FlowCellAlignmentToolState $entry
            if ($convertedEntry) {
                $existingEntries += $convertedEntry
            }
        }
    }
    elseif (-not $FlowCellState.PSObject.Properties['AlignmentToolStates']) {
        $FlowCellState | Add-Member -MemberType NoteProperty -Name AlignmentToolStates -Value @()
    }

    $resolvedEntries = @()
    foreach ($programState in @($FlowCellState.Programs)) {
        foreach ($panel in @($programState.Panels)) {
            foreach ($button in @($panel.Buttons)) {
                $button = Ensure-FlowCellButtonStateLayer $button
                if ([string](Get-FlowCellButtonCompoundToolId $button) -ne 'alignment') { continue }

                $match = @(
                    $existingEntries |
                        Where-Object {
                            [int]$_.ProgramTabId -eq [int]$programState.ProgramTabId -and
                            [string]$_.OwnerButtonId -eq [string]$button.Id
                        } |
                        Select-Object -First 1
                )
                $resolvedEntry = if (@($match).Count -gt 0) {
                    $existingEntry = $match[0]
                    [pscustomobject]@{
                        ProgramTabId = [int]$programState.ProgramTabId
                        PanelId = [string]$panel.Id
                        OwnerButtonId = [string]$button.Id
                        Modifiers = [pscustomobject]@{
                            X = [string]$existingEntry.Modifiers.X
                            Y = [string]$existingEntry.Modifiers.Y
                            Z = [string]$existingEntry.Modifiers.Z
                        }
                    }
                }
                else {
                    New-FlowCellAlignmentToolState -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id) -OwnerButtonId ([string]$button.Id)
                }
                $resolvedEntries += $resolvedEntry
            }
        }
    }

    $didChange = ($existingEntries.Count -ne $resolvedEntries.Count)
    if (-not $didChange) {
        for ($index = 0; $index -lt $resolvedEntries.Count; $index++) {
            $oldEntry = $existingEntries[$index]
            $newEntry = $resolvedEntries[$index]
            if (
                [int]$oldEntry.ProgramTabId -ne [int]$newEntry.ProgramTabId -or
                [string]$oldEntry.PanelId -ne [string]$newEntry.PanelId -or
                [string]$oldEntry.OwnerButtonId -ne [string]$newEntry.OwnerButtonId -or
                [string]$oldEntry.Modifiers.X -ne [string]$newEntry.Modifiers.X -or
                [string]$oldEntry.Modifiers.Y -ne [string]$newEntry.Modifiers.Y -or
                [string]$oldEntry.Modifiers.Z -ne [string]$newEntry.Modifiers.Z
            ) {
                $didChange = $true
                break
            }
        }
    }

    if ($FlowCellState.PSObject.Properties['AlignmentToolStates']) {
        $FlowCellState.AlignmentToolStates = @($resolvedEntries)
    }
    else {
        $FlowCellState | Add-Member -MemberType NoteProperty -Name AlignmentToolStates -Value @($resolvedEntries)
    }
    return $didChange
}

function Read-FlowCellState {
    if (-not $script:State) {
        return [pscustomobject]@{
            SelectedProgramTabId = 0
            ButtonScale = 1.0
            StartupRestorePopoutsOnly = $true
            MainWindowBounds = $null
            Programs = @()
            AlignmentToolStates = @()
            ToolOptionStates = @()
            ToolPopouts = @()
            PopoutClusters = @()
        }
    }

    $state = $null
    if (Test-Path -LiteralPath $script:FlowCellStatePath -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $script:FlowCellStatePath -Raw
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $state = $raw | ConvertFrom-Json
            }
        }
        catch {
            Write-UiLog ('FlowCell state read failed: {0}' -f $_.Exception.ToString())
        }
    }

    $programs = @()
    foreach ($programTab in @($script:State.ProgramTabs)) {
        $existing = $null
        if ($state -and $state.PSObject.Properties['Programs']) {
            $existing = @($state.Programs | Where-Object { $_.ProgramTabId -eq [int]$programTab.Id } | Select-Object -First 1)
            if (@($existing).Count -gt 0) { $existing = $existing[0] } else { $existing = $null }
        }
        $programs += (Ensure-FlowCellProgramState -ProgramState $existing -ProgramTab $programTab)
    }

    $selectedProgramTabId = if ($state -and $state.PSObject.Properties['SelectedProgramTabId']) { [int]$state.SelectedProgramTabId } else { [int]$script:State.SelectedProgramTabId }
    if (@($script:State.ProgramTabs).Count -gt 0 -and -not (@($script:State.ProgramTabs).Id -contains $selectedProgramTabId)) {
        $selectedProgramTabId = [int]$script:State.ProgramTabs[0].Id
    }
    elseif (@($script:State.ProgramTabs).Count -eq 0) {
        $selectedProgramTabId = 0
    }

    $toolPopouts = @()
    $clusterStates = @()
    $alignmentToolStates = @()
    $toolOptionStates = @()
    if ($state -and $state.PSObject.Properties['ToolPopouts']) {
        foreach ($toolPopout in @($state.ToolPopouts)) {
            $converted = ConvertTo-FlowCellToolPopoutState $toolPopout
            if ($null -eq $converted) { continue }
            $toolPopouts += [pscustomobject]@{
                ProgramTabId = [int]$converted.ProgramTabId
                PanelId = [string]$converted.PanelId
                ButtonIds = @($converted.ButtonIds | ForEach-Object { [string]$_ })
                LayoutMode = [string]$converted.LayoutMode
                Bounds = $converted.Bounds
            }
        }
    }
    if ($state -and $state.PSObject.Properties['AlignmentToolStates']) {
        foreach ($alignmentToolState in @($state.AlignmentToolStates)) {
            $convertedAlignmentToolState = ConvertTo-FlowCellAlignmentToolState $alignmentToolState
            if ($convertedAlignmentToolState) {
                $alignmentToolStates += $convertedAlignmentToolState
            }
        }
    }
    if ($state -and $state.PSObject.Properties['ToolOptionStates']) {
        foreach ($toolOptionState in @($state.ToolOptionStates)) {
            $convertedToolOptionState = ConvertTo-FlowCellToolOptionState $toolOptionState
            if ($convertedToolOptionState) {
                $toolOptionStates += $convertedToolOptionState
            }
        }
    }
    if ($state -and $state.PSObject.Properties['PopoutClusters']) {
        foreach ($cluster in @($state.PopoutClusters)) {
            $convertedCluster = ConvertTo-FlowCellPopoutClusterState $cluster
            if ($convertedCluster) {
                $clusterStates += $convertedCluster
            }
        }
    }

    $toolPopoutIdMap = @{}
    foreach ($toolPopout in @($toolPopouts)) {
        $convertedToolPopout = ConvertTo-FlowCellToolPopoutState $toolPopout
        if ($null -eq $convertedToolPopout) { continue }
        foreach ($buttonId in @($convertedToolPopout.ButtonIds)) {
            $toolPopoutId = Get-FlowCellToolButtonPopoutId -ProgramTabId ([int]$convertedToolPopout.ProgramTabId) -PanelId ([string]$convertedToolPopout.PanelId) -ButtonId ([string]$buttonId)
            if (-not [string]::IsNullOrWhiteSpace([string]$toolPopoutId)) {
                $toolPopoutIdMap[[string]$toolPopoutId] = $true
            }
        }
    }

    $redundantPanelPopoutIds = New-Object System.Collections.Generic.List[string]
    foreach ($program in @($programs)) {
        foreach ($panel in @($program.Panels)) {
            if (-not [bool]$panel.IsPoppedOut) { continue }
            $panelButtons = @($panel.Buttons)
            if (@($panelButtons).Count -eq 0) { continue }
            $embeddedOnly = $true
            $allToolPopoutsPresent = $true
            foreach ($button in @($panelButtons)) {
                if (-not (Test-FlowCellMultiButtonToolButton $button)) {
                    $embeddedOnly = $false
                    break
                }
                $toolPopoutId = Get-FlowCellToolButtonPopoutId -ProgramTabId ([int]$program.ProgramTabId) -PanelId ([string]$panel.Id) -ButtonId ([string]$button.Id)
                if (-not $toolPopoutIdMap.ContainsKey([string]$toolPopoutId)) {
                    $allToolPopoutsPresent = $false
                    break
                }
            }
            if (-not $embeddedOnly -or -not $allToolPopoutsPresent) { continue }
            $panel.IsPoppedOut = $false
            [void]$redundantPanelPopoutIds.Add((Get-FlowCellPanelPopoutId -ProgramTabId ([int]$program.ProgramTabId) -PanelId ([string]$panel.Id)))
        }
    }

    if ($redundantPanelPopoutIds.Count -gt 0) {
        $clusterStates = @(
            foreach ($clusterState in @($clusterStates)) {
                $convertedCluster = ConvertTo-FlowCellPopoutClusterState $clusterState
                if ($null -eq $convertedCluster) { continue }
                $memberIds = @($convertedCluster.MemberIds | Where-Object { -not $redundantPanelPopoutIds.Contains([string]$_) })
                if (@($memberIds).Count -lt 2) { continue }
                [pscustomobject]@{
                    Id = [string]$convertedCluster.Id
                    MemberIds = @($memberIds)
                    GrabberOffset = $convertedCluster.GrabberOffset
                }
            }
        )
    }

    $resolvedState = [pscustomobject]@{
        SelectedProgramTabId = $selectedProgramTabId
        ButtonScale = if ($state -and $state.PSObject.Properties['ButtonScale']) { [double]$state.ButtonScale } else { 1.0 }
        StartupRestorePopoutsOnly = if ($state -and $state.PSObject.Properties['StartupRestorePopoutsOnly']) { [bool]$state.StartupRestorePopoutsOnly } else { $true }
        MainWindowBounds = if ($state -and $state.PSObject.Properties['MainWindowBounds'] -and $state.MainWindowBounds) {
            New-FlowCellPopoutBounds -Left ([double]$state.MainWindowBounds.Left) -Top ([double]$state.MainWindowBounds.Top) -Width ([double]$state.MainWindowBounds.Width) -Height ([double]$state.MainWindowBounds.Height)
        } else { $null }
        Programs = @($programs)
        AlignmentToolStates = @($alignmentToolStates)
        ToolOptionStates = @($toolOptionStates)
        ToolPopouts = @($toolPopouts)
        PopoutClusters = @($clusterStates)
    }
    [void](Ensure-FlowCellAlignmentStateCollection -FlowCellState $resolvedState)
    [void](Ensure-FlowCellToolOptionStateCollection -FlowCellState $resolvedState)
    Write-FlowCellStateLayerValidation -FlowCellState $resolvedState
    return $resolvedState
}

function Save-FlowCellState {
    if (-not $script:FlowCellState) { return }
    $programsRoot = Get-FlowCellProgramsRoot
    $script:FlowCellState.Programs = @(
        foreach ($programState in @($script:FlowCellState.Programs)) {
            if ($null -eq $programState) { continue }
            $programTab = Get-FlowCellProgramTab -ProgramTabId ([int]$programState.ProgramTabId)
            if ($null -eq $programTab -or [string]::IsNullOrWhiteSpace([string]$programTab.Label)) {
                continue
            }
            if (-not (Get-FlowCellNamedChildDirectory -RootPath $programsRoot -Name ([string]$programTab.Label))) {
                continue
            }

            $programState.Panels = @(
                foreach ($panel in @($programState.Panels)) {
                    if ($null -eq $panel -or [string]::IsNullOrWhiteSpace([string]$panel.Name)) {
                        continue
                    }
                    if (-not [string]::IsNullOrWhiteSpace((Get-FlowCellPanelFolderPath -ProgramName ([string]$programTab.Label) -PanelName ([string]$panel.Name)))) {
                        $panel
                    }
                }
            )
            if (@($programState.Panels).Count -gt 0) {
                if (-not (@($programState.Panels).Id -contains [string]$programState.SelectedPanelId)) {
                    $programState.SelectedPanelId = [string]$programState.Panels[0].Id
                }
            }
            else {
                $programState.SelectedPanelId = ''
            }

            $programState
        }
    )
    if (@($script:FlowCellState.Programs).Count -gt 0) {
        if (-not (@($script:FlowCellState.Programs).ProgramTabId -contains [int]$script:FlowCellState.SelectedProgramTabId)) {
            $script:FlowCellState.SelectedProgramTabId = [int]$script:FlowCellState.Programs[0].ProgramTabId
        }
    }
    else {
        $script:FlowCellState.SelectedProgramTabId = 0
    }
    [void](Ensure-FlowCellAlignmentStateCollection -FlowCellState $script:FlowCellState)
    [void](Ensure-FlowCellToolOptionStateCollection -FlowCellState $script:FlowCellState)
    $stateToolPopouts = if ($script:FlowCellState.PSObject.Properties['ToolPopouts']) { @($script:FlowCellState.ToolPopouts) } else { @() }
    $statePopoutClusters = if ($script:FlowCellState.PSObject.Properties['PopoutClusters']) { @($script:FlowCellState.PopoutClusters) } else { @() }
    $stateAlignmentToolStates = if ($script:FlowCellState.PSObject.Properties['AlignmentToolStates']) { @($script:FlowCellState.AlignmentToolStates) } else { @() }
    $stateToolOptionStates = if ($script:FlowCellState.PSObject.Properties['ToolOptionStates']) { @($script:FlowCellState.ToolOptionStates) } else { @() }
    $payload = [pscustomobject]@{
        SelectedProgramTabId = [int]$script:FlowCellState.SelectedProgramTabId
        ButtonScale = [double]$(if ($script:FlowCellState.PSObject.Properties['ButtonScale']) { $script:FlowCellState.ButtonScale } else { 1.0 })
        StartupRestorePopoutsOnly = [bool]$(if ($script:FlowCellState.PSObject.Properties['StartupRestorePopoutsOnly']) { $script:FlowCellState.StartupRestorePopoutsOnly } else { $true })
        MainWindowBounds = if ($script:FlowCellState.PSObject.Properties['MainWindowBounds'] -and $script:FlowCellState.MainWindowBounds) {
            [pscustomobject]@{
                Left = [double]$(if ($script:FlowCellState.MainWindowBounds.PSObject.Properties['Left']) { $script:FlowCellState.MainWindowBounds.Left } else { 0 })
                Top = [double]$(if ($script:FlowCellState.MainWindowBounds.PSObject.Properties['Top']) { $script:FlowCellState.MainWindowBounds.Top } else { 0 })
                Width = [double]$(if ($script:FlowCellState.MainWindowBounds.PSObject.Properties['Width']) { $script:FlowCellState.MainWindowBounds.Width } else { 1500 })
                Height = [double]$(if ($script:FlowCellState.MainWindowBounds.PSObject.Properties['Height']) { $script:FlowCellState.MainWindowBounds.Height } else { 940 })
            }
        } else { $null }
        Programs = @(
            foreach ($program in @($script:FlowCellState.Programs)) {
                $programTab = Get-FlowCellProgramTab -ProgramTabId ([int]$program.ProgramTabId)
                $programConfig = Get-FlowCellProgramConfig -ProgramTab $programTab -ProgramConfig $(if ($program.PSObject.Properties['ProgramConfig']) { $program.ProgramConfig } else { $null })
                [pscustomobject]@{
                    ProgramTabId = [int]$program.ProgramTabId
                    SelectedPanelId = [string]$program.SelectedPanelId
                    ProgramConfig = $programConfig
                    Panels = @(
                        foreach ($panel in @($program.Panels)) {
                            [pscustomobject]@{
                                Id = [string]$panel.Id
                                Name = [string]$panel.Name
                                IsPoppedOut = [bool]$panel.IsPoppedOut
                                PopoutBounds = if ($panel.PSObject.Properties['PopoutBounds'] -and $panel.PopoutBounds) {
                                    [pscustomobject]@{
                                        Left = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Left']) { $panel.PopoutBounds.Left } else { 0 })
                                        Top = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Top']) { $panel.PopoutBounds.Top } else { 0 })
                                        Width = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Width']) { $panel.PopoutBounds.Width } else { 820 })
                                        Height = [double]$(if ($panel.PopoutBounds.PSObject.Properties['Height']) { $panel.PopoutBounds.Height } else { 620 })
                                    }
                                } else { $null }
                                Buttons = @(
                                    foreach ($button in @($panel.Buttons)) {
                                        [pscustomobject]@{
                                            Id = [string]$button.Id
                                            Kind = [string]$button.Kind
                                            command_id = [string](Get-FlowCellButtonCommandId $button)
                                            Label = [string]$button.Label
                                            Target = [string]$button.Target
                                            Tooltip = if ($button.PSObject.Properties['Tooltip']) { [string]$button.Tooltip } else { '' }
                                            Shortcut = [string]$button.Shortcut
                                            BindingId = [int]$(if ($button.PSObject.Properties['BindingId']) { $button.BindingId } else { 0 })
                                            style_group_id = [string](Get-FlowCellButtonStyleGroupId $button)
                                            compound_tool_id = [string](Get-FlowCellButtonCompoundToolId $button)
                                        }
                                    }
                                )
                            }
                        }
                    )
                }
            }
        )
        AlignmentToolStates = @(
            foreach ($alignmentToolState in @($stateAlignmentToolStates)) {
                $convertedAlignmentToolState = ConvertTo-FlowCellAlignmentToolState $alignmentToolState
                if ($null -eq $convertedAlignmentToolState) { continue }
                [pscustomobject]@{
                    ProgramTabId = [int]$convertedAlignmentToolState.ProgramTabId
                    PanelId = [string]$convertedAlignmentToolState.PanelId
                    OwnerButtonId = [string]$convertedAlignmentToolState.OwnerButtonId
                    Modifiers = [pscustomobject]@{
                        X = [string]$convertedAlignmentToolState.Modifiers.X
                        Y = [string]$convertedAlignmentToolState.Modifiers.Y
                        Z = [string]$convertedAlignmentToolState.Modifiers.Z
                    }
                }
            }
        )
        ToolOptionStates = @(
            foreach ($toolOptionState in @($stateToolOptionStates)) {
                $convertedToolOptionState = ConvertTo-FlowCellToolOptionState $toolOptionState
                if ($null -eq $convertedToolOptionState) { continue }
                [pscustomobject]@{
                    ProgramTabId = [int]$convertedToolOptionState.ProgramTabId
                    PanelId = [string]$convertedToolOptionState.PanelId
                    OwnerButtonId = [string]$convertedToolOptionState.OwnerButtonId
                    ToolId = [string]$convertedToolOptionState.ToolId
                    Values = $convertedToolOptionState.Values
                }
            }
        )
        ToolPopouts = @(
            foreach ($toolPopout in @($stateToolPopouts)) {
                $convertedToolPopout = ConvertTo-FlowCellToolPopoutState $toolPopout
                if ($null -eq $convertedToolPopout) { continue }
                [pscustomobject]@{
                    ProgramTabId = [int]$convertedToolPopout.ProgramTabId
                    PanelId = [string]$convertedToolPopout.PanelId
                    ButtonIds = @($convertedToolPopout.ButtonIds | ForEach-Object { [string]$_ })
                    LayoutMode = [string]$convertedToolPopout.LayoutMode
                    Bounds = if ($convertedToolPopout.PSObject.Properties['Bounds'] -and $convertedToolPopout.Bounds) {
                        [pscustomobject]@{
                            Left = [double]$convertedToolPopout.Bounds.Left
                            Top = [double]$convertedToolPopout.Bounds.Top
                            Width = [double]$convertedToolPopout.Bounds.Width
                            Height = [double]$convertedToolPopout.Bounds.Height
                        }
                    } else { $null }
                }
            }
        )
        PopoutClusters = @(
            foreach ($clusterState in @($statePopoutClusters)) {
                $convertedCluster = ConvertTo-FlowCellPopoutClusterState $clusterState
                if ($null -eq $convertedCluster) { continue }
                [pscustomobject]@{
                    Id = [string]$convertedCluster.Id
                    MemberIds = @($convertedCluster.MemberIds | ForEach-Object { [string]$_ })
                    GrabberOffset = [pscustomobject]@{
                        X = [double]$convertedCluster.GrabberOffset.X
                        Y = [double]$convertedCluster.GrabberOffset.Y
                    }
                }
            }
        )
    }
    Set-FlowCellContentWithRetry -Path $script:FlowCellStatePath -Value ($payload | ConvertTo-Json -Depth 8) -Encoding UTF8
}

function New-FlowCellPopoutBounds([double]$Left, [double]$Top, [double]$Width, [double]$Height) {
    return [pscustomobject]@{
        Left = [double]$Left
        Top = [double]$Top
        Width = [double]$Width
        Height = [double]$Height
    }
}

function Get-FlowCellVisiblePopoutBounds($Bounds) {
    if ($null -eq $Bounds) { return $null }
    return (New-FlowCellPopoutBounds -Left ([double]$Bounds.Left) -Top ([double]$Bounds.Top) -Width ([double]$Bounds.Width) -Height ([double]$Bounds.Height))
}

function Get-FlowCellCenteredPopoutBounds([double]$Width = 820, [double]$Height = 620) {
    $workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $resolvedWidth = [Math]::Max([Math]::Min([double]$Width, [double]$workingArea.Width - 40), 320)
    $resolvedHeight = [Math]::Max([Math]::Min([double]$Height, [double]$workingArea.Height - 40), 220)
    return (New-FlowCellPopoutBounds -Left ($workingArea.Left + (($workingArea.Width - $resolvedWidth) / 2)) -Top ($workingArea.Top + (($workingArea.Height - $resolvedHeight) / 2)) -Width $resolvedWidth -Height $resolvedHeight)
}

function Test-FlowCellPopoutBoundsVisible($Bounds) {
    if ($null -eq $Bounds) { return $false }
    try {
        $left = [double]$Bounds.Left
        $top = [double]$Bounds.Top
        $width = [double]$Bounds.Width
        $height = [double]$Bounds.Height
        if ([double]::IsNaN($left) -or [double]::IsNaN($top) -or [double]::IsNaN($width) -or [double]::IsNaN($height)) { return $false }
        if ($width -lt 40 -or $height -lt 24) { return $false }

        $windowRect = New-Object System.Drawing.Rectangle([int][Math]::Round($left), [int][Math]::Round($top), [int][Math]::Round($width), [int][Math]::Round($height))
        foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
            $intersection = [System.Drawing.Rectangle]::Intersect($screen.WorkingArea, $windowRect)
            if ($intersection.Width -ge 40 -and $intersection.Height -ge 24) {
                return $true
            }
        }
        return $false
    }
    catch {
        return $false
    }
}

function Get-FlowCellPanelBounds([int]$ProgramTabId, [string]$PanelId) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $panel) { return $null }
    if ($panel.PSObject.Properties['PopoutBounds'] -and $panel.PopoutBounds) {
        if (Test-FlowCellPopoutBoundsVisible $panel.PopoutBounds) {
            return $panel.PopoutBounds
        }

        $panel.PopoutBounds = Get-FlowCellCenteredPopoutBounds -Width ([double]$panel.PopoutBounds.Width) -Height ([double]$panel.PopoutBounds.Height)
        Save-FlowCellState
        return $panel.PopoutBounds
    }
    return $null
}

function Set-FlowCellPanelBounds([int]$ProgramTabId, [string]$PanelId, [double]$Left, [double]$Top, [double]$Width, [double]$Height) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $panel) { return }
    $panel.PopoutBounds = New-FlowCellPopoutBounds -Left $Left -Top $Top -Width $Width -Height $Height
}

function Set-FlowCellPanelButtonOrder([int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $panel) { return $false }

    $currentButtons = @($panel.Buttons)
    if (@($currentButtons).Count -le 1) { return $true }

    $orderedButtons = New-Object System.Collections.ArrayList
    $seenIds = @()
    foreach ($buttonId in @($ButtonIds)) {
        if ([string]::IsNullOrWhiteSpace([string]$buttonId)) { continue }
        $button = @($currentButtons | Where-Object { [string]$_.Id -eq [string]$buttonId } | Select-Object -First 1)
        if (@($button).Count -eq 0) { continue }
        $resolvedButton = $button[0]
        if ($seenIds -notcontains [string]$resolvedButton.Id) {
            $seenIds += [string]$resolvedButton.Id
            [void]$orderedButtons.Add($resolvedButton)
        }
    }

    foreach ($button in @($currentButtons)) {
        if ($null -eq $button) { continue }
        $buttonId = [string]$(if ($button.PSObject.Properties['Id']) { $button.Id } else { '' })
        if ([string]::IsNullOrWhiteSpace($buttonId)) { continue }
        if ($seenIds -notcontains $buttonId) {
            $seenIds += $buttonId
            [void]$orderedButtons.Add($button)
        }
    }

    if (@($orderedButtons).Count -eq 0) { return $false }
    $panel.Buttons = @($orderedButtons)
    return $true
}

function Move-FlowCellPanelButtonByOffset([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId, [int]$Offset) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $panel) { return $false }

    $buttons = @($panel.Buttons)
    if (@($buttons).Count -le 1) { return $false }

    $sourceIndex = -1
    for ($index = 0; $index -lt @($buttons).Count; $index++) {
        if ([string]$buttons[$index].Id -eq [string]$ButtonId) {
            $sourceIndex = $index
            break
        }
    }

    if ($sourceIndex -lt 0) { return $false }
    $targetIndex = [Math]::Max([Math]::Min($sourceIndex + $Offset, @($buttons).Count - 1), 0)
    if ($targetIndex -eq $sourceIndex) { return $false }

    $movingButton = $buttons[$sourceIndex]
    $orderedButtons = New-Object System.Collections.ArrayList
    for ($index = 0; $index -lt @($buttons).Count; $index++) {
        if ($index -eq $sourceIndex) { continue }
        [void]$orderedButtons.Add($buttons[$index])
    }
    $orderedButtons.Insert($targetIndex, $movingButton)
    $panel.Buttons = @($orderedButtons)
    return $true
}

function Move-FlowCellPanelButtonToEdge([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId, [ValidateSet('Start', 'End')][string]$Edge) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $panel) { return $false }

    $buttons = @($panel.Buttons)
    if (@($buttons).Count -le 1) { return $false }

    $movingButton = @($buttons | Where-Object { [string]$_.Id -eq [string]$ButtonId } | Select-Object -First 1)
    if (@($movingButton).Count -eq 0) { return $false }
    $resolvedButton = $movingButton[0]

    $remainingButtons = @($buttons | Where-Object { [string]$_.Id -ne [string]$ButtonId })
    if ([string]$Edge -eq 'Start') {
        $panel.Buttons = @($resolvedButton) + @($remainingButtons)
    }
    else {
        $panel.Buttons = @($remainingButtons) + @($resolvedButton)
    }
    return $true
}

function Get-FlowCellMainArrangeModeEnabled {
    return [bool]$script:FlowCellMainArrangeModeEnabled
}

function Get-FlowCellButtonHostOrder([System.Windows.Controls.Panel]$ButtonGrid) {
    if ($null -eq $ButtonGrid) { return @() }
    $buttonIds = @()
    foreach ($child in @($ButtonGrid.Children)) {
        if ($null -eq $child -or -not $child.PSObject.Properties['Tag']) { continue }
        $tag = $child.Tag
        if ($null -eq $tag -or -not $tag.PSObject.Properties['ButtonId']) { continue }
        if ([string]::IsNullOrWhiteSpace([string]$tag.ButtonId)) { continue }
        $buttonIds += [string]$tag.ButtonId
    }
    return @($buttonIds)
}

function Get-FlowCellButtonHostUnderPoint {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [Parameter(Mandatory = $true)]
        [System.Windows.Point]$Point
    )

    try {
        $hit = $ButtonGrid.InputHitTest($Point)
        $current = [System.Windows.DependencyObject]$hit
        while ($current) {
            if ($current -is [System.Windows.FrameworkElement] -and $current.PSObject.Properties['Tag']) {
                $tag = $current.Tag
                if ($tag -and $tag.PSObject.Properties['ButtonId']) {
                    return $current
                }
            }
            $current = [System.Windows.Media.VisualTreeHelper]::GetParent($current)
        }

        $nearestHost = $null
        $nearestDistance = [double]::PositiveInfinity
        foreach ($child in @($ButtonGrid.Children)) {
            if ($null -eq $child -or -not $child.PSObject.Properties['Tag']) { continue }
            $tag = $child.Tag
            if ($null -eq $tag -or -not $tag.PSObject.Properties['ButtonId']) { continue }

            $childOrigin = $child.TranslatePoint((New-Object System.Windows.Point 0, 0), $ButtonGrid)
            $childRect = New-Object System.Windows.Rect($childOrigin.X, $childOrigin.Y, [double]$child.ActualWidth, [double]$child.ActualHeight)
            $deltaX = 0.0
            if ($Point.X -lt $childRect.Left) {
                $deltaX = [double]$childRect.Left - [double]$Point.X
            }
            elseif ($Point.X -gt $childRect.Right) {
                $deltaX = [double]$Point.X - [double]$childRect.Right
            }

            $deltaY = 0.0
            if ($Point.Y -lt $childRect.Top) {
                $deltaY = [double]$childRect.Top - [double]$Point.Y
            }
            elseif ($Point.Y -gt $childRect.Bottom) {
                $deltaY = [double]$Point.Y - [double]$childRect.Bottom
            }

            $distance = [Math]::Sqrt(($deltaX * $deltaX) + ($deltaY * $deltaY))
            if ($distance -lt $nearestDistance) {
                $nearestDistance = $distance
                $nearestHost = $child
            }
        }

        if ($nearestHost) {
            return $nearestHost
        }
    }
    catch {
    }

    return $null
}

function Move-FlowCellButtonHostInGrid {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [Parameter(Mandatory = $true)]
        [string]$SourceButtonId,
        [Parameter(Mandatory = $true)]
        [string]$TargetButtonId,
        [Parameter(Mandatory = $true)]
        [bool]$InsertAfter
    )

    $sourceIndex = -1
    $targetIndex = -1
    for ($index = 0; $index -lt $ButtonGrid.Children.Count; $index++) {
        $child = $ButtonGrid.Children[$index]
        if ($null -eq $child -or -not $child.PSObject.Properties['Tag']) { continue }
        $tag = $child.Tag
        if ($null -eq $tag -or -not $tag.PSObject.Properties['ButtonId']) { continue }
        if ([string]$tag.ButtonId -eq [string]$SourceButtonId) { $sourceIndex = $index }
        if ([string]$tag.ButtonId -eq [string]$TargetButtonId) { $targetIndex = $index }
    }

    if ($sourceIndex -lt 0 -or $targetIndex -lt 0 -or $sourceIndex -eq $targetIndex) { return $false }

    $movingChild = $ButtonGrid.Children[$sourceIndex]
    $ButtonGrid.Children.RemoveAt($sourceIndex)
    if ($targetIndex -gt $sourceIndex) {
        $targetIndex -= 1
    }
    if ($InsertAfter) {
        $targetIndex += 1
    }
    if ($targetIndex -lt 0) {
        $targetIndex = 0
    }
    if ($targetIndex -gt $ButtonGrid.Children.Count) {
        $targetIndex = $ButtonGrid.Children.Count
    }
    $ButtonGrid.Children.Insert($targetIndex, $movingChild)
    return $true
}

function Commit-FlowCellPanelButtonGridOrder {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [Parameter(Mandatory = $true)]
        [int]$ProgramTabId,
        [Parameter(Mandatory = $true)]
        [string]$PanelId
    )

    if ($null -eq $ButtonGrid) { return $false }
    if (-not (Set-FlowCellPanelButtonOrder -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds @(Get-FlowCellButtonHostOrder -ButtonGrid $ButtonGrid))) {
        return $false
    }

    Save-FlowCellState
    return $true
}

function Set-FlowCellMainArrangeDropTarget($TargetHost = $null, [bool]$InsertAfter = $false) {
    $dragState = $script:FlowCellMainArrangeDragState
    if ($null -eq $dragState) { return }

    if ($dragState.HighlightHost) {
        try {
            $dragState.HighlightHost.BorderBrush = $dragState.HighlightOriginalBrush
            $dragState.HighlightHost.BorderThickness = $dragState.HighlightOriginalThickness
        }
        catch {
        }
    }

    $dragState.HighlightHost = $null
    $dragState.HighlightOriginalBrush = $null
    $dragState.HighlightOriginalThickness = $null
    $dragState.TargetButtonId = ''
    $dragState.InsertAfter = $false
    $dragState.Dirty = $false

    if ($null -eq $TargetHost) { return }

    $targetTag = $TargetHost.Tag
    if ($null -eq $targetTag -or -not $targetTag.PSObject.Properties['ButtonId']) { return }
    $targetButtonId = [string]$targetTag.ButtonId
    if ([string]::IsNullOrWhiteSpace($targetButtonId) -or $targetButtonId -eq [string]$dragState.SourceButtonId) { return }

    $dragState.HighlightHost = $TargetHost
    $dragState.HighlightOriginalBrush = $TargetHost.BorderBrush
    $dragState.HighlightOriginalThickness = $TargetHost.BorderThickness
    $dragState.TargetButtonId = $targetButtonId
    $dragState.InsertAfter = [bool]$InsertAfter
    $dragState.Dirty = $true
    Write-UiLog ('Arrange target updated. Source={0}; Target={1}; InsertAfter={2}' -f [string]$dragState.SourceButtonId, $targetButtonId, [bool]$InsertAfter)

    try {
        $TargetHost.BorderBrush = if ($InsertAfter) {
            New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(255, 170, 79))
        }
        else {
            New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(121, 255, 51))
        }
        $TargetHost.BorderThickness = '3'
    }
    catch {
    }
}

function Start-FlowCellMainArrangeDrag {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [Parameter(Mandatory = $true)]
        [int]$ProgramTabId,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [string]$SourceButtonId,
        $SourceHost = $null,
        [scriptblock]$RefreshAction = $null
    )

    $script:FlowCellMainArrangeDragState = [pscustomobject]@{
        ButtonGrid = $ButtonGrid
        ProgramTabId = [int]$ProgramTabId
        PanelId = [string]$PanelId
        SourceButtonId = [string]$SourceButtonId
        OriginalOrder = @(Get-FlowCellButtonHostOrder -ButtonGrid $ButtonGrid)
        Dirty = $false
        DropCompleted = $false
        TargetButtonId = ''
        InsertAfter = $false
        HighlightHost = $null
        HighlightOriginalBrush = $null
        HighlightOriginalThickness = $null
        SourceHost = $SourceHost
        OriginalOpacity = if ($null -ne $SourceHost -and $SourceHost.PSObject.Properties['Opacity']) { [double]$SourceHost.Opacity } else { 1.0 }
        RefreshAction = $RefreshAction
    }

    Write-UiLog ('Arrange drag started. ProgramTabId={0}; PanelId={1}; Source={2}' -f [int]$ProgramTabId, [string]$PanelId, [string]$SourceButtonId)

    if ($null -ne $SourceHost) {
        try {
            $SourceHost.Opacity = 0.72
        }
        catch {
        }
    }
}

function Update-FlowCellMainArrangeDrag {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Point]$Point
    )

    $dragState = $script:FlowCellMainArrangeDragState
    if ($null -eq $dragState -or $null -eq $dragState.ButtonGrid) { return $false }
    $buttonGrid = $dragState.ButtonGrid
    if ($buttonGrid.Children.Count -le 1) { return $false }

    $targetHost = Get-FlowCellButtonHostUnderPoint -ButtonGrid $buttonGrid -Point $Point
    $sourceButtonId = [string]$dragState.SourceButtonId
    if ($null -ne $targetHost) {
        $targetTag = $targetHost.Tag
        if ($null -eq $targetTag -or -not $targetTag.PSObject.Properties['ButtonId']) { return $false }
        $targetButtonId = [string]$targetTag.ButtonId
        if ([string]::IsNullOrWhiteSpace($targetButtonId) -or $targetButtonId -eq $sourceButtonId) {
            Set-FlowCellMainArrangeDropTarget
            return $false
        }
        $targetPoint = $buttonGrid.TranslatePoint($Point, $targetHost)
        $insertAfter = ([double]$targetPoint.X -ge ([double]$targetHost.ActualWidth / 2.0))
        if ([string]$dragState.TargetButtonId -ne $targetButtonId -or [bool]$dragState.InsertAfter -ne [bool]$insertAfter) {
            Set-FlowCellMainArrangeDropTarget -TargetHost $targetHost -InsertAfter $insertAfter
            return $true
        }
        return $false
    }

    $lastHost = $null
    foreach ($child in @($buttonGrid.Children)) {
        if ($null -eq $child -or -not $child.PSObject.Properties['Tag']) { continue }
        $tag = $child.Tag
        if ($null -eq $tag -or -not $tag.PSObject.Properties['ButtonId']) { continue }
        $lastHost = $child
    }
    if ($null -eq $lastHost) { return $false }
    $lastTag = $lastHost.Tag
    if ($null -eq $lastTag -or [string]::IsNullOrWhiteSpace([string]$lastTag.ButtonId) -or [string]$lastTag.ButtonId -eq $sourceButtonId) {
        Set-FlowCellMainArrangeDropTarget
        return $false
    }
    if ([string]$dragState.TargetButtonId -ne [string]$lastTag.ButtonId -or -not [bool]$dragState.InsertAfter) {
        Set-FlowCellMainArrangeDropTarget -TargetHost $lastHost -InsertAfter $true
        return $true
    }
    return $false
}

function Complete-FlowCellMainArrangeDrag {
    $dragState = $script:FlowCellMainArrangeDragState
    if ($null -eq $dragState) { return $false }
    $dragState.DropCompleted = $true
    $targetButtonId = [string]$dragState.TargetButtonId
    $insertAfter = [bool]$dragState.InsertAfter
    Set-FlowCellMainArrangeDropTarget
    if ($dragState.SourceHost) {
        try {
            $dragState.SourceHost.Opacity = [double]$dragState.OriginalOpacity
        }
        catch {
        }
    }
    if ([string]::IsNullOrWhiteSpace($targetButtonId) -or $targetButtonId -eq [string]$dragState.SourceButtonId) {
        Write-UiLog ('Arrange drag completed without target. Source={0}' -f [string]$dragState.SourceButtonId)
        return $false
    }
    if (-not (Move-FlowCellButtonHostInGrid -ButtonGrid $dragState.ButtonGrid -SourceButtonId ([string]$dragState.SourceButtonId) -TargetButtonId $targetButtonId -InsertAfter $insertAfter)) {
        Write-UiLog ('Arrange drag move failed. Source={0}; Target={1}; InsertAfter={2}' -f [string]$dragState.SourceButtonId, $targetButtonId, $insertAfter)
        return $false
    }
    if (-not (Commit-FlowCellPanelButtonGridOrder -ButtonGrid $dragState.ButtonGrid -ProgramTabId ([int]$dragState.ProgramTabId) -PanelId ([string]$dragState.PanelId))) {
        Write-UiLog ('Arrange drag commit failed. Source={0}; Target={1}; InsertAfter={2}' -f [string]$dragState.SourceButtonId, $targetButtonId, $insertAfter)
        return $false
    }

    Write-UiLog ('Reordered FlowCell main buttons by drag. ProgramTabId={0}; PanelId={1}; Source={2}; Target={3}; InsertAfter={4}' -f ([int]$dragState.ProgramTabId), ([string]$dragState.PanelId), ([string]$dragState.SourceButtonId), $targetButtonId, $insertAfter)
    return $true
}

function Cancel-FlowCellMainArrangeDrag {
    $dragState = $script:FlowCellMainArrangeDragState
    if ($null -eq $dragState) {
        $script:FlowCellMainArrangePendingPointer = $null
        return
    }
    Write-UiLog ('Arrange drag cancelled. Source={0}' -f [string]$dragState.SourceButtonId)

    if ($dragState.SourceHost) {
        try {
            $dragState.SourceHost.Opacity = [double]$dragState.OriginalOpacity
        }
        catch {
        }
    }
    Set-FlowCellMainArrangeDropTarget

    $script:FlowCellMainArrangeDragState = $null
    $script:FlowCellMainArrangePendingPointer = $null
}

function Get-FlowCellToolPopoutStateKey([int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds, [string]$LayoutMode) {
    $sortedButtonIds = @($ButtonIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { [string]$_ } | Sort-Object)
    return ('{0}|{1}|{2}|{3}' -f $ProgramTabId, [string]$PanelId, [string]$LayoutMode, ($sortedButtonIds -join ';'))
}

function Get-FlowCellToolPopoutState([int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds, [string]$LayoutMode) {
    if (-not $script:FlowCellState -or -not $script:FlowCellState.PSObject.Properties['ToolPopouts']) { return $null }
    $targetKey = Get-FlowCellToolPopoutStateKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $ButtonIds -LayoutMode $LayoutMode
    foreach ($toolPopout in @($script:FlowCellState.ToolPopouts)) {
        $converted = ConvertTo-FlowCellToolPopoutState $toolPopout
        if ($null -eq $converted) { continue }
        $candidateKey = Get-FlowCellToolPopoutStateKey -ProgramTabId ([int]$converted.ProgramTabId) -PanelId ([string]$converted.PanelId) -ButtonIds @($converted.ButtonIds) -LayoutMode ([string]$converted.LayoutMode)
        if ($candidateKey -eq $targetKey) { return $toolPopout }
    }
    return $null
}

function Set-FlowCellToolPopoutState([int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds, [string]$LayoutMode, $Bounds = $null) {
    if (-not $script:FlowCellState) { return $null }
    if (-not $script:FlowCellState.PSObject.Properties['ToolPopouts']) {
        $script:FlowCellState | Add-Member -MemberType NoteProperty -Name ToolPopouts -Value @()
    }
    $existing = Get-FlowCellToolPopoutState -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $ButtonIds -LayoutMode $LayoutMode
    if ($existing) {
        $existing.ProgramTabId = [int]$ProgramTabId
        $existing.PanelId = [string]$PanelId
        $existing.ButtonIds = @($ButtonIds | ForEach-Object { [string]$_ })
        $existing.LayoutMode = [string]$LayoutMode
        if ($null -ne $Bounds) { $existing.Bounds = $Bounds }
        return $existing
    }

    $toolPopout = [pscustomobject]@{
        ProgramTabId = [int]$ProgramTabId
        PanelId = [string]$PanelId
        ButtonIds = @($ButtonIds | ForEach-Object { [string]$_ })
        LayoutMode = [string]$LayoutMode
        Bounds = $Bounds
    }
    $script:FlowCellState.ToolPopouts = @(@($script:FlowCellState.ToolPopouts) + $toolPopout)
    return $toolPopout
}

function Remove-FlowCellToolPopoutState([int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds, [string]$LayoutMode) {
    if (-not $script:FlowCellState -or -not $script:FlowCellState.PSObject.Properties['ToolPopouts']) {
        Restore-FlowCellPopoutClusters
        return
    }
    $targetKey = Get-FlowCellToolPopoutStateKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $ButtonIds -LayoutMode $LayoutMode
    $script:FlowCellState.ToolPopouts = @(
        foreach ($toolPopout in @($script:FlowCellState.ToolPopouts)) {
            $converted = ConvertTo-FlowCellToolPopoutState $toolPopout
            if ($null -eq $converted) { continue }
            $candidateKey = Get-FlowCellToolPopoutStateKey -ProgramTabId ([int]$converted.ProgramTabId) -PanelId ([string]$converted.PanelId) -ButtonIds @($converted.ButtonIds) -LayoutMode ([string]$converted.LayoutMode)
            if ($candidateKey -ne $targetKey) { $toolPopout }
        }
    )
}

function Save-FlowCellPanelWindowBounds([System.Windows.Window]$Window, [int]$ProgramTabId, [string]$PanelId) {
    try {
        if ($null -eq $Window) { return }
        if ([double]::IsNaN([double]$Window.Left) -or [double]::IsNaN([double]$Window.Top)) { return }
        if ([double]::IsNaN([double]$Window.Width) -or [double]::IsNaN([double]$Window.Height)) { return }
        $bounds = New-FlowCellPopoutBounds -Left ([double]$Window.Left) -Top ([double]$Window.Top) -Width ([double]$Window.Width) -Height ([double]$Window.Height)
        if (-not (Test-FlowCellPopoutBoundsVisible $bounds)) { return }
        Set-FlowCellPanelBounds -ProgramTabId $ProgramTabId -PanelId $PanelId -Left ([double]$Window.Left) -Top ([double]$Window.Top) -Width ([double]$Window.Width) -Height ([double]$Window.Height)
    }
    catch {
        Write-UiLog ('Save-FlowCellPanelWindowBounds failed. ProgramTabId={0}; PanelId={1}; Error={2}' -f $ProgramTabId, [string]$PanelId, $_.Exception.ToString())
    }
}

function Save-FlowCellToolPopoutWindowBounds([System.Windows.Window]$Window, [int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds, [string]$LayoutMode) {
    try {
        if ($null -eq $Window) { return }
        if ([double]::IsNaN([double]$Window.Left) -or [double]::IsNaN([double]$Window.Top)) { return }
        if ([double]::IsNaN([double]$Window.Width) -or [double]::IsNaN([double]$Window.Height)) { return }
        $bounds = New-FlowCellPopoutBounds -Left ([double]$Window.Left) -Top ([double]$Window.Top) -Width ([double]$Window.Width) -Height ([double]$Window.Height)
        if (-not (Test-FlowCellPopoutBoundsVisible $bounds)) { return }
        Set-FlowCellToolPopoutState -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $ButtonIds -LayoutMode $LayoutMode -Bounds $bounds | Out-Null
    }
    catch {
        Write-UiLog ('Save-FlowCellToolPopoutWindowBounds failed. ProgramTabId={0}; PanelId={1}; LayoutMode={2}; Error={3}' -f $ProgramTabId, [string]$PanelId, [string]$LayoutMode, $_.Exception.ToString())
    }
}

function Save-FlowCellMainWindowBounds([System.Windows.Window]$Window) {
    if ($null -eq $Window -or -not $script:FlowCellState) { return }
    if ($Window.WindowState -eq 'Minimized') { return }
    if ([double]::IsNaN([double]$Window.Left) -or [double]::IsNaN([double]$Window.Top)) { return }
    if ([double]::IsNaN([double]$Window.Width) -or [double]::IsNaN([double]$Window.Height)) { return }
    $bounds = New-FlowCellPopoutBounds -Left ([double]$Window.Left) -Top ([double]$Window.Top) -Width ([double]$Window.Width) -Height ([double]$Window.Height)
    if (-not (Test-FlowCellPopoutBoundsVisible $bounds)) { return }
    if ($script:FlowCellState.PSObject.Properties['MainWindowBounds']) {
        $script:FlowCellState.MainWindowBounds = $bounds
    }
    else {
        $script:FlowCellState | Add-Member -MemberType NoteProperty -Name MainWindowBounds -Value $bounds
    }
}

function Restore-FlowCellMainWindowBounds([System.Windows.Window]$Window) {
    if ($null -eq $Window -or -not $script:FlowCellState) { return }
    if (-not $script:FlowCellState.PSObject.Properties['MainWindowBounds'] -or -not $script:FlowCellState.MainWindowBounds) { return }
    if (-not (Test-FlowCellPopoutBoundsVisible $script:FlowCellState.MainWindowBounds)) { return }
    $Window.WindowStartupLocation = 'Manual'
    $Window.Left = [double]$script:FlowCellState.MainWindowBounds.Left
    $Window.Top = [double]$script:FlowCellState.MainWindowBounds.Top
    $Window.Width = [double]$script:FlowCellState.MainWindowBounds.Width
    $Window.Height = [double]$script:FlowCellState.MainWindowBounds.Height
}

function Get-FlowCellAllPopoutWindowEntries {
    $entries = @()
    if ($script:FlowCellPanelWindows -is [hashtable]) {
        foreach ($entry in @($script:FlowCellPanelWindows.GetEnumerator())) {
            if ($entry.Value) { $entries += $entry.Value }
        }
    }
    if ($script:FlowCellToolPopoutWindows -is [hashtable]) {
        foreach ($entry in @($script:FlowCellToolPopoutWindows.GetEnumerator())) {
            if ($entry.Value) { $entries += $entry.Value }
        }
    }
    return @($entries)
}

function Invoke-FlowCellTogglePopoutWindowMinimize {
    $entries = @(
        foreach ($entry in @(Get-FlowCellAllPopoutWindowEntries)) {
            if ($entry -and $entry.PSObject.Properties['Window'] -and $entry.Window -and $entry.Window.IsLoaded -and [string]$entry.Window.Tag -notin @('closing', 'shutdown')) {
                $entry
            }
        }
    )
    if (@($entries).Count -eq 0) {
        return [pscustomobject]@{ Succeeded = $true; Message = 'No popouts are open.' }
    }

    $visibleEntries = @($entries | Where-Object { $_.Window.WindowState -ne 'Minimized' })
    if (@($visibleEntries).Count -gt 0) {
        foreach ($entry in @($entries)) {
            $entry.Window.WindowState = 'Minimized'
        }
        return [pscustomobject]@{ Succeeded = $true; Message = 'Minimized all FlowCell popouts.' }
    }

    foreach ($entry in @($entries)) {
        $entry.Window.WindowState = 'Normal'
        $entry.Window.Show()
        $entry.Window.Activate() | Out-Null
        Push-FlowCellWindowAboveOwner -Window $entry.Window
    }
    return [pscustomobject]@{ Succeeded = $true; Message = 'Restored all FlowCell popouts.' }
}

function Get-FlowCellPopoutWindowEntryById([string]$PopoutId) {
    if ([string]::IsNullOrWhiteSpace($PopoutId)) { return $null }
    foreach ($entry in @(Get-FlowCellAllPopoutWindowEntries)) {
        if ($entry -and $entry.PSObject.Properties['PopoutId'] -and [string]$entry.PopoutId -eq [string]$PopoutId) {
            return $entry
        }
    }
    return $null
}

function Get-FlowCellPopoutWindowEntryBounds($Entry) {
    if ($null -eq $Entry -or -not $Entry.PSObject.Properties['Window'] -or $null -eq $Entry.Window) { return $null }
    $window = $Entry.Window
    if (-not $window.IsLoaded) { return $null }
    if ([double]::IsNaN([double]$window.Left) -or [double]::IsNaN([double]$window.Top) -or [double]::IsNaN([double]$window.Width) -or [double]::IsNaN([double]$window.Height)) { return $null }
    return (New-FlowCellPopoutBounds -Left ([double]$window.Left) -Top ([double]$window.Top) -Width ([double]$window.Width) -Height ([double]$window.Height))
}

function Save-FlowCellPopoutWindowEntryBounds($Entry) {
    if ($null -eq $Entry) { return }
    if (-not $Entry.PSObject.Properties['Kind']) { return }
    switch ([string]$Entry.Kind) {
        'Panel' {
            Save-FlowCellPanelWindowBounds -Window $Entry.Window -ProgramTabId ([int]$Entry.ProgramTabId) -PanelId ([string]$Entry.PanelId)
        }
        'Tool' {
            Save-FlowCellToolPopoutWindowBounds -Window $Entry.Window -ProgramTabId ([int]$Entry.ProgramTabId) -PanelId ([string]$Entry.PanelId) -ButtonIds @($Entry.ButtonIds) -LayoutMode ([string]$Entry.LayoutMode)
        }
    }
}

function Set-FlowCellPopoutWindowBounds($Entry, $Bounds) {
    if ($null -eq $Entry -or $null -eq $Bounds) { return }
    if (-not $Entry.PSObject.Properties['Window'] -or $null -eq $Entry.Window) { return }
    $window = $Entry.Window
    if (-not $window.IsLoaded) { return }
    $previousSuppress = $false
    if ($Entry.PSObject.Properties['SuppressSnapHandling']) {
        $previousSuppress = [bool]$Entry.SuppressSnapHandling
        $Entry.SuppressSnapHandling = $true
    }
    try {
        $window.Left = [double]$Bounds.Left
        $window.Top = [double]$Bounds.Top
        if ($Bounds.PSObject.Properties['Width'] -and -not [double]::IsNaN([double]$Bounds.Width)) {
            $window.Width = [double]$Bounds.Width
        }
        if ($Bounds.PSObject.Properties['Height'] -and -not [double]::IsNaN([double]$Bounds.Height)) {
            $window.Height = [double]$Bounds.Height
        }
    }
    finally {
        if ($Entry.PSObject.Properties['SuppressSnapHandling']) {
            $Entry.SuppressSnapHandling = $previousSuppress
        }
    }
}

function Set-FlowCellStatePopoutClusters([object[]]$ClusterStates) {
    if (-not $script:FlowCellState) { return }
    if ($script:FlowCellState.PSObject.Properties['PopoutClusters']) {
        $script:FlowCellState.PopoutClusters = @($ClusterStates)
    }
    else {
        $script:FlowCellState | Add-Member -MemberType NoteProperty -Name PopoutClusters -Value @($ClusterStates)
    }
}

function Sync-FlowCellPopoutClustersToState {
    $clusterStates = @()
    if ($script:FlowCellPopoutClusters -is [hashtable]) {
        foreach ($cluster in @($script:FlowCellPopoutClusters.Values)) {
            if ($null -eq $cluster) { continue }
            $convertedCluster = ConvertTo-FlowCellPopoutClusterState $cluster
            if ($convertedCluster) {
                $clusterStates += $convertedCluster
            }
        }
    }
    Set-FlowCellStatePopoutClusters -ClusterStates $clusterStates
}

function Get-FlowCellClusterEntryForPopoutId([string]$PopoutId) {
    if ([string]::IsNullOrWhiteSpace($PopoutId)) { return $null }
    foreach ($cluster in @($script:FlowCellPopoutClusters.Values)) {
        if ($cluster -and @($cluster.MemberIds) -contains [string]$PopoutId) {
            return $cluster
        }
    }
    return $null
}

function Invoke-FlowCellClusterSafe([string]$Context, [scriptblock]$Action) {
    if (-not ($Action -is [scriptblock])) { return $null }
    try {
        return (& $Action)
    }
    catch {
        Write-UiLog ('FlowCell cluster operation failed. Context={0}; Error={1}' -f $Context, $_.Exception.ToString())
        return $null
    }
}

function Get-FlowCellBoundsOverlapLength([double]$StartA, [double]$EndA, [double]$StartB, [double]$EndB) {
    return [Math]::Max(0, [Math]::Min($EndA, $EndB) - [Math]::Max($StartA, $StartB))
}

function Get-FlowCellBoundsGapDistance($BoundsA, $BoundsB) {
    if ($null -eq $BoundsA -or $null -eq $BoundsB) { return [double]::PositiveInfinity }
    $visibleBoundsA = Get-FlowCellVisiblePopoutBounds $BoundsA
    $visibleBoundsB = Get-FlowCellVisiblePopoutBounds $BoundsB
    if ($null -eq $visibleBoundsA -or $null -eq $visibleBoundsB) { return [double]::PositiveInfinity }
    $rightA = [double]$visibleBoundsA.Left + [double]$visibleBoundsA.Width
    $bottomA = [double]$visibleBoundsA.Top + [double]$visibleBoundsA.Height
    $rightB = [double]$visibleBoundsB.Left + [double]$visibleBoundsB.Width
    $bottomB = [double]$visibleBoundsB.Top + [double]$visibleBoundsB.Height

    $dx = if ($rightA -lt [double]$visibleBoundsB.Left) {
        [double]$visibleBoundsB.Left - $rightA
    }
    elseif ($rightB -lt [double]$visibleBoundsA.Left) {
        [double]$visibleBoundsA.Left - $rightB
    }
    else {
        0.0
    }

    $dy = if ($bottomA -lt [double]$visibleBoundsB.Top) {
        [double]$visibleBoundsB.Top - $bottomA
    }
    elseif ($bottomB -lt [double]$visibleBoundsA.Top) {
        [double]$visibleBoundsA.Top - $bottomB
    }
    else {
        0.0
    }

    if ($dx -gt 0 -and $dy -gt 0) {
        return [Math]::Sqrt(([Math]::Pow($dx, 2)) + ([Math]::Pow($dy, 2)))
    }
    return [Math]::Max($dx, $dy)
}

function Test-FlowCellClusterMembersTouching($EntryA, $EntryB, [double]$Tolerance = $script:FlowCellClusterTouchTolerance) {
    $boundsA = Get-FlowCellVisiblePopoutBounds (Get-FlowCellPopoutWindowEntryBounds $EntryA)
    $boundsB = Get-FlowCellVisiblePopoutBounds (Get-FlowCellPopoutWindowEntryBounds $EntryB)
    if ($null -eq $boundsA -or $null -eq $boundsB) { return $false }

    $verticalOverlap = Get-FlowCellBoundsOverlapLength -StartA ([double]$boundsA.Top) -EndA ([double]$boundsA.Top + [double]$boundsA.Height) -StartB ([double]$boundsB.Top) -EndB ([double]$boundsB.Top + [double]$boundsB.Height)
    $horizontalOverlap = Get-FlowCellBoundsOverlapLength -StartA ([double]$boundsA.Left) -EndA ([double]$boundsA.Left + [double]$boundsA.Width) -StartB ([double]$boundsB.Left) -EndB ([double]$boundsB.Left + [double]$boundsB.Width)
    $minimumVertical = [Math]::Max(40.0, [Math]::Min([double]$boundsA.Height, [double]$boundsB.Height) * 0.18)
    $minimumHorizontal = [Math]::Max(40.0, [Math]::Min([double]$boundsA.Width, [double]$boundsB.Width) * 0.18)

    if ($verticalOverlap -ge $minimumVertical) {
        if ([Math]::Abs([double]$boundsA.Left - ([double]$boundsB.Left + [double]$boundsB.Width)) -le $Tolerance) { return $true }
        if ([Math]::Abs(([double]$boundsA.Left + [double]$boundsA.Width) - [double]$boundsB.Left) -le $Tolerance) { return $true }
    }
    if ($horizontalOverlap -ge $minimumHorizontal) {
        if ([Math]::Abs([double]$boundsA.Top - ([double]$boundsB.Top + [double]$boundsB.Height)) -le $Tolerance) { return $true }
        if ([Math]::Abs(([double]$boundsA.Top + [double]$boundsA.Height) - [double]$boundsB.Top) -le $Tolerance) { return $true }
    }

    return $false
}

function Get-FlowCellClusterConnectedComponents([string[]]$MemberIds) {
    $remaining = New-Object System.Collections.Generic.List[string]
    foreach ($memberId in @($MemberIds | Select-Object -Unique)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$memberId)) {
            [void]$remaining.Add([string]$memberId)
        }
    }

    $components = @()
    while ($remaining.Count -gt 0) {
        $seed = [string]$remaining[0]
        $remaining.RemoveAt(0)
        $component = New-Object System.Collections.Generic.List[string]
        [void]$component.Add($seed)
        $queue = New-Object System.Collections.Generic.Queue[string]
        $queue.Enqueue($seed)
        while ($queue.Count -gt 0) {
            $currentId = [string]$queue.Dequeue()
            $currentEntry = Get-FlowCellPopoutWindowEntryById -PopoutId $currentId
            foreach ($candidateId in @($remaining.ToArray())) {
                $candidateEntry = Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$candidateId)
                if (Test-FlowCellClusterMembersTouching -EntryA $currentEntry -EntryB $candidateEntry) {
                    [void]$component.Add([string]$candidateId)
                    $queue.Enqueue([string]$candidateId)
                    [void]$remaining.Remove([string]$candidateId)
                }
            }
        }
        $components += ,@($component.ToArray())
    }

    return @($components)
}

function Get-FlowCellClusterBounds($ClusterEntry) {
    if ($null -eq $ClusterEntry) { return $null }
    $memberBounds = @()
    foreach ($memberId in @($ClusterEntry.MemberIds)) {
        $entry = Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$memberId)
        $bounds = Get-FlowCellPopoutWindowEntryBounds $entry
        if ($bounds) { $memberBounds += $bounds }
    }
    if (@($memberBounds).Count -eq 0) { return $null }

    $left = [double]($memberBounds | Measure-Object -Property Left -Minimum).Minimum
    $top = [double]($memberBounds | Measure-Object -Property Top -Minimum).Minimum
    $right = [double]($memberBounds | ForEach-Object { [double]$_.Left + [double]$_.Width } | Measure-Object -Maximum).Maximum
    $bottom = [double]($memberBounds | ForEach-Object { [double]$_.Top + [double]$_.Height } | Measure-Object -Maximum).Maximum
    return (New-FlowCellPopoutBounds -Left $left -Top $top -Width ($right - $left) -Height ($bottom - $top))
}

function Get-FlowCellDefaultClusterGrabberOffset($ClusterEntry) {
    return (New-FlowCellPoint -X 0 -Y -28)
}

function Remove-FlowCellClusterGrabber($ClusterEntry) {
    if ($null -eq $ClusterEntry) { return }
    if ($ClusterEntry.PSObject.Properties['GrabberWindow'] -and $ClusterEntry.GrabberWindow) {
        try {
            $ClusterEntry.GrabberWindow.Tag = 'closing'
            $ClusterEntry.GrabberWindow.Close()
        }
        catch {
        }
    }
    if ($ClusterEntry.PSObject.Properties['GrabberWindow']) {
        $ClusterEntry.GrabberWindow = $null
    }
}

function Close-FlowCellPopoutClusterGrabbers {
    if (-not ($script:FlowCellPopoutClusters -is [hashtable])) { return }
    foreach ($cluster in @($script:FlowCellPopoutClusters.Values)) {
        Remove-FlowCellClusterGrabber -ClusterEntry $cluster
    }
}

function Update-FlowCellClusterGrabberWindow($ClusterEntry) {
    if ($null -eq $ClusterEntry) { return }
    Remove-FlowCellClusterGrabber -ClusterEntry $ClusterEntry
}

function Ensure-FlowCellClusterGrabberWindow($ClusterEntry) {
    if ($null -eq $ClusterEntry) { return }
    Remove-FlowCellClusterGrabber -ClusterEntry $ClusterEntry
}

function Update-FlowCellClusterMembership($ClusterEntry, [string[]]$MemberIds) {
    if ($null -eq $ClusterEntry) { return }
    $resolvedMemberIds = @($MemberIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    $ClusterEntry.MemberIds = @($resolvedMemberIds)
    foreach ($entry in @(Get-FlowCellAllPopoutWindowEntries)) {
        if ($null -eq $entry -or -not $entry.PSObject.Properties['PopoutId']) { continue }
        if (@($resolvedMemberIds) -contains [string]$entry.PopoutId) {
            $entry.ClusterId = [string]$ClusterEntry.Id
        }
        elseif ($entry.PSObject.Properties['ClusterId'] -and [string]$entry.ClusterId -eq [string]$ClusterEntry.Id) {
            $entry.ClusterId = ''
        }
    }
}

function Register-FlowCellPopoutCluster {
    param(
        [string[]]$MemberIds,
        [string]$ClusterId = '',
        $GrabberOffset = $null
    )

    $resolvedMemberIds = @($MemberIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    $resolvedMemberIds = @($resolvedMemberIds | Where-Object { $null -ne (Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$_)) })
    if (@($resolvedMemberIds).Count -lt 2) { return $null }

    $existingClusterIds = @(
        foreach ($memberId in @($resolvedMemberIds)) {
            $existingCluster = Get-FlowCellClusterEntryForPopoutId -PopoutId ([string]$memberId)
            if ($existingCluster) { [string]$existingCluster.Id }
        }
    ) | Select-Object -Unique

    $cluster = $null
    if (-not [string]::IsNullOrWhiteSpace($ClusterId) -and $script:FlowCellPopoutClusters.ContainsKey([string]$ClusterId)) {
        $cluster = $script:FlowCellPopoutClusters[[string]$ClusterId]
    }
    elseif (@($existingClusterIds).Count -gt 0) {
        $cluster = $script:FlowCellPopoutClusters[[string]$existingClusterIds[0]]
    }
    else {
        $cluster = [pscustomobject]@{
            Id = $(if ([string]::IsNullOrWhiteSpace($ClusterId)) { 'cluster_{0}' -f [guid]::NewGuid().ToString('N') } else { [string]$ClusterId })
            MemberIds = @()
            GrabberOffset = $null
            GrabberWindow = $null
            DragMode = ''
            DragOrigin = $null
            DragScreenOrigin = $null
            DragMemberBounds = @{}
            IsUpdatingGrabber = $false
        }
        $script:FlowCellPopoutClusters[[string]$cluster.Id] = $cluster
    }

    $allMemberIds = New-Object System.Collections.Generic.List[string]
    foreach ($memberId in @($resolvedMemberIds)) {
        if (-not $allMemberIds.Contains([string]$memberId)) {
            [void]$allMemberIds.Add([string]$memberId)
        }
    }
    foreach ($existingClusterId in @($existingClusterIds)) {
        if ([string]$existingClusterId -eq [string]$cluster.Id) { continue }
        $otherCluster = $script:FlowCellPopoutClusters[[string]$existingClusterId]
        if ($otherCluster) {
            foreach ($memberId in @($otherCluster.MemberIds)) {
                if (-not $allMemberIds.Contains([string]$memberId)) {
                    [void]$allMemberIds.Add([string]$memberId)
                }
            }
            Remove-FlowCellClusterGrabber -ClusterEntry $otherCluster
            [void]$script:FlowCellPopoutClusters.Remove([string]$existingClusterId)
        }
    }

    Update-FlowCellClusterMembership -ClusterEntry $cluster -MemberIds @($allMemberIds.ToArray())
    if ($null -ne $GrabberOffset) {
        $cluster.GrabberOffset = New-FlowCellPoint -X ([double]$GrabberOffset.X) -Y ([double]$GrabberOffset.Y)
    }
    elseif ($null -eq $cluster.GrabberOffset) {
        $cluster.GrabberOffset = Get-FlowCellDefaultClusterGrabberOffset -ClusterEntry $cluster
    }

    Ensure-FlowCellClusterGrabberWindow -ClusterEntry $cluster
    Update-FlowCellClusterGrabberWindow -ClusterEntry $cluster
    Sync-FlowCellPopoutClustersToState
    return $cluster
}

function Remove-FlowCellPopoutFromCluster([string]$PopoutId) {
    $cluster = Get-FlowCellClusterEntryForPopoutId -PopoutId $PopoutId
    if ($null -eq $cluster) { return }
    $remaining = @($cluster.MemberIds | Where-Object { [string]$_ -ne [string]$PopoutId })
    $entry = Get-FlowCellPopoutWindowEntryById -PopoutId $PopoutId
    if ($entry -and $entry.PSObject.Properties['ClusterId']) {
        $entry.ClusterId = ''
    }
    if (@($remaining).Count -lt 2) {
        foreach ($memberId in @($remaining)) {
            $memberEntry = Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$memberId)
            if ($memberEntry -and $memberEntry.PSObject.Properties['ClusterId']) {
                $memberEntry.ClusterId = ''
            }
        }
        Remove-FlowCellClusterGrabber -ClusterEntry $cluster
        if ($script:FlowCellPopoutClusters.ContainsKey([string]$cluster.Id)) {
            $script:FlowCellPopoutClusters.Remove([string]$cluster.Id)
        }
    }
    else {
        Update-FlowCellClusterMembership -ClusterEntry $cluster -MemberIds $remaining
        $components = @(Get-FlowCellClusterConnectedComponents -MemberIds @($cluster.MemberIds))
        if (@($components).Count -gt 1) {
            if ($script:FlowCellPopoutClusters.ContainsKey([string]$cluster.Id)) {
                $script:FlowCellPopoutClusters.Remove([string]$cluster.Id)
            }
            Remove-FlowCellClusterGrabber -ClusterEntry $cluster
            $first = $true
            foreach ($component in @($components)) {
                if (@($component).Count -lt 2) {
                    foreach ($memberId in @($component)) {
                        $memberEntry = Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$memberId)
                        if ($memberEntry -and $memberEntry.PSObject.Properties['ClusterId']) {
                            $memberEntry.ClusterId = ''
                        }
                    }
                    continue
                }
                $reuseId = if ($first) { [string]$cluster.Id } else { 'cluster_{0}' -f [guid]::NewGuid().ToString('N') }
                $reuseOffset = if ($first) { $cluster.GrabberOffset } else { $null }
                [void](Register-FlowCellPopoutCluster -MemberIds @($component) -ClusterId $reuseId -GrabberOffset $reuseOffset)
                $first = $false
            }
        }
        else {
            Ensure-FlowCellClusterGrabberWindow -ClusterEntry $cluster
            Update-FlowCellClusterGrabberWindow -ClusterEntry $cluster
        }
    }

    Sync-FlowCellPopoutClustersToState
}

function Restore-FlowCellPopoutClusters {
    if (-not $script:FlowCellState) { return }
    Close-FlowCellPopoutClusterGrabbers
    $script:FlowCellPopoutClusters = @{}
    foreach ($entry in @(Get-FlowCellAllPopoutWindowEntries)) {
        if ($entry -and $entry.PSObject.Properties['ClusterId']) {
            $entry.ClusterId = ''
        }
    }

    if (-not $script:FlowCellState.PSObject.Properties['PopoutClusters']) { return }
    foreach ($clusterState in @($script:FlowCellState.PopoutClusters)) {
        $convertedCluster = ConvertTo-FlowCellPopoutClusterState $clusterState
        if ($null -eq $convertedCluster) { continue }
        [void](Register-FlowCellPopoutCluster -MemberIds @($convertedCluster.MemberIds) -ClusterId ([string]$convertedCluster.Id) -GrabberOffset $convertedCluster.GrabberOffset)
    }
    Sync-FlowCellPopoutClustersToState
}

function Bring-FlowCellPopoutClusterToFront($ClusterEntry, [string]$PreferredPopoutId = '') {
    if ($null -eq $ClusterEntry) { return $false }
    $memberEntries = @(
        foreach ($memberId in @($ClusterEntry.MemberIds)) {
            $entry = Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$memberId)
            if ($entry -and $entry.Window -and $entry.Window.IsLoaded -and [string]$entry.Window.Tag -ne 'closing' -and [string]$entry.Window.Tag -ne 'shutdown') {
                $entry
            }
        }
    )
    if (@($memberEntries).Count -eq 0) { return $false }
    foreach ($entry in @($memberEntries)) {
        $entry.Window.WindowState = 'Normal'
        $entry.Window.Show()
    }
    foreach ($entry in @($memberEntries | Where-Object { [string]$_.PopoutId -ne [string]$PreferredPopoutId })) {
        try { Push-FlowCellWindowAboveOwner -Window $entry.Window } catch {}
    }
    $preferredEntry = @($memberEntries | Where-Object { [string]$_.PopoutId -eq [string]$PreferredPopoutId } | Select-Object -First 1)
    if (@($preferredEntry).Count -gt 0) {
        Show-FlowCellWindowFront -Window $preferredEntry[0].Window
    }
    else {
        Show-FlowCellWindowFront -Window $memberEntries[-1].Window
    }
    if ($ClusterEntry.GrabberWindow -and $ClusterEntry.GrabberWindow.IsLoaded) {
        $ClusterEntry.GrabberWindow.Show()
    }
    Update-FlowCellClusterGrabberWindow -ClusterEntry $ClusterEntry
    return $true
}

function Bring-FlowCellPopoutClusterToFrontByPopoutId([string]$PopoutId) {
    $cluster = Get-FlowCellClusterEntryForPopoutId -PopoutId $PopoutId
    if ($cluster) {
        return (Bring-FlowCellPopoutClusterToFront -ClusterEntry $cluster -PreferredPopoutId $PopoutId)
    }
    return $false
}

function Get-FlowCellBestPopoutSnap($MovingEntry) {
    if ($null -eq $MovingEntry) { return $null }
    $movingBounds = Get-FlowCellPopoutWindowEntryBounds $MovingEntry
    $movingVisibleBounds = Get-FlowCellVisiblePopoutBounds $movingBounds
    if ($null -eq $movingBounds -or $null -eq $movingVisibleBounds) { return $null }

    $best = $null
    foreach ($candidateEntry in @(Get-FlowCellAllPopoutWindowEntries)) {
        if ($null -eq $candidateEntry -or [string]$candidateEntry.PopoutId -eq [string]$MovingEntry.PopoutId) { continue }
        if ($null -eq $candidateEntry.Window -or -not $candidateEntry.Window.IsLoaded) { continue }
        $candidateBounds = Get-FlowCellPopoutWindowEntryBounds $candidateEntry
        $candidateVisibleBounds = Get-FlowCellVisiblePopoutBounds $candidateBounds
        if ($null -eq $candidateBounds -or $null -eq $candidateVisibleBounds) { continue }

        $verticalOverlap = Get-FlowCellBoundsOverlapLength -StartA ([double]$movingVisibleBounds.Top) -EndA ([double]$movingVisibleBounds.Top + [double]$movingVisibleBounds.Height) -StartB ([double]$candidateVisibleBounds.Top) -EndB ([double]$candidateVisibleBounds.Top + [double]$candidateVisibleBounds.Height)
        $horizontalOverlap = Get-FlowCellBoundsOverlapLength -StartA ([double]$movingVisibleBounds.Left) -EndA ([double]$movingVisibleBounds.Left + [double]$movingVisibleBounds.Width) -StartB ([double]$candidateVisibleBounds.Left) -EndB ([double]$candidateVisibleBounds.Left + [double]$candidateVisibleBounds.Width)
        $minimumVertical = [Math]::Max(48.0, [Math]::Min([double]$movingVisibleBounds.Height, [double]$candidateVisibleBounds.Height) * 0.2)
        $minimumHorizontal = [Math]::Max(48.0, [Math]::Min([double]$movingVisibleBounds.Width, [double]$candidateVisibleBounds.Width) * 0.2)

        if ($verticalOverlap -ge $minimumVertical) {
            $leftGap = [Math]::Abs([double]$movingVisibleBounds.Left - ([double]$candidateVisibleBounds.Left + [double]$candidateVisibleBounds.Width))
            if ($leftGap -le $script:FlowCellPopoutSnapThreshold) {
                $candidate = [pscustomobject]@{
                    Score = $leftGap
                    TargetEntry = $candidateEntry
                    Bounds = New-FlowCellPopoutBounds -Left ([double]$candidateBounds.Left + [double]$candidateBounds.Width) -Top ([double]$movingBounds.Top) -Width ([double]$movingBounds.Width) -Height ([double]$movingBounds.Height)
                }
                if ($null -eq $best -or [double]$candidate.Score -lt [double]$best.Score) { $best = $candidate }
            }
            $rightGap = [Math]::Abs(([double]$movingVisibleBounds.Left + [double]$movingVisibleBounds.Width) - [double]$candidateVisibleBounds.Left)
            if ($rightGap -le $script:FlowCellPopoutSnapThreshold) {
                $candidate = [pscustomobject]@{
                    Score = $rightGap
                    TargetEntry = $candidateEntry
                    Bounds = New-FlowCellPopoutBounds -Left ([double]$candidateBounds.Left - [double]$movingBounds.Width) -Top ([double]$movingBounds.Top) -Width ([double]$movingBounds.Width) -Height ([double]$movingBounds.Height)
                }
                if ($null -eq $best -or [double]$candidate.Score -lt [double]$best.Score) { $best = $candidate }
            }
        }

        if ($horizontalOverlap -ge $minimumHorizontal) {
            $topGap = [Math]::Abs([double]$movingVisibleBounds.Top - ([double]$candidateVisibleBounds.Top + [double]$candidateVisibleBounds.Height))
            if ($topGap -le $script:FlowCellPopoutSnapThreshold) {
                $candidate = [pscustomobject]@{
                    Score = $topGap
                    TargetEntry = $candidateEntry
                    Bounds = New-FlowCellPopoutBounds -Left ([double]$movingBounds.Left) -Top ([double]$candidateBounds.Top + [double]$candidateBounds.Height) -Width ([double]$movingBounds.Width) -Height ([double]$movingBounds.Height)
                }
                if ($null -eq $best -or [double]$candidate.Score -lt [double]$best.Score) { $best = $candidate }
            }
            $bottomGap = [Math]::Abs(([double]$movingVisibleBounds.Top + [double]$movingVisibleBounds.Height) - [double]$candidateVisibleBounds.Top)
            if ($bottomGap -le $script:FlowCellPopoutSnapThreshold) {
                $candidate = [pscustomobject]@{
                    Score = $bottomGap
                    TargetEntry = $candidateEntry
                    Bounds = New-FlowCellPopoutBounds -Left ([double]$movingBounds.Left) -Top ([double]$candidateBounds.Top - [double]$movingBounds.Height) -Width ([double]$movingBounds.Width) -Height ([double]$movingBounds.Height)
                }
                if ($null -eq $best -or [double]$candidate.Score -lt [double]$best.Score) { $best = $candidate }
            }
        }
    }

    return $best
}

function Complete-FlowCellPopoutWindowMove($Entry) {
    if ($null -eq $Entry -or ($Entry.PSObject.Properties['SuppressSnapHandling'] -and $Entry.SuppressSnapHandling)) { return }
    $cluster = Get-FlowCellClusterEntryForPopoutId -PopoutId ([string]$Entry.PopoutId)
    $snapResult = Get-FlowCellBestPopoutSnap -MovingEntry $Entry

    if ($snapResult) {
        Set-FlowCellPopoutWindowBounds -Entry $Entry -Bounds $snapResult.Bounds
        $targetCluster = Get-FlowCellClusterEntryForPopoutId -PopoutId ([string]$snapResult.TargetEntry.PopoutId)
        if ($cluster -and [string]$cluster.Id -ne $(if ($targetCluster) { [string]$targetCluster.Id } else { '' })) {
            Remove-FlowCellPopoutFromCluster -PopoutId ([string]$Entry.PopoutId)
        }
        $memberIds = @([string]$Entry.PopoutId, [string]$snapResult.TargetEntry.PopoutId)
        if ($targetCluster) {
            $memberIds = @($memberIds + @($targetCluster.MemberIds))
        }
        [void](Register-FlowCellPopoutCluster -MemberIds $memberIds)
    }
    elseif ($cluster) {
        $otherEntries = @(
            foreach ($memberId in @($cluster.MemberIds | Where-Object { [string]$_ -ne [string]$Entry.PopoutId })) {
                $memberEntry = Get-FlowCellPopoutWindowEntryById -PopoutId ([string]$memberId)
                if ($memberEntry) { $memberEntry }
            }
        )
        $minimumGap = [double]::PositiveInfinity
        foreach ($otherEntry in @($otherEntries)) {
            $gap = Get-FlowCellBoundsGapDistance -BoundsA (Get-FlowCellPopoutWindowEntryBounds $Entry) -BoundsB (Get-FlowCellPopoutWindowEntryBounds $otherEntry)
            if ($gap -lt $minimumGap) {
                $minimumGap = $gap
            }
        }
        if (@($otherEntries).Count -gt 0 -and $minimumGap -gt $script:FlowCellPopoutDetachThreshold) {
            Remove-FlowCellPopoutFromCluster -PopoutId ([string]$Entry.PopoutId)
        }
        else {
            Ensure-FlowCellClusterGrabberWindow -ClusterEntry $cluster
            Update-FlowCellClusterGrabberWindow -ClusterEntry $cluster
        }
    }

    Save-FlowCellPopoutWindowEntryBounds $Entry
    Sync-FlowCellPopoutClustersToState
    Save-FlowCellState
}

function Start-FlowCellSinglePopoutDrag($Entry, $DragSource) {
    if ($null -eq $Entry -or $null -eq $DragSource) { return }
    try {
        $window = [System.Windows.Window]::GetWindow($DragSource)
        if ($null -eq $window -or -not $window.IsLoaded) { return }
        if ([string]$window.Tag -eq 'closing' -or [string]$window.Tag -eq 'shutdown') { return }
        if ($Entry.PSObject.Properties['SuppressSnapHandling']) {
            $Entry.SuppressSnapHandling = $true
        }
        try {
            $window.DragMove()
        }
        finally {
            if ($Entry.PSObject.Properties['SuppressSnapHandling']) {
                $Entry.SuppressSnapHandling = $false
            }
        }
        Complete-FlowCellPopoutWindowMove -Entry $Entry
    }
    catch {
    }
}

function Enable-FlowCellWindowSpaceDrag([System.Windows.Window]$Window, $Entry) {
    return
}

function Enable-FlowCellPopoutGrabberDrag($Grabber, [System.Windows.Window]$Window, $Entry) {
    if ($null -eq $Grabber -or $null -eq $Window -or $null -eq $Entry) { return }
    $Grabber.Add_PreviewMouseLeftButtonDown({
        param($sender, $eventArgs)
        if ($eventArgs) { $eventArgs.Handled = $true }
        Start-FlowCellSinglePopoutDrag -Entry $Entry -DragSource $sender
    }.GetNewClosure())
}

function Get-FlowCellPopoutButtonHostOrder([System.Windows.Controls.Panel]$ButtonGrid) {
    return @(Get-FlowCellButtonHostOrder -ButtonGrid $ButtonGrid)
}

function Get-FlowCellPopoutButtonHostUnderPoint {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [Parameter(Mandatory = $true)]
        [System.Windows.Point]$Point
    )

    try {
        return (Get-FlowCellButtonHostUnderPoint -ButtonGrid $ButtonGrid -Point $Point)
    }
    catch {
    }

    return $null
}

function Move-FlowCellPopoutButtonHost {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [Parameter(Mandatory = $true)]
        [int]$ProgramTabId,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [string]$SourceButtonId,
        [Parameter(Mandatory = $true)]
        [string]$TargetButtonId,
        [Parameter(Mandatory = $true)]
        [bool]$InsertAfter
    )

    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $panel -or $null -eq $ButtonGrid) { return $false }

    if (-not (Move-FlowCellButtonHostInGrid -ButtonGrid $ButtonGrid -SourceButtonId $SourceButtonId -TargetButtonId $TargetButtonId -InsertAfter $InsertAfter)) {
        return $false
    }

    [void](Commit-FlowCellPanelButtonGridOrder -ButtonGrid $ButtonGrid -ProgramTabId $ProgramTabId -PanelId $PanelId)
    Invoke-FlowCellMainRefreshAsync
    Write-UiLog ('Reordered FlowCell popout buttons. ProgramTabId={0}; PanelId={1}; Source={2}; Target={3}; InsertAfter={4}' -f $ProgramTabId, $PanelId, $SourceButtonId, $TargetButtonId, $InsertAfter)
    return $true
}

function New-FlowCellPopoutButtonHost {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Content,
        [Parameter(Mandatory = $true)]
        $Button,
        [Parameter(Mandatory = $true)]
        [int]$ProgramTabId,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid
    )

    $Button = Ensure-FlowCellButtonStateLayer $Button
    $styleGroupId = Get-FlowCellButtonStyleGroupId $Button
    $tileHost = New-Object System.Windows.Controls.Border
    $tileHost.Margin = '0'
    $tileHost.Padding = '0'
    $tileHost.Background = [System.Windows.Media.Brushes]::Transparent
    $tileHost.HorizontalAlignment = 'Stretch'
    $tileHost.VerticalAlignment = 'Stretch'
    $tileHost.AllowDrop = $true
    $tileHost.Tag = [pscustomobject]@{
        ButtonId = [string]$Button.Id
        Button = $Button
        ProgramTabId = [int]$ProgramTabId
        PanelId = [string]$PanelId
    }
    if ($Content -is [System.Windows.UIElement]) {
        $visualState = New-FlowCellHostVisualState `
            -Label ([string]$Button.Label) `
            -IsSelected $false `
            -IsEnabled $true `
            -StyleGroupId ([string]$styleGroupId) `
            -AccentColor '#FF74C4FF'
        $tileHost.Child = New-FlowCellHostVisualSkinSurface -Content $Content -VisualState $visualState -Mode 'Popout'
    }
    else {
        $tileHost.Child = $Content
    }

    return $tileHost
}

function Connect-FlowCellPopoutEntriesInLayout($Entries, [string]$LayoutMode) {
    $resolvedEntries = @($Entries | Where-Object { $null -ne $_ -and $_.PSObject.Properties['Window'] -and $null -ne $_.Window -and $_.Window.IsLoaded })
    if (@($resolvedEntries).Count -lt 2) { return }
    if ([string]$LayoutMode -notin @('Vertical', 'Horizontal')) { return }

    $previousBounds = Get-FlowCellPopoutWindowEntryBounds $resolvedEntries[0]
    for ($index = 1; $index -lt @($resolvedEntries).Count; $index++) {
        $entry = $resolvedEntries[$index]
        $bounds = Get-FlowCellPopoutWindowEntryBounds $entry
        if ($null -eq $bounds -or $null -eq $previousBounds) { continue }
        $targetBounds = if ([string]$LayoutMode -eq 'Horizontal') {
            New-FlowCellPopoutBounds -Left ([double]$previousBounds.Left + [double]$previousBounds.Width) -Top ([double]$previousBounds.Top) -Width ([double]$bounds.Width) -Height ([double]$bounds.Height)
        }
        else {
            New-FlowCellPopoutBounds -Left ([double]$previousBounds.Left) -Top ([double]$previousBounds.Top + [double]$previousBounds.Height) -Width ([double]$bounds.Width) -Height ([double]$bounds.Height)
        }
        Set-FlowCellPopoutWindowBounds -Entry $entry -Bounds $targetBounds
        Save-FlowCellPopoutWindowEntryBounds $entry
        $previousBounds = $targetBounds
    }

    [void](Register-FlowCellPopoutCluster -MemberIds @($resolvedEntries | ForEach-Object { [string]$_.PopoutId }))
    Save-FlowCellState
}

function Close-FlowCellPanelWindowsForLayout {
    foreach ($entry in @($script:FlowCellPanelWindows.GetEnumerator())) {
        if ($null -eq $entry.Value -or $null -eq $entry.Value.Window) { continue }
        if (-not $entry.Value.Window.IsLoaded) { continue }
        $entry.Value.Window.Tag = 'shutdown'
        try { $entry.Value.Window.Close() } catch {}
    }
    $script:FlowCellPanelWindows = @{}
    Close-FlowCellPopoutClusterGrabbers
    $script:FlowCellPopoutClusters = @{}
}

function Close-FlowCellToolPopoutWindows {
    if (-not ($script:FlowCellToolPopoutWindows -is [hashtable])) { return }
    foreach ($entry in @($script:FlowCellToolPopoutWindows.GetEnumerator())) {
        if ($null -eq $entry.Value -or $null -eq $entry.Value.Window) { continue }
        if (-not $entry.Value.Window.IsLoaded) { continue }
        $entry.Value.Window.Tag = 'shutdown'
        try { $entry.Value.Window.Close() } catch {}
    }
    $script:FlowCellToolPopoutWindows = @{}
    $script:FlowCellToolPopoutTargets = @{}
    Close-FlowCellPopoutClusterGrabbers
    $script:FlowCellPopoutClusters = @{}
}

function Restore-FlowCellPoppedOutPanels {
    param(
        [scriptblock]$OnStateChanged = $null
    )

    if (-not $script:FlowCellState) { return }
    $restoreCount = 0
    foreach ($program in @($script:FlowCellState.Programs)) {
        foreach ($panel in @($program.Panels)) {
            if (-not [bool]$panel.IsPoppedOut) { continue }
            $restoreCount += 1
            Write-UiLog ('Restoring FlowCell panel window. ProgramTabId={0}; PanelId={1}' -f [int]$program.ProgramTabId, [string]$panel.Id)
            Show-FlowCellPanelWindow -ProgramTabId ([int]$program.ProgramTabId) -PanelId ([string]$panel.Id) -OnStateChanged $OnStateChanged
        }
    }
    Write-UiLog ('Restored FlowCell popped-out panel count: {0}' -f $restoreCount)
}

function Restore-FlowCellToolPopouts {
    param(
        [scriptblock]$OnStateChanged = $null
    )

    if (-not $script:FlowCellState -or -not $script:FlowCellState.PSObject.Properties['ToolPopouts']) {
        Restore-FlowCellPopoutClusters
        return
    }
    $restoreCount = 0
    foreach ($toolPopout in @($script:FlowCellState.ToolPopouts)) {
        $converted = ConvertTo-FlowCellToolPopoutState $toolPopout
        if ($null -eq $converted) { continue }
        $entries = @(
            foreach ($buttonId in @($converted.ButtonIds)) {
                Get-FlowCellButtonEntry -ProgramTabId ([int]$converted.ProgramTabId) -PanelId ([string]$converted.PanelId) -ButtonId ([string]$buttonId)
            }
        )
        $entries = @($entries | Where-Object { $null -ne $_ -and $_.PSObject.Properties['Button'] -and $null -ne $_.Button })
        if (@($entries).Count -eq 0) { continue }
        $restoreCount += 1
        Write-UiLog ('Restoring FlowCell tool popout. ProgramTabId={0}; PanelId={1}; ButtonCount={2}; LayoutMode={3}' -f [int]$converted.ProgramTabId, [string]$converted.PanelId, @($entries).Count, [string]$converted.LayoutMode)
        Show-FlowCellButtonPopoutWindow -ProgramTabId ([int]$converted.ProgramTabId) -PanelId ([string]$converted.PanelId) -Entries $entries -LayoutMode ([string]$converted.LayoutMode) -OnStateChanged $OnStateChanged
    }
    Write-UiLog ('Restored FlowCell tool popout count: {0}' -f $restoreCount)
    Invoke-FlowCellClusterSafe 'restore-tool-popouts' { Restore-FlowCellPopoutClusters } | Out-Null
}

function Get-FlowCellMostRecentLayoutSnapshotPath {
    try {
        if (-not (Test-Path -LiteralPath $script:FlowCellLayoutsRoot -PathType Container)) { return '' }
        $layoutFile = @(Get-ChildItem -LiteralPath $script:FlowCellLayoutsRoot -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*.flowlayout.json' -or $_.Name -like '*.json' } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1)
        if (@($layoutFile).Count -eq 0) { return '' }
        return [string]$layoutFile[0].FullName
    }
    catch {
        Write-UiLog ('FlowCell failed to resolve latest layout snapshot: {0}' -f $_.Exception.ToString())
        return ''
    }
}

function Restore-FlowCellPopoutFirstWorkspace {
    param(
        [System.Windows.Window]$MainWindow = $null,
        [scriptblock]$OnStateChanged = $null
    )

    $script:FlowCellStartupRestoreInProgress = $true
    try {
        if ($MainWindow -and $MainWindow.IsLoaded) {
            $MainWindow.ShowActivated = $false
            $MainWindow.WindowState = 'Minimized'
        }

        $layoutPath = Get-FlowCellMostRecentLayoutSnapshotPath
        if (-not [string]::IsNullOrWhiteSpace($layoutPath)) {
            Write-UiLog ('FlowCell popout-first startup restoring layout snapshot: {0}' -f $layoutPath)
            Import-FlowCellLayout -Path $layoutPath -OnStateChanged $OnStateChanged | Out-Null
        }
        else {
            Write-UiLog 'FlowCell popout-first startup found no layout snapshot; restoring live popout state.'
            Restore-FlowCellPoppedOutPanels -OnStateChanged $OnStateChanged
            Restore-FlowCellToolPopouts -OnStateChanged $OnStateChanged
            Invoke-FlowCellClusterSafe 'popout-first-startup' { Restore-FlowCellPopoutClusters } | Out-Null
        }

        Enable-FlowCellPanelWindows
        if ($MainWindow -and $MainWindow.IsLoaded) {
            $MainWindow.WindowState = 'Minimized'
        }
    }
    catch {
        Write-UiLog ('FlowCell popout-first startup restore failed: {0}' -f $_.Exception.ToString())
    }
    finally {
        $script:FlowCellStartupRestoreInProgress = $false
        $script:FlowCellPopoutFirstStartupPending = $false
        if ($MainWindow -and $MainWindow.IsLoaded) {
            $MainWindow.WindowState = 'Minimized'
        }
    }
}

function Copy-FlowCellLayoutBounds($Bounds) {
    if ($null -eq $Bounds) { return $null }
    try {
        $width = [double]$(if ($Bounds.PSObject.Properties['Width']) { $Bounds.Width } else { 820 })
        $height = [double]$(if ($Bounds.PSObject.Properties['Height']) { $Bounds.Height } else { 620 })
        $boundsCopy = New-FlowCellPopoutBounds -Left ([double]$(if ($Bounds.PSObject.Properties['Left']) { $Bounds.Left } else { 0 })) -Top ([double]$(if ($Bounds.PSObject.Properties['Top']) { $Bounds.Top } else { 0 })) -Width $width -Height $height
        if (Test-FlowCellPopoutBoundsVisible $boundsCopy) { return $boundsCopy }
        return (Get-FlowCellCenteredPopoutBounds -Width $width -Height $height)
    }
    catch {
        return $null
    }
}

function Get-FlowCellLayoutProgramName([int]$ProgramTabId) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    if ($programTab -and $programTab.PSObject.Properties['Label']) { return [string]$programTab.Label }
    return ''
}

function Get-FlowCellLayoutPanelButtonLabels($Panel, [string[]]$ButtonIds) {
    if ($null -eq $Panel) { return @() }
    $labels = @()
    foreach ($buttonId in @($ButtonIds)) {
        $button = @($Panel.Buttons | Where-Object { [string]$_.Id -eq [string]$buttonId } | Select-Object -First 1)
        if (@($button).Count -gt 0) { $labels += [string]$button[0].Label }
    }
    return @($labels)
}

function Get-FlowCellLayoutPanelButtonIds($Panel) {
    if ($null -eq $Panel) { return @() }
    $buttonIds = @()
    foreach ($button in @($Panel.Buttons)) {
        if ($null -eq $button) { continue }
        if (-not $button.PSObject.Properties['Id']) { continue }
        if ([string]::IsNullOrWhiteSpace([string]$button.Id)) { continue }
        $buttonIds += [string]$button.Id
    }
    return @($buttonIds)
}

function Resolve-FlowCellLayoutProgramState($LayoutEntry) {
    if ($null -eq $LayoutEntry) { return $null }
    $programTabId = if ($LayoutEntry.PSObject.Properties['ProgramTabId']) { [int]$LayoutEntry.ProgramTabId } else { 0 }
    if ($programTabId -gt 0) {
        $programState = Get-FlowCellProgramState -ProgramTabId $programTabId
        if ($programState) { return $programState }
    }

    $programName = if ($LayoutEntry.PSObject.Properties['ProgramName']) { [string]$LayoutEntry.ProgramName } else { '' }
    if ([string]::IsNullOrWhiteSpace($programName)) { return $null }
    $programTab = @($script:State.ProgramTabs | Where-Object { [string]$_.Label -eq $programName } | Select-Object -First 1)
    if (@($programTab).Count -eq 0) { return $null }
    return (Get-FlowCellProgramState -ProgramTabId ([int]$programTab[0].Id))
}

function Resolve-FlowCellLayoutPanel($ProgramState, $LayoutEntry) {
    if ($null -eq $ProgramState -or $null -eq $LayoutEntry) { return $null }
    $panelId = if ($LayoutEntry.PSObject.Properties['PanelId']) { [string]$LayoutEntry.PanelId } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($panelId)) {
        $panel = Get-FlowCellPanel -ProgramState $ProgramState -PanelId $panelId
        if ($panel) { return $panel }
    }

    $panelName = if ($LayoutEntry.PSObject.Properties['PanelName']) { [string]$LayoutEntry.PanelName } elseif ($LayoutEntry.PSObject.Properties['Name']) { [string]$LayoutEntry.Name } else { '' }
    if ([string]::IsNullOrWhiteSpace($panelName)) { return $null }
    $matchingPanel = @($ProgramState.Panels | Where-Object { [string]$_.Name -eq $panelName } | Select-Object -First 1)
    if (@($matchingPanel).Count -gt 0) { return $matchingPanel[0] }
    return $null
}

function Resolve-FlowCellLayoutToolButtonIds($Panel, $ToolPopout) {
    if ($null -eq $Panel -or $null -eq $ToolPopout) { return @() }
    $resolvedIds = @()
    $savedButtonIds = @(
        if ($ToolPopout.PSObject.Properties['ButtonIds']) {
            foreach ($buttonId in @($ToolPopout.ButtonIds)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$buttonId)) { [string]$buttonId }
            }
        }
    )
    $savedButtonLabels = @(
        if ($ToolPopout.PSObject.Properties['ButtonLabels']) {
            foreach ($label in @($ToolPopout.ButtonLabels)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$label)) { [string]$label }
            }
        }
    )

    for ($index = 0; $index -lt [Math]::Max(@($savedButtonIds).Count, @($savedButtonLabels).Count); $index++) {
        $resolvedButton = $null
        if ($index -lt @($savedButtonIds).Count) {
            $buttonId = [string]$savedButtonIds[$index]
            $resolvedButton = @($Panel.Buttons | Where-Object { [string]$_.Id -eq $buttonId } | Select-Object -First 1)
            if (@($resolvedButton).Count -gt 0) { $resolvedButton = $resolvedButton[0] } else { $resolvedButton = $null }
        }
        if ($null -eq $resolvedButton -and $index -lt @($savedButtonLabels).Count) {
            $buttonLabel = [string]$savedButtonLabels[$index]
            $resolvedButton = @($Panel.Buttons | Where-Object { [string]$_.Label -eq $buttonLabel } | Select-Object -First 1)
            if (@($resolvedButton).Count -gt 0) { $resolvedButton = $resolvedButton[0] } else { $resolvedButton = $null }
        }
        if ($resolvedButton -and @($resolvedIds) -notcontains [string]$resolvedButton.Id) {
            $resolvedIds += [string]$resolvedButton.Id
        }
    }
    return @($resolvedIds)
}

function ConvertTo-FlowCellPopoutLayoutPayload($Payload) {
    if ($null -eq $Payload) { return $null }
    if ($Payload.PSObject.Properties['PanelPopouts'] -or ([string]$(if ($Payload.PSObject.Properties['LayoutKind']) { $Payload.LayoutKind } else { '' }) -eq 'PopoutsOnly')) {
        return [pscustomobject]@{
            PanelPopouts = @(
                if ($Payload.PSObject.Properties['PanelPopouts']) {
                    foreach ($panelPopout in @($Payload.PanelPopouts)) {
                        [pscustomobject]@{
                            ProgramTabId = [int]$(if ($panelPopout.PSObject.Properties['ProgramTabId']) { $panelPopout.ProgramTabId } else { 0 })
                            ProgramName = [string]$(if ($panelPopout.PSObject.Properties['ProgramName']) { $panelPopout.ProgramName } else { '' })
                            PanelId = [string]$(if ($panelPopout.PSObject.Properties['PanelId']) { $panelPopout.PanelId } else { '' })
                            PanelName = [string]$(if ($panelPopout.PSObject.Properties['PanelName']) { $panelPopout.PanelName } else { '' })
                            ButtonIds = @(if ($panelPopout.PSObject.Properties['ButtonIds']) { $panelPopout.ButtonIds } else { @() })
                            Bounds = Copy-FlowCellLayoutBounds $(if ($panelPopout.PSObject.Properties['Bounds']) { $panelPopout.Bounds } else { $null })
                        }
                    }
                }
            )
            ToolPopouts = @(
                if ($Payload.PSObject.Properties['ToolPopouts']) {
                    foreach ($toolPopout in @($Payload.ToolPopouts)) {
                        [pscustomobject]@{
                            ProgramTabId = [int]$(if ($toolPopout.PSObject.Properties['ProgramTabId']) { $toolPopout.ProgramTabId } else { 0 })
                            ProgramName = [string]$(if ($toolPopout.PSObject.Properties['ProgramName']) { $toolPopout.ProgramName } else { '' })
                            PanelId = [string]$(if ($toolPopout.PSObject.Properties['PanelId']) { $toolPopout.PanelId } else { '' })
                            PanelName = [string]$(if ($toolPopout.PSObject.Properties['PanelName']) { $toolPopout.PanelName } else { '' })
                            ButtonIds = @(if ($toolPopout.PSObject.Properties['ButtonIds']) { $toolPopout.ButtonIds } else { @() })
                            ButtonLabels = @(if ($toolPopout.PSObject.Properties['ButtonLabels']) { $toolPopout.ButtonLabels } else { @() })
                            LayoutMode = [string](Get-FlowCellNormalizedToolPopoutLayoutMode -LayoutMode $(if ($toolPopout.PSObject.Properties['LayoutMode']) { $toolPopout.LayoutMode } else { 'Group' }))
                            Bounds = Copy-FlowCellLayoutBounds $(if ($toolPopout.PSObject.Properties['Bounds']) { $toolPopout.Bounds } else { $null })
                        }
                    }
                }
            )
            PopoutClusters = @(if ($Payload.PSObject.Properties['PopoutClusters']) { $Payload.PopoutClusters } else { @() })
        }
    }

    $statePayload = if ($Payload.PSObject.Properties['FlowCellState'] -and $Payload.FlowCellState) { $Payload.FlowCellState } else { $Payload }
    if ($null -eq $statePayload -or -not $statePayload.PSObject.Properties['Programs']) { return $null }
    $panelPopouts = @()
    $toolPopouts = @()
    foreach ($program in @($statePayload.Programs)) {
        $programTabId = [int]$(if ($program.PSObject.Properties['ProgramTabId']) { $program.ProgramTabId } else { 0 })
        $programName = Get-FlowCellLayoutProgramName -ProgramTabId $programTabId
        foreach ($panel in @($program.Panels)) {
            if ([bool]$(if ($panel.PSObject.Properties['IsPoppedOut']) { $panel.IsPoppedOut } else { $false })) {
                $panelPopouts += [pscustomobject]@{
                    ProgramTabId = $programTabId
                    ProgramName = $programName
                    PanelId = [string]$(if ($panel.PSObject.Properties['Id']) { $panel.Id } else { '' })
                    PanelName = [string]$(if ($panel.PSObject.Properties['Name']) { $panel.Name } else { '' })
                    ButtonIds = @(Get-FlowCellLayoutPanelButtonIds -Panel $panel)
                    Bounds = Copy-FlowCellLayoutBounds $(if ($panel.PSObject.Properties['PopoutBounds']) { $panel.PopoutBounds } else { $null })
                }
            }
        }
    }
    foreach ($toolPopout in @(if ($statePayload.PSObject.Properties['ToolPopouts']) { $statePayload.ToolPopouts } else { @() })) {
        $converted = ConvertTo-FlowCellToolPopoutState $toolPopout
        if ($null -eq $converted) { continue }
        $savedProgram = @($statePayload.Programs | Where-Object { [int]$_.ProgramTabId -eq [int]$converted.ProgramTabId } | Select-Object -First 1)
        $savedPanel = $null
        if (@($savedProgram).Count -gt 0) {
            $savedPanel = @($savedProgram[0].Panels | Where-Object { [string]$_.Id -eq [string]$converted.PanelId } | Select-Object -First 1)
            if (@($savedPanel).Count -gt 0) { $savedPanel = $savedPanel[0] } else { $savedPanel = $null }
        }
        $toolPopouts += [pscustomobject]@{
            ProgramTabId = [int]$converted.ProgramTabId
            ProgramName = Get-FlowCellLayoutProgramName -ProgramTabId ([int]$converted.ProgramTabId)
            PanelId = [string]$converted.PanelId
            PanelName = [string]$(if ($savedPanel -and $savedPanel.PSObject.Properties['Name']) { $savedPanel.Name } else { '' })
            ButtonIds = @($converted.ButtonIds)
            ButtonLabels = @(Get-FlowCellLayoutPanelButtonLabels -Panel $savedPanel -ButtonIds @($converted.ButtonIds))
            LayoutMode = [string]$converted.LayoutMode
            Bounds = Copy-FlowCellLayoutBounds $converted.Bounds
        }
    }
    return [pscustomobject]@{
        PanelPopouts = @($panelPopouts)
        ToolPopouts = @($toolPopouts)
        PopoutClusters = @(if ($statePayload.PSObject.Properties['PopoutClusters']) { $statePayload.PopoutClusters } else { @() })
    }
}

function Get-FlowCellPopoutLayoutPayload {
    $panelPopouts = @()
    foreach ($program in @($script:FlowCellState.Programs)) {
        foreach ($panel in @($program.Panels)) {
            if (-not [bool]$panel.IsPoppedOut) { continue }
            $panelPopouts += [pscustomobject]@{
                ProgramTabId = [int]$program.ProgramTabId
                ProgramName = Get-FlowCellLayoutProgramName -ProgramTabId ([int]$program.ProgramTabId)
                PanelId = [string]$panel.Id
                PanelName = [string]$panel.Name
                Bounds = Copy-FlowCellLayoutBounds $(if ($panel.PSObject.Properties['PopoutBounds']) { $panel.PopoutBounds } else { $null })
            }
        }
    }

    $toolPopouts = @()
    foreach ($toolPopout in @(if ($script:FlowCellState.PSObject.Properties['ToolPopouts']) { $script:FlowCellState.ToolPopouts } else { @() })) {
        $converted = ConvertTo-FlowCellToolPopoutState $toolPopout
        if ($null -eq $converted) { continue }
        $programState = Get-FlowCellProgramState -ProgramTabId ([int]$converted.ProgramTabId)
        $panel = Get-FlowCellPanel -ProgramState $programState -PanelId ([string]$converted.PanelId)
        $toolPopouts += [pscustomobject]@{
            ProgramTabId = [int]$converted.ProgramTabId
            ProgramName = Get-FlowCellLayoutProgramName -ProgramTabId ([int]$converted.ProgramTabId)
            PanelId = [string]$converted.PanelId
            PanelName = [string]$(if ($panel) { $panel.Name } else { '' })
            ButtonIds = @($converted.ButtonIds | ForEach-Object { [string]$_ })
            ButtonLabels = @(Get-FlowCellLayoutPanelButtonLabels -Panel $panel -ButtonIds @($converted.ButtonIds))
            LayoutMode = [string]$converted.LayoutMode
            Bounds = Copy-FlowCellLayoutBounds $converted.Bounds
        }
    }

    return [pscustomobject]@{
        SavedAt = (Get-Date).ToString('o')
        Version = 3
        LayoutKind = 'PopoutsOnly'
        FlowCellStatePath = $script:FlowCellStatePath
        PanelPopouts = @($panelPopouts)
        ToolPopouts = @($toolPopouts)
        PopoutClusters = @(
            foreach ($clusterState in @(if ($script:FlowCellState.PSObject.Properties['PopoutClusters']) { $script:FlowCellState.PopoutClusters } else { @() })) {
                $convertedCluster = ConvertTo-FlowCellPopoutClusterState $clusterState
                if ($null -eq $convertedCluster) { continue }
                [pscustomobject]@{
                    Id = [string]$convertedCluster.Id
                    MemberIds = @($convertedCluster.MemberIds | ForEach-Object { [string]$_ })
                    GrabberOffset = [pscustomobject]@{
                        X = [double]$convertedCluster.GrabberOffset.X
                        Y = [double]$convertedCluster.GrabberOffset.Y
                    }
                }
            }
        )
    }
}

function Enable-FlowCellPanelWindows {
    foreach ($entry in @(Get-FlowCellAllPopoutWindowEntries)) {
        if ($null -eq $entry -or -not $entry.PSObject.Properties['Window'] -or $null -eq $entry.Window) { continue }
        if (-not $entry.Window.IsLoaded) { continue }
        if ([string]$entry.Window.Tag -in @('closing', 'shutdown')) { continue }
        Set-FlowCellWindowEnabledState -Window $entry.Window -IsEnabled $true
    }
}

function Save-FlowCellLayoutSnapshot {
    param(
        [System.Windows.Window]$MainWindow = $null,
        [string]$Path = ''
    )

    if (-not $script:FlowCellState) { return }
    if ($MainWindow) {
        Save-FlowCellMainWindowBounds -Window $MainWindow
    }
    foreach ($entry in @($script:FlowCellPanelWindows.GetEnumerator())) {
        if ($null -eq $entry.Value -or $null -eq $entry.Value.Window) { continue }
        if (-not $entry.Value.Window.IsLoaded) { continue }
        $keyParts = ([string]$entry.Key).Split('|', 2)
        if (@($keyParts).Count -ne 2) { continue }
        $programTabId = [int]$keyParts[0]
        $panelId = [string]$keyParts[1]
        Save-FlowCellPanelWindowBounds -Window $entry.Value.Window -ProgramTabId $programTabId -PanelId $panelId
        $programState = Get-FlowCellProgramState -ProgramTabId $programTabId
        $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $panelId
        if ($panel) { $panel.IsPoppedOut = $true }
    }
    foreach ($entry in @($script:FlowCellToolPopoutWindows.GetEnumerator())) {
        if ($null -eq $entry.Value -or $null -eq $entry.Value.Window) { continue }
        if (-not $entry.Value.Window.IsLoaded) { continue }
        if (-not $entry.Value.PSObject.Properties['ProgramTabId'] -or -not $entry.Value.PSObject.Properties['PanelId'] -or -not $entry.Value.PSObject.Properties['ButtonIds'] -or -not $entry.Value.PSObject.Properties['LayoutMode']) { continue }
        Save-FlowCellToolPopoutWindowBounds -Window $entry.Value.Window -ProgramTabId ([int]$entry.Value.ProgramTabId) -PanelId ([string]$entry.Value.PanelId) -ButtonIds @($entry.Value.ButtonIds) -LayoutMode ([string]$entry.Value.LayoutMode)
    }
    Save-FlowCellState
    $layoutPayload = Get-FlowCellPopoutLayoutPayload
    New-Item -ItemType Directory -Path $script:FlowCellLayoutsRoot -Force | Out-Null
    $layoutPath = if ([string]::IsNullOrWhiteSpace($Path)) { Join-Path $script:FlowCellLayoutsRoot 'last_layout.json' } else { [string]$Path }
    Set-Content -LiteralPath $layoutPath -Value ($layoutPayload | ConvertTo-Json -Depth 12) -Encoding UTF8
    return $layoutPath
}

function Import-FlowCellLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [System.Windows.Window]$MainWindow = $null,
        [scriptblock]$OnStateChanged = $null
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Layout file was not found.' }
    $payload = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $layoutPayload = ConvertTo-FlowCellPopoutLayoutPayload $payload
    if ($null -eq $layoutPayload) {
        throw 'Layout file is missing FlowCell popout layout data.'
    }

    Close-FlowCellToolPopoutWindows
    Close-FlowCellPanelWindowsForLayout

    foreach ($programState in @($script:FlowCellState.Programs)) {
        foreach ($panel in @($programState.Panels)) {
            $panel.IsPoppedOut = $false
        }
    }
    if ($script:FlowCellState.PSObject.Properties['ToolPopouts']) {
        $script:FlowCellState.ToolPopouts = @()
    }
    else {
        $script:FlowCellState | Add-Member -MemberType NoteProperty -Name ToolPopouts -Value @()
    }
    if ($script:FlowCellState.PSObject.Properties['PopoutClusters']) {
        $script:FlowCellState.PopoutClusters = @()
    }
    else {
        $script:FlowCellState | Add-Member -MemberType NoteProperty -Name PopoutClusters -Value @()
    }

    $popoutIdMap = @{}
    $restoredPanelCount = 0
    foreach ($panelPopout in @($layoutPayload.PanelPopouts)) {
        $programState = Resolve-FlowCellLayoutProgramState $panelPopout
        $panel = Resolve-FlowCellLayoutPanel -ProgramState $programState -LayoutEntry $panelPopout
        if ($null -eq $programState -or $null -eq $panel) { continue }
        if ($panelPopout.PSObject.Properties['ButtonIds']) {
            [void](Set-FlowCellPanelButtonOrder -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id) -ButtonIds @($panelPopout.ButtonIds))
        }
        $bounds = Copy-FlowCellLayoutBounds $(if ($panelPopout.PSObject.Properties['Bounds']) { $panelPopout.Bounds } else { $null })
        if ($bounds) { $panel.PopoutBounds = $bounds }
        $panel.IsPoppedOut = $true
        $restoredPanelCount += 1

        $oldProgramTabId = [int]$(if ($panelPopout.PSObject.Properties['ProgramTabId']) { $panelPopout.ProgramTabId } else { $programState.ProgramTabId })
        $oldPanelId = [string]$(if ($panelPopout.PSObject.Properties['PanelId']) { $panelPopout.PanelId } else { $panel.Id })
        $oldPopoutId = Get-FlowCellPanelPopoutId -ProgramTabId $oldProgramTabId -PanelId $oldPanelId
        $newPopoutId = Get-FlowCellPanelPopoutId -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id)
        $popoutIdMap[[string]$oldPopoutId] = [string]$newPopoutId
    }

    $restoredToolCount = 0
    foreach ($toolPopout in @($layoutPayload.ToolPopouts)) {
        $programState = Resolve-FlowCellLayoutProgramState $toolPopout
        $panel = Resolve-FlowCellLayoutPanel -ProgramState $programState -LayoutEntry $toolPopout
        if ($null -eq $programState -or $null -eq $panel) { continue }
        $buttonIds = @(Resolve-FlowCellLayoutToolButtonIds -Panel $panel -ToolPopout $toolPopout)
        if (@($buttonIds).Count -eq 0) { continue }
        $layoutMode = Get-FlowCellNormalizedToolPopoutLayoutMode -LayoutMode $(if ($toolPopout.PSObject.Properties['LayoutMode']) { [string]$toolPopout.LayoutMode } else { 'Group' })
        $bounds = Copy-FlowCellLayoutBounds $(if ($toolPopout.PSObject.Properties['Bounds']) { $toolPopout.Bounds } else { $null })
        Set-FlowCellToolPopoutState -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id) -ButtonIds @($buttonIds) -LayoutMode $layoutMode -Bounds $bounds | Out-Null
        $restoredToolCount += 1

        $oldProgramTabId = [int]$(if ($toolPopout.PSObject.Properties['ProgramTabId']) { $toolPopout.ProgramTabId } else { $programState.ProgramTabId })
        $oldPanelId = [string]$(if ($toolPopout.PSObject.Properties['PanelId']) { $toolPopout.PanelId } else { $panel.Id })
        $savedButtonIds = @(if ($toolPopout.PSObject.Properties['ButtonIds']) { $toolPopout.ButtonIds } else { @() })
        for ($index = 0; $index -lt [Math]::Min(@($savedButtonIds).Count, @($buttonIds).Count); $index++) {
            $oldPopoutId = Get-FlowCellToolButtonPopoutId -ProgramTabId $oldProgramTabId -PanelId $oldPanelId -ButtonId ([string]$savedButtonIds[$index])
            $newPopoutId = Get-FlowCellToolButtonPopoutId -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id) -ButtonId ([string]$buttonIds[$index])
            $popoutIdMap[[string]$oldPopoutId] = [string]$newPopoutId
        }
    }

    $clusterStates = @()
    foreach ($clusterState in @($layoutPayload.PopoutClusters)) {
        $convertedCluster = ConvertTo-FlowCellPopoutClusterState $clusterState
        if ($null -eq $convertedCluster) { continue }
        $memberIds = @(
            foreach ($memberId in @($convertedCluster.MemberIds)) {
                if ($popoutIdMap.ContainsKey([string]$memberId)) {
                    [string]$popoutIdMap[[string]$memberId]
                }
            }
        ) | Select-Object -Unique
        if (@($memberIds).Count -lt 2) { continue }
        $clusterStates += [pscustomobject]@{
            Id = [string]$convertedCluster.Id
            MemberIds = @($memberIds)
            GrabberOffset = $convertedCluster.GrabberOffset
        }
    }
    Set-FlowCellStatePopoutClusters -ClusterStates @($clusterStates)

    Write-UiLog ('Imported FlowCell popout layout. PoppedOutCount={0}; ToolPopoutCount={1}; Path={2}' -f $restoredPanelCount, $restoredToolCount, $Path)
    Restore-FlowCellPoppedOutPanels -OnStateChanged $OnStateChanged
    Restore-FlowCellToolPopouts -OnStateChanged $OnStateChanged
    Invoke-FlowCellClusterSafe 'import-layout' { Restore-FlowCellPopoutClusters } | Out-Null
    Save-FlowCellState
    return $payload
}

function Get-FlowCellLayoutFileRows {
    New-Item -ItemType Directory -Path $script:FlowCellLayoutsRoot -Force | Out-Null
    $rows = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $script:FlowCellLayoutsRoot -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*.flowlayout.json' -or $_.Name -like '*.json' } | Sort-Object LastWriteTime -Descending)) {
        $savedAt = ''
        $popoutDetails = ''
        try {
            $payload = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
            if ($payload -and $payload.PSObject.Properties['SavedAt']) { $savedAt = [string]$payload.SavedAt }
            $layoutPayload = ConvertTo-FlowCellPopoutLayoutPayload $payload
            if ($layoutPayload) {
                $popoutDetails = ('Panels {0}  Tools {1}' -f @($layoutPayload.PanelPopouts).Count, @($layoutPayload.ToolPopouts).Count)
            }
        }
        catch {
        }
        $details = 'Modified {0:g}' -f $file.LastWriteTime
        if (-not [string]::IsNullOrWhiteSpace($popoutDetails)) {
            $details = '{0}  {1}' -f $details, $popoutDetails
        }
        if (-not [string]::IsNullOrWhiteSpace($savedAt)) {
            $details = '{0}  Saved {1}' -f $details, $savedAt
        }
        $rows += [pscustomobject]@{
            Name = [System.IO.Path]::GetFileNameWithoutExtension([string]$file.Name)
            DisplayName = [string]$file.Name
            Path = [string]$file.FullName
            Details = $details
        }
    }
    return @($rows)
}

function Show-FlowCellLayoutPickerDialog([System.Windows.Window]$OwnerWindow = $null) {
    $layoutRows = @(Get-FlowCellLayoutFileRows)
    if (@($layoutRows).Count -eq 0) {
        throw 'No saved layout files were found.'
    }

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Load Layout"
        Width="560"
        Height="420"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF1D2128"
        Foreground="#FFF2F2F2">
    <Border Margin="12" Padding="12" Background="#FF262B33" CornerRadius="8">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Grid.Row="0" Text="Choose a saved layout" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10" />
            <ListBox x:Name="LayoutList" Grid.Row="1" Background="#FF171B22" Foreground="#FFF2F2F2" BorderBrush="#FF4B5563" BorderThickness="1" DisplayMemberPath="DisplayName" />
            <TextBlock x:Name="LayoutDetailsText" Grid.Row="2" Margin="0,10,0,10" TextWrapping="Wrap" Foreground="#FFB6C2CF" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="LoadButton" Width="94" Height="32" Margin="0,0,8,0" Background="#FF74C4FF" Foreground="#FF11151A">Load</Button>
                <Button x:Name="CancelButton" Width="94" Height="32" Background="#FF3A424F" Foreground="#FFF2F2F2">Cancel</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    if ($OwnerWindow) { $dialog.Owner = $OwnerWindow }
    $listBox = $dialog.FindName('LayoutList')
    $detailsText = $dialog.FindName('LayoutDetailsText')
    foreach ($row in @($layoutRows)) {
        [void]$listBox.Items.Add($row)
    }
    if ($listBox.Items.Count -gt 0) {
        $listBox.SelectedIndex = 0
        $detailsText.Text = [string]$listBox.SelectedItem.Details
    }

    $script:__flowCellSelectedLayoutPath = ''
    $commitSelection = {
        if ($null -eq $listBox.SelectedItem) { return }
        $script:__flowCellSelectedLayoutPath = [string]$listBox.SelectedItem.Path
        $dialog.DialogResult = $true
        $dialog.Close()
    }
    $listBox.Add_SelectionChanged({
        if ($listBox.SelectedItem) {
            $detailsText.Text = [string]$listBox.SelectedItem.Details
        }
    })
    $listBox.Add_MouseDoubleClick({ & $commitSelection }.GetNewClosure())
    $dialog.FindName('LoadButton').Add_Click({ & $commitSelection }.GetNewClosure())
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })

    if ($dialog.ShowDialog()) {
        return [string]$script:__flowCellSelectedLayoutPath
    }
    return ''
}

function Get-FlowCellProgramPanelSaveFolder([int]$ProgramTabId) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    $folderName = if ($programTab -and -not [string]::IsNullOrWhiteSpace([string]$programTab.Label)) { [string]$programTab.Label } else { 'Program' }
    $safeName = ($folderName -replace '[\\/:*?"<>|]+', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($safeName)) { $safeName = 'Program' }
    $folderPath = Join-Path $script:FlowCellPanelSavesRoot $safeName
    New-Item -ItemType Directory -Path $folderPath -Force | Out-Null
    return $folderPath
}

function Get-UniqueFlowCellPanelName($ProgramState, [string]$Name) {
    $baseName = if ([string]::IsNullOrWhiteSpace($Name)) { 'Panel' } else { $Name.Trim() }
    $existingNames = @($ProgramState.Panels | ForEach-Object { [string]$_.Name })
    if ($existingNames -notcontains $baseName) { return $baseName }
    $index = 2
    while ($existingNames -contains ('{0} {1}' -f $baseName, $index)) {
        $index += 1
    }
    return ('{0} {1}' -f $baseName, $index)
}

function Export-FlowCellPanel($Panel, [int]$ProgramTabId, [string]$Path) {
    if ($null -eq $Panel) { throw 'No panel is selected.' }
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    $payload = [pscustomobject]@{
        ExportedAt = (Get-Date).ToString('o')
        ProgramTabId = [int]$ProgramTabId
        ProgramName = if ($programTab) { [string]$programTab.Label } else { '' }
        Panel = [pscustomobject]@{
            Name = [string]$Panel.Name
            PopoutBounds = if ($Panel.PSObject.Properties['PopoutBounds'] -and $Panel.PopoutBounds) {
                [pscustomobject]@{
                    Left = [double]$Panel.PopoutBounds.Left
                    Top = [double]$Panel.PopoutBounds.Top
                    Width = [double]$Panel.PopoutBounds.Width
                    Height = [double]$Panel.PopoutBounds.Height
                }
            } else { $null }
            Buttons = @(
                foreach ($button in @($Panel.Buttons)) {
                    [pscustomobject]@{
                        Kind = [string]$button.Kind
                        command_id = [string](Get-FlowCellButtonCommandId $button)
                        Label = [string]$button.Label
                        Target = [string]$button.Target
                        Tooltip = if ($button.PSObject.Properties['Tooltip']) { [string]$button.Tooltip } else { '' }
                        Shortcut = if ($button.PSObject.Properties['Shortcut']) { [string]$button.Shortcut } else { '' }
                        BindingId = if ($button.PSObject.Properties['BindingId']) { [int]$button.BindingId } else { 0 }
                        style_group_id = [string]$(if ($button.PSObject.Properties['style_group_id']) { $button.style_group_id } elseif ($button.PSObject.Properties['StyleGroupId']) { $button.StyleGroupId } else { '' })
                        compound_tool_id = [string]$(if ($button.PSObject.Properties['compound_tool_id']) { $button.compound_tool_id } elseif ($button.PSObject.Properties['CompoundToolId']) { $button.CompoundToolId } elseif (Test-FlowCellLegacyAlignmentToolTarget ([string]$button.Target)) { 'alignment' } else { '' })
                    }
                }
            )
        }
    }
    Set-Content -LiteralPath $Path -Value ($payload | ConvertTo-Json -Depth 8) -Encoding UTF8
}

function Import-FlowCellPanel([int]$ProgramTabId, [string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Panel file was not found.' }
    $raw = Get-Content -LiteralPath $Path -Raw
    $payload = $raw | ConvertFrom-Json
    if ($null -eq $payload -or -not $payload.PSObject.Properties['Panel'] -or $null -eq $payload.Panel) {
        throw 'Panel file is missing Panel data.'
    }
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    if ($null -eq $programState) { throw 'Current program was not found.' }
    $importedPanel = New-FlowCellPanelState -Name (Get-UniqueFlowCellPanelName -ProgramState $programState -Name ([string]$payload.Panel.Name))
    if ($payload.Panel.PSObject.Properties['PopoutBounds'] -and $payload.Panel.PopoutBounds) {
        $importedPanel.PopoutBounds = New-FlowCellPopoutBounds -Left ([double]$payload.Panel.PopoutBounds.Left) -Top ([double]$payload.Panel.PopoutBounds.Top) -Width ([double]$payload.Panel.PopoutBounds.Width) -Height ([double]$payload.Panel.PopoutBounds.Height)
    }
    $importedPanel.Buttons = @(
        foreach ($button in @($payload.Panel.Buttons)) {
            [pscustomobject]@{
                Id = 'button_{0}' -f [guid]::NewGuid().ToString('N')
                Kind = [string]$button.Kind
                command_id = [string](Get-FlowCellButtonCommandId $button)
                Label = [string]$button.Label
                Target = [string]$button.Target
                Tooltip = if ($button.PSObject.Properties['Tooltip']) { [string]$button.Tooltip } else { '' }
                Shortcut = if ($button.PSObject.Properties['Shortcut']) { [string]$button.Shortcut } else { '' }
                BindingId = if ($button.PSObject.Properties['BindingId']) { [int]$button.BindingId } else { 0 }
                style_group_id = [string]$(if ($button.PSObject.Properties['style_group_id']) { $button.style_group_id } elseif ($button.PSObject.Properties['StyleGroupId']) { $button.StyleGroupId } else { '' })
                compound_tool_id = [string]$(if ($button.PSObject.Properties['compound_tool_id']) { $button.compound_tool_id } elseif ($button.PSObject.Properties['CompoundToolId']) { $button.CompoundToolId } elseif (Test-FlowCellLegacyAlignmentToolTarget ([string]$button.Target)) { 'alignment' } else { '' })
            }
        }
    )
    $programState.Panels += $importedPanel
    $programState.SelectedPanelId = [string]$importedPanel.Id
    return $importedPanel
}

function Reset-FlowCellPopoutState {
    if (-not $script:FlowCellState) { return }
    foreach ($program in @($script:FlowCellState.Programs)) {
        foreach ($panel in @($program.Panels)) {
            $panel.IsPoppedOut = $false
        }
    }
    Save-FlowCellState
}

function Get-FlowCellButtonScale {
    if ($script:FlowCellState -and $script:FlowCellState.PSObject.Properties['ButtonScale']) {
        $scale = [double]$script:FlowCellState.ButtonScale
        if ($scale -lt 0.2) { return 0.2 }
        if ($scale -gt 1.0) { return 1.0 }
        return $scale
    }
    return 1.0
}

function Get-FlowCellButtonStyleGroupId($Button) {
    if ($null -eq $Button) { return '' }
    if ($Button.PSObject.Properties['style_group_id']) {
        return [string]$Button.style_group_id
    }
    if ($Button.PSObject.Properties['StyleGroupId']) {
        $legacyValue = [string]$Button.StyleGroupId
        if (-not $Button.PSObject.Properties['style_group_id']) {
            $Button | Add-Member -MemberType NoteProperty -Name style_group_id -Value $legacyValue
        }
        $Button.PSObject.Properties.Remove('StyleGroupId')
        return $legacyValue
    }
    return ''
}

function Get-FlowCellButtonCompoundToolId($Button) {
    if ($null -eq $Button) { return '' }
    if ($Button.PSObject.Properties['compound_tool_id']) {
        return [string]$Button.compound_tool_id
    }
    if ($Button.PSObject.Properties['CompoundToolId']) {
        $legacyValue = [string]$Button.CompoundToolId
        if (-not $Button.PSObject.Properties['compound_tool_id']) {
            $Button | Add-Member -MemberType NoteProperty -Name compound_tool_id -Value $legacyValue
        }
        $Button.PSObject.Properties.Remove('CompoundToolId')
        return $legacyValue
    }
    return ''
}

function Test-FlowCellLegacyAlignmentToolTarget([string]$Target) {
    if ([string]::IsNullOrWhiteSpace($Target)) { return $false }
    $fileName = [string]([System.IO.Path]::GetFileName($Target)).ToLowerInvariant()
    return ($fileName -in @('util_alignment_tools.ps1', 'util_flowcell_custom_util_alignment_tools.ps1'))
}

function Test-FlowCellLegacySmartAxisStateTarget([string]$Target) {
    if ([string]::IsNullOrWhiteSpace($Target)) { return $false }
    switch ([string]([System.IO.Path]::GetFileName($Target)).ToLowerInvariant()) {
        'util_smart_axis_base.ps1' { return $true }
        'util_smart_axis_x.ps1' { return $true }
        'util_smart_axis_y.ps1' { return $true }
        'util_smart_axis_z.ps1' { return $true }
        'util_smart_axis_live.ps1' { return $true }
        default { return $false }
    }
}

function Get-FlowCellSmartAxisStateButtonsFromPanel($Panel) {
    if ($null -eq $Panel -or -not $Panel.PSObject.Properties['Buttons']) { return @() }
    return @(
        foreach ($panelButton in @($Panel.Buttons)) {
            if (Test-FlowCellSmartAxisStateButton $panelButton) {
                Ensure-FlowCellButtonStateLayer $panelButton
            }
        }
    )
}

function Get-FlowCellSmartAxisOwnerButtonFromPanel($Panel) {
    $smartAxisButtons = @(Get-FlowCellSmartAxisStateButtonsFromPanel -Panel $Panel)
    if (@($smartAxisButtons).Count -eq 0) { return $null }

    $baseButton = @(
        $smartAxisButtons |
            Where-Object {
                [string]([System.IO.Path]::GetFileName([string]$_.Target)).ToLowerInvariant() -eq 'util_smart_axis_base.ps1'
            } |
            Select-Object -First 1
    )
    if (@($baseButton).Count -gt 0) {
        return $baseButton[0]
    }

    return $smartAxisButtons[0]
}

function Get-FlowCellSmartAxisGroupTooltip {
    return 'Smart Axis Lock controls: Base stores the baseline, X/Y/Z cycle axis pinning, and Live toggles live pinning.'
}

function Get-FlowCellRenderedButtonCount {
    param(
        [object[]]$Buttons
    )

    $count = 0
    $smartAxisRendered = $false
    foreach ($button in @($Buttons)) {
        if ($null -eq $button) { continue }
        if (Test-FlowCellSmartAxisStateButton $button) {
            if ($smartAxisRendered) { continue }
            $smartAxisRendered = $true
        }
        $count += 1
    }
    return $count
}

function Get-FlowCellButtonCommandId($Button) {
    if ($null -eq $Button) { return '' }
    if ($Button.PSObject.Properties['command_id'] -and -not [string]::IsNullOrWhiteSpace([string]$Button.command_id)) {
        return [string]$Button.command_id
    }
    if ($Button.PSObject.Properties['CommandId'] -and -not [string]::IsNullOrWhiteSpace([string]$Button.CommandId)) {
        return [string]$Button.CommandId
    }

    switch ([string]$(if ($Button.PSObject.Properties['Kind']) { $Button.Kind } else { '' })) {
        'script' { return 'flowcell.run_script' }
        'macro' { return 'flowcell.run_macro' }
        'tool_action' { return 'flowcell.run_tool_action' }
        'builtin' { return 'flowcell.run_builtin' }
        default { return '' }
    }
}

function Ensure-FlowCellButtonStateLayer($Button) {
    if ($null -eq $Button) { return $null }
    $styleGroupId = Get-FlowCellButtonStyleGroupId $Button
    if ($Button.PSObject.Properties['style_group_id']) {
        $Button.style_group_id = [string]$styleGroupId
    }
    else {
        $Button | Add-Member -MemberType NoteProperty -Name style_group_id -Value ([string]$styleGroupId)
    }
    if ($Button.PSObject.Properties['StyleGroupId']) {
        $Button.PSObject.Properties.Remove('StyleGroupId')
    }
    $compoundToolId = Get-FlowCellButtonCompoundToolId $Button
    if ([string]::IsNullOrWhiteSpace($compoundToolId) -and [string]$Button.Kind -eq 'script' -and (Test-FlowCellLegacyAlignmentToolTarget ([string]$Button.Target))) {
        $compoundToolId = 'alignment'
    }
    if ($Button.PSObject.Properties['compound_tool_id']) {
        $Button.compound_tool_id = [string]$compoundToolId
    }
    else {
        $Button | Add-Member -MemberType NoteProperty -Name compound_tool_id -Value ([string]$compoundToolId)
    }
    if ($Button.PSObject.Properties['CompoundToolId']) {
        $Button.PSObject.Properties.Remove('CompoundToolId')
    }
    $commandId = Get-FlowCellButtonCommandId $Button
    if ($Button.PSObject.Properties['command_id']) {
        $Button.command_id = [string]$commandId
    }
    else {
        $Button | Add-Member -MemberType NoteProperty -Name command_id -Value ([string]$commandId)
    }
    if ($Button.PSObject.Properties['CommandId']) {
        $Button.PSObject.Properties.Remove('CommandId')
    }
    return $Button
}

function Get-FlowCellButtonStateTargetCandidates($ProgramTab, [string]$Target) {
    $candidates = New-Object System.Collections.Generic.List[string]
    $addCandidate = {
        param([string]$Candidate)
        if ([string]::IsNullOrWhiteSpace([string]$Candidate)) { return }
        try {
            $resolvedCandidate = [System.IO.Path]::GetFullPath([string]$Candidate)
        }
        catch {
            $resolvedCandidate = [string]$Candidate
        }
        $normalizedCandidate = $resolvedCandidate.Trim().TrimEnd('\')
        if (-not [string]::IsNullOrWhiteSpace($normalizedCandidate) -and -not $candidates.Contains($normalizedCandidate)) {
            [void]$candidates.Add($normalizedCandidate)
        }
    }

    if ([string]::IsNullOrWhiteSpace([string]$Target)) {
        return @()
    }

    $rawTarget = [string]$Target
    if ([System.IO.Path]::IsPathRooted($rawTarget)) {
        & $addCandidate $rawTarget
        return @($candidates)
    }

    $programConfig = Get-FlowCellProgramConfig -ProgramTab $ProgramTab
    $scriptFolder = if ($programConfig -and $programConfig.PSObject.Properties['ScriptFolder']) { [string]$programConfig.ScriptFolder } else { '' }
    $scriptFolderParent = if (-not [string]::IsNullOrWhiteSpace($scriptFolder)) { Split-Path -Parent $scriptFolder } else { '' }
    $trimmedLeafTarget = $rawTarget.Trim().TrimStart('.','\','/')

    if (-not [string]::IsNullOrWhiteSpace($scriptFolder)) {
        & $addCandidate (Join-Path $scriptFolder $trimmedLeafTarget)
    }
    if (-not [string]::IsNullOrWhiteSpace($scriptFolderParent)) {
        & $addCandidate (Join-Path $scriptFolderParent $rawTarget)
        if (-not [string]::IsNullOrWhiteSpace($trimmedLeafTarget)) {
            & $addCandidate (Join-Path $scriptFolderParent $trimmedLeafTarget)
        }
    }

    & $addCandidate (Join-Path $script:FlowCellHomeRoot $rawTarget)
    if (-not [string]::IsNullOrWhiteSpace($trimmedLeafTarget)) {
        & $addCandidate (Join-Path $script:FlowCellHomeRoot $trimmedLeafTarget)
    }
    & $addCandidate $rawTarget
    return @($candidates)
}

function Resolve-FlowCellButtonStateTargetPath($ProgramTab, [string]$Target) {
    $candidates = @(Get-FlowCellButtonStateTargetCandidates -ProgramTab $ProgramTab -Target $Target)
    foreach ($candidate in @($candidates)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [string]$candidate
        }
    }
    if (@($candidates).Count -gt 0) {
        return [string]$candidates[0]
    }
    return [string]$Target
}

function Get-FlowCellButtonStateMetadata {
    param(
        $Button,
        $ProgramTab,
        [string]$PanelId = '',
        [string]$Surface = 'Unknown',
        [switch]$SkipLog
    )

    if ($null -eq $Button -or $null -eq $ProgramTab) {
        return [pscustomobject]@{
            Valid = $false
            ValidationMessage = 'Nothing is selected.'
            Button = $Button
            ProgramTab = $ProgramTab
            ProgramTabId = [int]$(if ($ProgramTab -and $ProgramTab.PSObject.Properties['Id']) { $ProgramTab.Id } else { 0 })
            ProgramLabel = [string]$(if ($ProgramTab -and $ProgramTab.PSObject.Properties['Label']) { $ProgramTab.Label } else { '' })
            PanelId = [string]$PanelId
            PanelName = ''
            ButtonId = [string]$(if ($Button -and $Button.PSObject.Properties['Id']) { $Button.Id } else { '' })
            Label = [string]$(if ($Button -and $Button.PSObject.Properties['Label']) { $Button.Label } else { '' })
            Kind = [string]$(if ($Button -and $Button.PSObject.Properties['Kind']) { $Button.Kind } else { '' })
            Target = [string]$(if ($Button -and $Button.PSObject.Properties['Target']) { $Button.Target } else { '' })
            ResolvedTarget = [string]$(if ($Button -and $Button.PSObject.Properties['Target']) { $Button.Target } else { '' })
            TargetExists = $false
            CommandId = [string](Get-FlowCellButtonCommandId $Button)
            style_group_id = [string](Get-FlowCellButtonStyleGroupId $Button)
            compound_tool_id = [string](Get-FlowCellButtonCompoundToolId $Button)
            Surface = [string]$Surface
            TargetCandidates = @()
            Tool = [string]$(if ($Button -and $Button.PSObject.Properties['Tool']) { $Button.Tool } else { '' })
            Intent = [string]$(if ($Button -and $Button.PSObject.Properties['Intent']) { $Button.Intent } else { '' })
            OwnerButtonId = [string]$(if ($Button -and $Button.PSObject.Properties['OwnerButtonId']) { $Button.OwnerButtonId } else { '' })
            OwnerPanelId = [string]$(if ($Button -and $Button.PSObject.Properties['OwnerPanelId']) { $Button.OwnerPanelId } else { '' })
        }
    }

    $stateButton = Ensure-FlowCellButtonStateLayer $Button
    $programState = Get-FlowCellProgramState -ProgramTabId ([int]$ProgramTab.Id)
    $panel = if (-not [string]::IsNullOrWhiteSpace([string]$PanelId)) { Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId } else { $null }
    $kind = [string]$stateButton.Kind
    $rawTarget = [string]$stateButton.Target
    $resolvedTarget = $rawTarget
    $targetCandidates = @()
    $targetExists = $true
    $validationMessage = ''
    $valid = $true

    if ($kind -eq 'script') {
        $targetCandidates = @(Get-FlowCellButtonStateTargetCandidates -ProgramTab $ProgramTab -Target $rawTarget)
        $resolvedTarget = Resolve-FlowCellButtonStateTargetPath -ProgramTab $ProgramTab -Target $rawTarget
        $targetExists = (-not [string]::IsNullOrWhiteSpace([string]$resolvedTarget)) -and (Test-Path -LiteralPath $resolvedTarget -PathType Leaf)
        if (-not $targetExists) {
            $valid = $false
            $validationMessage = ('Button target was not found. RawTarget={0}; ResolvedTarget={1}' -f $rawTarget, $resolvedTarget)
        }
    }
    elseif ($kind -eq 'tool_action') {
        $resolvedTarget = if ($stateButton.PSObject.Properties['Intent']) { [string]$stateButton.Intent } else { [string]$rawTarget }
        $targetExists = $true
        if (
            -not $stateButton.PSObject.Properties['Tool'] -or
            [string]::IsNullOrWhiteSpace([string]$stateButton.Tool) -or
            (
                (-not $stateButton.PSObject.Properties['Intent']) -and
                [string]::IsNullOrWhiteSpace([string]$rawTarget)
            )
        ) {
            $valid = $false
            $validationMessage = 'Tool action metadata is incomplete.'
        }
    }
    elseif ([string]::IsNullOrWhiteSpace($kind)) {
        $valid = $false
        $validationMessage = 'Button kind is missing from state.'
    }

    $metadata = [pscustomobject]@{
        Valid = [bool]$valid
        ValidationMessage = [string]$validationMessage
        Button = $stateButton
        ProgramTab = $ProgramTab
        ProgramTabId = [int]$ProgramTab.Id
        ProgramLabel = [string]$ProgramTab.Label
        PanelId = [string]$PanelId
        PanelName = [string]$(if ($panel) { $panel.Name } else { '' })
        ButtonId = [string]$(if ($stateButton.PSObject.Properties['Id']) { $stateButton.Id } else { '' })
        Label = [string]$stateButton.Label
        Kind = [string]$kind
        Target = [string]$rawTarget
        ResolvedTarget = [string]$resolvedTarget
        TargetExists = [bool]$targetExists
        CommandId = [string](Get-FlowCellButtonCommandId $stateButton)
        style_group_id = [string](Get-FlowCellButtonStyleGroupId $stateButton)
        compound_tool_id = [string](Get-FlowCellButtonCompoundToolId $stateButton)
        Surface = [string]$Surface
        TargetCandidates = @($targetCandidates)
        Tool = [string]$(if ($stateButton.PSObject.Properties['Tool']) { $stateButton.Tool } else { '' })
        Intent = [string]$(if ($stateButton.PSObject.Properties['Intent']) { $stateButton.Intent } else { '' })
        OwnerButtonId = [string]$(if ($stateButton.PSObject.Properties['OwnerButtonId']) { $stateButton.OwnerButtonId } else { '' })
        OwnerPanelId = [string]$(if ($stateButton.PSObject.Properties['OwnerPanelId']) { $stateButton.OwnerPanelId } else { '' })
    }

    if (-not $SkipLog) {
        Write-UiLog ('State resolved metadata. HostVersion={0}; Surface={1}; ProgramTabId={2}; ProgramLabel={3}; PanelId={4}; PanelName={5}; ButtonId={6}; Label={7}; Kind={8}; Target={9}; ResolvedTarget={10}; style_group_id={11}; Valid={12}' -f `
            $script:FlowCellHostLayerVersion, `
            $metadata.Surface, `
            $metadata.ProgramTabId, `
            $metadata.ProgramLabel, `
            $metadata.PanelId, `
            $metadata.PanelName, `
            $metadata.ButtonId, `
            $metadata.Label, `
            $metadata.Kind, `
            $metadata.Target, `
            $metadata.ResolvedTarget, `
            $metadata.style_group_id, `
            $metadata.Valid)
    }

    return $metadata
}

function Write-FlowCellStateLayerValidation($FlowCellState) {
    if ($null -eq $FlowCellState -or -not ($FlowCellState.PSObject.Properties['Programs'])) { return }
    $validatedCount = 0
    $invalidCount = 0

    foreach ($programState in @($FlowCellState.Programs)) {
        $programTab = Get-FlowCellProgramTab -ProgramTabId ([int]$programState.ProgramTabId)
        if ($null -eq $programTab) { continue }
        foreach ($panel in @($programState.Panels)) {
            foreach ($button in @($panel.Buttons)) {
                $metadata = Get-FlowCellButtonStateMetadata -Button $button -ProgramTab $programTab -PanelId ([string]$panel.Id) -Surface 'StateAudit' -SkipLog
                $validatedCount++
                if (-not [bool]$metadata.Valid) {
                    $invalidCount++
                    Write-UiLog ('State validation failed. HostVersion={0}; ProgramTabId={1}; PanelId={2}; ButtonId={3}; Label={4}; Reason={5}' -f `
                        $script:FlowCellHostLayerVersion, `
                        $metadata.ProgramTabId, `
                        $metadata.PanelId, `
                        $metadata.ButtonId, `
                        $metadata.Label, `
                        $metadata.ValidationMessage)
                }
            }
        }
    }

    Write-UiLog ('State validation summary. HostVersion={0}; ButtonsValidated={1}; InvalidButtons={2}' -f $script:FlowCellHostLayerVersion, $validatedCount, $invalidCount)
}

function Get-FlowCellStyleGroupRoots {
    $roots = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @([string]$script:FlowCellStyleGroupRoot, [string]$script:FlowCellDevStyleGroupRoot)) {
        if ([string]::IsNullOrWhiteSpace([string]$candidate)) { continue }
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }
        if (-not $roots.Contains([string]$candidate)) {
            [void]$roots.Add([string]$candidate)
        }
    }
    return @($roots)
}

function Resolve-FlowCellStyleGroupFolder([string]$StyleGroupId) {
    if ([string]::IsNullOrWhiteSpace([string]$StyleGroupId)) { return '' }
    foreach ($root in @(Get-FlowCellStyleGroupRoots)) {
        $candidate = Join-Path $root ([string]$StyleGroupId)
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return [string]$candidate
        }
    }
    return ''
}

function ConvertTo-FlowCellBrushOrNull([string]$Value) {
    if ([string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    try {
        $converted = [System.Windows.Media.BrushConverter]::new().ConvertFromString([string]$Value)
        if ($converted -is [System.Windows.Media.Brush]) {
            return $converted
        }
    }
    catch {
    }
    return $null
}

function Get-FlowCellBuiltInVisualSkinFallback([string]$StyleGroupId) {
    switch ([string]$StyleGroupId) {
        'alignment_modifier_active' {
            return [pscustomobject]@{
                Background = '#FF79FF33'
                Border = '#FFB4FF90'
                Foreground = '#FF10140C'
            }
        }
        'smart_axis_axis_active' {
            return [pscustomobject]@{
                Background = '#FF79FF33'
                Border = '#FFB4FF90'
                Foreground = '#FF10140C'
            }
        }
        'smart_axis_live_active' {
            return [pscustomobject]@{
                Background = '#FFDC4040'
                Border = '#FFFFA0A0'
                Foreground = '#FFFFFFFF'
            }
        }
        default {
            return $null
        }
    }
}

function Get-FlowCellStyleGroupMetadata([string]$StyleGroupId) {
    $resolvedStyleGroupId = [string]$StyleGroupId
    if ([string]::IsNullOrWhiteSpace($resolvedStyleGroupId)) {
        return [pscustomobject]@{
            StyleGroupId = ''
            Folder = ''
            Metadata = $null
            Succeeded = $false
        }
    }
    if (-not ($script:FlowCellStyleGroupCache -is [hashtable])) {
        $script:FlowCellStyleGroupCache = @{}
    }
    if ($script:FlowCellStyleGroupCache.ContainsKey($resolvedStyleGroupId)) {
        $cached = $script:FlowCellStyleGroupCache[$resolvedStyleGroupId]
        $cachedMetadataPath = [string]$(if ($cached -and $cached.PSObject.Properties['MetadataPath']) { $cached.MetadataPath } else { '' })
        if ($cached -and -not [string]::IsNullOrWhiteSpace($cachedMetadataPath) -and (Test-Path -LiteralPath $cachedMetadataPath -PathType Leaf)) {
            try {
                $lastWriteTicks = (Get-Item -LiteralPath $cachedMetadataPath).LastWriteTimeUtc.Ticks
                if ($cached.PSObject.Properties['LastWriteTicks'] -and [long]$cached.LastWriteTicks -eq [long]$lastWriteTicks) {
                    return $cached
                }
            }
            catch {
            }
        }
    }

    $styleFolder = Resolve-FlowCellStyleGroupFolder -StyleGroupId $resolvedStyleGroupId
    if ([string]::IsNullOrWhiteSpace([string]$styleFolder)) {
        $result = [pscustomobject]@{
            StyleGroupId = $resolvedStyleGroupId
            Folder = ''
            MetadataPath = ''
            LastWriteTicks = 0
            Metadata = $null
            Succeeded = $false
        }
        $script:FlowCellStyleGroupCache[$resolvedStyleGroupId] = $result
        return $result
    }

    $metadataPath = Join-Path $styleFolder 'metadata.json'
    if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
        $result = [pscustomobject]@{
            StyleGroupId = $resolvedStyleGroupId
            Folder = $styleFolder
            MetadataPath = ''
            LastWriteTicks = 0
            Metadata = $null
            Succeeded = $false
        }
        $script:FlowCellStyleGroupCache[$resolvedStyleGroupId] = $result
        return $result
    }

    try {
        $rawMetadata = Get-Content -LiteralPath $metadataPath -Raw
        $metadata = $rawMetadata | ConvertFrom-Json
        $lastWriteTicks = (Get-Item -LiteralPath $metadataPath).LastWriteTimeUtc.Ticks
        $result = [pscustomobject]@{
            StyleGroupId = $resolvedStyleGroupId
            Folder = $styleFolder
            MetadataPath = $metadataPath
            LastWriteTicks = $lastWriteTicks
            Metadata = $metadata
            Succeeded = $true
        }
        $script:FlowCellStyleGroupCache[$resolvedStyleGroupId] = $result
        return $result
    }
    catch {
        Write-UiLog ('Style group metadata load failed. StyleGroupId={0}; Error={1}' -f $resolvedStyleGroupId, $_.Exception.Message)
        $result = [pscustomobject]@{
            StyleGroupId = $resolvedStyleGroupId
            Folder = $styleFolder
            MetadataPath = $metadataPath
            LastWriteTicks = 0
            Metadata = $null
            Succeeded = $false
        }
        $script:FlowCellStyleGroupCache[$resolvedStyleGroupId] = $result
        return $result
    }
}

function New-FlowCellHostVisualState {
    param(
        [string]$Label = '',
        [string]$Icon = '',
        [bool]$IsHovered = $false,
        [bool]$IsSelected = $false,
        [bool]$IsEnabled = $true,
        [double]$Width = [double]::NaN,
        [double]$Height = [double]::NaN,
        [string]$StyleGroupId = '',
        [string]$AccentColor = '#FF74C4FF'
    )

    return [pscustomobject]@{
        Label = [string]$Label
        Icon = [string]$Icon
        IsHovered = [bool]$IsHovered
        IsSelected = [bool]$IsSelected
        IsEnabled = [bool]$IsEnabled
        Width = [double]$Width
        Height = [double]$Height
        style_group_id = [string]$StyleGroupId
        AccentColor = [string]$AccentColor
    }
}

function Test-FlowCellVisualSkinMetadataRenderOnly($Metadata, [ref]$UnsafePath) {
    $UnsafePath.Value = ''
    if ($null -eq $Metadata) { return $true }

    $blockedPattern = '^(action|target|script|scriptpath|command|onclick|handler|binding|bindings|dispatch|execute|run|programtab|panelid|buttonid)$'
    $walk = $null
    $walk = {
        param($Node, [string]$Path)
        if ($null -eq $Node) { return $true }
        if ($Node -is [System.Collections.IDictionary]) {
            foreach ($key in @($Node.Keys)) {
                $segment = [string]$key
                $childPath = if ([string]::IsNullOrWhiteSpace($Path)) { $segment } else { '{0}.{1}' -f $Path, $segment }
                if ($segment -imatch $blockedPattern) {
                    $UnsafePath.Value = $childPath
                    return $false
                }
                if (-not (& $walk $Node[$key] $childPath)) { return $false }
            }
            return $true
        }
        if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [string])) {
            $index = 0
            foreach ($item in $Node) {
                $childPath = '{0}[{1}]' -f $Path, $index
                if (-not (& $walk $item $childPath)) { return $false }
                $index++
            }
            return $true
        }
        if ($Node.PSObject -and $Node.PSObject.Properties.Count -gt 0 -and -not ($Node -is [string])) {
            foreach ($property in @($Node.PSObject.Properties)) {
                $segment = [string]$property.Name
                $childPath = if ([string]::IsNullOrWhiteSpace($Path)) { $segment } else { '{0}.{1}' -f $Path, $segment }
                if ($segment -imatch $blockedPattern) {
                    $UnsafePath.Value = $childPath
                    return $false
                }
                if (-not (& $walk $property.Value $childPath)) { return $false }
            }
        }
        return $true
    }

    return (& $walk $Metadata '')
}

function New-FlowCellHostVisualSkinSurface {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.UIElement]$Content,
        [Parameter(Mandatory = $true)]
        [object]$VisualState,
        [string]$Mode = 'Button'
    )

    $safeShell = New-Object System.Windows.Controls.Border
    $safeShell.Margin = '0'
    $safeShell.Padding = '0'
    $safeShell.CornerRadius = '0'
    $safeShell.SnapsToDevicePixels = $true
    $safeShell.ClipToBounds = $true
    $safeShell.Tag = [pscustomobject]@{
        Layer = 'VisualSkin'
        Sandbox = $true
        RenderOnly = $true
        Mode = [string]$Mode
        style_group_id = [string]$(if ($VisualState.PSObject.Properties['style_group_id']) { $VisualState.style_group_id } else { '' })
    }

    $fallbackBackground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(45,51,61))
    $fallbackBorder = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(116,196,255))
    $safeShell.Background = $fallbackBackground
    $safeShell.BorderBrush = $fallbackBorder
    $safeShell.BorderThickness = '1'

    $styleGroupId = [string]$(if ($VisualState.PSObject.Properties['style_group_id']) { $VisualState.style_group_id } else { '' })
    $styleGroup = [pscustomobject]@{
        Succeeded = $false
    }
    $fallbackForeground = $null
    $builtInSkin = Get-FlowCellBuiltInVisualSkinFallback -StyleGroupId $styleGroupId
    if ($builtInSkin) {
        $builtInBackground = ConvertTo-FlowCellBrushOrNull -Value ([string]$builtInSkin.Background)
        if ($builtInBackground) { $safeShell.Background = $builtInBackground }
        $builtInBorder = ConvertTo-FlowCellBrushOrNull -Value ([string]$builtInSkin.Border)
        if ($builtInBorder) { $safeShell.BorderBrush = $builtInBorder }
        $fallbackForeground = ConvertTo-FlowCellBrushOrNull -Value ([string]$builtInSkin.Foreground)
    }
    if (-not [string]::IsNullOrWhiteSpace($styleGroupId)) {
        try {
            $styleGroup = Get-FlowCellStyleGroupMetadata -StyleGroupId $styleGroupId
            if ($styleGroup -and [bool]$styleGroup.Succeeded -and $styleGroup.Metadata) {
                $unsafePath = ''
                if (-not (Test-FlowCellVisualSkinMetadataRenderOnly -Metadata $styleGroup.Metadata -UnsafePath ([ref]$unsafePath))) {
                    Write-UiLog ('Visual Skin guardrail blocked metadata. HostVersion={0}; style_group_id={1}; UnsafePath={2}' -f $script:FlowCellHostLayerVersion, $styleGroupId, $unsafePath)
                }
                else {
                    $buttonStyle = if ($styleGroup.Metadata.PSObject.Properties['button']) { $styleGroup.Metadata.button } else { $null }
                    if ($buttonStyle) {
                    $bgBrush = ConvertTo-FlowCellBrushOrNull -Value ([string]$(if ($buttonStyle.PSObject.Properties['background']) { $buttonStyle.background } else { '' }))
                    if ($bgBrush) { $safeShell.Background = $bgBrush }
                    $borderBrush = ConvertTo-FlowCellBrushOrNull -Value ([string]$(if ($buttonStyle.PSObject.Properties['border']) { $buttonStyle.border } else { '' }))
                    if ($borderBrush) { $safeShell.BorderBrush = $borderBrush }
                    if ($buttonStyle.PSObject.Properties['border_thickness']) {
                        $safeShell.BorderThickness = [string]$buttonStyle.border_thickness
                    }
                    if ($buttonStyle.PSObject.Properties['corner_radius']) {
                        $safeShell.CornerRadius = [string]$buttonStyle.corner_radius
                    }
                    if ($buttonStyle.PSObject.Properties['padding']) {
                        $safeShell.Padding = [string]$buttonStyle.padding
                    }
                }
                }
            }
        }
        catch {
            Write-UiLog ('Style group render fallback used. StyleGroupId={0}; Error={1}' -f $styleGroupId, $_.Exception.Message)
        }
    }

    Write-UiLog ('Visual Skin rendered host skin. HostVersion={0}; Mode={1}; Label={2}; style_group_id={3}; UsedMetadata={4}; RenderOnly=True' -f `
        $script:FlowCellHostLayerVersion, `
        [string]$Mode, `
        [string]$(if ($VisualState.PSObject.Properties['Label']) { $VisualState.Label } else { '' }), `
        [string]$styleGroupId, `
        [bool]$(if ($styleGroupId) { $styleGroup.Succeeded } else { $false }))
    $safeShell.Child = $Content
    if ($fallbackForeground -and $Content -is [System.Windows.Controls.Control]) {
        $Content.Foreground = $fallbackForeground
    }
    return $safeShell
}

function New-FlowCellHostButtonControl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [object]$Tag,
        [scriptblock]$OnClick = $null,
        [scriptblock]$OnRightClick = $null,
        [string]$Tooltip = '',
        [double]$Width = [double]::NaN,
        [double]$Height = [double]::NaN,
        [string]$Padding = '0',
        [double]$FontSize = 12,
        [string]$HorizontalAlignment = 'Stretch',
        [string]$VerticalAlignment = 'Stretch'
    )

    $buttonControl = New-Object System.Windows.Controls.Button
    $buttonControl.Width = $Width
    $buttonControl.Height = $Height
    $buttonControl.Margin = '0'
    $buttonControl.Padding = [string]$Padding
    $buttonControl.FontSize = [double]$FontSize
    $buttonControl.HorizontalAlignment = [string]$HorizontalAlignment
    $buttonControl.VerticalAlignment = [string]$VerticalAlignment
    $buttonControl.HorizontalContentAlignment = 'Center'
    $buttonControl.VerticalContentAlignment = 'Center'
    $buttonControl.Background = [System.Windows.Media.Brushes]::Transparent
    $buttonControl.BorderBrush = [System.Windows.Media.Brushes]::Transparent
    $buttonControl.BorderThickness = '0'
    $buttonControl.Foreground = [System.Windows.Media.Brushes]::White
    $buttonControl.Content = [string]$Label
    $buttonControl.ToolTip = [string]$Tooltip
    $buttonControl.Tag = $Tag
    if ($OnClick -is [scriptblock]) {
        $buttonControl.Add_Click($OnClick.GetNewClosure())
    }
    if ($OnRightClick -is [scriptblock]) {
        $buttonControl.Add_PreviewMouseRightButtonUp($OnRightClick.GetNewClosure())
    }
    return $buttonControl
}

function New-FlowCellHostTabItemStyle {
    param(
        [string]$Mode = 'ProgramTab',
        [string]$StyleGroupId = ''
    )

    $defaultBackground = ConvertTo-FlowCellBrushOrNull '#FF303743'
    $defaultSelectedBackground = ConvertTo-FlowCellBrushOrNull '#FF74C4FF'
    $defaultHoverBackground = ConvertTo-FlowCellBrushOrNull '#FF3C4654'
    $defaultForeground = [System.Windows.Media.Brushes]::White
    $defaultSelectedForeground = ConvertTo-FlowCellBrushOrNull '#FF11151A'
    $defaultBorder = ConvertTo-FlowCellBrushOrNull '#FF74C4FF'

    if ([string]$Mode -eq 'PanelTab') {
        $defaultBackground = ConvertTo-FlowCellBrushOrNull '#FF2D333D'
        $defaultSelectedBackground = ConvertTo-FlowCellBrushOrNull '#FF79FF33'
        $defaultHoverBackground = ConvertTo-FlowCellBrushOrNull '#FF3B434E'
        $defaultSelectedForeground = ConvertTo-FlowCellBrushOrNull '#FF10140C'
        $defaultBorder = ConvertTo-FlowCellBrushOrNull '#FF79FF33'
    }

    $itemMargin = New-Object System.Windows.Thickness(0,0,0,8)
    if ([string]$Mode -eq 'ProgramTab' -or [string]$Mode -eq 'PanelTab') {
        $itemMargin = New-Object System.Windows.Thickness(0,0,0,8)
    }

    $style = New-Object System.Windows.Style([System.Windows.Controls.ListBoxItem])
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::PaddingProperty, (New-Object System.Windows.Thickness(18,12,18,12)))))
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.FrameworkElement]::MarginProperty, $itemMargin)))
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::BackgroundProperty, $defaultBackground)))
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::ForegroundProperty, $defaultForeground)))
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::BorderThicknessProperty, (New-Object System.Windows.Thickness(0)))))
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::HorizontalContentAlignmentProperty, [System.Windows.HorizontalAlignment]::Center)))
    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::VerticalContentAlignmentProperty, [System.Windows.VerticalAlignment]::Center)))

    $template = New-Object System.Windows.Controls.ControlTemplate([System.Windows.Controls.ListBoxItem])
    $borderFactory = New-Object System.Windows.FrameworkElementFactory([System.Windows.Controls.Border])
    $borderFactory.Name = 'HostBorder'
    $borderFactory.SetValue([System.Windows.Controls.Border]::PaddingProperty, (New-Object System.Windows.TemplateBindingExtension([System.Windows.Controls.Control]::PaddingProperty)))
    $borderFactory.SetValue([System.Windows.Controls.Border]::BackgroundProperty, (New-Object System.Windows.TemplateBindingExtension([System.Windows.Controls.Control]::BackgroundProperty)))
    $borderFactory.SetValue([System.Windows.Controls.Border]::CornerRadiusProperty, (New-Object System.Windows.CornerRadius(12)))
    $borderFactory.SetValue([System.Windows.Controls.Border]::BorderThicknessProperty, (New-Object System.Windows.Thickness(1)))
    $borderFactory.SetValue([System.Windows.Controls.Border]::BorderBrushProperty, $defaultBorder)

    $contentPresenterFactory = New-Object System.Windows.FrameworkElementFactory([System.Windows.Controls.ContentPresenter])
    $contentPresenterFactory.SetValue([System.Windows.Controls.ContentPresenter]::HorizontalAlignmentProperty, (New-Object System.Windows.TemplateBindingExtension([System.Windows.Controls.Control]::HorizontalContentAlignmentProperty)))
    $contentPresenterFactory.SetValue([System.Windows.Controls.ContentPresenter]::VerticalAlignmentProperty, (New-Object System.Windows.TemplateBindingExtension([System.Windows.Controls.Control]::VerticalContentAlignmentProperty)))
    $borderFactory.AppendChild($contentPresenterFactory)
    $template.VisualTree = $borderFactory

    $hoverTrigger = New-Object System.Windows.Trigger
    $hoverTrigger.Property = [System.Windows.Controls.Control]::IsMouseOverProperty
    $hoverTrigger.Value = $true
    [void]$hoverTrigger.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::BackgroundProperty, $defaultHoverBackground)))
    [void]$template.Triggers.Add($hoverTrigger)

    $selectedTrigger = New-Object System.Windows.Trigger
    $selectedTrigger.Property = [System.Windows.Controls.ListBoxItem]::IsSelectedProperty
    $selectedTrigger.Value = $true
    [void]$selectedTrigger.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::BackgroundProperty, $defaultSelectedBackground)))
    [void]$selectedTrigger.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::ForegroundProperty, $defaultSelectedForeground)))
    [void]$template.Triggers.Add($selectedTrigger)

    [void]$style.Setters.Add((New-Object System.Windows.Setter([System.Windows.Controls.Control]::TemplateProperty, $template)))
    return $style
}

function Get-FlowCellButtonSelectionKey([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    return ('{0}|{1}|{2}' -f $ProgramTabId, [string]$PanelId, [string]$ButtonId)
}

function Is-FlowCellButtonSelected([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    $key = Get-FlowCellButtonSelectionKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId
    return ($script:FlowCellSelectedButtonKeys -and $script:FlowCellSelectedButtonKeys.ContainsKey($key))
}

function Toggle-FlowCellButtonSelection([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    $key = Get-FlowCellButtonSelectionKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId
    if (-not $script:FlowCellSelectedButtonKeys) { $script:FlowCellSelectedButtonKeys = @{} }
    if ($script:FlowCellSelectedButtonKeys.ContainsKey($key)) {
        $script:FlowCellSelectedButtonKeys.Remove($key) | Out-Null
    }
    else {
        $script:FlowCellSelectedButtonKeys[$key] = $true
    }
}

function Select-FlowCellButton([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId, [bool]$Exclusive = $true) {
    if ($Exclusive) {
        Clear-FlowCellButtonSelection -ProgramTabId $ProgramTabId -PanelId $PanelId
    }
    $key = Get-FlowCellButtonSelectionKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId
    if (-not $script:FlowCellSelectedButtonKeys) { $script:FlowCellSelectedButtonKeys = @{} }
    $script:FlowCellSelectedButtonKeys[$key] = $true
}

function Clear-FlowCellButtonSelection([int]$ProgramTabId = 0, [string]$PanelId = '') {
    if (-not $script:FlowCellSelectedButtonKeys) { return }
    if ($ProgramTabId -le 0 -and [string]::IsNullOrWhiteSpace($PanelId)) {
        $script:FlowCellSelectedButtonKeys = @{}
        return
    }
    $prefix = '{0}|{1}|' -f $ProgramTabId, [string]$PanelId
    foreach ($key in @($script:FlowCellSelectedButtonKeys.Keys)) {
        if ([string]$key -like ($prefix + '*')) {
            $script:FlowCellSelectedButtonKeys.Remove([string]$key) | Out-Null
        }
    }
}

function Get-FlowCellSelectedButtonEntries([int]$ProgramTabId, [string]$PanelId) {
    $entries = @()
    if (-not $script:FlowCellSelectedButtonKeys) { return @() }
    $prefix = '{0}|{1}|' -f $ProgramTabId, [string]$PanelId
    foreach ($key in @($script:FlowCellSelectedButtonKeys.Keys)) {
        if (-not ([string]$key -like ($prefix + '*'))) { continue }
        $buttonId = ([string]$key).Substring($prefix.Length)
        $entry = Get-FlowCellButtonEntry -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $buttonId
        if ($entry) { $entries += $entry }
    }
    return @($entries)
}

function Get-FlowCellSmartAxisGroupEntries([int]$ProgramTabId, [string]$PanelId) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $programState -or $null -eq $panel) { return @() }

    $entries = @()
    foreach ($button in @($panel.Buttons)) {
        if (-not (Test-FlowCellSmartAxisStateButton $button)) { continue }
        $entry = Get-FlowCellButtonEntry -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId ([string]$button.Id)
        if ($entry) {
            $entries += $entry
        }
    }
    return @($entries)
}

function Get-FlowCellDeleteButtonEntries([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    $selectedEntries = @()
    if (Is-FlowCellButtonSelected -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId) {
        $selectedEntries = @(Get-FlowCellSelectedButtonEntries -ProgramTabId $ProgramTabId -PanelId $PanelId)
    }
    if (@($selectedEntries).Count -gt 0) {
        return @($selectedEntries)
    }
    $singleEntry = Get-FlowCellButtonEntry -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId
    if ($singleEntry) { return @($singleEntry) }
    return @()
}

function Get-FlowCellButtonPopoutTargetKey([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    return (Get-FlowCellButtonSelectionKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId)
}

function Test-FlowCellButtonPopoutTargetOpen([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    if (-not ($script:FlowCellToolPopoutTargets -is [hashtable])) { return $false }
    $targetKey = Get-FlowCellButtonPopoutTargetKey -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $ButtonId
    if (-not $script:FlowCellToolPopoutTargets.ContainsKey($targetKey)) { return $false }
    $windowKey = [string]$script:FlowCellToolPopoutTargets[$targetKey]
    if (-not ($script:FlowCellToolPopoutWindows -is [hashtable])) { return $false }
    if (-not $script:FlowCellToolPopoutWindows.ContainsKey($windowKey)) { return $false }
    $entry = $script:FlowCellToolPopoutWindows[$windowKey]
    if ($null -eq $entry -or $null -eq $entry.Window) { return $false }
    return ($entry.Window.IsLoaded -and [string]$entry.Window.Tag -ne 'closing' -and [string]$entry.Window.Tag -ne 'shutdown')
}

function Show-FlowCellWindowFront($Window) {
    if ($null -eq $Window) { return }
    if (-not $Window.IsLoaded) { return }
    $Window.WindowState = 'Normal'
    $Window.Show()
    $Window.Activate() | Out-Null
    Push-FlowCellWindowAboveOwner -Window $Window
}

function Show-FlowCellExistingToolPopoutForTarget([string]$TargetKey) {
    if (-not ($script:FlowCellToolPopoutTargets -is [hashtable])) { return $false }
    if (-not $script:FlowCellToolPopoutTargets.ContainsKey($TargetKey)) { return $false }
    $windowKey = [string]$script:FlowCellToolPopoutTargets[$TargetKey]
    if (-not ($script:FlowCellToolPopoutWindows -is [hashtable])) { return $false }
    if (-not $script:FlowCellToolPopoutWindows.ContainsKey($windowKey)) { return $false }
    $entry = $script:FlowCellToolPopoutWindows[$windowKey]
    if ($null -eq $entry -or $null -eq $entry.Window -or -not $entry.Window.IsLoaded) { return $false }
    if ([string]$entry.Window.Tag -eq 'closing' -or [string]$entry.Window.Tag -eq 'shutdown') { return $false }
    if ($entry.Refresh -is [scriptblock]) { & $entry.Refresh }
    if ($entry.PSObject.Properties['PopoutId'] -and (Bring-FlowCellPopoutClusterToFrontByPopoutId -PopoutId ([string]$entry.PopoutId))) {
        return $true
    }
    Show-FlowCellWindowFront -Window $entry.Window
    return $true
}

function Get-FlowCellExistingToolPopoutEntryForTarget([string]$TargetKey) {
    if (-not ($script:FlowCellToolPopoutTargets -is [hashtable])) { return $null }
    if (-not $script:FlowCellToolPopoutTargets.ContainsKey($TargetKey)) { return $null }
    $windowKey = [string]$script:FlowCellToolPopoutTargets[$TargetKey]
    if (-not ($script:FlowCellToolPopoutWindows -is [hashtable])) { return $null }
    if (-not $script:FlowCellToolPopoutWindows.ContainsKey($windowKey)) { return $null }
    $entry = $script:FlowCellToolPopoutWindows[$windowKey]
    if ($null -eq $entry -or $null -eq $entry.Window -or -not $entry.Window.IsLoaded) { return $null }
    if ([string]$entry.Window.Tag -eq 'closing' -or [string]$entry.Window.Tag -eq 'shutdown') { return $null }
    return $entry
}

function Get-FlowCellLiveToolPopoutEntriesForTargetKeys([string[]]$TargetKeys) {
    $resolvedTargetKeys = @($TargetKeys | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { [string]$_ })
    if (@($resolvedTargetKeys).Count -eq 0) { return @() }

    $entries = @()
    $seenEntryIds = New-Object System.Collections.Generic.HashSet[string]
    foreach ($targetKey in @($resolvedTargetKeys)) {
        $entry = Get-FlowCellExistingToolPopoutEntryForTarget -TargetKey ([string]$targetKey)
        if (-not $entry) { continue }
        $entryId = if ($entry.PSObject.Properties['PopoutId'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.PopoutId)) {
            [string]$entry.PopoutId
        }
        else {
            [string]$entry.Window.Title
        }
        if ($seenEntryIds.Add($entryId)) {
            $entries += $entry
        }
    }
    return @($entries)
}

function Test-FlowCellToolPopoutEntryMatchesSpec($Entry, [int]$ProgramTabId, [string]$PanelId, [string[]]$ButtonIds, [string]$LayoutMode) {
    if ($null -eq $Entry) { return $false }
    if (-not $Entry.PSObject.Properties['ProgramTabId'] -or [int]$Entry.ProgramTabId -ne $ProgramTabId) { return $false }
    if (-not $Entry.PSObject.Properties['PanelId'] -or [string]$Entry.PanelId -ne [string]$PanelId) { return $false }
    if (-not $Entry.PSObject.Properties['LayoutMode'] -or [string]$Entry.LayoutMode -ne [string]$LayoutMode) { return $false }
    if (-not $Entry.PSObject.Properties['ButtonIds']) { return $false }

    $expectedButtonIds = @($ButtonIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { [string]$_ } | Sort-Object)
    $entryButtonIds = @($Entry.ButtonIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { [string]$_ } | Sort-Object)
    if (@($expectedButtonIds).Count -ne @($entryButtonIds).Count) { return $false }

    for ($index = 0; $index -lt @($expectedButtonIds).Count; $index++) {
        if ([string]$expectedButtonIds[$index] -ne [string]$entryButtonIds[$index]) {
            return $false
        }
    }

    return $true
}

function Close-FlowCellToolPopoutEntry($Entry) {
    if ($null -eq $Entry -or -not $Entry.PSObject.Properties['Window'] -or $null -eq $Entry.Window) { return }
    if (-not $Entry.Window.IsLoaded) { return }
    if ([string]$Entry.Window.Tag -in @('closing', 'shutdown')) { return }
    try {
        $Entry.Window.Close()
    }
    catch {
    }
}

function Get-FlowCellPopoutMode([object]$ModeControl) {
    if ($null -eq $ModeControl) { return 'Group' }
    $selected = $ModeControl.SelectedItem
    if ($selected -and $selected.PSObject.Properties['Content']) {
        $selected = $selected.Content
    }
    $mode = [string]$selected
    if ([string]::IsNullOrWhiteSpace($mode)) { $mode = [string]$ModeControl.Text }
    return (Get-FlowCellNormalizedToolPopoutLayoutMode -LayoutMode $mode)
}

function Get-FlowCellProgramState([int]$ProgramTabId) {
    if (-not $script:FlowCellState) { return $null }
    return ($script:FlowCellState.Programs | Where-Object { $_.ProgramTabId -eq [int]$ProgramTabId } | Select-Object -First 1)
}

function Get-FlowCellProgramTab([int]$ProgramTabId) {
    return ($script:State.ProgramTabs | Where-Object { $_.Id -eq [int]$ProgramTabId } | Select-Object -First 1)
}

function Get-FlowCellSelectedProgramTab {
    return (Get-FlowCellProgramTab -ProgramTabId ([int]$script:FlowCellState.SelectedProgramTabId))
}

function Get-FlowCellSelectedProgramState {
    return (Get-FlowCellProgramState -ProgramTabId ([int]$script:FlowCellState.SelectedProgramTabId))
}

function Get-FlowCellPanel($ProgramState, [string]$PanelId) {
    if ($null -eq $ProgramState) { return $null }
    return ($ProgramState.Panels | Where-Object { [string]$_.Id -eq [string]$PanelId } | Select-Object -First 1)
}

function Get-FlowCellSelectedPanel {
    $programState = Get-FlowCellSelectedProgramState
    if ($null -eq $programState) { return $null }
    return (Get-FlowCellPanel -ProgramState $programState -PanelId ([string]$programState.SelectedPanelId))
}

function Test-FlowCellPanelWindowOpen([int]$ProgramTabId, [string]$PanelId) {
    if (-not $script:FlowCellPanelWindows) { return $false }
    $windowKey = '{0}|{1}' -f $ProgramTabId, [string]$PanelId
    if (-not $script:FlowCellPanelWindows.ContainsKey($windowKey)) { return $false }
    $entry = $script:FlowCellPanelWindows[$windowKey]
    if ($null -eq $entry -or $null -eq $entry.Window) { return $false }
    return ($entry.Window.IsLoaded -and [string]$entry.Window.Tag -ne 'closing' -and [string]$entry.Window.Tag -ne 'shutdown')
}

function Sync-FlowCellButtonsFromBindings {
    if (-not $script:FlowCellState) { return }

    foreach ($programState in @($script:FlowCellState.Programs)) {
        foreach ($panel in @($programState.Panels)) {
            $updatedButtons = @()
            foreach ($button in @($panel.Buttons)) {
                if ([string]$button.Kind -eq 'script') {
                    $bindingId = [int]$(if ($button.PSObject.Properties['BindingId']) { $button.BindingId } else { 0 })
                    $binding = @($script:State.ScriptBindings | Where-Object { $_.Id -eq $bindingId } | Select-Object -First 1)
                    if (
                        @($binding).Count -eq 0 -and
                        $script:State -and
                        $button.PSObject.Properties['Target'] -and
                        -not [string]::IsNullOrWhiteSpace([string]$button.Target)
                    ) {
                        $buttonTarget = [string]$button.Target
                        $programTabId = [int]$(if ($programState.PSObject.Properties['ProgramTabId']) { $programState.ProgramTabId } else { 0 })
                        $binding = @(
                            $script:State.ScriptBindings |
                                Where-Object {
                                    [string]$_.Target -eq $buttonTarget -and
                                    [int]$(if ($_.PSObject.Properties['ProgramTabId']) { $_.ProgramTabId } else { 0 }) -eq $programTabId
                                } |
                                Select-Object -First 1
                        )
                        if (@($binding).Count -eq 0) {
                            $binding = @(
                                $script:State.ScriptBindings |
                                    Where-Object { [string]$_.Target -eq $buttonTarget } |
                                    Select-Object -First 1
                            )
                        }
                    }
                    if (@($binding).Count -gt 0) {
                        $binding = $binding[0]
                        $button.BindingId = [int]$binding.Id
                        $button.Shortcut = Get-CanonicalShortcut -Value ([string]$binding.Shortcut)
                        if (-not [string]::IsNullOrWhiteSpace([string]$binding.Target)) {
                            $button.Target = [string]$binding.Target
                            if ([string]::IsNullOrWhiteSpace([string]$button.Label)) {
                                $button.Label = Get-FlowCellDisplayButtonLabelFromPath -Path ([string]$binding.Target)
                            }
                        }
                    }
                    elseif ($bindingId -gt 0) {
                        $button.Shortcut = ''
                        $button.BindingId = 0
                    }
                }
                elseif ([string]$button.Kind -eq 'macro') {
                    if ($script:State.ActionHotkeys.Contains([string]$button.Target)) {
                        $button.Shortcut = Get-CanonicalShortcut -Value ([string]$script:State.ActionHotkeys[[string]$button.Target])
                    }
                    else {
                        $button.Shortcut = ''
                    }
                    $action = @($script:Actions | Where-Object { $_.Id -eq [string]$button.Target } | Select-Object -First 1)
                    if (@($action).Count -gt 0) {
                        $button.Label = [string]$action[0].Label
                    }
                    else {
                        Write-UiLog ('Preserving macro button with unresolved action target: {0}' -f [string]$button.Target)
                    }
                }
                $button = Ensure-FlowCellButtonStateLayer $button
                $updatedButtons += $button
            }
            $panel.Buttons = @($updatedButtons)
        }
    }
}

function Sync-FlowCellUiFromCurrentState {
    if (-not $script:FlowCellState) { return }
    Sync-FlowCellButtonsFromBindings
    Save-FlowCellState
    Invoke-FlowCellMainRefresh
    Refresh-FlowCellPanelWindows
}

function Repair-FlowCellPopoutState {
    if (-not $script:FlowCellState) { return }
    $stateChanged = $false
    foreach ($programState in @($script:FlowCellState.Programs)) {
        foreach ($panel in @($programState.Panels)) {
            $hasLiveWindow = Test-FlowCellPanelWindowOpen -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$panel.Id)
            if ([bool]$panel.IsPoppedOut -ne $hasLiveWindow) {
                $panel.IsPoppedOut = $hasLiveWindow
                $stateChanged = $true
            }
        }
    }
    if ($stateChanged) {
        Save-FlowCellState
    }
}

function Get-BuiltInActions {
    return @($script:BuiltInActions | ForEach-Object {
        [pscustomobject]@{
            Id = [string]$_.Id
            Label = [string]$_.Label
            Tooltip = [string]$_.Tooltip
            Kind = 'builtin'
        }
    })
}

function Get-RecordedMacroActions {
    if (-not (Test-Path -LiteralPath $script:RecordedActionsDir -PathType Container)) {
        New-Item -ItemType Directory -Path $script:RecordedActionsDir -Force | Out-Null
    }

    $actions = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $script:RecordedActionsDir -Filter '*.ini' -File | Sort-Object Name)) {
        $ini = Parse-Ini -Path $file.FullName
        if (-not $ini.Contains('Action')) { continue }
        $id = [string]$ini.Action.Id
        $label = [string]$ini.Action.Label
        if ([string]::IsNullOrWhiteSpace($id) -or [string]::IsNullOrWhiteSpace($label)) { continue }
        $actions += [pscustomobject]@{
            Id = $id
            Label = $label
            Tooltip = ('Recorded macro from {0}' -f $file.Name)
            Kind = 'recorded'
            Path = $file.FullName
        }
    }
    return @($actions)
}

function Load-Actions {
    $script:Actions = @(
        @(Get-BuiltInActions) +
        @(Get-RecordedMacroActions)
    )
}

function Refresh-ActionSelector {
    if (-not $script:ActionSelector) { return }

    $selectedId = ''
    if ($script:ActionSelector.SelectedValue) { $selectedId = [string]$script:ActionSelector.SelectedValue }
    if ([string]::IsNullOrWhiteSpace($selectedId) -and $script:ActionSelector.SelectedItem) {
        $selectedId = [string]$script:ActionSelector.SelectedItem.Id
    }

    $script:ActionSelector.Items.Clear()
    foreach ($action in $script:Actions) {
        [void]$script:ActionSelector.Items.Add($action)
    }

    if ($script:ActionSelector.Items.Count -eq 0) { return }

    if ($selectedId -and ($script:Actions.Id -contains $selectedId)) {
        $script:ActionSelector.SelectedValue = $selectedId
    }
    elseif ($script:ActionSelector.Items.Count -gt 0) {
        $script:ActionSelector.SelectedIndex = 0
    }
}

function New-RecordedActionId([string]$Name) {
    $slug = ($Name.ToLowerInvariant() -replace '[^a-z0-9]+', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = 'recorded_action' }
    return 'recorded_{0}_{1}' -f $slug, (Get-Date -Format 'yyyyMMdd_HHmmss')
}

function Show-RecordActionDialog {
    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Record Action"
        Width="560"
        Height="320"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Record New Action</TextBlock>
            <TextBlock Grid.Row="1" Text="Give it a name, press Start Recording, do the steps in Illustrator, then press F8 to stop and save. Press F12 to cancel." Margin="0,0,0,14" TextWrapping="Wrap" FontSize="15" />
            <TextBlock Grid.Row="2" Margin="0,0,0,8">Action name</TextBlock>
            <TextBox Grid.Row="3" x:Name="NameTextBox" MinHeight="42" FontSize="16" VerticalContentAlignment="Center" Padding="10,6" />
            <StackPanel Grid.Row="4" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                <Button x:Name="CancelButton" Width="130" Margin="0,0,10,0" Background="#FF6C6C6C">Cancel</Button>
                <Button x:Name="OkButton" Width="150">Start Recording</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $dialogOwner = Get-DialogOwnerWindow
    if ($dialogOwner) { $dialog.Owner = $dialogOwner }

    $textBox = $dialog.FindName('NameTextBox')
    $textBox.Text = 'New Recorded Action'
    $textBox.SelectAll()
    $textBox.Focus() | Out-Null

    $script:__recordActionName = $null
    $accept = {
        $script:__recordActionName = $textBox.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($script:__recordActionName)) { return }
        $dialog.DialogResult = $true
        $dialog.Close()
    }

    $dialog.FindName('OkButton').Add_Click($accept)
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })
    $textBox.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Enter') {
            & $accept
            $eventArgs.Handled = $true
        }
    })

    $shown = $dialog.ShowDialog()
    if ($shown) { return [string]$script:__recordActionName }
    return ''
}

function Read-State {
    $bindingsFileExists = Test-Path -LiteralPath $script:BindingsPath -PathType Leaf
    $ini = Parse-Ini -Path $script:BindingsPath
    $ids = @()
    $nextId = 1
    $programTabIds = @()
    $programTabNextId = 1
    $selectedProgramTabId = 1
    if ($ini.Contains('Meta')) {
        if ($ini.Meta.Contains('Ids') -and $ini.Meta.Ids) { $ids = @($ini.Meta.Ids -split '\|' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }) }
        if ($ini.Meta.Contains('NextId') -and $ini.Meta.NextId -match '^\d+$') { $nextId = [int]$ini.Meta.NextId }
        if ($ini.Meta.Contains('ProgramTabIds') -and $ini.Meta.ProgramTabIds) { $programTabIds = @($ini.Meta.ProgramTabIds -split '\|' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }) }
        if ($ini.Meta.Contains('ProgramTabNextId') -and $ini.Meta.ProgramTabNextId -match '^\d+$') { $programTabNextId = [int]$ini.Meta.ProgramTabNextId }
        if ($ini.Meta.Contains('SelectedProgramTabId') -and $ini.Meta.SelectedProgramTabId -match '^\d+$') { $selectedProgramTabId = [int]$ini.Meta.SelectedProgramTabId }
    }
    $scriptBindings = @()
    foreach ($id in $ids) {
        $section = 'Binding_{0}' -f $id
        if ($ini.Contains($section)) {
            $scriptBindings += [pscustomobject]@{
                Kind = 'script'
                Id = $id
                Shortcut = Get-CanonicalShortcut -Value ([string]$ini[$section].Shortcut)
                Target = Resolve-LegacyWindowsProgramPath -Path ([string]$ini[$section].ScriptPath) -RequireExisting
                Status = 'Active'
                ProgramTabId = if ($ini[$section].Contains('ProgramTabId') -and $ini[$section].ProgramTabId -match '^\d+$') { [int]$ini[$section].ProgramTabId } else { 0 }
            }
        }
    }
    $programTabs = @()
    foreach ($id in $programTabIds) {
        $section = 'ProgramTab_{0}' -f $id
        if ($ini.Contains($section)) {
            $programTabs += (New-FlowCellProgramTab -Id $id `
                -Label $(if ($ini[$section].Contains('Label') -and $ini[$section].Label) { [string]$ini[$section].Label } else { 'Program {0}' -f $id }) `
                -ScriptFolder $(if ($ini[$section].Contains('ScriptFolder')) { Resolve-LegacyWindowsProgramPath -Path ([string]$ini[$section].ScriptFolder) -RequireExisting } else { '' }) `
                -ProgramType $(if ($ini[$section].Contains('ProgramType')) { [string]$ini[$section].ProgramType } else { '' }) `
                -ExePath $(if ($ini[$section].Contains('ExePath')) { [string]$ini[$section].ExePath } else { '' }) `
                -RunMethod $(if ($ini[$section].Contains('RunMethod')) { [string]$ini[$section].RunMethod } else { '' }) `
                -AllowedScriptExtensions $(if ($ini[$section].Contains('AllowedScriptExtensions')) { [string]$ini[$section].AllowedScriptExtensions } else { '' }) `
                -BridgeFolder $(if ($ini[$section].Contains('BridgeFolder')) { [string]$ini[$section].BridgeFolder } else { '' }) `
                -RequiresRestart $([bool]$(if ($ini[$section].Contains('RequiresRestart')) { [string]$ini[$section].RequiresRestart -match '^(1|true)$' } else { $false })) `
                -DefaultPanels $(if ($ini[$section].Contains('DefaultPanels')) { [string]$ini[$section].DefaultPanels } else { '' }) `
                -ProcessNames $(if ($ini[$section].Contains('ProcessNames')) { [string]$ini[$section].ProcessNames } else { '' }) `
                -NormalizedName $(if ($ini[$section].Contains('NormalizedName')) { [string]$ini[$section].NormalizedName } else { '' }))
        }
    }
    if (@($programTabs).Count -eq 0 -and -not $bindingsFileExists) {
        $programTabs = @(Get-DefaultProgramTabs)
    }
    $programTabNextId = [Math]::Max($programTabNextId, (($programTabs | Measure-Object -Property Id -Maximum).Maximum + 1))
    if (@($programTabs).Count -gt 0 -and -not ($programTabIds -contains $selectedProgramTabId)) {
        $selectedProgramTabId = [int]$programTabs[0].Id
    }
    elseif (@($programTabs).Count -eq 0) {
        $selectedProgramTabId = 0
    }
    $actionHotkeys = [ordered]@{}
    if ($ini.Contains('ActionHotkeys')) {
        foreach ($entry in $ini.ActionHotkeys.GetEnumerator()) {
            if ($entry.Value) { $actionHotkeys[$entry.Key] = Get-CanonicalShortcut -Value ([string]$entry.Value) }
        }
    }
    $macroEditorColumns = [ordered]@{
        Number = 44
        Type = 130
        Delay = 84
        X = 84
        Y = 84
        Button = 94
        Count = 78
        Direction = 104
        Text = 260
        Keys = 230
        Script = 320
    }
    if ($ini.Contains('MacroEditorColumns')) {
        foreach ($key in @($macroEditorColumns.Keys)) {
            if ($ini.MacroEditorColumns.Contains($key) -and $ini.MacroEditorColumns[$key] -match '^\d+(\.\d+)?$') {
                $macroEditorColumns[$key] = [double]$ini.MacroEditorColumns[$key]
            }
        }
    }
    $defaultDummyBinding = Get-DefaultDummyMonitorBinding -ProgramTabs @($programTabs)
    if ($null -ne $defaultDummyBinding) {
        $defaultShortcut = Normalize-Shortcut -Value ([string]$defaultDummyBinding.Shortcut)
        $defaultTarget = Resolve-LegacyWindowsProgramPath -Path ([string]$defaultDummyBinding.Target) -RequireExisting
        $existingDefaultBinding = @(
            $scriptBindings |
                Where-Object {
                    (Normalize-Shortcut -Value ([string]$_.Shortcut)) -eq $defaultShortcut -or
                    [string]::Equals(
                        (Resolve-LegacyWindowsProgramPath -Path ([string]$_.Target) -RequireExisting),
                        $defaultTarget,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )
                } |
                Select-Object -First 1
        )
        if (@($existingDefaultBinding).Count -eq 0) {
            $scriptBindings += [pscustomobject]@{
                Kind = 'script'
                Id = [int]$nextId
                Shortcut = [string]$defaultDummyBinding.Shortcut
                Target = [string]$defaultTarget
                Status = 'Active'
                ProgramTabId = [int]$defaultDummyBinding.ProgramTabId
            }
            $nextId = [int]$nextId + 1
        }
    }
    return [pscustomobject]@{
        NextId = [Math]::Max($nextId, 1)
        ScriptBindings = $scriptBindings
        ActionHotkeys = $actionHotkeys
        MacroEditorColumns = $macroEditorColumns
        ProgramTabs = @($programTabs)
        ProgramTabNextId = [Math]::Max($programTabNextId, 1)
        SelectedProgramTabId = if (@($programTabs).Count -gt 0) { [Math]::Max($selectedProgramTabId, 1) } else { 0 }
    }
}

function Resolve-LegacyWindowsProgramPath {
    param(
        [string]$Path,
        [switch]$RequireExisting
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $Path
    }

    $normalizedPath = [System.IO.Path]::GetFullPath($Path)
    $legacyRoot = [System.IO.Path]::GetFullPath((Join-Path $script:FlowCellHomeRoot 'Windows'))
    $managedRoot = [System.IO.Path]::GetFullPath((Join-Path $script:FlowCellHomeRoot 'Programs\Windows'))
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    $candidate = $null

    if ($normalizedPath.Equals($legacyRoot, $comparison)) {
        $candidate = $managedRoot
    }
    elseif ($normalizedPath.StartsWith($legacyRoot + '\', $comparison)) {
        $suffix = $normalizedPath.Substring($legacyRoot.Length).TrimStart('\')
        $candidate = Join-Path $managedRoot $suffix
    }

    if ($candidate) {
        if (-not $RequireExisting -or (Test-Path -LiteralPath $candidate)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    return $normalizedPath
}

function Get-DefaultDummyMonitorBinding {
    param(
        [object[]]$ProgramTabs = @()
    )

    $targetPath = Join-Path $script:FlowCellHomeRoot 'Programs\Windows\Panels\Utility\Launch-DummyMonitorToggle.vbs'
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
        return $null
    }

    $windowsProgramTab = @(
        $ProgramTabs |
            Where-Object { (Get-ProgramLabelKey ([string]$_.Label)) -eq 'windows' } |
            Select-Object -First 1
    )

    return [pscustomobject]@{
        Kind = 'script'
        Shortcut = '^+F2'
        Target = [string]$targetPath
        ProgramTabId = if (@($windowsProgramTab).Count -gt 0) { [int]$windowsProgramTab[0].Id } else { 2 }
    }
}

function Save-State {
    $programsRoot = Get-FlowCellProgramsRoot
    $script:State.ProgramTabs = @(
        foreach ($programTab in @($script:State.ProgramTabs)) {
            if ($null -eq $programTab -or [string]::IsNullOrWhiteSpace([string]$programTab.Label)) {
                continue
            }
            if (Get-FlowCellNamedChildDirectory -RootPath $programsRoot -Name ([string]$programTab.Label)) {
                $programTab
            }
        }
    )
    $validProgramTabIds = @($script:State.ProgramTabs | ForEach-Object { [int]$_.Id })
    $script:State.ScriptBindings = @(
        foreach ($binding in @($script:State.ScriptBindings)) {
            if ($null -eq $binding) { continue }
            $bindingProgramTabId = if ($binding.PSObject.Properties['ProgramTabId']) { [int]$binding.ProgramTabId } else { 0 }
            if ($bindingProgramTabId -le 0 -or @($validProgramTabIds) -contains $bindingProgramTabId) {
                $binding
            }
        }
    )
    if (@($script:State.ProgramTabs).Count -gt 0) {
        if (-not (@($script:State.ProgramTabs).Id -contains [int]$script:State.SelectedProgramTabId)) {
            $script:State.SelectedProgramTabId = [int]$script:State.ProgramTabs[0].Id
        }
    }
    else {
        $script:State.SelectedProgramTabId = 0
    }

    $lines = New-Object System.Collections.Generic.List[string]
    $ids = @($script:State.ScriptBindings | Sort-Object Id | ForEach-Object { $_.Id })
    $programTabIds = @($script:State.ProgramTabs | Sort-Object Id | ForEach-Object { $_.Id })
    $lines.Add('[Meta]')
    $lines.Add('NextId=' + [string]([Math]::Max([int]$script:State.NextId, 1)))
    $lines.Add('Ids=' + (($ids | ForEach-Object { $_.ToString() }) -join '|'))
    $lines.Add('ProgramTabNextId=' + [string]([Math]::Max([int]$script:State.ProgramTabNextId, 1)))
    $lines.Add('ProgramTabIds=' + (($programTabIds | ForEach-Object { $_.ToString() }) -join '|'))
    $lines.Add('SelectedProgramTabId=' + [string]$(if (@($script:State.ProgramTabs).Count -gt 0) { [Math]::Max([int]$script:State.SelectedProgramTabId, 1) } else { 0 }))
    $lines.Add('')
    foreach ($binding in @($script:State.ScriptBindings | Sort-Object Id)) {
        $lines.Add('[Binding_' + [string]$binding.Id + ']')
        $lines.Add('Shortcut=' + (Get-CanonicalShortcut -Value ([string]$binding.Shortcut)))
        $lines.Add('ScriptPath=' + [string]$binding.Target)
        if ($binding.PSObject.Properties['ProgramTabId'] -and [int]$binding.ProgramTabId -gt 0) {
            $lines.Add('ProgramTabId=' + [string][int]$binding.ProgramTabId)
        }
        $lines.Add('')
    }
    foreach ($tab in @($script:State.ProgramTabs | Sort-Object Id)) {
        $lines.Add('[ProgramTab_' + [string]$tab.Id + ']')
        $lines.Add('Label=' + [string]$tab.Label)
        $lines.Add('NormalizedName=' + [string]$(if ($tab.PSObject.Properties['NormalizedName']) { $tab.NormalizedName } else { ([string]$tab.Label).Trim().ToLowerInvariant() }))
        $lines.Add('ScriptFolder=' + [string]$tab.ScriptFolder)
        $lines.Add('ProgramType=' + [string]$(if ($tab.PSObject.Properties['ProgramType']) { $tab.ProgramType } else { '' }))
        $lines.Add('ExePath=' + [string]$(if ($tab.PSObject.Properties['ExePath']) { $tab.ExePath } else { '' }))
        $lines.Add('RunMethod=' + [string]$(if ($tab.PSObject.Properties['RunMethod']) { $tab.RunMethod } else { '' }))
        $lines.Add('AllowedScriptExtensions=' + ((@(if ($tab.PSObject.Properties['AllowedScriptExtensions']) { $tab.AllowedScriptExtensions } else { @() }) | ForEach-Object { [string]$_ }) -join '|'))
        $lines.Add('BridgeFolder=' + [string]$(if ($tab.PSObject.Properties['BridgeFolder']) { $tab.BridgeFolder } else { '' }))
        $lines.Add('RequiresRestart=' + [string]$(if ($tab.PSObject.Properties['RequiresRestart'] -and [bool]$tab.RequiresRestart) { 1 } else { 0 }))
        $lines.Add('DefaultPanels=' + ((@(if ($tab.PSObject.Properties['DefaultPanels']) { $tab.DefaultPanels } else { @() }) | ForEach-Object { [string]$_ }) -join '|'))
        $lines.Add('ProcessNames=' + ((@(if ($tab.PSObject.Properties['ProcessNames']) { $tab.ProcessNames } else { @() }) | ForEach-Object { [string]$_ }) -join '|'))
        $lines.Add('')
    }
    $lines.Add('[ActionHotkeys]')
    foreach ($entry in @($script:State.ActionHotkeys.GetEnumerator() | Sort-Object Key)) {
        $shortcutValue = Get-CanonicalShortcut -Value ([string]$entry.Value)
        if (-not [string]::IsNullOrWhiteSpace([string]$entry.Key) -and $shortcutValue) {
            $lines.Add(([string]$entry.Key + '=' + $shortcutValue))
        }
    }
    $lines.Add('')
    $lines.Add('[MacroEditorColumns]')
    foreach ($entry in $script:State.MacroEditorColumns.GetEnumerator()) {
        $lines.Add(([string]$entry.Key + '=' + [string]$entry.Value))
    }
    Set-Content -LiteralPath $script:BindingsPath -Value (($lines -join [Environment]::NewLine).TrimEnd()) -Encoding Unicode
    if ($script:FlowCellState) {
        Sync-FlowCellUiFromCurrentState
    }
}

function Get-CanonicalShortcut([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    $compact = [regex]::Replace($Value.Trim(), '\s+', '')
    if ([string]::IsNullOrWhiteSpace($compact)) { return '' }

    $altGrPlaceholder = '__FLOWCELL_ALTGR__'
    $compact = $compact.Replace('<^>!', $altGrPlaceholder)
    $compact = $compact.Replace('<^', '^').Replace('>^', '^')
    $compact = $compact.Replace('<!', '!').Replace('>!', '!')
    $compact = $compact.Replace('<+', '+').Replace('>+', '+')
    $compact = $compact.Replace('<#', '#').Replace('>#', '#')
    $compact = $compact.Replace($altGrPlaceholder, '<^>!')
    return $compact
}

function Normalize-Shortcut([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return ([regex]::Replace((Get-CanonicalShortcut -Value $Value).ToLowerInvariant(), '\s+', ''))
}

function Format-ShortcutKeyTokenForDisplay([string]$Token) {
    if ([string]::IsNullOrWhiteSpace($Token)) { return '' }
    $trimmed = $Token.Trim()
    if ($trimmed.StartsWith('{') -and $trimmed.EndsWith('}') -and $trimmed.Length -gt 2) {
        $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
    }

    switch -Regex ($trimmed.ToLowerInvariant()) {
        '^ctrl$|^control$' { return 'Ctrl' }
        '^alt$' { return 'Alt' }
        '^shift$' { return 'Shift' }
        '^esc$|^escape$' { return 'Esc' }
        '^enter$|^return$' { return 'Enter' }
        '^tab$' { return 'Tab' }
        '^space$' { return 'Space' }
        '^backspace$|^bs$' { return 'Backspace' }
        '^delete$|^del$' { return 'Delete' }
        '^insert$|^ins$' { return 'Insert' }
        '^home$' { return 'Home' }
        '^end$' { return 'End' }
        '^pgup$|^prior$' { return 'Page Up' }
        '^pgdn$|^next$' { return 'Page Down' }
        '^up$' { return 'Up' }
        '^down$' { return 'Down' }
        '^left$' { return 'Left' }
        '^right$' { return 'Right' }
        '^capslock$' { return 'Caps Lock' }
        '^numlock$' { return 'Num Lock' }
        '^scrolllock$' { return 'Scroll Lock' }
        '^appskey$' { return 'Menu' }
        '^wheelup$' { return 'Wheel Up' }
        '^wheeldown$' { return 'Wheel Down' }
        '^lbutton$' { return 'Left Mouse' }
        '^rbutton$' { return 'Right Mouse' }
        '^mbutton$' { return 'Middle Mouse' }
        '^f([1-9]|1[0-9]|2[0-4])$' { return $trimmed.ToUpperInvariant() }
        '^[a-z]$' { return $trimmed.ToUpperInvariant() }
        default {
            return $trimmed
        }
    }
}

function Format-ShortcutForDisplay([string]$Shortcut) {
    if ([string]::IsNullOrWhiteSpace($Shortcut)) { return '' }
    $trimmed = $Shortcut.Trim()
    $rawCompact = [regex]::Replace($trimmed, '\s+', '')

    if ($rawCompact -match '[\^!\+]') {
        $parts = New-Object System.Collections.Generic.List[string]
        $index = 0
        while ($index -lt $rawCompact.Length) {
            $remaining = $rawCompact.Substring($index)

            if ($remaining.StartsWith('<^>!')) {
                if (-not $parts.Contains('AltGr')) { $parts.Add('AltGr') }
                $index += 4
                continue
            }
            if ($remaining.StartsWith('<^')) {
                if (-not $parts.Contains('Left Ctrl')) { $parts.Add('Left Ctrl') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('>^')) {
                if (-not $parts.Contains('Right Ctrl')) { $parts.Add('Right Ctrl') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('<!')) {
                if (-not $parts.Contains('Left Alt')) { $parts.Add('Left Alt') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('>!')) {
                if (-not $parts.Contains('Right Alt')) { $parts.Add('Right Alt') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('<+')) {
                if (-not $parts.Contains('Left Shift')) { $parts.Add('Left Shift') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('>+')) {
                if (-not $parts.Contains('Right Shift')) { $parts.Add('Right Shift') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('<#')) {
                if (-not $parts.Contains('Left Win')) { $parts.Add('Left Win') }
                $index += 2
                continue
            }
            if ($remaining.StartsWith('>#')) {
                if (-not $parts.Contains('Right Win')) { $parts.Add('Right Win') }
                $index += 2
                continue
            }

            $currentToken = $rawCompact.Substring($index, 1)
            if ($currentToken -eq '^') {
                if (-not $parts.Contains('Ctrl')) { $parts.Add('Ctrl') }
                $index += 1
                continue
            }
            if ($currentToken -eq '!') {
                if (-not $parts.Contains('Alt')) { $parts.Add('Alt') }
                $index += 1
                continue
            }
            if ($currentToken -eq '+') {
                if (-not $parts.Contains('Shift')) { $parts.Add('Shift') }
                $index += 1
                continue
            }
            if ($currentToken -eq '#') {
                if (-not $parts.Contains('Win')) { $parts.Add('Win') }
                $index += 1
                continue
            }
            break
        }

        $keyToken = if ($index -lt $rawCompact.Length) { $rawCompact.Substring($index) } else { '' }
        $keyDisplay = Format-ShortcutKeyTokenForDisplay -Token $keyToken
        if (-not [string]::IsNullOrWhiteSpace($keyDisplay)) {
            $parts.Add($keyDisplay)
        }
        return (($parts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' + ')
    }

    $tokens = @($trimmed -split '\s*\+\s*' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($tokens.Count -gt 1) {
        return ((@($tokens | ForEach-Object { Format-ShortcutKeyTokenForDisplay -Token $_ }) | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }) -join ' + ')
    }

    return (Format-ShortcutKeyTokenForDisplay -Token $trimmed)
}

function New-ShortcutDisplayItem([string]$RawShortcut) {
    $rawValue = Get-CanonicalShortcut -Value ([string]$RawShortcut)
    return [pscustomobject]@{
        RawShortcut = $rawValue
        Display = if ([string]::IsNullOrWhiteSpace($rawValue)) { '' } else { Format-ShortcutForDisplay -Shortcut $rawValue }
    }
}

function Convert-ShortcutDisplayTokenToRaw([string]$Token) {
    if ([string]::IsNullOrWhiteSpace($Token)) { return '' }
    $trimmed = $Token.Trim()
    switch -Regex ($trimmed.ToLowerInvariant()) {
        '^left\s+ctrl$|^left\s+control$' { return '<^' }
        '^right\s+ctrl$|^right\s+control$' { return '>^' }
        '^ctrl$|^control$' { return '^' }
        '^left\s+alt$' { return '<!' }
        '^right\s+alt$' { return '>!' }
        '^altgr$' { return '<^>!' }
        '^alt$' { return '!' }
        '^left\s+shift$' { return '<+' }
        '^right\s+shift$' { return '>+' }
        '^shift$' { return '+' }
        '^left\s+win(dows)?$' { return '<#' }
        '^right\s+win(dows)?$' { return '>#' }
        '^win(dows)?$' { return '#' }
        '^esc$|^escape$' { return 'Esc' }
        '^enter$|^return$' { return 'Enter' }
        '^tab$' { return 'Tab' }
        '^space$' { return 'Space' }
        '^backspace$|^bs$' { return 'Backspace' }
        '^delete$|^del$' { return 'Delete' }
        '^insert$|^ins$' { return 'Insert' }
        '^home$' { return 'Home' }
        '^end$' { return 'End' }
        '^page\s+up$|^pgup$|^prior$' { return 'PgUp' }
        '^page\s+down$|^pgdn$|^next$' { return 'PgDn' }
        '^up$' { return 'Up' }
        '^down$' { return 'Down' }
        '^left$' { return 'Left' }
        '^right$' { return 'Right' }
        '^caps\s+lock$|^capslock$' { return 'CapsLock' }
        '^num\s+lock$|^numlock$' { return 'NumLock' }
        '^scroll\s+lock$|^scrolllock$' { return 'ScrollLock' }
        '^menu$|^appskey$' { return 'AppsKey' }
        '^f([1-9]|1[0-9]|2[0-4])$' { return $trimmed.ToUpperInvariant() }
        '^[a-z]$' { return $trimmed.ToUpperInvariant() }
        '^[0-9]$' { return $trimmed }
        '^-$|^=$' { return $trimmed }
        default { return '' }
    }
}

function Convert-ShortcutDisplayToRaw([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    $tokens = @($Value.Trim() -split '\s*\+\s*' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if (@($tokens).Count -eq 0) { return '' }

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($token in $tokens) {
        $rawToken = Convert-ShortcutDisplayTokenToRaw -Token $token
        if ([string]::IsNullOrWhiteSpace($rawToken)) { return '' }
        [void]$parts.Add($rawToken)
    }
    return ($parts -join '')
}

function Resolve-ShortcutDisplaySelection([string]$Value, [object[]]$Items) {
    $trimmed = [string]$Value
    if ([string]::IsNullOrWhiteSpace($trimmed)) { return '' }
    $trimmed = $trimmed.Trim()
    foreach ($item in @($Items)) {
        if ($null -eq $item) { continue }
        $rawShortcut = Get-CanonicalShortcut -Value $(if ($item.PSObject.Properties['RawShortcut']) { [string]$item.RawShortcut } else { [string]$item })
        $displayShortcut = if ($item.PSObject.Properties['Display']) { [string]$item.Display } else { Format-ShortcutForDisplay -Shortcut $rawShortcut }
        if ($trimmed -eq $rawShortcut -or $trimmed -eq $displayShortcut) {
            return $rawShortcut
        }
    }
    $displayParsed = Convert-ShortcutDisplayToRaw -Value $trimmed
    if (-not [string]::IsNullOrWhiteSpace($displayParsed)) {
        return (Get-CanonicalShortcut -Value $displayParsed)
    }
    return (Get-CanonicalShortcut -Value $trimmed)
}

function Convert-VirtualKeyCodeToShortcutToken([int]$KeyCode) {
    if ($KeyCode -ge 112 -and $KeyCode -le 123) { return ('F{0}' -f ($KeyCode - 111)) }
    if ($KeyCode -ge 65 -and $KeyCode -le 90) { return ([char]$KeyCode).ToString().ToUpperInvariant() }
    if ($KeyCode -ge 48 -and $KeyCode -le 57) { return [string][char]$KeyCode }
    switch ($KeyCode) {
        189 { return '-' }
        187 { return '=' }
        default { return '' }
    }
}

function Convert-AzeronCodesToShortcut([int[]]$MetaCodes, [int[]]$KeyCodes) {
    if (-not $KeyCodes -or $KeyCodes.Count -ne 1) { return '' }
    $keyToken = Convert-VirtualKeyCodeToShortcutToken -KeyCode ([int]$KeyCodes[0])
    if ([string]::IsNullOrWhiteSpace($keyToken)) { return '' }
    $parts = New-Object System.Collections.Generic.List[string]
    if (@($MetaCodes | Where-Object { $_ -eq 162 -or $_ -eq 163 }).Count) { $parts.Add('^') }
    if (@($MetaCodes | Where-Object { $_ -eq 18 -or $_ -eq 164 -or $_ -eq 165 }).Count) { $parts.Add('!') }
    if (@($MetaCodes | Where-Object { $_ -eq 160 -or $_ -eq 161 }).Count) { $parts.Add('+') }
    $parts.Add($keyToken)
    return ($parts -join '')
}

function Get-AzeronReservedShortcuts {
    $profilePath = $script:AzeronProfilePath
    $profileName = $script:AzeronProfileName
    if ([string]::IsNullOrWhiteSpace($profilePath) -or -not (Test-Path -LiteralPath $profilePath -PathType Leaf)) { return @() }

    $stamp = ''
    try {
        $item = Get-Item -LiteralPath $profilePath
        $stamp = '{0}|{1}' -f $item.LastWriteTimeUtc.Ticks, $item.Length
    } catch {
        return @()
    }

    if ($script:CachedAzeronReservedShortcuts -and $script:CachedAzeronReservedStamp -eq $stamp) {
        return @($script:CachedAzeronReservedShortcuts)
    }

    $results = New-Object System.Collections.Generic.List[string]
    try {
        $raw = Get-Content -LiteralPath $profilePath -Raw
        $json = $raw | ConvertFrom-Json
        $profile = @($json.profiles | Where-Object { [string]$_.name -eq $profileName } | Select-Object -First 1)
        if (-not $profile) {
            $script:CachedAzeronReservedShortcuts = @()
            $script:CachedAzeronReservedStamp = $stamp
            return @()
        }

        foreach ($input in @($profile[0].inputs)) {
            foreach ($pair in @(
                @{ Keys = 'keyValues'; Meta = 'metaValues' },
                @{ Keys = 'keyValuesLong'; Meta = 'metaValuesLong' },
                @{ Keys = 'keyValuesDouble'; Meta = 'metaValuesDouble' }
            )) {
                $keys = @($input.($pair.Keys) | Where-Object { $_ -and $_ -notin @('0', '255') } | ForEach-Object { [int]$_ })
                $meta = @($input.($pair.Meta) | Where-Object { $_ -and $_ -notin @('0', '255') } | ForEach-Object { [int]$_ })
                $shortcut = Convert-AzeronCodesToShortcut -MetaCodes $meta -KeyCodes $keys
                if (-not [string]::IsNullOrWhiteSpace($shortcut)) { $results.Add($shortcut) }
            }
        }
    } catch {
        Write-UiLog ('Azeron shortcut scan failed: {0}' -f $_.Exception.Message)
    }

    $unique = @($results | Select-Object -Unique)
    $script:CachedAzeronReservedShortcuts = $unique
    $script:CachedAzeronReservedStamp = $stamp
    return $unique
}

function Convert-OpusHotkeyToShortcut([string]$Hotkey) {
    if ([string]::IsNullOrWhiteSpace($Hotkey)) { return '' }
    $parts = New-Object System.Collections.Generic.List[string]
    $keyToken = ''
    foreach ($token in @($Hotkey.Trim().ToLowerInvariant().Split('+') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        if ($token -eq 'ctrl') { if (-not $parts.Contains('^')) { $parts.Add('^') }; continue }
        elseif ($token -eq 'alt') { if (-not $parts.Contains('!')) { $parts.Add('!') }; continue }
        elseif ($token -eq 'shift') { if (-not $parts.Contains('+')) { $parts.Add('+') }; continue }
        if ($token -match '^f([1-9]|1[0-2])$') { $keyToken = $token.ToUpperInvariant(); continue }
        if ($token -match '^[a-z]$') { $keyToken = $token.ToUpperInvariant(); continue }
        if ($token -match '^[0-9]$') { $keyToken = $token; continue }
        if ($token -in @('-', '=')) { $keyToken = $token; continue }
        return ''
    }
    if ([string]::IsNullOrWhiteSpace($keyToken)) { return '' }
    $parts.Add($keyToken)
    return ($parts -join '')
}

function Get-OpusReservedShortcuts {
    $base = if (-not [string]::IsNullOrWhiteSpace([string]$script:DirectoryOpusConfigRoot)) {
        [string]$script:DirectoryOpusConfigRoot
    }
    else {
        Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'GPSoftware\Directory Opus'
    }
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { return @() }

    $files = @(
        'ConfigFiles\global_hotkeys.oxc'
        'ConfigFiles\lister_hotkeys.oxc'
        'ConfigFiles\tree_hotkeys.oxc'
        'ConfigFiles\viewer_hotkeys.oxc'
    ) | ForEach-Object { Join-Path $base $_ }

    $existingFiles = @($files | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    if (-not $existingFiles.Count) { return @() }

    $stamp = (@($existingFiles | ForEach-Object {
        $item = Get-Item -LiteralPath $_
        '{0}|{1}|{2}' -f $item.FullName, $item.LastWriteTimeUtc.Ticks, $item.Length
    }) -join ';')

    if ($script:CachedOpusReservedShortcuts -and $script:CachedOpusReservedStamp -eq $stamp) {
        return @($script:CachedOpusReservedShortcuts)
    }

    $results = New-Object System.Collections.Generic.List[string]
    foreach ($path in $existingFiles) {
        try {
            [xml]$xml = Get-Content -LiteralPath $path -Raw
            foreach ($node in @($xml.SelectNodes('/hotkeys/key'))) {
                $hotkeyText = [string]$node.GetAttribute('hotkey')
                if (-not [string]::IsNullOrWhiteSpace($hotkeyText)) {
                    $shortcut = Convert-OpusHotkeyToShortcut -Hotkey $hotkeyText
                    if ($shortcut) { $results.Add($shortcut) }
                }
                foreach ($subKey in @($node.SelectNodes('./hotkeys/key'))) {
                    $subKeyText = [string]$subKey.InnerText
                    $shortcut = Convert-OpusHotkeyToShortcut -Hotkey $subKeyText
                    if ($shortcut) { $results.Add($shortcut) }
                }
            }
        } catch {
            Write-UiLog ('Directory Opus shortcut scan failed for {0}: {1}' -f $path, $_.Exception.Message)
        }
    }

    $unique = @($results | Select-Object -Unique)
    $script:CachedOpusReservedShortcuts = $unique
    $script:CachedOpusReservedStamp = $stamp
    return $unique
}

function Build-Candidates {
    $list = New-Object System.Collections.Generic.List[string]
    $functionKeys = @('F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12')
    $numberKeys = @('1','2','3','4','5','6','7','8','9','0','-','=')
    $letterKeys = @('A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z')
    foreach ($key in $functionKeys) { $list.Add('^+{0}' -f $key) }
    foreach ($key in $functionKeys) { $list.Add('^!+{0}' -f $key) }
    foreach ($key in $numberKeys) { $list.Add('^!{0}' -f $key) }
    foreach ($key in $numberKeys) { $list.Add('^!+{0}' -f $key) }
    foreach ($key in $letterKeys) { $list.Add('^!{0}' -f $key) }
    foreach ($key in $letterKeys) { $list.Add('^!+{0}' -f $key) }
    return @($list | Select-Object -Unique)
}

function Get-UsedShortcuts([string]$ExcludeShortcut = '') {
    $exclude = Normalize-Shortcut -Value $ExcludeShortcut
    $used = @{}
    foreach ($binding in @($script:State.ScriptBindings)) {
        $normalized = Normalize-Shortcut -Value $binding.Shortcut
        if ($normalized -and $normalized -ne $exclude) { $used[$normalized] = $true }
    }
    foreach ($entry in $script:State.ActionHotkeys.GetEnumerator()) {
        $normalized = Normalize-Shortcut -Value $entry.Value
        if ($normalized -and $normalized -ne $exclude) { $used[$normalized] = $true }
    }
    foreach ($shortcut in @(Get-AzeronReservedShortcuts)) {
        $normalized = Normalize-Shortcut -Value $shortcut
        if ($normalized -and $normalized -ne $exclude) { $used[$normalized] = $true }
    }
    foreach ($shortcut in @(Get-OpusReservedShortcuts)) {
        $normalized = Normalize-Shortcut -Value $shortcut
        if ($normalized -and $normalized -ne $exclude) { $used[$normalized] = $true }
    }
    return $used
}

function Get-AvailableCandidateShortcuts([string]$IncludeShortcut = '') {
    $include = Normalize-Shortcut -Value $IncludeShortcut
    $used = Get-UsedShortcuts -ExcludeShortcut $IncludeShortcut
    $available = @(Build-Candidates | Where-Object {
        $normalized = Normalize-Shortcut -Value $_
        $normalized -eq $include -or -not $used.ContainsKey($normalized)
    })
    if ($include -and -not (@($available | Where-Object { (Normalize-Shortcut -Value $_) -eq $include }).Count)) {
        $available = @($IncludeShortcut) + $available
    }
    return @($available)
}

function Build-CandidateText {
    $all = @(Build-Candidates)
    $available = @(Get-AvailableCandidateShortcuts)
    $usedMap = Get-UsedShortcuts
    $used = @($all | Where-Object { $usedMap.ContainsKey((Normalize-Shortcut -Value $_)) })
    $azeronReserved = @((Get-AzeronReservedShortcuts) | Where-Object { @(Build-Candidates) -contains $_ })
    $opusReserved = @((Get-OpusReservedShortcuts) | Where-Object { @(Build-Candidates) -contains $_ })
    @(
        'Available now:'
        if (@($available).Count) { $available -join [Environment]::NewLine } else { '(none)' }
        ''
        'Already used:'
        if (@($used).Count) { $used -join [Environment]::NewLine } else { '(none)' }
        ''
        'Reserved by Azeron profile:'
        if (@($azeronReserved).Count) { $azeronReserved -join [Environment]::NewLine } else { '(none)' }
        ''
        'Reserved by Directory Opus:'
        if (@($opusReserved).Count) { $opusReserved -join [Environment]::NewLine } else { '(none)' }
        ''
        'Shortcut note:'
        'Suggested shortcuts assume the normal defaults are taken. The list excludes current FlowCell binds plus reserved shortcuts found in your Azeron and Directory Opus configs.'
    ) -join [Environment]::NewLine
}

function Get-ActionLabel([string]$ActionId) {
    ($script:Actions | Where-Object { $_.Id -eq $ActionId } | Select-Object -First 1).Label
}

function Get-BindingRows {
    $rows = @()
    foreach ($action in $script:Actions) {
        if ($script:State.ActionHotkeys.Contains($action.Id)) {
            $rows += [pscustomobject]@{ Kind = 'action'; Id = $action.Id; Shortcut = $script:State.ActionHotkeys[$action.Id]; Target = 'Action: {0}' -f $action.Label; Status = 'Active' }
        }
    }
    $rows += @($script:State.ScriptBindings | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.Shortcut) } | Sort-Object Shortcut, Target)
    return @($rows)
}

function Set-ActionStatus([string]$Text) {
    if ($script:ActionStatus -and $script:ActionStatus.PSObject.Properties['Text']) {
        $script:ActionStatus.Text = $Text.TrimEnd()
    }
}
function Set-ShortcutStatus([string]$Text) {
    if ($script:ShortcutStatus -and $script:ShortcutStatus.PSObject.Properties['Text']) {
        $script:ShortcutStatus.Text = $Text.TrimEnd()
    }
}

function Refresh-Ui {
    if ($script:BindingsList -and $script:BindingsList.PSObject.Properties['Items']) {
        $script:BindingsList.Items.Clear()
        foreach ($row in @(Get-BindingRows)) { [void]$script:BindingsList.Items.Add($row) }
    }
    Set-ControlTextValue $script:CandidateText (Build-CandidateText)
    Refresh-ActionSelector
}

function Show-ShortcutPickerDialog([string]$InitialValue = '') {
    $candidates = @(
        Get-AvailableCandidateShortcuts -IncludeShortcut $InitialValue |
        ForEach-Object { [string]$_ }
    )
    $candidateItems = @($candidates | ForEach-Object { New-ShortcutDisplayItem -RawShortcut ([string]$_) })

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Choose Shortcut"
        Width="520"
        Height="420"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Shortcut</TextBlock>
            <TextBlock Grid.Row="1" Text="Pick an available candidate shortcut or type one manually." Margin="0,0,0,12" TextWrapping="Wrap" />
            <TextBox Grid.Row="2" x:Name="ShortcutTextBox" MinHeight="36" FontSize="15" Padding="10,6" />
            <ListBox Grid.Row="3" x:Name="ShortcutList" Margin="0,12,0,0" FontSize="15" />
            <StackPanel Grid.Row="4" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                <Button x:Name="CancelButton" Width="110" Margin="0,0,10,0" Background="#FF6C6C6C">Cancel</Button>
                <Button x:Name="OkButton" Width="110">OK</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $dialogOwner = Get-DialogOwnerWindow
    if ($dialogOwner) { $dialog.Owner = $dialogOwner }

    $textBox = $dialog.FindName('ShortcutTextBox')
    $listBox = $dialog.FindName('ShortcutList')
    $listBox.DisplayMemberPath = 'Display'
    foreach ($candidate in $candidateItems) { [void]$listBox.Items.Add($candidate) }

    if ($InitialValue) {
        $normalizedInitialValue = Normalize-Shortcut -Value $InitialValue
        $matchingItem = @($candidateItems | Where-Object { (Normalize-Shortcut -Value ([string]$_.RawShortcut)) -eq $normalizedInitialValue } | Select-Object -First 1)
        $textBox.Text = Format-ShortcutForDisplay -Shortcut $InitialValue
        if (@($matchingItem).Count -gt 0) { $listBox.SelectedItem = $matchingItem[0] }
    }
    elseif ($listBox.Items.Count -gt 0) {
        $listBox.SelectedIndex = 0
        if ($listBox.SelectedItem -and $listBox.SelectedItem.PSObject.Properties['Display']) {
            $textBox.Text = [string]$listBox.SelectedItem.Display
        }
    }

    $script:__shortcutSelection = $null
    $accept = {
        $script:__shortcutSelection = Resolve-ShortcutDisplaySelection -Value ($textBox.Text.Trim()) -Items @($candidateItems)
        $dialog.DialogResult = $true
        $dialog.Close()
    }

    $dialog.FindName('OkButton').Add_Click($accept)
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })
    $listBox.Add_SelectionChanged({
        if ($listBox.SelectedItem -and $listBox.SelectedItem.PSObject.Properties['Display']) {
            $textBox.Text = [string]$listBox.SelectedItem.Display
        }
    })
    $listBox.Add_MouseDoubleClick({
        if ($listBox.SelectedItem) { & $accept }
    })
    $textBox.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Enter') {
            & $accept
            $eventArgs.Handled = $true
        }
    })
    $dialog.Add_ContentRendered({
        $textBox.Focus() | Out-Null
        $textBox.SelectAll()
    })

    $shown = $dialog.ShowDialog()
    if ($shown) { return $script:__shortcutSelection }
    return ''
}

function Show-ActionPickerDialog([string]$InitialActionId = '') {
    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Choose Action"
        Width="460"
        Height="220"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Action</TextBlock>
            <TextBlock Grid.Row="1" Text="Choose the action to bind." Margin="0,0,0,12" TextWrapping="Wrap" />
            <ComboBox Grid.Row="2" x:Name="ActionCombo" DisplayMemberPath="Label" SelectedValuePath="Id" MinHeight="36" FontSize="15" VerticalContentAlignment="Center" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                <Button x:Name="CancelButton" Width="110" Margin="0,0,10,0" Background="#FF6C6C6C">Cancel</Button>
                <Button x:Name="OkButton" Width="110">OK</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $dialogOwner = Get-DialogOwnerWindow
    if ($dialogOwner) { $dialog.Owner = $dialogOwner }

    $combo = $dialog.FindName('ActionCombo')
    foreach ($action in $script:Actions) { [void]$combo.Items.Add($action) }
    if ($InitialActionId) { $combo.SelectedValue = $InitialActionId } elseif ($combo.Items.Count -gt 0) { $combo.SelectedIndex = 0 }

    $script:__actionSelection = $null
    $dialog.FindName('OkButton').Add_Click({
        $script:__actionSelection = [string]$combo.SelectedValue
        $dialog.DialogResult = $true
        $dialog.Close()
    })
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })

    $shown = $dialog.ShowDialog()
    if ($shown) { return $script:__actionSelection }
    return ''
}

 function Start-DocumentWatch {
    $script:DocumentPollTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:DocumentPollTimer.Interval = [TimeSpan]::FromSeconds(2)
    $script:DocumentPollTimer.Add_Tick({
        try {
            $state = Get-IllustratorDocumentState
            if (-not $state.IllustratorOpen) {
                if (-not $script:IsDocumentAutoScanRunning) {
                    Set-ActionStatus 'Waiting for Illustrator to open before auto-scan.'
                }
                return
            }

            if (-not $state.HasDocumentWindow) {
                if (-not $script:IsDocumentAutoScanRunning) {
                    Set-ActionStatus 'Illustrator is open. Waiting for a document window before auto-scan.'
                }
                return
            }

            if ($script:LastAutoScannedDocumentKey -eq $state.DocumentKey -or $script:IsDocumentAutoScanRunning -or $script:IsControllerBusy) {
                return
            }

            $script:IsDocumentAutoScanRunning = $true
            Set-ActionStatus ('Document detected:`r`n{0}`r`n`r`nAuto-scanning Illustrator UI...' -f $state.DocumentTitle)
            if (-not (Invoke-Scan -Quiet -AutoTriggered)) {
                $script:IsDocumentAutoScanRunning = $false
            }
        }
        catch {
            Write-UiLog ('Document watch failed: {0}' -f $_.Exception.ToString())
        }
    })
    $script:DocumentPollTimer.Start()
}

function Prompt-Shortcut([string]$InitialValue = '') {
    return (Show-ShortcutPickerDialog -InitialValue $InitialValue).Trim()
}

function Add-ActionBinding {
    if (@($script:Actions).Count -eq 0) {
        throw 'No recorded actions exist yet. Record one first.'
    }
    $actionId = Show-ActionPickerDialog
    if (-not $actionId) { return }
    if (-not ($script:Actions.Id -contains $actionId)) { throw 'Unknown action id.' }
    $shortcut = Prompt-Shortcut
    if (-not $shortcut) { return }
    if ((Get-UsedShortcuts).ContainsKey((Normalize-Shortcut -Value $shortcut))) { throw 'That shortcut is already in use.' }
    $script:State.ActionHotkeys[$actionId] = $shortcut
    Save-State
    Restart-Backend
    Refresh-Ui
    Set-ShortcutStatus ('Saved action binding for {0}.' -f (Get-ActionLabel -ActionId $actionId))
}

function Add-ScriptBinding {
    $dialog = New-Object Microsoft.Win32.OpenFileDialog
    $dialog.Title = 'Choose Illustrator script'
    $dialog.Filter = 'Illustrator Scripts (*.jsx;*.js)|*.jsx;*.js|All Files (*.*)|*.*'
    if (Test-Path -LiteralPath $script:IllustratorScriptsDir -PathType Container) {
        $dialog.InitialDirectory = $script:IllustratorScriptsDir
    }
    $dialogOwner = Get-DialogOwnerWindow
    if ($dialogOwner) {
        if (-not $dialog.ShowDialog($dialogOwner)) { return }
    }
    else {
        if (-not $dialog.ShowDialog()) { return }
    }
    $shortcut = Prompt-Shortcut
    if (-not $shortcut) { return }
    if ((Get-UsedShortcuts).ContainsKey((Normalize-Shortcut -Value $shortcut))) { throw 'That shortcut is already in use.' }
    $id = [int]$script:State.NextId
    $script:State.NextId = $id + 1
    $script:State.ScriptBindings += [pscustomobject]@{ Kind = 'script'; Id = $id; Shortcut = $shortcut; Target = $dialog.FileName; Status = 'Active' }
    Save-State
    Restart-Backend
    Refresh-Ui
    Set-ShortcutStatus 'Saved script binding.'
}

function Edit-SelectedBinding {
    $selected = $script:BindingsList.SelectedItem
    if ($null -eq $selected) { Set-ShortcutStatus 'Select one binding first, then choose Edit Selected.'; return }
    $shortcut = Prompt-Shortcut -InitialValue $selected.Shortcut
    if (-not $shortcut) { return }
    if ((Get-UsedShortcuts -ExcludeShortcut $selected.Shortcut).ContainsKey((Normalize-Shortcut -Value $shortcut))) { throw 'That shortcut is already in use.' }
    if ($selected.Kind -eq 'action') {
        $script:State.ActionHotkeys[$selected.Id] = $shortcut
    }
    else {
        foreach ($binding in $script:State.ScriptBindings) {
            if ($binding.Id -eq $selected.Id) { $binding.Shortcut = $shortcut }
        }
    }
    Save-State
    Restart-Backend
    Refresh-Ui
    Set-ShortcutStatus 'Updated binding.'
}

function Remove-SelectedBinding {
    $selected = $script:BindingsList.SelectedItem
    if ($null -eq $selected) { Set-ShortcutStatus 'Select one binding first, then choose Remove Selected.'; return }
    $messageOwner = Get-DialogOwnerWindow
    if ($messageOwner) {
        if ([System.Windows.MessageBox]::Show($messageOwner, 'Remove this binding?', 'FlowCell', 'YesNo', 'Question') -ne 'Yes') { return }
    }
    else {
        if ([System.Windows.MessageBox]::Show('Remove this binding?', 'FlowCell', 'YesNo', 'Question') -ne 'Yes') { return }
    }
    if ($selected.Kind -eq 'action') { $script:State.ActionHotkeys.Remove([string]$selected.Id) }
    else { $script:State.ScriptBindings = @($script:State.ScriptBindings | Where-Object { $_.Id -ne $selected.Id }) }
    Save-State
    Restart-Backend
    Refresh-Ui
    Set-ShortcutStatus 'Removed binding.'
}

function Invoke-Scan([switch]$Rescan, [switch]$Quiet, [switch]$AutoTriggered) {
    $documentState = Get-IllustratorDocumentState
    $wasRescan = [bool]$Rescan
    $wasQuiet = [bool]$Quiet
    $wasAutoTriggered = [bool]$AutoTriggered
    $documentKey = $documentState.DocumentKey
    $documentTitle = $documentState.DocumentTitle
    $scanStatusPath = [string]$script:ScanStatusPath
    if (-not $documentState.IllustratorOpen) {
        if ($AutoTriggered) { $script:IsDocumentAutoScanRunning = $false }
        Set-ActionStatus 'Illustrator is not open yet. Open Illustrator and a document, then scan.'
        return $false
    }

    if (-not $documentState.HasDocumentWindow) {
        if ($AutoTriggered) { $script:IsDocumentAutoScanRunning = $false }
        Set-ActionStatus 'Illustrator is open, but no document window is open yet. Open a project, then scan.'
        return $false
    }

    Set-ActionStatus ($(if ($wasRescan) { 'Re-scanning Illustrator UI...' } else { 'Scanning Illustrator UI...' }))
    $onComplete = {
        param($exitCode)
        if ($wasAutoTriggered) { $script:IsDocumentAutoScanRunning = $false }
        Write-UiLog ('Scan finished. ExitCode={0}' -f $exitCode)
        if ($exitCode -eq 124) {
            Set-ActionStatus 'Scan timed out. Illustrator did not answer in time, but the macro window is still responsive.'
            return
        }
        if ($exitCode -eq 0) {
            $script:LastAutoScannedDocumentKey = $documentKey
        }
        if ($exitCode -ne 0) {
            Set-ActionStatus 'Scan failed. Check the log for details.'
            return
        }
        if ($wasQuiet) {
            Set-ActionStatus ('Auto-scan complete for:`r`n{0}`r`n`r`nUse Scan Illustrator UI if you want the full report.' -f $documentTitle)
        }
        else {
            Set-ActionStatus (Read-AllText -Path $scanStatusPath -Default 'No scan report was produced.')
        }
    }.GetNewClosure()
    return (Start-ControllerOperation -Description $(if ($wasRescan) { 're-scan' } else { 'scan' }) -Kind 'scan' -Arguments @('--scan-only') -Metadata @{ IsRescan = $wasRescan; AutoTriggered = $wasAutoTriggered; TimeoutSeconds = 45 } -OnComplete $onComplete)
}

function Invoke-Action([string]$ActionId) {
    $resolvedActionId = [string]$ActionId
    $actionTimeoutSeconds = 60
    $lastActionStatusPath = [string]$script:LastActionStatusPath
    Set-ActionStatus ('Running action: {0}...' -f (Get-ActionLabel -ActionId $resolvedActionId))
    $onComplete = {
        param($exitCode)
        Write-UiLog ('Action finished. ActionId={0} | ExitCode={1}' -f $resolvedActionId, $exitCode)
        if ($exitCode -eq 124) {
            Set-ActionStatus ('Action timed out: {0}`r`n`r`nThe backend did not finish in time, but the macro window stayed responsive.' -f (Get-ActionLabel -ActionId $resolvedActionId))
            return
        }
        $statusText = Read-AllText -Path $lastActionStatusPath -Default 'No action status was produced.'
        if ($exitCode -ne 0 -and [string]::IsNullOrWhiteSpace($statusText)) {
            $statusText = ('Action failed: {0}' -f (Get-ActionLabel -ActionId $resolvedActionId))
        }
        Set-ActionStatus $statusText
    }.GetNewClosure()
    return (Start-ControllerOperation -Description ('action {0}' -f $resolvedActionId) -Kind 'action' -Arguments @('--run-action={0}' -f $resolvedActionId) -Metadata @{ ActionId = $resolvedActionId; TimeoutSeconds = $actionTimeoutSeconds } -OnComplete $onComplete)
}

function Invoke-SelectedAction {
    if (-not $script:ActionSelector -or -not $script:ActionSelector.SelectedItem) {
        Set-ActionStatus 'Choose an action first, then use Run Selected Action.'
        return
    }

    Invoke-Action -ActionId ([string]$script:ActionSelector.SelectedItem.Id)
}

function Start-RecordAction {
    param(
        [scriptblock]$OnSaved = $null
    )

    $actionName = Show-RecordActionDialog
    if ([string]::IsNullOrWhiteSpace($actionName)) { return }

    if (-not (Test-Path -LiteralPath $script:MacroRecorderPath -PathType Leaf)) {
    throw 'helpers\RecordMacro.ahk was not found.'
    }

    if (-not (Test-Path -LiteralPath $script:RecordedActionsDir -PathType Container)) {
        New-Item -ItemType Directory -Path $script:RecordedActionsDir -Force | Out-Null
    }

    $actionId = New-RecordedActionId -Name $actionName
    $macroPath = Join-Path $script:RecordedActionsDir ('{0}.ini' -f $actionId)
    $windowStateBeforeRecord = if ($script:Window) { $script:Window.WindowState } else { 'Normal' }
    if ($script:Window) { $script:Window.WindowState = 'Minimized' }
    Set-ActionStatus ("Recording action:`r`n{0}`r`n`r`nSwitch to Illustrator now. Press F8 to stop and save, or F12 to cancel." -f $actionName)

    $onComplete = {
        param($exitCode)
        Write-UiLog ('Record action finished. Name={0} | ExitCode={1}' -f $actionName, $exitCode)
        if ($script:Window) {
            $script:Window.WindowState = $windowStateBeforeRecord
            $script:Window.Activate() | Out-Null
        }

        if ($exitCode -eq 0) {
            Load-Actions
            $script:State = Read-State
            Sync-FlowCellUiFromCurrentState
            Refresh-Ui
            $savedDefinition = Read-MacroDefinition -Path $macroPath
            if ($script:ActionSelector -and ($script:Actions.Id -contains $actionId)) {
                $script:ActionSelector.SelectedValue = $actionId
            }
            if ($OnSaved -and $null -ne $savedDefinition) {
                try {
                    & $OnSaved $savedDefinition
                }
                catch {
                    Write-UiLog ('Record action saved callback failed: {0}' -f $_.Exception.ToString())
                }
            }
            Set-ActionStatus ("Recorded action saved:`r`n{0}`r`n`r`nYou can run it from Run Selected Action or bind it on the right." -f $actionName)
            Set-ShortcutStatus ('Recorded action added to the action list.')
            return
        }

        if ($exitCode -eq 2) {
            Set-ActionStatus ('Recording canceled:`r`n{0}' -f $actionName)
            return
        }

        if ($exitCode -eq 3) {
            Set-ActionStatus ('Recording stopped, but no usable Illustrator steps were captured for:`r`n{0}' -f $actionName)
            return
        }

        Set-ActionStatus ('Recording failed for:`r`n{0}`r`n`r`nCheck the log for details.' -f $actionName)
    }.GetNewClosure()

    $started = Start-ControllerOperation -Description ('record action {0}' -f $actionName) -Kind 'record' -Arguments @(
            ('--out={0}' -f $macroPath),
            ('--name={0}' -f $actionName),
            ('--id={0}' -f $actionId)
        ) -Metadata @{
            ScriptPath = $script:MacroRecorderPath
            TimeoutSeconds = 3600
            WindowStyle = 'Hidden'
        } -OnComplete $onComplete
    if (-not $started -and $script:Window) {
        $script:Window.WindowState = $windowStateBeforeRecord
        $script:Window.Activate() | Out-Null
    }
    return $started
}

function Edit-RecordedMacro {
    param(
        [string]$InitialActionId = '',
        [string]$ProgramLabel = ''
    )

    if (-not [string]::IsNullOrWhiteSpace([string]$ProgramLabel)) {
        $script:MacroLabProgramContext = [string]$ProgramLabel
    }

    $action = $null
    if (-not [string]::IsNullOrWhiteSpace([string]$InitialActionId)) {
        $action = Get-RecordedActionById -ActionId $InitialActionId
    }
    if ($null -eq $action) {
        $action = Get-SelectedRecordedAction
    }
    if ($null -eq $action) {
        $action = @($script:Actions | Where-Object { $_.Kind -eq 'recorded' } | Sort-Object Label | Select-Object -First 1)[0]
    }

    $definition = $null
    if ($null -ne $action) {
        $definition = Read-MacroDefinition -Path $action.Path
        if ($null -eq $definition) {
            throw 'The selected recorded action could not be read from disk.'
        }
    }

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        xmlns:sys="clr-namespace:System;assembly=mscorlib"
        Title="Macro Lab"
        Width="1700"
        Height="900"
        MinWidth="1500"
        MinHeight="780"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="Background" Value="#FF7FFF2A" />
            <Setter Property="Foreground" Value="#FF202020" />
            <Setter Property="HorizontalContentAlignment" Value="Center" />
            <Setter Property="VerticalContentAlignment" Value="Center" />
            <Setter Property="FontWeight" Value="SemiBold" />
            <Setter Property="Padding" Value="8,4" />
        </Style>
        <Style TargetType="Menu">
            <Setter Property="Background" Value="#FF2F2F2F" />
            <Setter Property="Foreground" Value="#FFF2F2F2" />
        </Style>
        <Style TargetType="MenuItem">
            <Setter Property="Background" Value="#FF2F2F2F" />
            <Setter Property="Foreground" Value="#FFF2F2F2" />
            <Setter Property="Padding" Value="12,6" />
            <Style.Triggers>
                <Trigger Property="IsHighlighted" Value="True">
                    <Setter Property="Background" Value="#FF6EC8FF" />
                    <Setter Property="Foreground" Value="#FF202020" />
                </Trigger>
            </Style.Triggers>
        </Style>
    </Window.Resources>
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <StackPanel Grid.Row="0" Margin="0,0,0,14">
                <TextBlock FontSize="20" FontWeight="SemiBold" Margin="0,0,0,8">Macro Lab</TextBlock>
                <TextBlock Text="Shift selects ranges, Ctrl cherry-picks rows, Enter applies the current fields to the selection, and Right Click is now a first-class step type." TextWrapping="Wrap" FontSize="15" />
                <StackPanel Margin="0,12,0,0">
                    <TextBlock Text="Program Tabs" Margin="0,0,0,8" FontSize="16" FontWeight="SemiBold" />
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="120" />
                        </Grid.ColumnDefinitions>
                        <ListBox x:Name="ProgramTabStrip"
                                 DisplayMemberPath="Label"
                                 MinHeight="48"
                                 Height="48"
                                 Grid.Column="0"
                                 BorderThickness="0"
                                 Background="Transparent"
                                 ScrollViewer.HorizontalScrollBarVisibility="Auto"
                                 ScrollViewer.VerticalScrollBarVisibility="Disabled"
                                 ScrollViewer.CanContentScroll="False"
                                 SelectionMode="Single">
                            <ListBox.ItemsPanel>
                                <ItemsPanelTemplate>
                                    <StackPanel Orientation="Horizontal" />
                                </ItemsPanelTemplate>
                            </ListBox.ItemsPanel>
                            <ListBox.ItemContainerStyle>
                                <Style TargetType="ListBoxItem">
                                    <Setter Property="Margin" Value="0,0,8,0" />
                                    <Setter Property="Padding" Value="16,10" />
                                    <Setter Property="MinWidth" Value="140" />
                                    <Setter Property="Background" Value="#FF4A4A4A" />
                                    <Setter Property="Foreground" Value="#FFF2F2F2" />
                                    <Setter Property="BorderBrush" Value="#FF626262" />
                                    <Setter Property="Cursor" Value="Hand" />
                                    <Setter Property="HorizontalContentAlignment" Value="Center" />
                                    <Setter Property="VerticalContentAlignment" Value="Center" />
                                    <Setter Property="Template">
                                        <Setter.Value>
                                            <ControlTemplate TargetType="ListBoxItem">
                                                <Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1" CornerRadius="12,12,0,0" Padding="{TemplateBinding Padding}">
                                                    <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="{TemplateBinding VerticalContentAlignment}" />
                                                </Border>
                                            </ControlTemplate>
                                        </Setter.Value>
                                    </Setter>
                                    <Style.Triggers>
                                        <Trigger Property="IsMouseOver" Value="True">
                                            <Setter Property="Background" Value="#FF5A5A5A" />
                                            <Setter Property="BorderBrush" Value="#FF8A8A8A" />
                                        </Trigger>
                                        <Trigger Property="IsSelected" Value="True">
                                            <Setter Property="Background" Value="#FF6EC8FF" />
                                            <Setter Property="Foreground" Value="#FF202020" />
                                            <Setter Property="BorderBrush" Value="#FF6EC8FF" />
                                        </Trigger>
                                    </Style.Triggers>
                                </Style>
                            </ListBox.ItemContainerStyle>
                        </ListBox>
                        <Button x:Name="AddProgramTabButton" Grid.Column="1" Width="110" Height="48" HorizontalAlignment="Right">Add Tab</Button>
                    </Grid>
                    <TextBlock x:Name="ProgramTabStatusText" Text="Active program: Illustrator" Margin="2,8,0,0" FontSize="14" Foreground="#FFD0D0D0" TextWrapping="Wrap" />
                </StackPanel>
            </StackPanel>
            <Grid Grid.Row="1">
                <Grid.RowDefinitions>
                    <RowDefinition Height="Auto" />
                    <RowDefinition Height="Auto" />
                    <RowDefinition Height="*" />
                </Grid.RowDefinitions>
                <Grid Grid.Row="0" Margin="0,0,0,14">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="520" />
                        <ColumnDefinition Width="0" />
                        <ColumnDefinition Width="0" />
                        <ColumnDefinition Width="0" />
                        <ColumnDefinition Width="180" />
                        <ColumnDefinition Width="18" />
                        <ColumnDefinition Width="*" />
                    </Grid.ColumnDefinitions>
                    <StackPanel Grid.Column="0">
                        <TextBlock Margin="0,0,0,8">Open Macros</TextBlock>
                        <ListBox x:Name="MacroTabStrip"
                                 DisplayMemberPath="HeaderText"
                                 MinHeight="56"
                                 Height="56"
                                 BorderThickness="0"
                                 Background="Transparent"
                                 ScrollViewer.HorizontalScrollBarVisibility="Auto"
                                 ScrollViewer.VerticalScrollBarVisibility="Disabled"
                                 ScrollViewer.CanContentScroll="False"
                                 SelectionMode="Single">
                            <ListBox.ItemsPanel>
                                <ItemsPanelTemplate>
                                    <StackPanel Orientation="Horizontal" />
                                </ItemsPanelTemplate>
                            </ListBox.ItemsPanel>
                            <ListBox.ItemContainerStyle>
                                <Style TargetType="ListBoxItem">
                                    <Setter Property="Margin" Value="0,0,8,0" />
                                    <Setter Property="Padding" Value="18,10" />
                                    <Setter Property="MinWidth" Value="160" />
                                    <Setter Property="Background" Value="#FF4A4A4A" />
                                    <Setter Property="Foreground" Value="#FFF2F2F2" />
                                    <Setter Property="BorderBrush" Value="#FF626262" />
                                    <Setter Property="Cursor" Value="Hand" />
                                    <Setter Property="HorizontalContentAlignment" Value="Center" />
                                    <Setter Property="VerticalContentAlignment" Value="Center" />
                                    <Setter Property="Template">
                                        <Setter.Value>
                                            <ControlTemplate TargetType="ListBoxItem">
                                                <Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1" CornerRadius="12,12,0,0" Padding="{TemplateBinding Padding}">
                                                    <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="{TemplateBinding VerticalContentAlignment}" />
                                                </Border>
                                            </ControlTemplate>
                                        </Setter.Value>
                                    </Setter>
                                    <Style.Triggers>
                                        <Trigger Property="IsMouseOver" Value="True">
                                            <Setter Property="Background" Value="#FF5A5A5A" />
                                            <Setter Property="BorderBrush" Value="#FF8A8A8A" />
                                        </Trigger>
                                        <Trigger Property="IsSelected" Value="True">
                                            <Setter Property="Background" Value="#FF6EC8FF" />
                                            <Setter Property="Foreground" Value="#FF202020" />
                                            <Setter Property="BorderBrush" Value="#FF6EC8FF" />
                                        </Trigger>
                                    </Style.Triggers>
                                </Style>
                            </ListBox.ItemContainerStyle>
                        </ListBox>
                    </StackPanel>
                    <StackPanel Grid.Column="2" Visibility="Collapsed">
                        <TextBlock Margin="0,0,0,8">Bind Script</TextBlock>
                        <TextBox x:Name="ProgramBindingScriptBox" IsReadOnly="True" MinHeight="42" FontSize="14" Padding="10,6" Background="#FF1F1F1F" Foreground="#FFE6F5FF" BorderBrush="#FF6EC8FF" />
                        <WrapPanel Margin="0,10,0,0">
                            <TextBox x:Name="ProgramBindingShortcutBox" IsReadOnly="True" Width="170" Height="32" Margin="0,0,8,0" FontSize="14" FontWeight="Bold" Padding="10,4" Background="#FF1F1F1F" Foreground="#FFFFF27A" BorderBrush="#FFFFD84D" />
                            <Button x:Name="SelectProgramScriptButton" Width="130" Height="32" Margin="0,0,8,0">Select Script</Button>
                            <Button x:Name="ChooseProgramShortcutButton" Width="130" Height="32" Margin="0,0,8,0">Shortcut</Button>
                            <Button x:Name="ClearProgramBindingButton" Width="110" Height="32" Background="#FF6C6C6C">Clear</Button>
                        </WrapPanel>
                    </StackPanel>
                    <StackPanel Grid.Column="4">
                        <TextBlock Margin="0,0,0,8">Current Mouse XY</TextBlock>
                        <TextBox x:Name="MousePositionBox" IsReadOnly="True" MinHeight="40" FontSize="16" Padding="10,6" />
                    </StackPanel>
                    <WrapPanel Grid.Column="6" HorizontalAlignment="Right">
                        <Button x:Name="RunMacroButton" Width="190" Height="46" Margin="0,0,12,0">Run</Button>
                        <Button x:Name="RecordMacroButton" Width="190" Height="46">Record</Button>
                    </WrapPanel>
                </Grid>
                <Border Grid.Row="1" Background="#FF4A4A4A" CornerRadius="14" Padding="10" Margin="0,0,0,12">
                    <Grid>
                        <Grid.RowDefinitions>
                            <RowDefinition Height="Auto" />
                            <RowDefinition Height="Auto" />
                        </Grid.RowDefinitions>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="52" />
                            <ColumnDefinition Width="130" />
                            <ColumnDefinition Width="84" />
                            <ColumnDefinition Width="84" />
                            <ColumnDefinition Width="84" />
                            <ColumnDefinition Width="0" />
                            <ColumnDefinition Width="0" />
                            <ColumnDefinition Width="0" />
                            <ColumnDefinition Width="210" />
                            <ColumnDefinition Width="180" />
                            <ColumnDefinition Width="300" />
                            <ColumnDefinition Width="240" />
                        </Grid.ColumnDefinitions>
                        <TextBlock Grid.Row="0" Grid.Column="0" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Move selected" />
                        <TextBlock Grid.Row="0" Grid.Column="1" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply type" />
                        <TextBlock Grid.Row="0" Grid.Column="2" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply delay" />
                        <Button Grid.Row="0" Grid.Column="3" Grid.ColumnSpan="2" x:Name="PickXYButton" Height="30" Margin="4,0,4,8">Pick XY</Button>
                        <TextBlock Grid.Row="0" Grid.Column="5" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply button" Visibility="Collapsed" />
                        <TextBlock Grid.Row="0" Grid.Column="6" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply count" Visibility="Collapsed" />
                        <TextBlock Grid.Row="0" Grid.Column="7" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply direction" Visibility="Collapsed" />
                        <TextBlock Grid.Row="0" Grid.Column="8" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply text" />
                        <TextBlock Grid.Row="0" Grid.Column="9" Margin="4,0,4,8" Foreground="#FFD0D0D0" Text="Apply keys" />
                        <WrapPanel Grid.Row="0" Grid.Column="10" Margin="4,0,4,8" HorizontalAlignment="Left">
                            <Button x:Name="BrowseScriptButton" Width="54" Height="24" Margin="0,0,4,0" Padding="0">Script</Button>
                            <Button x:Name="BrowseMacroButton" Width="54" Height="24" Padding="0">Macro</Button>
                        </WrapPanel>
                        <Button Grid.Row="0" Grid.Column="11" x:Name="ApplySelectedButton" Height="30" Margin="4,0,4,8">Apply Selected</Button>

                        <StackPanel Grid.Row="1" Grid.Column="0" Margin="4,0,4,0">
                            <Button x:Name="MoveUpButton" Height="16" Margin="0,0,0,2">Up</Button>
                            <Button x:Name="MoveDownButton" Height="16">Down</Button>
                        </StackPanel>
                        <ComboBox Grid.Row="1" Grid.Column="1" x:Name="BulkTypeBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" VerticalContentAlignment="Center">
                            <ComboBoxItem Content="" />
                            <ComboBoxItem Content="ActivateIllustrator" />
                            <ComboBoxItem Content="ActivateBlender" />
                            <ComboBoxItem Content="ActivatePhotoshop" />
                            <ComboBoxItem Content="ActivateWindows" />
                            <ComboBoxItem Content="Click" />
                            <ComboBoxItem Content="RightClick" />
                            <ComboBoxItem Content="Wheel" />
                            <ComboBoxItem Content="Text" />
                            <ComboBoxItem Content="Key" />
                            <ComboBoxItem Content="Script" />
                            <ComboBoxItem Content="Macro" />
                        </ComboBox>
                        <TextBox Grid.Row="1" Grid.Column="2" x:Name="BulkDelayBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" />
                        <TextBox Grid.Row="1" Grid.Column="3" x:Name="BulkXBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" />
                        <TextBox Grid.Row="1" Grid.Column="4" x:Name="BulkYBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" />
                        <ComboBox Grid.Row="1" Grid.Column="5" x:Name="BulkButtonBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" VerticalContentAlignment="Center" Visibility="Collapsed">
                            <ComboBoxItem Content="" />
                            <ComboBoxItem Content="Left" />
                            <ComboBoxItem Content="Right" />
                            <ComboBoxItem Content="Middle" />
                        </ComboBox>
                        <TextBox Grid.Row="1" Grid.Column="6" x:Name="BulkCountBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" Visibility="Collapsed" />
                        <ComboBox Grid.Row="1" Grid.Column="7" x:Name="BulkDirectionBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" VerticalContentAlignment="Center" Visibility="Collapsed">
                            <ComboBoxItem Content="" />
                            <ComboBoxItem Content="Up" />
                            <ComboBoxItem Content="Down" />
                        </ComboBox>
                        <TextBox Grid.Row="1" Grid.Column="8" x:Name="BulkTextBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" />
                        <TextBox Grid.Row="1" Grid.Column="9" x:Name="BulkKeysBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" />
                        <TextBox Grid.Row="1" Grid.Column="10" x:Name="BulkScriptBox" Margin="4,0,4,0" MinHeight="34" FontSize="14" Padding="8,4" />
                        <WrapPanel Grid.Row="1" Grid.Column="11" Margin="4,0,4,0">
                            <Button x:Name="AddStepButton" Width="112" Height="34" Margin="0,0,8,0">Add Step</Button>
                            <Button x:Name="ClearStepButton" Width="112" Height="34">Clear Step</Button>
                        </WrapPanel>
                    </Grid>
                </Border>
                <Border Grid.Row="2" Background="#FF4A4A4A" CornerRadius="14" Padding="10">
                    <DataGrid x:Name="StepGrid"
                              AutoGenerateColumns="False"
                              CanUserAddRows="False"
                              CanUserDeleteRows="False"
                              HeadersVisibility="Column"
                              GridLinesVisibility="Horizontal"
                              RowHeaderWidth="0"
                              SelectionMode="Extended"
                              SelectionUnit="FullRow"
                              AlternatingRowBackground="#FF515151"
                              Background="#FF4A4A4A"
                              Foreground="#FFF2F2F2">
                        <DataGrid.Resources>
                            <Style TargetType="DataGridColumnHeader">
                                <Setter Property="Background" Value="#FF2F2F2F" />
                                <Setter Property="Foreground" Value="#FFF2F2F2" />
                                <Setter Property="BorderBrush" Value="#FF626262" />
                                <Setter Property="BorderThickness" Value="0,0,1,1" />
                                <Setter Property="Padding" Value="8,6" />
                            </Style>
                            <Style TargetType="DataGridCell">
                                <Setter Property="Foreground" Value="#FFF2F2F2" />
                                <Setter Property="Background" Value="#FF4A4A4A" />
                                <Setter Property="BorderBrush" Value="#FF626262" />
                                <Setter Property="BorderThickness" Value="0,0,1,1" />
                                <Setter Property="Padding" Value="6,4" />
                                <Style.Triggers>
                                    <Trigger Property="IsSelected" Value="True">
                                        <Setter Property="Background" Value="#FF0E7AD1" />
                                        <Setter Property="Foreground" Value="#FFFFFFFF" />
                                        <Setter Property="BorderBrush" Value="#FF89C7FF" />
                                    </Trigger>
                                </Style.Triggers>
                            </Style>
                            <Style TargetType="DataGridRow">
                                <Setter Property="Foreground" Value="#FFF2F2F2" />
                                <Setter Property="Background" Value="#FF4A4A4A" />
                                <Style.Triggers>
                                    <Trigger Property="IsSelected" Value="True">
                                        <Setter Property="Background" Value="#FF0E7AD1" />
                                        <Setter Property="Foreground" Value="#FFFFFFFF" />
                                    </Trigger>
                                </Style.Triggers>
                            </Style>
                        </DataGrid.Resources>
                        <DataGrid.Columns>
                            <DataGridTextColumn Header="#" Binding="{Binding StepNumber}" IsReadOnly="True" Width="44" />
                            <DataGridComboBoxColumn Header="Type" SelectedItemBinding="{Binding Type, UpdateSourceTrigger=PropertyChanged}" Width="130">
                            <DataGridComboBoxColumn.ItemsSource>
                                    <x:Array Type="{x:Type sys:String}">
                                        <sys:String>ActivateIllustrator</sys:String>
                                        <sys:String>ActivateBlender</sys:String>
                                        <sys:String>ActivatePhotoshop</sys:String>
                                        <sys:String>ActivateWindows</sys:String>
                                        <sys:String>Click</sys:String>
                                        <sys:String>RightClick</sys:String>
                                        <sys:String>Wheel</sys:String>
                                        <sys:String>Text</sys:String>
                                        <sys:String>Key</sys:String>
                                        <sys:String>Script</sys:String>
                                        <sys:String>Macro</sys:String>
                                    </x:Array>
                                </DataGridComboBoxColumn.ItemsSource>
                            </DataGridComboBoxColumn>
                            <DataGridTextColumn Header="Delay" Binding="{Binding DelayMs, UpdateSourceTrigger=PropertyChanged}" Width="84" />
                            <DataGridTextColumn Header="X" Binding="{Binding X, UpdateSourceTrigger=PropertyChanged}" Width="84" />
                            <DataGridTextColumn Header="Y" Binding="{Binding Y, UpdateSourceTrigger=PropertyChanged}" Width="84" />
                            <DataGridTextColumn Header="Text" Binding="{Binding Text, UpdateSourceTrigger=PropertyChanged}" Width="210" />
                            <DataGridTextColumn Header="Keys" Binding="{Binding Keys, UpdateSourceTrigger=PropertyChanged}" Width="180" />
                            <DataGridTextColumn Header="Target" Binding="{Binding ScriptPath, UpdateSourceTrigger=PropertyChanged}" Width="300" />
                        </DataGrid.Columns>
                    </DataGrid>
                </Border>
            </Grid>
            <WrapPanel Grid.Row="2" HorizontalAlignment="Right" Margin="0,16,0,0" ItemHeight="28" ItemWidth="120">
                <Button x:Name="OpenMacroButton" Width="110" Height="28" Margin="0,0,8,8">Open</Button>
                <Button x:Name="NewMacroButton" Width="110" Height="28" Margin="0,0,8,8">New Macro</Button>
                <Button x:Name="SaveButton" Width="90" Height="28" Margin="0,0,8,8">Save</Button>
                <Button x:Name="SaveAsButton" Width="100" Height="28" Margin="0,0,8,8">Save As</Button>
                <Button x:Name="RenameMacroButton" Width="100" Height="28" Margin="0,0,8,8">Rename</Button>
                <Button x:Name="CopyMacroButton" Width="110" Height="28" Margin="0,0,8,8">Copy</Button>
                <Button x:Name="CloseTabButton" Width="95" Height="28" Margin="0,0,8,8">Close Tab</Button>
                <Button x:Name="DeleteMacroButton" Width="100" Height="28" Margin="0,0,8,8">Delete</Button>
                <Button x:Name="ScanMacroButton" Width="90" Height="28" Margin="0,0,8,8">Scan</Button>
                <Button x:Name="UndoButton" Width="90" Height="28" Margin="0,0,8,8">Undo</Button>
                <Button x:Name="RedoButton" Width="90" Height="28" Margin="0,0,8,8">Redo</Button>
                <Button x:Name="DuplicateStepButton" Width="120" Height="28" Margin="0,0,8,8">Duplicate</Button>
                <Button x:Name="DeleteStepButton" Width="120" Height="28" Margin="0,0,8,8">Delete Step</Button>
                <Button x:Name="CancelButton" Width="90" Height="28" Margin="0,0,8,8">Cancel</Button>
            </WrapPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $dialogOwner = Get-DialogOwnerWindow
    if ($dialogOwner) { $dialog.Owner = $dialogOwner }

    $programTabStrip = $dialog.FindName('ProgramTabStrip')
    $programTabStatus = $dialog.FindName('ProgramTabStatusText')
    $addProgramTabButton = $dialog.FindName('AddProgramTabButton')
    $macroTabStrip = $dialog.FindName('MacroTabStrip')
    $activeShortcutBox = $dialog.FindName('ActiveShortcutBox')
    $chooseShortcutButton = $dialog.FindName('ChooseShortcutButton')
    $clearShortcutButton = $dialog.FindName('ClearShortcutButton')
    $programBindingScriptBox = $dialog.FindName('ProgramBindingScriptBox')
    $programBindingShortcutBox = $dialog.FindName('ProgramBindingShortcutBox')
    $selectProgramScriptButton = $dialog.FindName('SelectProgramScriptButton')
    $chooseProgramShortcutButton = $dialog.FindName('ChooseProgramShortcutButton')
    $clearProgramBindingButton = $dialog.FindName('ClearProgramBindingButton')
    $mousePositionBox = $dialog.FindName('MousePositionBox')
    $pickXYButton = $dialog.FindName('PickXYButton')
    $stepGrid = $dialog.FindName('StepGrid')
    $openMacroButton = $dialog.FindName('OpenMacroButton')
    $newMacroButton = $dialog.FindName('NewMacroButton')
    $renameMacroButton = $dialog.FindName('RenameMacroButton')
    $deleteMacroButton = $dialog.FindName('DeleteMacroButton')
    $closeTabButton = $dialog.FindName('CloseTabButton')
    $runMacroButton = $dialog.FindName('RunMacroButton')
    $recordMacroButton = $dialog.FindName('RecordMacroButton')
    $scanMacroButton = $dialog.FindName('ScanMacroButton')
    $saveAsButton = $dialog.FindName('SaveAsButton')
    $clearStepButton = $dialog.FindName('ClearStepButton')
    $fileOpenMacroMenuItem = $dialog.FindName('FileOpenMacroMenuItem')
    $fileSaveMenuItem = $dialog.FindName('FileSaveMenuItem')
    $fileSaveAsMenuItem = $dialog.FindName('FileSaveAsMenuItem')
    $fileCopyMacroMenuItem = $dialog.FindName('FileCopyMacroMenuItem')
    $fileCloseTabMenuItem = $dialog.FindName('FileCloseTabMenuItem')
    $fileDeleteMacroMenuItem = $dialog.FindName('FileDeleteMacroMenuItem')
    $fileBindShortcutMenuItem = $dialog.FindName('FileBindShortcutMenuItem')
    $fileClearShortcutMenuItem = $dialog.FindName('FileClearShortcutMenuItem')
    $fileRunMenuItem = $dialog.FindName('FileRunMenuItem')
    $fileRecordMenuItem = $dialog.FindName('FileRecordMenuItem')
    $fileScanMenuItem = $dialog.FindName('FileScanMenuItem')
    $bulkTypeBox = $dialog.FindName('BulkTypeBox')
    $bulkDelayBox = $dialog.FindName('BulkDelayBox')
    $bulkXBox = $dialog.FindName('BulkXBox')
    $bulkYBox = $dialog.FindName('BulkYBox')
    $bulkButtonBox = $dialog.FindName('BulkButtonBox')
    $bulkCountBox = $dialog.FindName('BulkCountBox')
    $bulkDirectionBox = $dialog.FindName('BulkDirectionBox')
    $bulkTextBox = $dialog.FindName('BulkTextBox')
    $bulkKeysBox = $dialog.FindName('BulkKeysBox')
    $bulkScriptBox = $dialog.FindName('BulkScriptBox')
    $browseScriptButton = $dialog.FindName('BrowseScriptButton')
    $browseMacroButton = $dialog.FindName('BrowseMacroButton')
    $stepTable = New-Object System.Data.DataTable
    foreach ($columnName in @('StepNumber','Type','DelayMs','X','Y','Button','Count','Direction','Text','Keys','ScriptPath')) {
        [void]$stepTable.Columns.Add($columnName)
    }

    $script:__macroUndoStack = New-Object System.Collections.Generic.List[object]
    $script:__macroRedoStack = New-Object System.Collections.Generic.List[object]
    $script:__macroSuppressUndo = $false
    $script:__macroDirty = $false
    $script:__macroLoadingDefinition = $false
    $script:__macroSelectedDefinitionId = ''
    $script:__lastAppliedBindingShortcut = ''
    $script:__macroTabSuppressSelection = $false
    $script:__programTabSuppressSelection = $false
    $openMacroTabs = New-Object System.Collections.ArrayList
    $script:__currentProgramTabId = if ($script:State -and $script:State.PSObject.Properties['SelectedProgramTabId']) { [int]$script:State.SelectedProgramTabId } else { 1 }

    $getProgramTabs = {
        if ($script:State -and $script:State.PSObject.Properties['ProgramTabs'] -and @($script:State.ProgramTabs).Count -gt 0) {
            return @($script:State.ProgramTabs)
        }
        return @(Get-DefaultProgramTabs)
    }

    $getProgramTabById = {
        param([int]$programTabId)
        foreach ($tab in @(& $getProgramTabs)) {
            if ([int]$tab.Id -eq [int]$programTabId) {
                return $tab
            }
        }
        return $null
    }

    $getCurrentProgramTab = {
        $currentTab = & $getProgramTabById $script:__currentProgramTabId
        if ($null -ne $currentTab) { return $currentTab }
        $allTabs = @(& $getProgramTabs)
        if ($allTabs.Count -gt 0) { return $allTabs[0] }
        return $null
    }
    $getSelectorSelectedItem = {
        param($control)
        return (Get-ControlSelectedItem $control)
    }

    $setProgramTabStatus = {
        param($tab)
        if (-not $programTabStatus) { return }
        if ($null -eq $tab) {
            $programTabStatus.Text = 'No program tab selected.'
            return
        }
        $folderText = ''
        if ($tab.PSObject.Properties['ScriptFolder'] -and -not [string]::IsNullOrWhiteSpace([string]$tab.ScriptFolder)) {
            $folderText = ' | Script folder: ' + [string]$tab.ScriptFolder
        }
        $programTabStatus.Text = 'Active program: ' + [string]$tab.Label + $folderText
    }

    $ensureProgramTab = {
        param([string]$label, [string]$scriptFolder = '')
        $label = [string]$label
        if ([string]::IsNullOrWhiteSpace($label)) { return $null }
        $existing = @(& $getProgramTabs | Where-Object { [string]$_.Label -ieq $label } | Select-Object -First 1)
        if ($existing.Count -gt 0) { return $existing[0] }
        $nextId = if ($script:State -and $script:State.PSObject.Properties['ProgramTabNextId']) { [int]$script:State.ProgramTabNextId } else { 1 }
        $tab = [pscustomobject]@{
            Id = $nextId
            Label = $label
            ScriptFolder = [string]$scriptFolder
        }
        if (-not $script:State) {
            $script:State = Read-State
        }
        $script:State.ProgramTabs += $tab
        $script:State.ProgramTabNextId = $nextId + 1
        $script:State.SelectedProgramTabId = $tab.Id
        Save-State
        return $tab
    }

    $selectProgramTabById = {
        param([int]$programTabId)
        if (-not $programTabStrip) { return }
        $script:__programTabSuppressSelection = $true
        try {
            if ($programTabId -le 0) {
                $programTabStrip.SelectedIndex = -1
                return
            }
            $targetItem = @($programTabStrip.Items | Where-Object { $_ -and $_.PSObject.Properties['Id'] -and [int]$_.Id -eq [int]$programTabId } | Select-Object -First 1)
            if ($targetItem.Count -gt 0) {
                $programTabStrip.SelectedItem = $targetItem[0]
                $script:__currentProgramTabId = [int]$targetItem[0].Id
                if ($script:State) {
                    $script:State.SelectedProgramTabId = $script:__currentProgramTabId
                }
                return
            }
            if ($programTabStrip.Items.Count -gt 0) {
                $programTabStrip.SelectedIndex = 0
                $firstItem = $programTabStrip.Items[0]
                if ($firstItem -and $firstItem.PSObject.Properties['Id']) {
                    $script:__currentProgramTabId = [int]$firstItem.Id
                    if ($script:State) {
                        $script:State.SelectedProgramTabId = $script:__currentProgramTabId
                    }
                }
            }
        }
        finally {
            $script:__programTabSuppressSelection = $false
        }
    }

    $refreshProgramTabs = {
        $definitions = [object[]]@(& $getProgramTabs)
        $programTabStrip.ItemsSource = $null
        $programTabStrip.ItemsSource = $definitions
        if (@($definitions).Count -gt 0) {
            & $selectProgramTabById $script:__currentProgramTabId
            if ($null -eq (& $getSelectorSelectedItem $programTabStrip)) {
                $programTabStrip.SelectedIndex = 0
            }
        }
        else {
            $programTabStrip.SelectedIndex = -1
        }
        & $setProgramTabStatus (& $getCurrentProgramTab)
        & $refreshProgramBindingDisplay
    }

    $script:__currentProgramTabId = [int]((& $getCurrentProgramTab).Id)

    $resolveCurrentMacroId = {
        $selectedMacroItem = & $getSelectorSelectedItem $macroTabStrip
        if ($selectedMacroItem -and $selectedMacroItem.PSObject.Properties['Id']) {
            $selectedId = [string]$selectedMacroItem.Id
            if (-not [string]::IsNullOrWhiteSpace($selectedId)) {
                return $selectedId
            }
        }
        return ''
    }

    $getShortcutForMacroId = {
        param([string]$macroId)
        if ([string]::IsNullOrWhiteSpace($macroId)) { return '' }
        try {
            $latestState = Read-State
            if ($latestState -and $latestState.ActionHotkeys -and $latestState.ActionHotkeys.Contains($macroId)) {
                if ($script:State) {
                    $script:State.ActionHotkeys = $latestState.ActionHotkeys
                }
                return [string]$latestState.ActionHotkeys[$macroId]
            }
        }
        catch {
        }
        if ($script:State -and $script:State.ActionHotkeys -and $script:State.ActionHotkeys.Contains($macroId)) {
            return [string]$script:State.ActionHotkeys[$macroId]
        }
        return ''
    }

    $getCurrentSelectedMacroItem = {
        $selectedMacroItem = & $getSelectorSelectedItem $macroTabStrip
        if ($selectedMacroItem -and $selectedMacroItem.PSObject.Properties['Id']) {
            return $selectedMacroItem
        }
        return $null
    }

    $getCurrentSelectedMacroLabel = {
        $selectedMacro = & $getCurrentSelectedMacroItem
        if ($selectedMacro -and $selectedMacro.PSObject.Properties['Label'] -and -not [string]::IsNullOrWhiteSpace([string]$selectedMacro.Label)) {
            return [string]$selectedMacro.Label
        }
        return ''
    }

    $getMacroFileName = {
        param($macroItem)
        if ($null -eq $macroItem) { return '' }
        if ($macroItem.PSObject.Properties['FileName'] -and -not [string]::IsNullOrWhiteSpace([string]$macroItem.FileName)) {
            return [string]$macroItem.FileName
        }
        if ($macroItem.PSObject.Properties['Path'] -and -not [string]::IsNullOrWhiteSpace([string]$macroItem.Path)) {
            return [System.IO.Path]::GetFileNameWithoutExtension([string]$macroItem.Path)
        }
        return ''
    }

    $getMacroCreatedAt = {
        param($macroItem)
        if ($null -eq $macroItem) { return '' }
        if ($macroItem.PSObject.Properties['CreatedAt']) {
            return [string]$macroItem.CreatedAt
        }
        return ''
    }

    $updateActiveShortcutDisplay = {
        param([string]$shortcutValue)
        Set-ControlTextValue $activeShortcutBox $(if ([string]::IsNullOrWhiteSpace($shortcutValue)) { 'NO SHORTCUT BOUND' } else { Format-ShortcutForDisplay -Shortcut ([string]$shortcutValue) })
    }

    $getProgramTabBinding = {
        param([int]$programTabId)
        if ($programTabId -le 0 -or -not $script:State) { return $null }
        $matches = @(
            $script:State.ScriptBindings |
                Where-Object { $_.PSObject.Properties['ProgramTabId'] -and [int]$_.ProgramTabId -eq $programTabId } |
                Select-Object -First 1
        )
        if ($matches.Count -gt 0) { return $matches[0] }
        return $null
    }

    $refreshProgramBindingDisplay = {
        $currentProgramTab = & $getCurrentProgramTab
        if ($null -eq $currentProgramTab) {
            Set-ControlTextValue $programBindingScriptBox 'NO PROGRAM SELECTED'
            Set-ControlTextValue $programBindingShortcutBox ''
            return
        }

        $binding = & $getProgramTabBinding ([int]$currentProgramTab.Id)
        Set-ControlTextValue $programBindingScriptBox $(if ($binding -and -not [string]::IsNullOrWhiteSpace([string]$binding.Target)) { [string]$binding.Target } else { 'NO SCRIPT SELECTED' })
        Set-ControlTextValue $programBindingShortcutBox $(if ($binding -and -not [string]::IsNullOrWhiteSpace([string]$binding.Shortcut)) { Format-ShortcutForDisplay -Shortcut ([string]$binding.Shortcut) } else { 'NO SHORTCUT' })
    }
    $syncFirstStepToProgram = {
        param([string]$programLabel)
        if ($stepTable.Rows.Count -le 0) { return }
        $firstRow = $stepTable.Rows[0]
        $currentType = [string]$firstRow['Type']
        if ([string]::IsNullOrWhiteSpace($currentType) -or $currentType -in @('ActivateIllustrator','ActivateBlender','ActivatePhotoshop','ActivateWindows')) {
            $firstRow['Type'] = (Get-ActivationStepTypeForProgram -Label $programLabel)
        }
    }

    $resolveRowStepType = {
        param($row)
        $declaredType = [string]$row['Type']
        $targetPath = [string]$row['ScriptPath']
        if ($declaredType -eq 'Macro') { return 'Macro' }
        if ($declaredType -eq 'Script') { return 'Script' }
        if ($declaredType -eq 'RightClick') { return 'RightClick' }
        if ($declaredType -eq 'Click' -and [string]$row['Button'] -ieq 'Right') { return 'RightClick' }
        if (-not [string]::IsNullOrWhiteSpace($targetPath)) { return 'Script' }
        return $declaredType
    }

    $reindexRows = {
        $rowNumber = 1
        foreach ($row in @($stepTable.Rows)) {
            $row['StepNumber'] = [string]$rowNumber
            $rowNumber += 1
        }
    }

    $getRecordedDefinitions = {
        $items = @()
        foreach ($recordedAction in @($script:Actions | Where-Object { $_.Kind -eq 'recorded' } | Sort-Object Label)) {
            $recordedDefinition = Read-MacroDefinition -Path $recordedAction.Path
            if ($null -ne $recordedDefinition) {
                $currentShortcut = ''
                if ($script:State -and $script:State.ActionHotkeys -and $script:State.ActionHotkeys.Contains($recordedDefinition.Id)) {
                    $currentShortcut = [string]$script:State.ActionHotkeys[$recordedDefinition.Id]
                }
                $items += [pscustomobject]@{
                    Id = $recordedDefinition.Id
                    Label = $recordedDefinition.Label
                    Path = $recordedDefinition.Path
                    FileName = (& $getMacroFileName $recordedDefinition)
                    CreatedAt = (& $getMacroCreatedAt $recordedDefinition)
                    Shortcut = $currentShortcut
                    HeaderText = $recordedDefinition.Label
                }
            }
        }
        return [object[]]@($items)
    }

    $syncOpenTabLabel = {
        param([string]$macroId, [string]$labelText)
        foreach ($openTab in @($openMacroTabs)) {
            if ([string]$openTab.Id -eq $macroId) {
                $openTab.Label = $labelText
                $openTab.HeaderText = $labelText
                break
            }
        }
    }

    $ensureMacroOpenTab = {
        param($definitionToOpen)
        if ($null -eq $definitionToOpen) { return }
        $existing = @($openMacroTabs | Where-Object { [string]$_.Id -eq [string]$definitionToOpen.Id } | Select-Object -First 1)
        if (@($existing).Count -eq 0) {
            [void]$openMacroTabs.Add([pscustomobject]@{
                Id = [string]$definitionToOpen.Id
                Label = [string]$definitionToOpen.Label
                Path = [string]$definitionToOpen.Path
                FileName = (& $getMacroFileName $definitionToOpen)
                CreatedAt = (& $getMacroCreatedAt $definitionToOpen)
                Shortcut = ''
                HeaderText = [string]$definitionToOpen.Label
            })
            return
        }
        $existing[0].Label = [string]$definitionToOpen.Label
        $existing[0].HeaderText = [string]$definitionToOpen.Label
        $existing[0].Path = [string]$definitionToOpen.Path
        if ($existing[0].PSObject.Properties['FileName']) {
            $existing[0].FileName = (& $getMacroFileName $definitionToOpen)
        }
        else {
            $existing[0] | Add-Member -NotePropertyName FileName -NotePropertyValue (& $getMacroFileName $definitionToOpen) -Force
        }
        if ($existing[0].PSObject.Properties['CreatedAt']) {
            $existing[0].CreatedAt = (& $getMacroCreatedAt $definitionToOpen)
        }
        else {
            $existing[0] | Add-Member -NotePropertyName CreatedAt -NotePropertyValue (& $getMacroCreatedAt $definitionToOpen) -Force
        }
    }

    $removeMacroOpenTab = {
        param([string]$macroId)
        for ($i = ($openMacroTabs.Count - 1); $i -ge 0; $i -= 1) {
            if ([string]$openMacroTabs[$i].Id -eq $macroId) {
                $openMacroTabs.RemoveAt($i)
            }
        }
    }

    $selectMacroTabById = {
        param([string]$macroId)
        if (-not $macroTabStrip) { return }
        $script:__macroTabSuppressSelection = $true
        try {
            if ([string]::IsNullOrWhiteSpace($macroId)) {
                $macroTabStrip.SelectedIndex = -1
                return
            }
            $targetItem = @($macroTabStrip.Items | Where-Object { $_ -and $_.PSObject.Properties['Id'] -and [string]$_.Id -eq $macroId } | Select-Object -First 1)
            if (@($targetItem).Count -gt 0) {
                $macroTabStrip.SelectedItem = $targetItem[0]
                return
            }
            if ($macroTabStrip.Items.Count -gt 0) {
                $macroTabStrip.SelectedIndex = 0
            }
        }
        finally {
            $script:__macroTabSuppressSelection = $false
        }
    }

    $setWorkbenchMacroState = {
        param([bool]$hasActiveMacro)
        foreach ($controlName in @(
            'SaveButton',
            'SaveAsButton',
            'RenameMacroButton',
            'CopyMacroButton',
            'DeleteMacroButton',
            'CloseTabButton',
            'ChooseShortcutButton',
            'ClearShortcutButton',
            'RunMacroButton',
            'UndoButton',
            'RedoButton',
            'DuplicateStepButton',
            'DeleteStepButton',
            'ApplySelectedButton',
            'PickXYButton',
            'MoveUpButton',
            'MoveDownButton',
            'AddStepButton',
            'ClearStepButton',
            'BrowseScriptButton',
            'BrowseMacroButton',
            'BulkTypeBox',
            'BulkDelayBox',
            'BulkXBox',
            'BulkYBox',
            'BulkButtonBox',
            'BulkCountBox',
            'BulkDirectionBox',
            'BulkTextBox',
            'BulkKeysBox',
            'BulkScriptBox'
        )) {
            $control = $dialog.FindName($controlName)
            if ($control) {
                $control.IsEnabled = $hasActiveMacro
            }
        }
        if ($stepGrid) { $stepGrid.IsEnabled = $hasActiveMacro }
    }

    $clearBulkEditors = {
        if ($bulkTypeBox) { $bulkTypeBox.SelectedIndex = -1 }
        if ($bulkDelayBox) { $bulkDelayBox.Text = '' }
        if ($bulkXBox) { $bulkXBox.Text = '' }
        if ($bulkYBox) { $bulkYBox.Text = '' }
        if ($bulkButtonBox) { $bulkButtonBox.SelectedIndex = -1 }
        if ($bulkCountBox) { $bulkCountBox.Text = '' }
        if ($bulkDirectionBox) { $bulkDirectionBox.SelectedIndex = -1 }
        if ($bulkTextBox) { $bulkTextBox.Text = '' }
        if ($bulkKeysBox) { $bulkKeysBox.Text = '' }
        if ($bulkScriptBox) { $bulkScriptBox.Text = '' }
    }

    $makeRowValuesFromStep = {
        param($step)
        $displayType = [string]$step.Type
        if ($displayType -eq 'Click' -and ($step.PSObject.Properties['Button'] -and [string]$step.Button -ieq 'Right')) {
            $displayType = 'RightClick'
        }
        if ($displayType -eq 'RightClick') {
            $displayType = 'RightClick'
        }
        return [ordered]@{
            StepNumber = ''
            Type = $displayType
            DelayMs = [string]$(if ($null -ne $step.DelayMs) { $step.DelayMs } else { 0 })
            X = [string]$(if ($step.PSObject.Properties['X']) { $step.X } else { '' })
            Y = [string]$(if ($step.PSObject.Properties['Y']) { $step.Y } else { '' })
            Button = [string]$(if ($step.PSObject.Properties['Button']) { if ([string]$step.Button) { $step.Button } elseif ($displayType -eq 'RightClick') { 'Right' } elseif ($displayType -eq 'Click') { 'Left' } else { '' } } else { if ($displayType -eq 'RightClick') { 'Right' } elseif ($displayType -eq 'Click') { 'Left' } else { '' } })
            Count = [string]$(if ($step.PSObject.Properties['Count']) { $step.Count } else { $(if ($displayType -eq 'Wheel') { 1 } elseif ($displayType -in @('Click','RightClick')) { 1 } else { '' }) })
            Direction = [string]$(if ($step.PSObject.Properties['Direction']) { $step.Direction } else { $(if ($displayType -eq 'Wheel') { 'Down' } else { '' }) })
            Text = [string]$(if ($step.PSObject.Properties['Text']) { $step.Text } else { '' })
            Keys = [string]$(if ($step.PSObject.Properties['Keys']) { $step.Keys } else { '' })
            ScriptPath = [string]$(if ($step.PSObject.Properties['ScriptPath']) { $step.ScriptPath } elseif ($step.PSObject.Properties['MacroPath']) { $step.MacroPath } else { '' })
        }
    }

    $rowToHashtable = {
        param($row)
        return [ordered]@{
            StepNumber = [string]$row['StepNumber']
            Type = [string]$row['Type']
            DelayMs = [string]$row['DelayMs']
            X = [string]$row['X']
            Y = [string]$row['Y']
            Button = [string]$row['Button']
            Count = [string]$row['Count']
            Direction = [string]$row['Direction']
            Text = [string]$row['Text']
            Keys = [string]$row['Keys']
            ScriptPath = [string]$row['ScriptPath']
        }
    }

    $rebuildRows = {
        param($rowDataList)
        $stepTable.Rows.Clear()
        foreach ($rowData in @($rowDataList)) {
            $row = $stepTable.NewRow()
            foreach ($column in @('StepNumber','Type','DelayMs','X','Y','Button','Count','Direction','Text','Keys','ScriptPath')) {
                $row[$column] = [string]$rowData[$column]
            }
            [void]$stepTable.Rows.Add($row)
        }
        & $reindexRows
    }

    $getSelectedIndexes = {
        return @($stepGrid.SelectedItems | ForEach-Object { $stepGrid.Items.IndexOf($_) } | Where-Object { $_ -ge 0 } | Sort-Object -Unique)
    }

    $selectIndexes = {
        param([int[]]$indexes)
        $stepGrid.SelectedItems.Clear()
        foreach ($index in @($indexes | Where-Object { $_ -ge 0 -and $_ -lt $stepGrid.Items.Count })) {
            $stepGrid.SelectedItems.Add($stepGrid.Items[$index]) | Out-Null
        }
        if (@($indexes).Count -gt 0 -and $indexes[0] -ge 0 -and $indexes[0] -lt $stepGrid.Items.Count) {
            $stepGrid.SelectedIndex = $indexes[0]
            $stepGrid.ScrollIntoView($stepGrid.Items[$indexes[0]])
        }
    }

    $captureSnapshot = {
        $rows = @()
        foreach ($row in @($stepTable.Rows)) {
            $rows += [ordered]@{
                StepNumber = [string]$row['StepNumber']
                Type = [string]$row['Type']
                DelayMs = [string]$row['DelayMs']
                X = [string]$row['X']
                Y = [string]$row['Y']
                Button = [string]$row['Button']
                Count = [string]$row['Count']
                Direction = [string]$row['Direction']
                Text = [string]$row['Text']
                Keys = [string]$row['Keys']
                ScriptPath = [string]$row['ScriptPath']
            }
        }
        return [pscustomobject]@{
            Rows = @($rows)
        }
    }

    $pushUndo = {
        if ($script:__macroSuppressUndo) { return }
        $snapshot = & $captureSnapshot
        $script:__macroUndoStack.Add($snapshot)
        $script:__macroRedoStack.Clear()
        if ($script:__macroUndoStack.Count -gt 60) {
            $script:__macroUndoStack.RemoveAt(0)
        }
        $script:__macroDirty = $true
    }

    $applySnapshot = {
        param($snapshot)
        $script:__macroSuppressUndo = $true
        $script:__macroLoadingDefinition = $true
        try {
            & $rebuildRows $snapshot.Rows
            if ($stepGrid.Items.Count -gt 0) { & $selectIndexes @(0) }
        }
        finally {
            $script:__macroLoadingDefinition = $false
            $script:__macroSuppressUndo = $false
        }
    }

    $syncBulkEditorsFromSelection = {
        if ($script:__macroLoadingDefinition) { return }
        if (-not $bulkTypeBox -or -not $bulkDelayBox -or -not $bulkXBox -or -not $bulkYBox -or -not $bulkButtonBox -or -not $bulkCountBox -or -not $bulkDirectionBox -or -not $bulkTextBox -or -not $bulkKeysBox -or -not $bulkScriptBox) { return }
        $firstIndex = $stepGrid.SelectedIndex
        if ($firstIndex -lt 0 -or $firstIndex -ge $stepTable.Rows.Count) { return }
        $row = $stepTable.Rows[$firstIndex]
        $bulkTypeBox.SelectedIndex = -1
        foreach ($item in @($bulkTypeBox.Items)) {
            if ([string]$item.Content -eq [string]$row['Type']) {
                $bulkTypeBox.SelectedItem = $item
                break
            }
        }
        $bulkDelayBox.Text = [string]$row['DelayMs']
        $bulkXBox.Text = [string]$row['X']
        $bulkYBox.Text = [string]$row['Y']
        $bulkCountBox.Text = [string]$row['Count']
        $bulkTextBox.Text = [string]$row['Text']
        $bulkKeysBox.Text = [string]$row['Keys']
        $bulkScriptBox.Text = [string]$row['ScriptPath']
        $bulkButtonBox.SelectedIndex = -1
        foreach ($item in @($bulkButtonBox.Items)) {
            if ([string]$item.Content -eq [string]$row['Button']) {
                $bulkButtonBox.SelectedItem = $item
                break
            }
        }
        $bulkDirectionBox.SelectedIndex = -1
        foreach ($item in @($bulkDirectionBox.Items)) {
            if ([string]$item.Content -eq [string]$row['Direction']) {
                $bulkDirectionBox.SelectedItem = $item
                break
            }
        }
    }

    $refreshBindingShortcutDisplay = {
        param([string]$macroId = '')
        if ([string]::IsNullOrWhiteSpace($macroId)) {
            $macroId = (& $resolveCurrentMacroId)
        }
        if ([string]::IsNullOrWhiteSpace($macroId)) {
            Set-ControlTextValue $activeShortcutBox 'NO MACRO OPEN'
            $script:__lastAppliedBindingShortcut = ''
            return
        }
        $currentShortcut = (& $getShortcutForMacroId $macroId)
        & $updateActiveShortcutDisplay $currentShortcut
        $script:__lastAppliedBindingShortcut = $currentShortcut
    }

    $clearEditorForNoMacro = {
        $script:__macroSuppressUndo = $true
        $script:__macroLoadingDefinition = $true
        try {
            $stepTable.Rows.Clear()
            if ($stepGrid) {
                $stepGrid.SelectedItems.Clear()
                $stepGrid.SelectedIndex = -1
            }
            & $clearBulkEditors
        }
        finally {
            $script:__macroLoadingDefinition = $false
            $script:__macroSuppressUndo = $false
        }
        $script:__macroUndoStack.Clear()
        $script:__macroRedoStack.Clear()
        $script:__macroDirty = $false
        $script:__macroSelectedDefinitionId = ''
        & $refreshBindingShortcutDisplay ''
        & $setWorkbenchMacroState $false
    }

    $loadDefinitionIntoEditor = {
        param($newDefinition)
        if ($null -eq $newDefinition) { return }
        $script:__macroSuppressUndo = $true
        $script:__macroLoadingDefinition = $true
        try {
            $definition = $newDefinition
            $script:__macroSelectedDefinitionId = $definition.Id
            & $ensureMacroOpenTab $definition
            $rows = @()
            foreach ($step in @($definition.Steps)) {
                $rows += (& $makeRowValuesFromStep $step)
            }
            & $rebuildRows $rows
            $script:__macroUndoStack.Clear()
            $script:__macroRedoStack.Clear()
            $script:__macroDirty = $false
            & $refreshMacroTabs
            & $selectMacroTabById $definition.Id
            if ($stepGrid.Items.Count -gt 0) {
                & $selectIndexes @(0)
            }
        }
        finally {
            $script:__macroLoadingDefinition = $false
            $script:__macroSuppressUndo = $false
        }
        & $refreshBindingShortcutDisplay $definition.Id
        & $syncBulkEditorsFromSelection
        & $setWorkbenchMacroState $true
    }

    $refreshMacroTabs = {
        $definitions = [object[]]@($openMacroTabs)
        $macroTabStrip.ItemsSource = $null
        $macroTabStrip.ItemsSource = $definitions
        if (@($definitions).Count -gt 0) {
            & $selectMacroTabById $script:__macroSelectedDefinitionId
            if ($null -eq (& $getSelectorSelectedItem $macroTabStrip)) {
                $macroTabStrip.SelectedIndex = 0
            }
        }
        else {
            $macroTabStrip.SelectedIndex = -1
        }
    }

    if ($null -ne $definition) {
        & $ensureMacroOpenTab $definition
        & $refreshMacroTabs
    }
    else {
        & $refreshMacroTabs
    }
    $stepGrid.ItemsSource = $stepTable.DefaultView
    if ($null -ne $definition) {
        & $loadDefinitionIntoEditor $definition
    }
    else {
        & $clearEditorForNoMacro
    }

    $columnWidthMap = [ordered]@{
        '#' = 'Number'
        'Type' = 'Type'
        'Delay' = 'Delay'
        'X' = 'X'
        'Y' = 'Y'
        'Button' = 'Button'
        'Count' = 'Count'
        'Direction' = 'Direction'
        'Text' = 'Text'
        'Keys' = 'Keys'
        'Target' = 'Script'
    }
    foreach ($column in @($stepGrid.Columns)) {
        $headerText = [string]$column.Header
        if ($columnWidthMap.Contains($headerText) -and $script:State.MacroEditorColumns -and $script:State.MacroEditorColumns.Contains($columnWidthMap[$headerText])) {
            $column.Width = [double]$script:State.MacroEditorColumns[$columnWidthMap[$headerText]]
        }
    }

    $makeDefaultStep = {
        $selectedBulkType = ''
        if ($bulkTypeBox.SelectedItem) { $selectedBulkType = [string]$bulkTypeBox.SelectedItem.Content }
        if ([string]::IsNullOrWhiteSpace($selectedBulkType)) { $selectedBulkType = 'Click' }
        $defaultStep = [ordered]@{
            Type = $selectedBulkType
            DelayMs = if ([string]::IsNullOrWhiteSpace($bulkDelayBox.Text)) { 0 } else { $bulkDelayBox.Text }
            X = $bulkXBox.Text
            Y = $bulkYBox.Text
            Button = ''
            Count = ''
            Direction = ''
            Text = $bulkTextBox.Text
            Keys = $bulkKeysBox.Text
            ScriptPath = $bulkScriptBox.Text
        }
        if (-not [string]::IsNullOrWhiteSpace($defaultStep.ScriptPath) -and $selectedBulkType -ne 'Macro') {
            $defaultStep.Type = 'Script'
            $selectedBulkType = 'Script'
        }
        switch ($selectedBulkType) {
            'ActivateIllustrator' {
                $defaultStep.X = ''
                $defaultStep.Y = ''
                $defaultStep.Text = ''
                $defaultStep.Keys = ''
            }
            'RightClick' {
                $defaultStep.Button = 'Right'
                $defaultStep.Count = '1'
                $defaultStep.Direction = ''
                $defaultStep.Text = ''
                $defaultStep.Keys = ''
            }
            'Text' {
                $defaultStep.X = ''
                $defaultStep.Y = ''
                $defaultStep.Button = ''
                $defaultStep.Count = ''
                $defaultStep.Direction = ''
                $defaultStep.Keys = ''
            }
            'Key' {
                $defaultStep.X = ''
                $defaultStep.Y = ''
                $defaultStep.Button = ''
                $defaultStep.Count = ''
                $defaultStep.Direction = ''
                $defaultStep.Text = ''
            }
            'Wheel' {
                $defaultStep.Button = ''
                $defaultStep.Text = ''
                $defaultStep.Keys = ''
                $defaultStep.Count = if ([string]::IsNullOrWhiteSpace($bulkCountBox.Text)) { '1' } else { $bulkCountBox.Text }
                if ([string]::IsNullOrWhiteSpace($defaultStep.Direction)) { $defaultStep.Direction = 'Down' }
            }
            'Script' {
                $defaultStep.X = ''
                $defaultStep.Y = ''
                $defaultStep.Button = ''
                $defaultStep.Count = ''
                $defaultStep.Direction = ''
                $defaultStep.Text = ''
                $defaultStep.Keys = ''
            }
            'Macro' {
                $defaultStep.X = ''
                $defaultStep.Y = ''
                $defaultStep.Button = ''
                $defaultStep.Count = ''
                $defaultStep.Direction = ''
                $defaultStep.Text = ''
                $defaultStep.Keys = ''
            }
            default {
                if ([string]::IsNullOrWhiteSpace($defaultStep.Button)) { $defaultStep.Button = 'Left' }
                if ([string]::IsNullOrWhiteSpace($defaultStep.Count)) { $defaultStep.Count = '1' }
            }
        }
        if ($selectedBulkType -eq 'Click') {
            $defaultStep.Button = 'Left'
            $defaultStep.Count = '1'
            $defaultStep.Direction = ''
        }
        return $defaultStep
    }

    $applyBulkToSelection = {
        $selectedIndexes = @(& $getSelectedIndexes)
        if (@($selectedIndexes).Count -eq 0) {
            [System.Windows.MessageBox]::Show($dialog, 'Select one or more steps first.', 'Edit Macro') | Out-Null
            return
        }
        & $pushUndo
        $typeValue = if ($bulkTypeBox.SelectedItem) { [string]$bulkTypeBox.SelectedItem.Content } else { '' }
        $buttonValue = if ($bulkButtonBox.SelectedItem) { [string]$bulkButtonBox.SelectedItem.Content } else { '' }
        $directionValue = if ($bulkDirectionBox.SelectedItem) { [string]$bulkDirectionBox.SelectedItem.Content } else { '' }
        $scriptPathValue = $bulkScriptBox.Text.Trim()
        foreach ($index in $selectedIndexes) {
            $row = $stepTable.Rows[$index]
            if ($typeValue -ne '') { $row['Type'] = $typeValue }
            $row['DelayMs'] = $bulkDelayBox.Text
            $row['X'] = $bulkXBox.Text
            $row['Y'] = $bulkYBox.Text
            $row['Button'] = $buttonValue
            $row['Count'] = $bulkCountBox.Text
            $row['Direction'] = $directionValue
            $row['Text'] = $bulkTextBox.Text
            $row['Keys'] = $bulkKeysBox.Text
            $row['ScriptPath'] = $scriptPathValue
            if ($scriptPathValue -ne '' -and [string]::IsNullOrWhiteSpace([string]$row['Type'])) { $row['Type'] = 'Script' }
            switch ([string]$row['Type']) {
                'ActivateIllustrator' {
                    foreach ($column in @('X','Y','Button','Count','Direction','Text','Keys','ScriptPath')) { $row[$column] = '' }
                }
                'RightClick' {
                    foreach ($column in @('Direction','Text','Keys','ScriptPath')) { $row[$column] = '' }
                    $row['Button'] = 'Right'
                    if ([string]::IsNullOrWhiteSpace([string]$row['Count'])) { $row['Count'] = '1' }
                }
                'Text' {
                    foreach ($column in @('X','Y','Button','Count','Direction','Keys','ScriptPath')) { $row[$column] = '' }
                }
                'Key' {
                    foreach ($column in @('X','Y','Button','Count','Direction','Text','ScriptPath')) { $row[$column] = '' }
                }
                'Wheel' {
                    foreach ($column in @('Button','Text','Keys','ScriptPath')) { $row[$column] = '' }
                    if ([string]::IsNullOrWhiteSpace([string]$row['Count'])) { $row['Count'] = '1' }
                    if ([string]::IsNullOrWhiteSpace([string]$row['Direction'])) { $row['Direction'] = 'Down' }
                }
                'Click' {
                    foreach ($column in @('Direction','Text','Keys','ScriptPath')) { $row[$column] = '' }
                    $row['Button'] = 'Left'
                    if ([string]::IsNullOrWhiteSpace([string]$row['Count'])) { $row['Count'] = '1' }
                }
                'Script' {
                    foreach ($column in @('X','Y','Button','Count','Direction','Text','Keys')) { $row[$column] = '' }
                }
                'Macro' {
                    foreach ($column in @('X','Y','Button','Count','Direction','Text','Keys')) { $row[$column] = '' }
                }
            }
        }
        & $syncBulkEditorsFromSelection
    }

    $moveSelectedRows = {
        param([int]$direction)
        $selectedIndexes = @(& $getSelectedIndexes)
        if (@($selectedIndexes).Count -eq 0) { return }
        if ($direction -lt 0 -and $selectedIndexes[0] -le 0) { return }
        if ($direction -gt 0 -and $selectedIndexes[-1] -ge ($stepTable.Rows.Count - 1)) { return }
        & $pushUndo
        $allRows = @()
        foreach ($row in @($stepTable.Rows)) { $allRows += (& $rowToHashtable $row) }
        $moving = @()
        foreach ($index in $selectedIndexes) { $moving += $allRows[$index] }
        $selectedMap = @{}
        foreach ($index in $selectedIndexes) { $selectedMap[$index] = $true }
        $remaining = @()
        foreach ($index in 0..($allRows.Count - 1)) {
            if (-not $selectedMap.ContainsKey($index)) { $remaining += $allRows[$index] }
        }
        if ($direction -lt 0) {
            $insertAt = [Math]::Max($selectedIndexes[0] - 1, 0)
        } else {
            $insertAt = [Math]::Min($selectedIndexes[-1] + 2 - @($selectedIndexes).Count, $remaining.Count)
        }
        $newRows = @()
        if ($insertAt -gt 0) { $newRows += $remaining[0..($insertAt - 1)] }
        $newRows += $moving
        if ($insertAt -lt $remaining.Count) { $newRows += $remaining[$insertAt..($remaining.Count - 1)] }
        & $rebuildRows $newRows
        & $selectIndexes @((0..($moving.Count - 1)) | ForEach-Object { $insertAt + $_ })
        & $syncBulkEditorsFromSelection
    }

    $moveRowsToIndex = {
        param([int]$targetIndex)
        $selectedIndexes = @(& $getSelectedIndexes)
        if (@($selectedIndexes).Count -eq 0) { return }
        if ($targetIndex -lt 0) { $targetIndex = 0 }
        if ($targetIndex -gt $stepTable.Rows.Count) { $targetIndex = $stepTable.Rows.Count }
        if ($targetIndex -ge $selectedIndexes[0] -and $targetIndex -le ($selectedIndexes[-1] + 1)) { return }

        & $pushUndo
        $allRows = @()
        foreach ($row in @($stepTable.Rows)) { $allRows += (& $rowToHashtable $row) }
        $selectedMap = @{}
        foreach ($index in $selectedIndexes) { $selectedMap[$index] = $true }
        $moving = @()
        foreach ($index in $selectedIndexes) { $moving += $allRows[$index] }
        $remaining = @()
        $remainingIndexes = @()
        foreach ($index in 0..($allRows.Count - 1)) {
            if (-not $selectedMap.ContainsKey($index)) {
                $remaining += $allRows[$index]
                $remainingIndexes += $index
            }
        }
        $insertAt = 0
        foreach ($remainingIndex in $remainingIndexes) {
            if ($remainingIndex -lt $targetIndex) { $insertAt += 1 }
        }
        $newRows = @()
        if ($insertAt -gt 0) { $newRows += $remaining[0..($insertAt - 1)] }
        $newRows += $moving
        if ($insertAt -lt $remaining.Count) { $newRows += $remaining[$insertAt..($remaining.Count - 1)] }
        & $rebuildRows $newRows
        & $selectIndexes @((0..($moving.Count - 1)) | ForEach-Object { $insertAt + $_ })
        & $syncBulkEditorsFromSelection
    }

    $stepGrid.Add_BeginningEdit({
        & $pushUndo
    })
    $stepGrid.Add_CurrentCellChanged({
        if (-not $script:__macroSuppressUndo) { $script:__macroDirty = $true }
    })
    $stepGrid.Add_SelectionChanged({
        try {
            & $syncBulkEditorsFromSelection
        }
        catch {
            Write-UiLog ('Edit Macro selection sync failed: {0}' -f $_.Exception.ToString())
        }
    })
    $macroTabStrip.Add_SelectionChanged({
        try {
            if ($script:__macroLoadingDefinition -or $script:__macroTabSuppressSelection) { return }
            $selectedItem = & $getSelectorSelectedItem $macroTabStrip
            if ($null -eq $selectedItem) {
                if (@($openMacroTabs).Count -eq 0) {
                    & $clearEditorForNoMacro
                }
                return
            }
            if ([string]$selectedItem.Id -eq [string]$script:__macroSelectedDefinitionId) { return }
            if ($script:__macroDirty) {
                $discard = [System.Windows.MessageBox]::Show($dialog, 'Discard unsaved edits and switch macros?', 'Edit Macro', 'YesNo', 'Question')
                if ($discard -ne 'Yes') {
                    & $selectMacroTabById $script:__macroSelectedDefinitionId
                    return
                }
            }
            $newDefinition = Read-MacroDefinition -Path $selectedItem.Path
            if ($null -eq $newDefinition) { return }
            & $loadDefinitionIntoEditor $newDefinition
        }
        catch {
            Write-UiLog ('Edit Macro action switch failed: {0}' -f $_.Exception.ToString())
        }
    })
    $macroTabStrip.Add_PreviewMouseLeftButtonUp({
        param($sender, $eventArgs)
        try {
            $dep = [System.Windows.DependencyObject]$eventArgs.OriginalSource
            while ($dep -and -not ($dep -is [System.Windows.Controls.ListBoxItem])) {
                $dep = [System.Windows.Media.VisualTreeHelper]::GetParent($dep)
            }
            if ($dep -and ($dep -is [System.Windows.Controls.ListBoxItem])) {
                $clickedItem = $dep.DataContext
                if ($clickedItem) {
                    $macroTabStrip.SelectedItem = $clickedItem
                    $eventArgs.Handled = $true
                }
            }
        }
        catch {
            Write-UiLog ('Macro tab click handling failed: {0}' -f $_.Exception.ToString())
        }
    })

    if ($programTabStrip) {
        $programTabStrip.Add_SelectionChanged({
            try {
                if ($script:__programTabSuppressSelection) { return }
                $selectedItem = & $getSelectorSelectedItem $programTabStrip
                if ($null -eq $selectedItem) { return }
                $script:__currentProgramTabId = [int]$selectedItem.Id
                if ($script:State) {
                    $script:State.SelectedProgramTabId = $script:__currentProgramTabId
                    Save-State
                }
                & $setProgramTabStatus $selectedItem
                & $refreshProgramBindingDisplay
                & $syncFirstStepToProgram ([string]$selectedItem.Label)
                Write-UiLog ('Program tab selected: {0}' -f [string]$selectedItem.Label)
            }
            catch {
                Write-UiLog ('Program tab selection failed: {0}' -f $_.Exception.ToString())
            }
        })
        $programTabStrip.Add_PreviewMouseLeftButtonUp({
            param($sender, $eventArgs)
            try {
                $dep = [System.Windows.DependencyObject]$eventArgs.OriginalSource
                while ($dep -and -not ($dep -is [System.Windows.Controls.ListBoxItem])) {
                    $dep = [System.Windows.Media.VisualTreeHelper]::GetParent($dep)
                }
                if ($dep -and ($dep -is [System.Windows.Controls.ListBoxItem])) {
                    $clickedItem = $dep.DataContext
                    if ($clickedItem) {
                        $programTabStrip.SelectedItem = $clickedItem
                        $eventArgs.Handled = $true
                    }
                }
            }
            catch {
                Write-UiLog ('Program tab click handling failed: {0}' -f $_.Exception.ToString())
            }
        })
    }

    $promptProgramTabName = {
        param(
            [string]$title = 'Add Program Tab',
            [string]$initialValue = 'New Program',
            [string]$acceptText = 'Add'
        )

        $promptXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Add Program Tab"
        Width="520"
        Height="250"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock x:Name="PromptTitleText" Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,12" />
            <TextBlock Grid.Row="1" Text="Program name" Margin="0,0,0,8" />
            <TextBox x:Name="PromptInputBox" Grid.Row="2" MinHeight="42" FontSize="16" Padding="10,6" VerticalContentAlignment="Center" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                <Button x:Name="CancelButton" Width="120" Margin="0,0,10,0" Background="#FF6C6C6C">Cancel</Button>
                <Button x:Name="OkButton" Width="140">Add</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

        $promptReader = New-Object System.Xml.XmlNodeReader ([xml]$promptXaml)
        $promptDialog = [Windows.Markup.XamlReader]::Load($promptReader)
        $promptDialog.Owner = $dialog
        $promptDialog.FindName('PromptTitleText').Text = $title
        $promptInputBox = $promptDialog.FindName('PromptInputBox')
        $promptInputBox.Text = $initialValue
        $promptInputBox.SelectAll()
        $promptInputBox.Focus() | Out-Null
        $promptDialog.FindName('OkButton').Content = $acceptText
        $script:__programTabPromptValue = ''
        $commitProgramTabName = {
            $script:__programTabPromptValue = [string]$promptInputBox.Text.Trim()
            if ([string]::IsNullOrWhiteSpace($script:__programTabPromptValue)) { return }
            $promptDialog.DialogResult = $true
            $promptDialog.Close()
        }

        $promptDialog.FindName('OkButton').Add_Click($commitProgramTabName)
        $promptDialog.FindName('CancelButton').Add_Click({
            $promptDialog.DialogResult = $false
            $promptDialog.Close()
        })
        $promptInputBox.Add_KeyDown({
            param($sender, $eventArgs)
            if ($eventArgs.Key -eq 'Enter') {
                & $commitProgramTabName
                $eventArgs.Handled = $true
            }
        })

        [void]$promptDialog.ShowDialog()
        if ($promptDialog.DialogResult) { return [string]$script:__programTabPromptValue }
        return ''
    }

    if ($addProgramTabButton) {
        $addProgramTabButton.Add_Click({
            try {
                $tabName = & $promptProgramTabName 'Add Program Tab' 'New Program' 'Add'
                if ([string]::IsNullOrWhiteSpace($tabName)) { return }
                $currentProgramTab = & $getCurrentProgramTab
                $newTab = & $ensureProgramTab ([string]$tabName.Trim()) $(if ($currentProgramTab -and $currentProgramTab.PSObject.Properties['ScriptFolder']) { [string]$currentProgramTab.ScriptFolder } else { '' })
                if ($null -eq $newTab) { return }
                & $refreshProgramTabs
                & $selectProgramTabById ([int]$newTab.Id)
                & $setProgramTabStatus $newTab
                & $refreshProgramBindingDisplay
            }
            catch {
                Show-UiError 'Failed to add a program tab.' $_.Exception
            }
        })
    }

    $promptMacroName = {
        param(
            [string]$title,
            [string]$initialValue,
            [string]$acceptText
        )
        $nameDialogXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Name Macro"
        Width="520"
        Height="250"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock x:Name="TitleTextBlock" Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,12" />
            <TextBlock Grid.Row="1" Text="Macro name" Margin="0,0,0,8" />
            <TextBox x:Name="MacroNameInput" Grid.Row="2" MinHeight="42" FontSize="16" Padding="10,6" VerticalContentAlignment="Center" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                <Button x:Name="CancelButton" Width="120" Margin="0,0,10,0" Background="#FF6C6C6C">Cancel</Button>
                <Button x:Name="OkButton" Width="140">OK</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@
        $nameReader = New-Object System.Xml.XmlNodeReader ([xml]$nameDialogXaml)
        $nameDialog = [Windows.Markup.XamlReader]::Load($nameReader)
        $nameDialog.Owner = $dialog
        $nameDialog.FindName('TitleTextBlock').Text = $title
        $nameInputBox = $nameDialog.FindName('MacroNameInput')
        $nameInputBox.Text = $initialValue
        $nameInputBox.SelectAll()
        $nameInputBox.Focus() | Out-Null
        $nameDialog.FindName('OkButton').Content = $acceptText
        $script:__macroPromptValue = ''
        $commitName = {
            $script:__macroPromptValue = [string]$nameInputBox.Text.Trim()
            if ([string]::IsNullOrWhiteSpace($script:__macroPromptValue)) { return }
            $nameDialog.DialogResult = $true
            $nameDialog.Close()
        }
        $nameDialog.FindName('OkButton').Add_Click($commitName)
        $nameDialog.FindName('CancelButton').Add_Click({
            $nameDialog.DialogResult = $false
            $nameDialog.Close()
        })
        $nameInputBox.Add_KeyDown({
            param($sender, $eventArgs)
            if ($eventArgs.Key -eq 'Enter') {
                & $commitName
                $eventArgs.Handled = $true
            }
        })
        if ($nameDialog.ShowDialog()) { return [string]$script:__macroPromptValue }
        return ''
    }

    $showOpenMacroDialog = {
        param(
            [string]$windowTitle = 'Open Macro',
            [string]$promptText = 'Choose a recorded macro to open in a new tab.',
            [string]$acceptText = 'Open'
        )
        $availableDefinitions = [object[]]@(& $getRecordedDefinitions)
        if (@($availableDefinitions).Count -eq 0) {
            [System.Windows.MessageBox]::Show($dialog, 'No recorded macros exist yet.', 'FlowCell') | Out-Null
            return $null
        }
        $openDialogXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Open Macro"
        Width="560"
        Height="260"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock x:Name="OpenDialogTitleTextBlock" Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Open Macro</TextBlock>
            <TextBlock x:Name="OpenDialogPromptTextBlock" Grid.Row="1" Text="Choose a recorded macro to open in a new tab." Margin="0,0,0,12" />
            <ComboBox x:Name="MacroOpenCombo" Grid.Row="2" DisplayMemberPath="Label" SelectedValuePath="Id" MinHeight="38" FontSize="16" VerticalContentAlignment="Center" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,16,0,0">
                <Button x:Name="CancelButton" Width="120" Margin="0,0,10,0" Background="#FF6C6C6C">Cancel</Button>
                <Button x:Name="OpenButton" Width="120">Open</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@
        $openReader = New-Object System.Xml.XmlNodeReader ([xml]$openDialogXaml)
        $openDialog = [Windows.Markup.XamlReader]::Load($openReader)
        $openDialog.Owner = $dialog
        $openDialog.Title = $windowTitle
        $openDialog.FindName('OpenDialogTitleTextBlock').Text = $windowTitle
        $openDialog.FindName('OpenDialogPromptTextBlock').Text = $promptText
        $openDialog.FindName('OpenButton').Content = $acceptText
        $macroOpenCombo = $openDialog.FindName('MacroOpenCombo')
        foreach ($item in $availableDefinitions) { [void]$macroOpenCombo.Items.Add($item) }
        if ($macroOpenCombo.Items.Count -gt 0) { $macroOpenCombo.SelectedIndex = 0 }
        $script:__openedMacroDefinition = $null
        $commitOpen = {
            $script:__openedMacroDefinition = $macroOpenCombo.SelectedItem
            if ($null -eq $script:__openedMacroDefinition) { return }
            $openDialog.DialogResult = $true
            $openDialog.Close()
        }
        $openDialog.FindName('OpenButton').Add_Click($commitOpen)
        $openDialog.FindName('CancelButton').Add_Click({
            $openDialog.DialogResult = $false
            $openDialog.Close()
        })
        if ($openDialog.ShowDialog()) { return $script:__openedMacroDefinition }
        return $null
    }

    $showChooseMacroStepDialog = {
        $availableDefinitions = [object[]]@(& $getRecordedDefinitions)
        if (@($availableDefinitions).Count -eq 0) {
            [System.Windows.MessageBox]::Show($dialog, 'No recorded macros exist yet.', 'FlowCell') | Out-Null
            return $null
        }
        $macroChoice = & $showOpenMacroDialog 'Choose Macro Step' 'Choose a recorded macro to insert as a nested step.' 'Choose'
        if ($null -eq $macroChoice) { return $null }
        return [string]$macroChoice.Path
    }

    $openMacroInTab = {
        if ($script:__macroDirty -and -not [string]::IsNullOrWhiteSpace([string]$script:__macroSelectedDefinitionId)) {
            $discard = [System.Windows.MessageBox]::Show($dialog, 'Discard unsaved edits and open another macro?', 'FlowCell', 'YesNo', 'Question')
            if ($discard -ne 'Yes') { return }
        }
        $definitionItem = & $showOpenMacroDialog
        if ($null -eq $definitionItem) { return }
        $openedDefinition = Read-MacroDefinition -Path $definitionItem.Path
        if ($null -eq $openedDefinition) { return }
        & $loadDefinitionIntoEditor $openedDefinition
    }

    $closeCurrentMacroTab = {
        $selectedMacro = & $getCurrentSelectedMacroItem
        if ($null -eq $selectedMacro -or [string]::IsNullOrWhiteSpace([string]$selectedMacro.Id)) { return }
        if ($script:__macroDirty) {
            $discard = [System.Windows.MessageBox]::Show($dialog, 'Discard unsaved edits and close this tab?', 'FlowCell', 'YesNo', 'Question')
            if ($discard -ne 'Yes') { return }
        }
        $selectedIndex = $macroTabStrip.SelectedIndex
        $closingLabel = [string]$selectedMacro.Label
        $closingId = [string]$selectedMacro.Id
        & $removeMacroOpenTab $closingId
        & $refreshMacroTabs
        if (@($openMacroTabs).Count -eq 0) {
            & $clearEditorForNoMacro
            Set-ShortcutStatus ('Closed tab for {0}.' -f $closingLabel)
            Set-ActionStatus 'No macro is currently open.'
            return
        }
        $nextIndex = [Math]::Min([Math]::Max($selectedIndex, 0), $openMacroTabs.Count - 1)
        $nextOpenTab = $openMacroTabs[$nextIndex]
        $nextDefinition = Read-MacroDefinition -Path $nextOpenTab.Path
        if ($null -ne $nextDefinition) {
            & $loadDefinitionIntoEditor $nextDefinition
        }
    }
    $bulkApplyOnEnter = {
        param($sender, $eventArgs)
        if ($eventArgs.Key -ne 'Enter') { return }
        & $applyBulkToSelection
        $eventArgs.Handled = $true
    }
    foreach ($control in @($bulkDelayBox, $bulkXBox, $bulkYBox, $bulkCountBox, $bulkTextBox, $bulkKeysBox, $bulkScriptBox)) {
        if ($control) { $control.Add_KeyDown($bulkApplyOnEnter) }
    }
    foreach ($control in @($bulkTypeBox, $bulkButtonBox, $bulkDirectionBox)) {
        if ($control) { $control.Add_KeyDown($bulkApplyOnEnter) }
    }

    $mouseTimer = New-Object System.Windows.Threading.DispatcherTimer
    $mouseTimer.Interval = [TimeSpan]::FromMilliseconds(120)
    $mouseTimer.Add_Tick({
        try {
            if (-not $mousePositionBox) { return }
            $position = [System.Windows.Forms.Cursor]::Position
            $mousePositionBox.Text = ('X {0}   Y {1}' -f $position.X, $position.Y)
        }
        catch {
            Write-UiLog ('Edit Macro mouse timer failed: {0}' -f $_.Exception.ToString())
        }
    })

    $pickTimer = New-Object System.Windows.Threading.DispatcherTimer
    $pickTimer.Interval = [TimeSpan]::FromSeconds(1)
    $script:__pickRemaining = 0
    $pickTimer.Add_Tick({
        $script:__pickRemaining -= 1
        if ($script:__pickRemaining -gt 0) {
            $pickXYButton.Content = ('Pick XY ({0})' -f $script:__pickRemaining)
            return
        }

        $pickTimer.Stop()
        $pickXYButton.Content = 'Pick XY'
        $selectedIndexes = @(& $getSelectedIndexes)
        if (@($selectedIndexes).Count -eq 0) { return }
        & $pushUndo
        $position = [System.Windows.Forms.Cursor]::Position
        foreach ($selectedIndex in $selectedIndexes) {
            $selectedRow = $stepTable.Rows[$selectedIndex]
            $selectedRow['X'] = [string]$position.X
            $selectedRow['Y'] = [string]$position.Y
        }
        $bulkXBox.Text = [string]$position.X
        $bulkYBox.Text = [string]$position.Y
        $mousePositionBox.Text = ('X {0}   Y {1}' -f $position.X, $position.Y)
    })

    $dialog.Add_Activated({
        try {
            & $refreshBindingShortcutDisplay
        }
        catch {
        }
    })

    $saveCurrentMacro = {
        $selectedMacro = & $getCurrentSelectedMacroItem
        if ($null -eq $selectedMacro -or [string]::IsNullOrWhiteSpace([string]$selectedMacro.Id) -or [string]::IsNullOrWhiteSpace([string]$selectedMacro.Path)) {
            Set-ShortcutStatus 'Open a macro tab before saving.'
            Set-ActionStatus 'No macro is currently open.'
            return $false
        }
        $updatedSteps = @()
        foreach ($row in @($stepTable.Rows)) {
            $effectiveType = & $resolveRowStepType $row
            $savedCount = if ([string]::IsNullOrWhiteSpace([string]$row['Count'])) { $(if ($effectiveType -eq 'Wheel' -or $effectiveType -in @('Click','RightClick')) { '1' } else { '' }) } else { [string]$row['Count'] }
            $savedButton = switch ($effectiveType) {
                'RightClick' { 'Right' }
                'Click' { 'Left' }
                default { [string]$row['Button'] }
            }
            $savedDirection = if ($effectiveType -eq 'Wheel') {
                if ([string]::IsNullOrWhiteSpace([string]$row['Direction'])) { 'Down' } else { [string]$row['Direction'] }
            } else {
                ''
            }
            $updatedSteps += [pscustomobject]@{
                Section = ''
                Type = $effectiveType
                DelayMs = if ([string]$row['DelayMs'] -match '^-?\d+$') { [int]$row['DelayMs'] } else { 0 }
                X = switch ($effectiveType) { 'Click' { [string]$row['X'] } 'RightClick' { [string]$row['X'] } 'Wheel' { [string]$row['X'] } default { '' } }
                Y = switch ($effectiveType) { 'Click' { [string]$row['Y'] } 'RightClick' { [string]$row['Y'] } 'Wheel' { [string]$row['Y'] } default { '' } }
                Button = $savedButton
                Count = $savedCount
                Direction = $savedDirection
                Text = switch ($effectiveType) { 'Text' { [string]$row['Text'] } default { '' } }
                Keys = switch ($effectiveType) { 'Key' { [string]$row['Keys'] } default { '' } }
                ScriptPath = switch ($effectiveType) { 'Script' { [string]$row['ScriptPath'] } default { '' } }
                MacroPath = switch ($effectiveType) { 'Macro' { [string]$row['ScriptPath'] } default { '' } }
            }
        }
        $definitionToSave = [pscustomobject]@{
            Path = [string]$selectedMacro.Path
            FileName = (& $getMacroFileName $selectedMacro)
            Id = [string]$selectedMacro.Id
            Label = [string]$selectedMacro.Label
            CreatedAt = (& $getMacroCreatedAt $selectedMacro)
            Steps = @($updatedSteps)
        }
        Save-MacroDefinition -Definition $definitionToSave
        Load-Actions
        $script:State = Read-State
        Sync-FlowCellUiFromCurrentState
        Restart-Backend
        Refresh-Ui
        $reloadedDefinition = Read-MacroDefinition -Path $definitionToSave.Path
        if ($null -ne $reloadedDefinition) {
            & $loadDefinitionIntoEditor $reloadedDefinition
        }
        if ($script:ActionSelector -and ($script:Actions.Id -contains $definitionToSave.Id)) {
            $script:ActionSelector.SelectedValue = $definitionToSave.Id
        }
        & $refreshBindingShortcutDisplay $definitionToSave.Id
        Set-ShortcutStatus ('Saved macro changes for {0}.' -f $definitionToSave.Label)
        Set-ActionStatus ('Macro updated:`r`n{0}' -f $definitionToSave.Label)
        $script:__macroDirty = $false
        return $true
    }

    $saveMacroAsNew = {
        param(
            [string]$newLabel,
            [switch]$SelectNewTab
        )

        $newLabel = [string]$newLabel
        if ([string]::IsNullOrWhiteSpace($newLabel)) {
            [System.Windows.MessageBox]::Show($dialog, 'Macro name cannot be blank.', 'FlowCell') | Out-Null
            return $false
        }
        $selectedMacro = & $getCurrentSelectedMacroItem
        if ($null -eq $selectedMacro) {
            Set-ShortcutStatus 'Open a macro tab before using Save As.'
            Set-ActionStatus 'No macro is currently open.'
            return $false
        }

        $copyId = New-RecordedActionId -Name $newLabel
        $copyPath = Join-Path $script:RecordedActionsDir ('{0}.ini' -f $copyId)
        $copyDefinition = [pscustomobject]@{
            Path = $copyPath
            Id = $copyId
            Label = $newLabel.Trim()
            CreatedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
            Steps = @()
        }
        foreach ($row in @($stepTable.Rows)) {
            $effectiveType = & $resolveRowStepType $row
            $savedCount = if ([string]::IsNullOrWhiteSpace([string]$row['Count'])) { $(if ($effectiveType -eq 'Wheel' -or $effectiveType -in @('Click','RightClick')) { '1' } else { '' }) } else { [string]$row['Count'] }
            $savedButton = switch ($effectiveType) {
                'RightClick' { 'Right' }
                'Click' { 'Left' }
                default { [string]$row['Button'] }
            }
            $savedDirection = if ($effectiveType -eq 'Wheel') {
                if ([string]::IsNullOrWhiteSpace([string]$row['Direction'])) { 'Down' } else { [string]$row['Direction'] }
            } else {
                ''
            }
            $copyDefinition.Steps += [pscustomobject]@{
                Section = ''
                Type = $effectiveType
                DelayMs = if ([string]$row['DelayMs'] -match '^-?\d+$') { [int]$row['DelayMs'] } else { 0 }
                X = switch ($effectiveType) { 'Click' { [string]$row['X'] } 'RightClick' { [string]$row['X'] } 'Wheel' { [string]$row['X'] } default { '' } }
                Y = switch ($effectiveType) { 'Click' { [string]$row['Y'] } 'RightClick' { [string]$row['Y'] } 'Wheel' { [string]$row['Y'] } default { '' } }
                Button = $savedButton
                Count = $savedCount
                Direction = $savedDirection
                Text = switch ($effectiveType) { 'Text' { [string]$row['Text'] } default { '' } }
                Keys = switch ($effectiveType) { 'Key' { [string]$row['Keys'] } default { '' } }
                ScriptPath = switch ($effectiveType) { 'Script' { [string]$row['ScriptPath'] } default { '' } }
                MacroPath = switch ($effectiveType) { 'Macro' { [string]$row['ScriptPath'] } default { '' } }
            }
        }

        Save-MacroDefinition -Definition $copyDefinition
        if ($script:State.ActionHotkeys.Contains($copyId)) {
            $script:State.ActionHotkeys.Remove($copyId)
        }
        Save-State
        Load-Actions
        $script:State = Read-State
        Sync-FlowCellUiFromCurrentState
        Restart-Backend
        Refresh-Ui

        if ($SelectNewTab) {
            $reloadedCopy = Read-MacroDefinition -Path $copyDefinition.Path
            if ($null -ne $reloadedCopy) {
                & $ensureMacroOpenTab $reloadedCopy
                & $refreshMacroTabs
                & $selectMacroTabById $reloadedCopy.Id
                & $loadDefinitionIntoEditor $reloadedCopy
            }
            if ($script:ActionSelector -and ($script:Actions.Id -contains $copyDefinition.Id)) {
                $script:ActionSelector.SelectedValue = $copyDefinition.Id
            }
            & $refreshBindingShortcutDisplay $copyDefinition.Id
        }

        Set-ShortcutStatus ('Created new macro {0}.' -f $copyDefinition.Label)
        Set-ActionStatus ('Macro saved as new:`r`n{0}' -f $copyDefinition.Label)
        return $true
    }

    $applyBindingForCurrentMacro = {
        param([string]$shortcut, [string]$macroId = '')
        $shortcut = [string]$shortcut
        if ([string]::IsNullOrWhiteSpace($macroId)) {
            $macroId = (& $resolveCurrentMacroId)
        }
        if ([string]::IsNullOrWhiteSpace($macroId)) {
            Set-ShortcutStatus 'Open a macro tab before changing its shortcut.'
            return
        }
        Write-UiLog ('Macro binding apply start. MacroId=' + [string]$macroId + ' | Shortcut=' + [string]$shortcut)
        if ([string]::IsNullOrWhiteSpace($shortcut)) {
            if ($script:State.ActionHotkeys.Contains($macroId)) {
                $script:State.ActionHotkeys.Remove($macroId)
                Save-State
                $script:State = Read-State
                Restart-Backend
                Refresh-Ui
                & $refreshBindingShortcutDisplay $macroId
                Set-ShortcutStatus ('Removed binding for ' + (& $getCurrentSelectedMacroLabel) + '.')
                $script:__lastAppliedBindingShortcut = ''
                & $updateActiveShortcutDisplay ''
                Write-UiLog ('Macro binding cleared. MacroId=' + [string]$macroId)
            }
            return
        }
        if ((Get-UsedShortcuts -ExcludeShortcut $(if ($script:State.ActionHotkeys.Contains($macroId)) { $script:State.ActionHotkeys[$macroId] } else { '' })).ContainsKey((Normalize-Shortcut -Value $shortcut))) {
            throw 'That shortcut is already in use.'
        }
        $script:State.ActionHotkeys[$macroId] = $shortcut
        Save-State
        $script:State = Read-State
        Restart-Backend
        Refresh-Ui
        & $refreshBindingShortcutDisplay $macroId
        Set-ShortcutStatus ('Bound ' + (& $getCurrentSelectedMacroLabel) + ' to ' + (Format-ShortcutForDisplay -Shortcut $shortcut) + '.')
        $script:__lastAppliedBindingShortcut = $shortcut
        & $updateActiveShortcutDisplay $shortcut
        Write-UiLog ('Macro binding saved. MacroId=' + [string]$macroId + ' | Shortcut=' + [string]$shortcut)
    }

    $showScanWorkbench = {
        $scanDialogXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Scan Illustrator UI"
        Width="980"
        Height="720"
        WindowStartupLocation="CenterOwner"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Background="#FF3F3F3F" CornerRadius="16" Padding="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
            </Grid.RowDefinitions>
            <WrapPanel Grid.Row="0" Margin="0,0,0,12">
                <Button x:Name="ScanButton" Width="140">Scan</Button>
                <Button x:Name="RescanButton" Width="140" Background="#FF6EC8FF">Re-scan</Button>
                <Button x:Name="OpenLogButton" Width="140" Background="#FF6EC8FF">Open Log</Button>
                <Button x:Name="CloseButton" Width="140" Background="#FF6C6C6C">Close</Button>
            </WrapPanel>
            <TextBlock Grid.Row="1" Text="Latest scan report" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10" />
            <TextBox Grid.Row="2" x:Name="ScanReportBox" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" AcceptsReturn="True" FontSize="15" Padding="10,8" Background="#FF4A4A4A" Foreground="#FFF2F2F2" BorderBrush="#FF626262" />
        </Grid>
    </Border>
</Window>
'@
        $scanReader = New-Object System.Xml.XmlNodeReader ([xml]$scanDialogXaml)
        $scanDialog = [Windows.Markup.XamlReader]::Load($scanReader)
        if ($dialog) { $scanDialog.Owner = $dialog }
        $scanReportBox = $scanDialog.FindName('ScanReportBox')
        $refreshScanReport = {
            $scanReportBox.Text = Read-AllText -Path $script:ScanStatusPath -Default 'No scan report yet.'
        }
        & $refreshScanReport
        $scanDialog.FindName('ScanButton').Add_Click({
            Invoke-Scan | Out-Null
            Start-Sleep -Milliseconds 300
            & $refreshScanReport
        })
        $scanDialog.FindName('RescanButton').Add_Click({
            Invoke-Scan -Rescan | Out-Null
            Start-Sleep -Milliseconds 300
            & $refreshScanReport
        })
        $scanDialog.FindName('OpenLogButton').Add_Click({
            if (Test-Path -LiteralPath $script:ControllerLogPath) { Start-Process -FilePath $script:ControllerLogPath | Out-Null }
        })
        $scanDialog.FindName('CloseButton').Add_Click({
            $scanDialog.Close()
        })
        [void]$scanDialog.ShowDialog()
    }

    $dialog.FindName('UndoButton').Add_Click({
        if ($script:__macroUndoStack.Count -eq 0) { return }
        $snapshot = $script:__macroUndoStack[$script:__macroUndoStack.Count - 1]
        $script:__macroUndoStack.RemoveAt($script:__macroUndoStack.Count - 1)
        $script:__macroRedoStack.Add((& $captureSnapshot))
        & $applySnapshot $snapshot
    })
    $dialog.FindName('RedoButton').Add_Click({
        if ($script:__macroRedoStack.Count -eq 0) { return }
        $snapshot = $script:__macroRedoStack[$script:__macroRedoStack.Count - 1]
        $script:__macroRedoStack.RemoveAt($script:__macroRedoStack.Count - 1)
        $script:__macroUndoStack.Add((& $captureSnapshot))
        & $applySnapshot $snapshot
    })
    $pickXYButton.Add_Click({
        if ($stepGrid.SelectedIndex -lt 0) {
            [System.Windows.MessageBox]::Show($dialog, 'Select one or more steps first.', 'Edit Macro') | Out-Null
            return
        }
        if ($pickTimer.IsEnabled) { return }
        $script:__pickRemaining = 3
        $pickXYButton.Content = 'Pick XY (3)'
        $pickTimer.Start()
    })
    $dialog.FindName('ApplySelectedButton').Add_Click({
        & $applyBulkToSelection
    })
    $invokeChooseShortcut = {
        try {
            $currentMacroId = (& $resolveCurrentMacroId)
            if ([string]::IsNullOrWhiteSpace($currentMacroId)) {
                Set-ShortcutStatus 'Open a macro tab before choosing a shortcut.'
                return
            }
            $currentShortcut = (& $getShortcutForMacroId $currentMacroId)
            $selectedShortcut = Prompt-Shortcut -InitialValue $currentShortcut
            if ($null -eq $selectedShortcut) { return }
            $selectedShortcut = [string]$selectedShortcut
            if ([string]::IsNullOrWhiteSpace($selectedShortcut)) { return }
            if ((Normalize-Shortcut -Value $selectedShortcut) -eq (Normalize-Shortcut -Value $currentShortcut)) {
                & $refreshBindingShortcutDisplay $currentMacroId
                return
            }
            & $applyBindingForCurrentMacro $selectedShortcut $currentMacroId
        }
        catch {
            Write-UiLog ('Binding shortcut apply failed: ' + $_.Exception.ToString())
            Set-ShortcutStatus ('Binding shortcut failed: ' + $_.Exception.Message)
        }
    }
    $invokeClearShortcut = {
        try {
            & $applyBindingForCurrentMacro '' (& $resolveCurrentMacroId)
        }
        catch {
            Write-UiLog ('Binding shortcut clear failed: ' + $_.Exception.ToString())
            Set-ShortcutStatus ('Binding shortcut clear failed: ' + $_.Exception.Message)
        }
    }
    if ($chooseShortcutButton) {
        $chooseShortcutButton.Add_Click({
            & $invokeChooseShortcut
        })
    }
    if ($clearShortcutButton) {
        $clearShortcutButton.Add_Click({
            & $invokeClearShortcut
        })
    }
    if ($selectProgramScriptButton) {
        $selectProgramScriptButton.Add_Click({
            & $selectProgramBindingScript
        })
    }
    if ($chooseProgramShortcutButton) {
        $chooseProgramShortcutButton.Add_Click({
            & $chooseProgramBindingShortcut
        })
    }
    if ($clearProgramBindingButton) {
        $clearProgramBindingButton.Add_Click({
            & $clearProgramBinding
        })
    }
    $saveProgramTabBinding = {
        param(
            [int]$programTabId,
            [string]$scriptTarget,
            [string]$shortcutValue
        )

        if ($programTabId -le 0) { throw 'Select a program tab first.' }
        $shortcutValue = Get-CanonicalShortcut -Value $shortcutValue

        $existingBinding = & $getProgramTabBinding $programTabId
        if ([string]::IsNullOrWhiteSpace($scriptTarget) -and [string]::IsNullOrWhiteSpace($shortcutValue)) {
            if ($existingBinding) {
                $script:State.ScriptBindings = @($script:State.ScriptBindings | Where-Object { [int]$_.Id -ne [int]$existingBinding.Id })
            }
            Save-State
            Restart-Backend
            Refresh-Ui
            & $refreshProgramBindingDisplay
            return
        }

        if ($existingBinding) {
            $existingBinding.Target = [string]$scriptTarget
            $existingBinding.Shortcut = [string]$shortcutValue
            if ($existingBinding.PSObject.Properties['ProgramTabId']) {
                $existingBinding.ProgramTabId = $programTabId
            }
            else {
                $existingBinding | Add-Member -NotePropertyName ProgramTabId -NotePropertyValue $programTabId -Force
            }
        }
        else {
            $id = [int]$script:State.NextId
            $script:State.NextId = $id + 1
            $script:State.ScriptBindings += [pscustomobject]@{
                Kind = 'script'
                Id = $id
                Shortcut = [string]$shortcutValue
                Target = [string]$scriptTarget
                Status = 'Active'
                ProgramTabId = $programTabId
            }
        }

        Save-State
        Restart-Backend
        Refresh-Ui
        & $refreshProgramBindingDisplay
    }
    $setBulkTypeSelection = {
        param([string]$typeName)
        if (-not $bulkTypeBox) { return }
        $bulkTypeBox.SelectedIndex = -1
        foreach ($item in @($bulkTypeBox.Items)) {
            if ([string]$item.Content -eq $typeName) {
                $bulkTypeBox.SelectedItem = $item
                break
            }
        }
    }
    $showScriptFileDialogForCurrentProgramTab = {
        param([string]$dialogTitle)

        $fileDialog = New-Object Microsoft.Win32.OpenFileDialog
        $fileDialog.Title = $dialogTitle
        $fileDialog.Filter = 'Scripts and launchers (*.jsx;*.js;*.ahk;*.ps1;*.py;*.bat;*.cmd;*.exe;*.lnk)|*.jsx;*.js;*.ahk;*.ps1;*.py;*.bat;*.cmd;*.exe;*.lnk|All Files (*.*)|*.*'
        $currentProgramTab = & $getCurrentProgramTab
        $initialDirectory = Get-ProgramInitialScriptFolder -ProgramTab $currentProgramTab
        if (-not [string]::IsNullOrWhiteSpace($initialDirectory)) {
            $fileDialog.InitialDirectory = $initialDirectory
        }
        if ($fileDialog.ShowDialog($dialog)) {
            $selectedProgramTab = & $getCurrentProgramTab
            if ($selectedProgramTab) {
                Set-ProgramLastScriptFolder -ProgramTab $selectedProgramTab -FilePath ([string]$fileDialog.FileName)
                if ($script:State) {
                    $script:State.SelectedProgramTabId = [int]$selectedProgramTab.Id
                    Save-State
                }
                & $setProgramTabStatus $selectedProgramTab
            }
            return [string]$fileDialog.FileName
        }
        return ''
    }
    $browseForStepScript = {
        & $setBulkTypeSelection 'Script'
        $selectedScript = & $showScriptFileDialogForCurrentProgramTab 'Choose script for selected step(s)'
        if (-not [string]::IsNullOrWhiteSpace($selectedScript)) {
            $bulkScriptBox.Text = $selectedScript
            & $applyBulkToSelection
        }
    }
    $selectProgramBindingScript = {
        try {
            $currentProgramTab = & $getCurrentProgramTab
            if ($null -eq $currentProgramTab) {
                Set-ShortcutStatus 'Select a program tab first.'
                return
            }

            $selectedScript = & $showScriptFileDialogForCurrentProgramTab ('Choose script for ' + [string]$currentProgramTab.Label)
            if ([string]::IsNullOrWhiteSpace($selectedScript)) { return }

            $existingBinding = & $getProgramTabBinding ([int]$currentProgramTab.Id)
            $currentShortcut = if ($existingBinding) { [string]$existingBinding.Shortcut } else { '' }
            & $saveProgramTabBinding ([int]$currentProgramTab.Id) $selectedScript $currentShortcut
            Set-ShortcutStatus ('Selected script for ' + [string]$currentProgramTab.Label + '.')
        }
        catch {
            Write-UiLog ('Program script selection failed: ' + $_.Exception.ToString())
            Set-ShortcutStatus ('Program script selection failed: ' + $_.Exception.Message)
        }
    }
    $chooseProgramBindingShortcut = {
        try {
            $currentProgramTab = & $getCurrentProgramTab
            if ($null -eq $currentProgramTab) {
                Set-ShortcutStatus 'Select a program tab first.'
                return
            }

            $existingBinding = & $getProgramTabBinding ([int]$currentProgramTab.Id)
            $currentScriptTarget = if ($existingBinding) { [string]$existingBinding.Target } else { '' }
            if ([string]::IsNullOrWhiteSpace($currentScriptTarget)) {
                Set-ShortcutStatus 'Select a script first, then assign a shortcut.'
                return
            }

            $currentShortcut = if ($existingBinding) { [string]$existingBinding.Shortcut } else { '' }
            $selectedShortcut = Prompt-Shortcut -InitialValue $currentShortcut
            if ($null -eq $selectedShortcut) { return }
            $selectedShortcut = [string]$selectedShortcut
            if ([string]::IsNullOrWhiteSpace($selectedShortcut)) { return }
            if ((Normalize-Shortcut -Value $selectedShortcut) -eq (Normalize-Shortcut -Value $currentShortcut)) {
                & $refreshProgramBindingDisplay
                return
            }
            if ((Get-UsedShortcuts -ExcludeShortcut $currentShortcut).ContainsKey((Normalize-Shortcut -Value $selectedShortcut))) {
                throw 'That shortcut is already in use.'
            }

            & $saveProgramTabBinding ([int]$currentProgramTab.Id) $currentScriptTarget $selectedShortcut
            Set-ShortcutStatus ('Bound ' + [string]$currentProgramTab.Label + ' script to ' + (Format-ShortcutForDisplay -Shortcut $selectedShortcut) + '.')
        }
        catch {
            Write-UiLog ('Program shortcut binding failed: ' + $_.Exception.ToString())
            Set-ShortcutStatus ('Program shortcut binding failed: ' + $_.Exception.Message)
        }
    }
    $clearProgramBinding = {
        try {
            $currentProgramTab = & $getCurrentProgramTab
            if ($null -eq $currentProgramTab) {
                Set-ShortcutStatus 'Select a program tab first.'
                return
            }

            & $saveProgramTabBinding ([int]$currentProgramTab.Id) '' ''
            Set-ShortcutStatus ('Cleared script binding for ' + [string]$currentProgramTab.Label + '.')
        }
        catch {
            Write-UiLog ('Program script binding clear failed: ' + $_.Exception.ToString())
            Set-ShortcutStatus ('Program script binding clear failed: ' + $_.Exception.Message)
        }
    }
    $browseForStepMacro = {
        & $setBulkTypeSelection 'Macro'
        $macroPath = & $showChooseMacroStepDialog
        if (-not [string]::IsNullOrWhiteSpace($macroPath)) {
            $bulkScriptBox.Text = $macroPath
            & $applyBulkToSelection
        }
    }
    $dialog.FindName('MoveUpButton').Add_Click({
        & $moveSelectedRows -1
    })
    $dialog.FindName('MoveDownButton').Add_Click({
        & $moveSelectedRows 1
    })
    if ($browseScriptButton) {
        $browseScriptButton.Add_Click({
            & $browseForStepScript
        })
    }
    if ($browseMacroButton) {
        $browseMacroButton.Add_Click({
            & $browseForStepMacro
        })
    }
    if ($bulkScriptBox) {
        $bulkScriptBox.Add_MouseDoubleClick({
            $selectedBulkType = ''
            if ($bulkTypeBox -and $bulkTypeBox.SelectedItem) {
                $selectedBulkType = [string]$bulkTypeBox.SelectedItem.Content
            }
            if ($selectedBulkType -eq 'Macro') {
                & $browseForStepMacro
            }
            else {
                & $browseForStepScript
            }
        })
    }
    if ($stepGrid) {
        $stepGrid.Add_MouseDoubleClick({
        param($sender, $eventArgs)
        if ($stepGrid.CurrentColumn -and [string]$stepGrid.CurrentColumn.Header -eq 'Target') {
            $rowType = ''
            $selectedIndex = $stepGrid.SelectedIndex
            if ($selectedIndex -ge 0 -and $selectedIndex -lt $stepTable.Rows.Count) {
                $row = $stepTable.Rows[$selectedIndex]
                $rowType = [string]$row['Type']
                if ($bulkTypeBox) {
                    $bulkTypeBox.SelectedIndex = -1
                    foreach ($item in @($bulkTypeBox.Items)) {
                        if ([string]$item.Content -eq $rowType) {
                            $bulkTypeBox.SelectedItem = $item
                            break
                        }
                    }
                }
            }
            if ([string]$rowType -eq 'Macro') {
                & $browseForStepMacro
            }
            else {
                & $browseForStepScript
            }
            $eventArgs.Handled = $true
        }
    })
    }
    $insertStepRow = {
        param($rowData, [bool]$recordUndo = $true)
        if ($recordUndo) { & $pushUndo }
        $row = $stepTable.NewRow()
        $row['StepNumber'] = ''
        foreach ($column in @('Type','DelayMs','X','Y','Button','Count','Direction','Text','Keys','ScriptPath')) {
            $row[$column] = [string]$rowData[$column]
        }
        $selectedIndexes = @(& $getSelectedIndexes)
        $insertIndex = if (@($selectedIndexes).Count -gt 0) { (($selectedIndexes | Measure-Object -Maximum).Maximum + 1) } else { $stepTable.Rows.Count }
        if ($insertIndex -lt 0 -or $insertIndex -gt $stepTable.Rows.Count) { $insertIndex = $stepTable.Rows.Count }
        $stepTable.Rows.InsertAt($row, $insertIndex)
        & $reindexRows
        & $selectIndexes @($insertIndex)
        & $syncBulkEditorsFromSelection
    }
    $dialog.FindName('AddStepButton').Add_Click({
        & $insertStepRow (& $makeDefaultStep) $true
    })
    if ($clearStepButton) {
        $clearStepButton.Add_Click({
            & $clearBulkEditors
            & $insertStepRow ([ordered]@{
                Type = ''
                DelayMs = ''
                X = ''
                Y = ''
                Button = ''
                Count = ''
                Direction = ''
                Text = ''
                Keys = ''
                ScriptPath = ''
            }) $true
        })
    }
    $dialog.FindName('DuplicateStepButton').Add_Click({
        $selectedIndexes = @(& $getSelectedIndexes)
        if (@($selectedIndexes).Count -eq 0) { return }
        & $pushUndo
        $copies = @()
        foreach ($selectedIndex in $selectedIndexes) {
            $copies += (& $rowToHashtable $stepTable.Rows[$selectedIndex])
        }
        $insertAt = $selectedIndexes[-1] + 1
        foreach ($copy in $copies) {
            $row = $stepTable.NewRow()
            foreach ($column in @('StepNumber','Type','DelayMs','X','Y','Button','Count','Direction','Text','Keys','ScriptPath')) {
                $row[$column] = [string]$copy[$column]
            }
            $stepTable.Rows.InsertAt($row, $insertAt)
            $insertAt += 1
        }
        & $reindexRows
        & $selectIndexes @((0..($copies.Count - 1)) | ForEach-Object { ($selectedIndexes[-1] + 1) + $_ })
        & $syncBulkEditorsFromSelection
    })
    $dialog.FindName('DeleteStepButton').Add_Click({
        $selectedIndexes = @($stepGrid.SelectedItems | ForEach-Object { $stepGrid.Items.IndexOf($_) } | Sort-Object -Descending)
        if (@($selectedIndexes).Count -eq 0) { return }
        if ([System.Windows.MessageBox]::Show($dialog, ('Delete {0} selected step(s)?' -f @($selectedIndexes).Count), 'Edit Macro', 'YesNo', 'Question') -ne 'Yes') { return }
        & $pushUndo
        foreach ($removeIndex in $selectedIndexes) {
            if ($removeIndex -ge 0 -and $removeIndex -lt $stepTable.Rows.Count) {
                $stepTable.Rows.RemoveAt($removeIndex)
            }
        }
        & $reindexRows
        if ($stepGrid.Items.Count -gt 0) { $stepGrid.SelectedIndex = [Math]::Max([Math]::Min(($selectedIndexes[-1]), $stepGrid.Items.Count - 1), 0) }
        & $syncBulkEditorsFromSelection
    })
    $getUniqueMacroLabel = {
        param([string]$baseLabel, [string]$excludeMacroId = '')
        $candidateLabel = [string]$baseLabel
        $counter = 2
        while (@($script:Actions | Where-Object { $_.Kind -eq 'recorded' -and $_.Label -eq $candidateLabel -and [string]$_.Id -ne $excludeMacroId }).Count -gt 0) {
            $candidateLabel = '{0} {1}' -f $baseLabel, $counter
            $counter += 1
        }
        return $candidateLabel
    }
    $invokeNewMacro = {
        if ($script:__macroDirty -and -not [string]::IsNullOrWhiteSpace([string]$script:__macroSelectedDefinitionId)) {
            $discard = [System.Windows.MessageBox]::Show($dialog, 'Discard unsaved edits and create a new macro?', 'FlowCell', 'YesNo', 'Question')
            if ($discard -ne 'Yes') { return }
        }
        $requestedLabel = & $promptMacroName 'New Macro' 'New Macro' 'Create'
        if ([string]::IsNullOrWhiteSpace($requestedLabel)) { return }
        $newLabel = & $getUniqueMacroLabel $requestedLabel.Trim()
        $newId = New-RecordedActionId -Name $newLabel
        $newPath = Join-Path $script:RecordedActionsDir ('{0}.ini' -f $newId)
        $newDefinition = [pscustomobject]@{
            Path = $newPath
            Id = $newId
            Label = $newLabel
            CreatedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
            Steps = @(
                [pscustomobject]@{
                    Section = ''
                    Type = (Get-ActivationStepTypeForProgram -Label $script:MacroLabProgramContext)
                    DelayMs = 0
                    X = ''
                    Y = ''
                    Button = ''
                    Count = ''
                    Direction = ''
                    Text = ''
                    Keys = ''
                    ScriptPath = ''
                    MacroPath = ''
                }
            )
        }
        Save-MacroDefinition -Definition $newDefinition
        if ($script:State.ActionHotkeys.Contains($newId)) {
            $script:State.ActionHotkeys.Remove($newId)
        }
        Save-State
        Load-Actions
        $script:State = Read-State
        Sync-FlowCellUiFromCurrentState
        Restart-Backend
        Refresh-Ui
        $reloadedDefinition = Read-MacroDefinition -Path $newPath
        if ($null -ne $reloadedDefinition) {
            & $ensureMacroOpenTab $reloadedDefinition
            & $refreshMacroTabs
            & $selectMacroTabById $reloadedDefinition.Id
            & $loadDefinitionIntoEditor $reloadedDefinition
        }
        if ($script:ActionSelector -and ($script:Actions.Id -contains $newId)) {
            $script:ActionSelector.SelectedValue = $newId
        }
        Set-ShortcutStatus ('Created new macro {0}.' -f $newLabel)
        Set-ActionStatus ('New macro created:`r`n{0}' -f $newLabel)
    }
    $invokeRenameCurrentMacro = {
        $selectedMacro = & $getCurrentSelectedMacroItem
        if ($null -eq $selectedMacro -or [string]::IsNullOrWhiteSpace([string]$selectedMacro.Id)) {
            Set-ShortcutStatus 'Open a macro tab before renaming.'
            Set-ActionStatus 'No macro is currently open.'
            return
        }
        $requestedLabel = & $promptMacroName 'Rename Macro' ([string]$selectedMacro.Label) 'Rename'
        if ([string]::IsNullOrWhiteSpace($requestedLabel)) { return }
        $renameLabel = & $getUniqueMacroLabel $requestedLabel.Trim() ([string]$selectedMacro.Id)
        $updatedSteps = @()
        foreach ($row in @($stepTable.Rows)) {
            $effectiveType = & $resolveRowStepType $row
            $updatedSteps += [pscustomobject]@{
                Section = ''
                Type = $effectiveType
                DelayMs = if ([string]$row['DelayMs'] -match '^-?\d+$') { [int]$row['DelayMs'] } else { 0 }
                X = switch ($effectiveType) { 'Click' { [string]$row['X'] } 'Wheel' { [string]$row['X'] } default { '' } }
                Y = switch ($effectiveType) { 'Click' { [string]$row['Y'] } 'Wheel' { [string]$row['Y'] } default { '' } }
                Button = switch ($effectiveType) { 'Click' { [string]$row['Button'] } default { '' } }
                Count = switch ($effectiveType) { 'Click' { [string]$row['Count'] } 'Wheel' { [string]$row['Count'] } default { '' } }
                Direction = switch ($effectiveType) { 'Wheel' { [string]$row['Direction'] } default { '' } }
                Text = switch ($effectiveType) { 'Text' { [string]$row['Text'] } default { '' } }
                Keys = switch ($effectiveType) { 'Key' { [string]$row['Keys'] } default { '' } }
                ScriptPath = switch ($effectiveType) { 'Script' { [string]$row['ScriptPath'] } default { '' } }
                MacroPath = switch ($effectiveType) { 'Macro' { [string]$row['ScriptPath'] } default { '' } }
            }
        }
        $renamedDefinition = [pscustomobject]@{
            Path = [string]$selectedMacro.Path
            FileName = (& $getMacroFileName $selectedMacro)
            Id = [string]$selectedMacro.Id
            Label = $renameLabel
            CreatedAt = (& $getMacroCreatedAt $selectedMacro)
            Steps = @($updatedSteps)
        }
        Save-MacroDefinition -Definition $renamedDefinition
        Load-Actions
        $script:State = Read-State
        Sync-FlowCellUiFromCurrentState
        Restart-Backend
        Refresh-Ui
        $reloadedDefinition = Read-MacroDefinition -Path $renamedDefinition.Path
        if ($null -ne $reloadedDefinition) {
            & $loadDefinitionIntoEditor $reloadedDefinition
        }
        if ($script:ActionSelector -and ($script:Actions.Id -contains $renamedDefinition.Id)) {
            $script:ActionSelector.SelectedValue = $renamedDefinition.Id
        }
        Set-ShortcutStatus ('Renamed macro to {0}.' -f $renameLabel)
        Set-ActionStatus ('Macro renamed:`r`n{0}' -f $renameLabel)
    }
    $invokeCopyMacro = {
        $copyLabelBase = '{0} Copy' -f (& $getCurrentSelectedMacroLabel)
        $copyLabel = & $getUniqueMacroLabel $copyLabelBase
        & $saveMacroAsNew $copyLabel -SelectNewTab
    }
    $invokeSaveAs = {
        if ($null -eq (& $getCurrentSelectedMacroItem)) {
            Set-ShortcutStatus 'Open a macro tab before using Save As.'
            Set-ActionStatus 'No macro is currently open.'
            return
        }
        $saveAsLabel = & $promptMacroName 'Save Macro As' (& $getCurrentSelectedMacroLabel) 'Save As'
        if ([string]::IsNullOrWhiteSpace($saveAsLabel)) {
            return
        }
        $candidateLabel = & $getUniqueMacroLabel $saveAsLabel
        & $saveMacroAsNew $candidateLabel -SelectNewTab
    }
    $invokeDeleteCurrentMacro = {
        $selectedMacro = & $getCurrentSelectedMacroItem
        if ($null -eq $selectedMacro -or [string]::IsNullOrWhiteSpace([string]$selectedMacro.Id)) {
            Set-ShortcutStatus 'Open a macro tab before deleting.'
            Set-ActionStatus 'No macro is currently open.'
            return
        }
        $deleteLabel = [string]$selectedMacro.Label
        $deleteMacroId = [string]$selectedMacro.Id
        $deleteMacroPath = [string]$selectedMacro.Path
        $selectedIndex = $macroTabStrip.SelectedIndex
        if ([System.Windows.MessageBox]::Show($dialog, ('Delete macro "{0}"?' -f $deleteLabel), 'Edit Macro', 'YesNo', 'Question') -ne 'Yes') { return }
        if ($script:State.ActionHotkeys.Contains($deleteMacroId)) {
            $script:State.ActionHotkeys.Remove($deleteMacroId)
            Save-State
        }
        if (Test-Path -LiteralPath $deleteMacroPath) {
            Remove-Item -LiteralPath $deleteMacroPath -Force
        }
        Load-Actions
        $script:State = Read-State
        Sync-FlowCellUiFromCurrentState
        Restart-Backend
        Refresh-Ui
        & $removeMacroOpenTab $deleteMacroId
        & $refreshMacroTabs
        if (@($openMacroTabs).Count -gt 0) {
            $nextIndex = [Math]::Min([Math]::Max($selectedIndex, 0), $openMacroTabs.Count - 1)
            $nextDefinition = Read-MacroDefinition -Path $openMacroTabs[$nextIndex].Path
            if ($null -ne $nextDefinition) {
                & $loadDefinitionIntoEditor $nextDefinition
            }
        }
        else {
            & $clearEditorForNoMacro
        }
        Set-ShortcutStatus ('Deleted macro {0}.' -f $deleteLabel)
        Set-ActionStatus ('Macro deleted:`r`n{0}' -f $deleteLabel)
    }
    $invokeRunCurrentMacro = {
        $currentMacroId = (& $resolveCurrentMacroId)
        if ([string]::IsNullOrWhiteSpace($currentMacroId)) {
            Set-ShortcutStatus 'Open a macro tab before running.'
            Set-ActionStatus 'No macro is currently open.'
            return
        }
        if ($script:__macroDirty) {
            if (-not (& $saveCurrentMacro)) { return }
        }
        Invoke-Action -ActionId $currentMacroId | Out-Null
    }
    $dialog.FindName('CopyMacroButton').Add_Click({
        & $invokeCopyMacro
    })
    if ($openMacroButton) {
        $openMacroButton.Add_Click({
            & $openMacroInTab
        })
    }
    if ($newMacroButton) {
        $newMacroButton.Add_Click({
            & $invokeNewMacro
        })
    }
    if ($renameMacroButton) {
        $renameMacroButton.Add_Click({
            & $invokeRenameCurrentMacro
        })
    }
    if ($saveAsButton) {
        $saveAsButton.Add_Click({
            & $invokeSaveAs
        })
    }
    $deleteMacroButton.Add_Click({
        & $invokeDeleteCurrentMacro
    })
    if ($closeTabButton) {
        $closeTabButton.Add_Click({
            & $closeCurrentMacroTab
        })
    }
    $dialog.FindName('CancelButton').Add_Click({
        $mouseTimer.Stop()
        $pickTimer.Stop()
        $dialog.DialogResult = $false
        $dialog.Close()
    })
    if ($runMacroButton) {
        $runMacroButton.Add_Click({
            & $invokeRunCurrentMacro
        })
    }
    if ($recordMacroButton) {
        $recordMacroButton.Add_Click({
            if ($script:__macroDirty -and -not [string]::IsNullOrWhiteSpace([string]$script:__macroSelectedDefinitionId)) {
                $discard = [System.Windows.MessageBox]::Show($dialog, 'Discard unsaved edits and record a new macro?', 'FlowCell', 'YesNo', 'Question')
                if ($discard -ne 'Yes') { return }
            }
            Start-RecordAction -OnSaved ({
                param($savedDefinition)
                if ($null -eq $savedDefinition) { return }
                if (-not $dialog -or -not $dialog.IsLoaded) { return }
                & $loadDefinitionIntoEditor $savedDefinition
            }.GetNewClosure())
        })
    }
    if ($scanMacroButton) {
        $scanMacroButton.Add_Click({
            & $showScanWorkbench
        })
    }
    $dialog.FindName('SaveButton').Add_Click({
        if (-not (& $saveCurrentMacro)) { return }
    })
    if ($fileOpenMacroMenuItem) {
        $fileOpenMacroMenuItem.Add_Click({
            & $openMacroInTab
        })
    }
    if ($fileSaveMenuItem) {
        $fileSaveMenuItem.Add_Click({
            & $saveCurrentMacro | Out-Null
        })
    }
    if ($fileSaveAsMenuItem) {
        $fileSaveAsMenuItem.Add_Click({
            & $invokeSaveAs
        })
    }
    if ($fileCopyMacroMenuItem) {
        $fileCopyMacroMenuItem.Add_Click({
            & $invokeCopyMacro
        })
    }
    if ($fileCloseTabMenuItem) {
        $fileCloseTabMenuItem.Add_Click({
            & $closeCurrentMacroTab
        })
    }
    if ($fileDeleteMacroMenuItem) {
        $fileDeleteMacroMenuItem.Add_Click({
            & $invokeDeleteCurrentMacro
        })
    }
    if ($fileBindShortcutMenuItem) {
        $fileBindShortcutMenuItem.Add_Click({
            & $invokeChooseShortcut
        })
    }
    if ($fileClearShortcutMenuItem) {
        $fileClearShortcutMenuItem.Add_Click({
            & $invokeClearShortcut
        })
    }
    if ($fileRunMenuItem) {
        $fileRunMenuItem.Add_Click({
            & $invokeRunCurrentMacro
        })
    }
    if ($fileRecordMenuItem) {
        $fileRecordMenuItem.Add_Click({
            Start-RecordAction
        })
    }
    if ($fileScanMenuItem) {
        $fileScanMenuItem.Add_Click({
            & $showScanWorkbench
        })
    }
    $dialog.Add_Closed({
        if ($script:State -and $script:State.PSObject.Properties['MacroEditorColumns']) {
            foreach ($column in @($stepGrid.Columns)) {
                $headerText = [string]$column.Header
                if ($columnWidthMap.Contains($headerText)) {
                    $script:State.MacroEditorColumns[$columnWidthMap[$headerText]] = [Math]::Round([double]$column.ActualWidth, 2)
                }
            }
            Save-State
        }
        if ($mouseTimer) { $mouseTimer.Stop() }
        if ($pickTimer) { $pickTimer.Stop() }
    })

    & $refreshProgramTabs
    $mouseTimer.Start()
    [void]$dialog.ShowDialog()
    return $true
}

function Open-MacroLabWindow {
    param(
        [string]$ProgramLabel = ''
    )

    $previousWindow = $script:Window
    $script:MacroLabProgramContext = [string]$ProgramLabel
    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Macro Lab"
        Width="1220"
        Height="840"
        MinWidth="1080"
        MinHeight="720"
        WindowStartupLocation="CenterScreen"
        Topmost="True"
        Background="#FF353535"
        Foreground="#FFF2F2F2">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="Background" Value="#FF8DFF1A" />
            <Setter Property="Foreground" Value="#FF202020" />
            <Setter Property="Padding" Value="16,10" />
            <Setter Property="Margin" Value="0,0,10,10" />
            <Setter Property="MinWidth" Value="160" />
            <Setter Property="MinHeight" Value="48" />
            <Setter Property="FontSize" Value="17" />
            <Setter Property="FontWeight" Value="SemiBold" />
            <Setter Property="BorderThickness" Value="0" />
            <Setter Property="Cursor" Value="Hand" />
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" CornerRadius="16">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
            <Style.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter Property="Background" Value="#FFA3FF4A" />
                </Trigger>
                <Trigger Property="IsPressed" Value="True">
                    <Setter Property="Background" Value="#FF78D60E" />
                </Trigger>
            </Style.Triggers>
        </Style>
    </Window.Resources>
    <Border Margin="16" Background="#FF3F3F3F" CornerRadius="18" Padding="18">
        <ScrollViewer VerticalScrollBarVisibility="Auto">
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="520" />
                    <ColumnDefinition Width="24" />
                    <ColumnDefinition Width="620" />
                </Grid.ColumnDefinitions>
                <StackPanel Grid.Column="0">
                    <TextBlock FontSize="22" FontWeight="SemiBold" Margin="0,0,0,16">Macro Lab</TextBlock>
                    <WrapPanel Margin="0,0,0,16">
                        <Button x:Name="ScanButton">Scan Illustrator UI</Button>
                        <Button x:Name="RescanButton">Re-scan</Button>
                        <Button x:Name="OpenLogButton" Background="#FF6EC8FF">Open Log</Button>
                        <Button x:Name="ReloadBackendButton" Background="#FF6EC8FF">Reload Backend</Button>
                    </WrapPanel>
                    <TextBlock FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Recorded Actions</TextBlock>
                    <Border Background="#FF4A4A4A" CornerRadius="16" Padding="16" Margin="0,0,0,16">
                        <StackPanel>
                            <TextBlock Text="Record macros from Illustrator and run them from here." Margin="0,0,0,10" TextWrapping="Wrap" FontSize="15" />
                            <ComboBox x:Name="ActionPickerCombo" DisplayMemberPath="Label" SelectedValuePath="Id" MinHeight="38" FontSize="15" VerticalContentAlignment="Center" Margin="0,0,0,12" />
                            <WrapPanel>
                                <Button x:Name="RunSelectedActionButton" Width="220">Run Selected Action</Button>
                                <Button x:Name="RecordActionButton" Width="180" Background="#FFFFB84D">Record Action</Button>
                            </WrapPanel>
                        </StackPanel>
                    </Border>
                    <TextBlock FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Action Status</TextBlock>
                    <Border Background="#FF4A4A4A" CornerRadius="16" Padding="16">
                        <TextBlock x:Name="ActionStatusText" TextWrapping="Wrap" FontSize="15" LineHeight="22" />
                    </Border>
                </StackPanel>
                <StackPanel Grid.Column="2">
                    <TextBlock FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Bindings</TextBlock>
                    <Border Background="#FF4A4A4A" CornerRadius="16" Padding="10" Margin="0,0,0,16">
                        <ListView x:Name="BindingsList" Height="260">
                            <ListView.View>
                                <GridView>
                                    <GridViewColumn Header="Shortcut" DisplayMemberBinding="{Binding Shortcut}" Width="150" />
                                    <GridViewColumn Header="Target" DisplayMemberBinding="{Binding Target}" Width="340" />
                                    <GridViewColumn Header="Status" DisplayMemberBinding="{Binding Status}" Width="100" />
                                </GridView>
                            </ListView.View>
                        </ListView>
                    </Border>
                    <WrapPanel Margin="0,0,0,16">
                        <Button x:Name="AddActionBindingButton">Add Action</Button>
                        <Button x:Name="AddScriptBindingButton">Add Script</Button>
                        <Button x:Name="EditMacroButton" Background="#FFFFB84D">Edit Macro</Button>
                        <Button x:Name="EditBindingButton">Edit Selected</Button>
                        <Button x:Name="RemoveBindingButton">Remove Selected</Button>
                        <Button x:Name="ReloadBindingsButton" Background="#FF6EC8FF">Reload Bindings</Button>
                        <Button x:Name="OpenBindingsButton" Background="#FF6EC8FF">Open Bindings File</Button>
                        <Button x:Name="CopyCandidatesButton" Background="#FF6EC8FF">Copy Candidates</Button>
                    </WrapPanel>
                    <TextBlock FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Shortcut Status</TextBlock>
                    <Border Background="#FF4A4A4A" CornerRadius="16" Padding="16" Margin="0,0,0,16">
                        <TextBlock x:Name="ShortcutStatusText" TextWrapping="Wrap" FontSize="15" LineHeight="22" />
                    </Border>
                    <TextBlock FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Candidate Shortcuts</TextBlock>
                    <Border Background="#FF4A4A4A" CornerRadius="16" Padding="16">
                        <TextBlock x:Name="CandidateText" TextWrapping="Wrap" FontSize="15" LineHeight="22" />
                    </Border>
                </StackPanel>
            </Grid>
        </ScrollViewer>
    </Border>
</Window>
'@
    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $script:Window = [Windows.Markup.XamlReader]::Load($reader)
    $script:Window.Dispatcher.add_UnhandledException({
        param($sender, $eventArgs)
        try {
            Write-UiLog ('Unhandled UI exception: {0}' -f $eventArgs.Exception.ToString())
            Set-ActionStatus ('Macro Lab hit an internal UI error:`r`n{0}' -f $eventArgs.Exception.Message)
        }
        catch {
        }
        $eventArgs.Handled = $true
    })
    $script:BindingsList = $script:Window.FindName('BindingsList')
    $script:ActionStatus = $script:Window.FindName('ActionStatusText')
    $script:ShortcutStatus = $script:Window.FindName('ShortcutStatusText')
    $script:CandidateText = $script:Window.FindName('CandidateText')
    $script:ActionSelector = $script:Window.FindName('ActionPickerCombo')
    $script:Window.FindName('ScanButton').Add_Click({ Invoke-UiSafe 'Scan failed.' { Invoke-Scan } })
    $script:Window.FindName('RescanButton').Add_Click({ Invoke-UiSafe 'Re-scan failed.' { Invoke-Scan -Rescan } })
    $script:Window.FindName('RunSelectedActionButton').Add_Click({ Invoke-UiSafe 'Run Selected Action failed.' { Invoke-SelectedAction } })
    $script:Window.FindName('RecordActionButton').Add_Click({ Invoke-UiSafe 'Record Action failed.' { Start-RecordAction } })
    $script:Window.FindName('OpenLogButton').Add_Click({ if (Test-Path -LiteralPath $script:ControllerLogPath) { Start-Process -FilePath $script:ControllerLogPath | Out-Null } })
    $script:Window.FindName('ReloadBackendButton').Add_Click({ Invoke-UiSafe 'Backend reload failed.' { Restart-Backend; Set-ShortcutStatus 'Backend reloaded.' } })
    $script:Window.FindName('AddActionBindingButton').Add_Click({ Invoke-UiSafe 'Add Action failed.' { Add-ActionBinding } })
    $script:Window.FindName('AddScriptBindingButton').Add_Click({ Invoke-UiSafe 'Add Script failed.' { Add-ScriptBinding } })
    $script:Window.FindName('EditMacroButton').Add_Click({ Invoke-UiSafe 'Edit Macro failed.' { Edit-RecordedMacro } })
    $script:Window.FindName('EditBindingButton').Add_Click({ Invoke-UiSafe 'Edit Selected failed.' { Edit-SelectedBinding } })
    $script:Window.FindName('RemoveBindingButton').Add_Click({ Invoke-UiSafe 'Remove Selected failed.' { Remove-SelectedBinding } })
    $script:Window.FindName('ReloadBindingsButton').Add_Click({ Invoke-UiSafe 'Reload Bindings failed.' { Load-Actions; $script:State = Read-State; Restart-Backend; Refresh-Ui; Set-ShortcutStatus 'Bindings and actions reloaded from disk.' } })
    $script:Window.FindName('OpenBindingsButton').Add_Click({ if (-not (Test-Path -LiteralPath $script:BindingsPath)) { Save-State }; Start-Process -FilePath $script:BindingsPath | Out-Null })
    $script:Window.FindName('CopyCandidatesButton').Add_Click({ [System.Windows.Clipboard]::SetText((Build-CandidateText)); Set-ShortcutStatus 'Candidate shortcut list copied to the clipboard.' })
    $script:Window.Add_Closed({
        if ($script:DocumentPollTimer) { $script:DocumentPollTimer.Stop() }
        if ($script:CliWatchTimer) { $script:CliWatchTimer.Stop() }
        if ($script:BackendStartedByUi) { Stop-Backend }
        Write-UiLog 'Macro Lab window closed.'
    })
    Refresh-Ui
    Set-ControllerBusyState -IsBusy $false
    Set-ActionStatus 'Recorder is ready. Scan if you want UI context, or record a macro and bind it.'
    Set-ShortcutStatus 'Bindings are managed on the right. Saved bindings stay active while this macro window is open.'
    Start-DocumentWatch
    Write-UiLog 'Macro Lab window loaded.'
    if ($script:ActionSelector -and $script:ActionSelector.Items.Count -gt 0 -and $script:ActionSelector.SelectedIndex -lt 0) {
        $script:ActionSelector.SelectedIndex = 0
    }
    [void]$script:Window.ShowDialog()
    $script:Window = $previousWindow
}

function Show-TextEntryDialog {
    param(
        [string]$Title,
        [string]$Prompt,
        [string]$InitialValue = '',
        [string]$AcceptText = 'OK',
        $OwnerWindow = $null
    )

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Name"
        Width="560"
        Height="260"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Background="#FF22272E"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Padding="16" Background="#FF2D333B" CornerRadius="14">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock x:Name="PromptTitle" Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Name</TextBlock>
            <TextBlock x:Name="PromptText" Grid.Row="1" Margin="0,0,0,10" TextWrapping="Wrap">Enter a name.</TextBlock>
            <TextBox x:Name="ValueBox" Grid.Row="2" MinHeight="42" Margin="0,0,0,6" FontSize="15" Padding="10,8" VerticalContentAlignment="Center" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,14,0,0">
                <Button x:Name="CancelButton" Width="110" Margin="0,0,10,0" Background="#FF586069">Cancel</Button>
                <Button x:Name="OkButton" Width="110">OK</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $owner = if ($OwnerWindow -and $OwnerWindow -is [System.Windows.Window]) {
        $OwnerWindow
    }
    else {
        Get-DialogOwnerWindow
    }
    if ($owner) { $dialog.Owner = $owner }
    $dialog.Title = $Title
    $dialog.FindName('PromptTitle').Text = $Title
    $dialog.FindName('PromptText').Text = $Prompt
    $dialog.FindName('OkButton').Content = $AcceptText
    $valueBox = $dialog.FindName('ValueBox')
    $valueBox.Text = $InitialValue
    $script:__flowCellTextEntry = $null

    $accept = {
        $script:__flowCellTextEntry = $valueBox.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($script:__flowCellTextEntry)) { return }
        $dialog.DialogResult = $true
        $dialog.Close()
    }

    $dialog.FindName('OkButton').Add_Click($accept)
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })
    $valueBox.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Enter') {
            & $accept
            $eventArgs.Handled = $true
        }
    })
    $dialog.Add_ContentRendered({
        $valueBox.Focus() | Out-Null
        $valueBox.CaretIndex = $valueBox.Text.Length
    })

    if ($dialog.ShowDialog()) { return [string]$script:__flowCellTextEntry }
    return ''
}

function Resolve-FlowCellProgramExecutablePath([string]$ExePath) {
    if ([string]::IsNullOrWhiteSpace($ExePath)) {
        throw 'Program EXE path is required.'
    }

    $resolvedPath = Resolve-Path -LiteralPath $ExePath -ErrorAction Stop | Select-Object -First 1
    $fullPath = [System.IO.Path]::GetFullPath([string]$resolvedPath.Path)
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw 'Program EXE path does not exist.'
    }
    return $fullPath
}

function Ensure-FlowCellDirectory([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'A required FlowCell path was blank.'
    }
    $item = New-Item -ItemType Directory -Path $Path -Force
    return [System.IO.Path]::GetFullPath([string]$item.FullName)
}

function Initialize-FlowCellIllustratorManagedScriptsFolder {
    $managedFolder = Ensure-FlowCellDirectory -Path $script:IllustratorScriptsDir
    foreach ($sourceFolder in @($script:LegacyFlowCellIllustratorScriptsDir, $script:LegacyIllustratorScriptsDir)) {
        if ([string]::IsNullOrWhiteSpace([string]$sourceFolder) -or -not (Test-Path -LiteralPath $sourceFolder -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $sourceFolder -File -ErrorAction SilentlyContinue |
            Where-Object {
                @('.jsx', '.js') -contains ([string]$_.Extension).ToLowerInvariant() -and
                -not (Test-FlowCellPathUnderScriptDump -Path ([string]$_.FullName))
            } |
            ForEach-Object {
                try {
                    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $managedFolder $_.Name) -Force
                }
                catch {
                    Write-UiLog ('FlowCell failed to mirror Illustrator script {0} into managed folder: {1}' -f $_.FullName, $_.Exception.Message)
                }
            }
    }
    return $managedFolder
}

function Test-FlowCellIllustratorLegacyScriptPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $normalizedPath = Get-FlowCellNormalizedPath $Path
    $legacyFolder = Get-FlowCellNormalizedPath $script:LegacyIllustratorScriptsDir
    $legacyManagedFolder = Get-FlowCellNormalizedPath $script:LegacyFlowCellIllustratorScriptsDir
    return (
        ($legacyFolder -and $normalizedPath.StartsWith($legacyFolder)) -or
        ($legacyManagedFolder -and $normalizedPath.StartsWith($legacyManagedFolder))
    )
}

function Resolve-FlowCellManagedIllustratorScriptPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $extension = [System.IO.Path]::GetExtension($Path)
    if ([string]::IsNullOrWhiteSpace($extension) -or @('.jsx', '.js') -notcontains $extension.ToLowerInvariant()) {
        return $Path
    }

    $managedFolder = Initialize-FlowCellIllustratorManagedScriptsFolder
    $fileName = [System.IO.Path]::GetFileName($Path)
    if ([string]::IsNullOrWhiteSpace($fileName)) { return $Path }
    $managedPath = Join-Path $managedFolder $fileName
    $normalizedManagedPath = Get-FlowCellNormalizedPath $managedPath
    if ($normalizedManagedPath -eq (Get-FlowCellNormalizedPath $Path) -and (Test-Path -LiteralPath $managedPath -PathType Leaf)) {
        return $managedPath
    }

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try {
            Copy-Item -LiteralPath $Path -Destination $managedPath -Force
            return $managedPath
        }
        catch {
            Write-UiLog ('FlowCell failed to move Illustrator script into managed folder. Source={0}; Error={1}' -f $Path, $_.Exception.Message)
        }
    }

    if (Test-Path -LiteralPath $managedPath -PathType Leaf) {
        return $managedPath
    }

    return $Path
}

function Migrate-FlowCellIllustratorScriptReferences {
    if (-not $script:State -or -not $script:FlowCellState) { return }
    $managedFolder = Initialize-FlowCellIllustratorManagedScriptsFolder
    $changed = $false

    foreach ($programTab in @($script:State.ProgramTabs)) {
        $templateKey = Get-FlowCellProgramTemplateKey -ProgramName ([string]$programTab.Label) -ExePath $(if ($programTab.PSObject.Properties['ExePath']) { [string]$programTab.ExePath } else { '' })
        $currentScriptFolder = if ($programTab.PSObject.Properties['ScriptFolder']) { [string]$programTab.ScriptFolder } else { '' }
        if ($templateKey -eq 'illustrator' -or (Test-FlowCellIllustratorLegacyScriptPath $currentScriptFolder)) {
            if ((Get-FlowCellNormalizedPath $currentScriptFolder) -ne (Get-FlowCellNormalizedPath $managedFolder)) {
                $programTab.ScriptFolder = $managedFolder
                $changed = $true
            }
        }
    }

    foreach ($binding in @($script:State.ScriptBindings)) {
        if (-not $binding.PSObject.Properties['Target']) { continue }
        $targetPath = [string]$binding.Target
        if (-not (Test-FlowCellIllustratorLegacyScriptPath $targetPath)) { continue }
        $managedTargetPath = Resolve-FlowCellManagedIllustratorScriptPath -Path $targetPath
        if ($managedTargetPath -and $managedTargetPath -ne $targetPath) {
            $binding.Target = $managedTargetPath
            $changed = $true
        }
    }

    foreach ($programState in @($script:FlowCellState.Programs)) {
        if ($programState.PSObject.Properties['ProgramConfig']) {
            $programConfig = Get-FlowCellProgramConfig -ProgramTab (Get-FlowCellProgramTab -ProgramTabId ([int]$programState.ProgramTabId)) -ProgramConfig $programState.ProgramConfig
            if ((Get-FlowCellProgramTemplateKey -ProgramName ([string]$programConfig.NormalizedName) -ExePath ([string]$programConfig.ExePath)) -eq 'illustrator') {
                if ((Get-FlowCellNormalizedPath ([string]$programConfig.ScriptFolder)) -ne (Get-FlowCellNormalizedPath $managedFolder)) {
                    $programConfig.ScriptFolder = $managedFolder
                    $programState.ProgramConfig = $programConfig
                    $changed = $true
                }
            }
        }
        foreach ($panel in @($programState.Panels)) {
            foreach ($button in @($panel.Buttons)) {
                if ([string]$button.Kind -ne 'script') { continue }
                $buttonTarget = [string]$button.Target
                if (-not (Test-FlowCellIllustratorLegacyScriptPath $buttonTarget)) { continue }
                $managedButtonTarget = Resolve-FlowCellManagedIllustratorScriptPath -Path $buttonTarget
                if ($managedButtonTarget -and $managedButtonTarget -ne $buttonTarget) {
                    $button.Target = $managedButtonTarget
                    $changed = $true
                }
            }
        }
    }

    if ($changed) {
        Save-State
        Save-FlowCellState
        Write-UiLog ('FlowCell migrated Illustrator scripts into managed folder: {0}' -f $managedFolder)
    }
}

function Migrate-FlowCellBlenderScriptFolders {
    if (-not $script:State -or -not $script:FlowCellState) { return }
    $managedFolder = Ensure-FlowCellDirectory -Path (Get-FlowCellBlenderScriptsFolder)
    $normalizedManagedFolder = Get-FlowCellNormalizedPath $managedFolder
    $changed = $false

    foreach ($programTab in @($script:State.ProgramTabs)) {
        $currentScriptFolder = if ($programTab.PSObject.Properties['ScriptFolder']) { [string]$programTab.ScriptFolder } else { '' }
        if (-not (Test-FlowCellBlenderLegacyScriptPath $currentScriptFolder)) { continue }
        if ((Get-FlowCellNormalizedPath $currentScriptFolder) -ne $normalizedManagedFolder) {
            $programTab.ScriptFolder = $managedFolder
            $changed = $true
        }
    }

    foreach ($programState in @($script:FlowCellState.Programs)) {
        if (-not $programState.PSObject.Properties['ProgramConfig']) { continue }
        $programConfig = Get-FlowCellProgramConfig -ProgramTab (Get-FlowCellProgramTab -ProgramTabId ([int]$programState.ProgramTabId)) -ProgramConfig $programState.ProgramConfig
        $currentScriptFolder = [string]$programConfig.ScriptFolder
        if (-not (Test-FlowCellBlenderLegacyScriptPath $currentScriptFolder)) { continue }
        if ((Get-FlowCellNormalizedPath $currentScriptFolder) -ne $normalizedManagedFolder) {
            $programConfig.ScriptFolder = $managedFolder
            $programState.ProgramConfig = $programConfig
            $changed = $true
        }
    }

    if ($changed) {
        Save-State
        Save-FlowCellState
        Write-UiLog ('FlowCell migrated Blender script folders into managed folder: {0}' -f $managedFolder)
    }
}

function Get-FlowCellBlenderConfigPath {
    $localOverridePath = Join-Path $script:FlowCellPrivateRoot 'blender.config.local.json'
    if (Test-Path -LiteralPath $localOverridePath -PathType Leaf) {
        return $localOverridePath
    }
    $repoProgramsConfigPath = Join-Path $script:FlowCellHomeRoot 'Programs\Blender\config.json'
    if (Test-Path -LiteralPath $repoProgramsConfigPath -PathType Leaf) {
        return $repoProgramsConfigPath
    }
    return (Join-Path $script:FlowCellHomeRoot 'Blender\config.json')
}

function Get-FlowCellExistingBlenderBridgeFolder {
    $configPath = Get-FlowCellBlenderConfigPath
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return '' }
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($config -and $config.automation -and -not [string]::IsNullOrWhiteSpace([string]$config.automation.bridgeFolder)) {
            return [string]$config.automation.bridgeFolder
        }
    }
    catch {
        Write-UiLog ('FlowCell could not read Blender config for bridge reuse: {0}' -f $_.Exception.Message)
    }
    return ''
}

function Sync-FlowCellBlenderTemplateScripts([string]$TargetScriptFolder) {
    if ([string]::IsNullOrWhiteSpace($TargetScriptFolder)) { return }
    $sourceFolder = Get-FlowCellBlenderScriptsFolder
    if (-not (Test-Path -LiteralPath $sourceFolder -PathType Container)) {
        Write-UiLog ('Blender template script source folder was not found: {0}' -f $sourceFolder)
        return
    }

    Get-ChildItem -LiteralPath $sourceFolder -Filter '*.ps1' -File -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-FlowCellPathUnderScriptDump -Path ([string]$_.FullName)) } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $TargetScriptFolder $_.Name) -Force
        }

    $supportSourceFolder = Get-FlowCellBlenderSupportFolder
    if (-not (Test-Path -LiteralPath $supportSourceFolder -PathType Container)) {
        Write-UiLog ('Blender support script source folder was not found: {0}' -f $supportSourceFolder)
        return
    }

    $supportTargetFolder = Ensure-FlowCellDirectory -Path (Join-Path (Split-Path -Parent $TargetScriptFolder) 'SupportScripts')
    Get-ChildItem -LiteralPath $supportSourceFolder -Filter '*.ps1' -File -ErrorAction SilentlyContinue |
        Where-Object { -not (Test-FlowCellPathUnderScriptDump -Path ([string]$_.FullName)) } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $supportTargetFolder $_.Name) -Force
        }
}

function Install-FlowCellBlenderBridgeTemplate([string]$ExePath, [string]$BridgeFolder, [string]$ProgramName) {
    $config = Get-FlowCellBlenderConfig
    $bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
    $setupRecordPath = [string]$bridgeLayout.SetupStatusPath
    $payload = [pscustomobject]@{
        programName = [string]$ProgramName
        blenderExePath = [string]$ExePath
        bridgeFolder = [string]$BridgeFolder
        createdAt = (Get-Date).ToString('o')
        status = 'pending_restart'
    }
    Set-Content -LiteralPath $setupRecordPath -Value ($payload | ConvertTo-Json -Depth 6) -Encoding UTF8
    Write-UiLog ('Blender template setup created a bridge bootstrap record at {0} and will use bridge folder {1}.' -f [string]$setupRecordPath, [string]$BridgeFolder)
    return [pscustomobject]@{
        Succeeded = $true
        Message = 'Blender connected. Restart Blender to complete setup.'
        RecordPath = [string]$setupRecordPath
    }
}

function New-FlowCellProgramTemplateResult([string]$ProgramName, [string]$ExePath) {
    $displayName = [string]$ProgramName
    if ([string]::IsNullOrWhiteSpace($displayName)) {
        throw 'Program Name is required.'
    }
    $displayName = $displayName.Trim()
    $normalizedName = $displayName.ToLowerInvariant()
    $resolvedExePath = Resolve-FlowCellProgramExecutablePath -ExePath $ExePath
    $templateKey = Get-FlowCellProgramTemplateKey -ProgramName $normalizedName -ExePath $resolvedExePath
    $scriptFolder = ''
    $bridgeFolder = ''
    $programType = 'generic'
    $runMethod = 'generic'
    $allowedScriptExtensions = @()
    $defaultPanels = @('Files', 'Utility')
    $requiresRestart = $false
    $statusMessage = ''
    $storageName = Get-FlowCellProgramStorageName -ProgramName $normalizedName

    switch ($templateKey) {
        'illustrator' {
            $programType = 'adobe_direct_script_runner'
            $runMethod = 'illustrator_direct'
            $allowedScriptExtensions = @('.jsx', '.js')
            $defaultPanels = @('Layers', 'Files', 'Utility')
            $scriptFolder = Ensure-FlowCellDirectory -Path (Join-Path $script:FlowCellLocalAppDataRoot 'Programs\Illustrator\Scripts')
            break
        }
        'photoshop' {
            $programType = 'adobe_direct_script_runner'
            $runMethod = 'photoshop_direct'
            $allowedScriptExtensions = @('.jsx', '.js')
            $defaultPanels = @('Layers', 'Files', 'Utility')
            $scriptFolder = Ensure-FlowCellDirectory -Path $script:PhotoshopScriptsDir
            break
        }
        'blender' {
            $programType = 'bridge_runner'
            $runMethod = 'blender_bridge'
            $allowedScriptExtensions = @('.ps1', '.py', '.blend', '.exe', '.lnk')
            $defaultPanels = @('Collections', 'Files', 'Utility')
            $scriptFolder = Ensure-FlowCellDirectory -Path (Join-Path $script:FlowCellLocalAppDataRoot 'Programs\Blender\Scripts')
            Sync-FlowCellBlenderTemplateScripts -TargetScriptFolder $scriptFolder
            $existingBridgeFolder = Get-FlowCellExistingBlenderBridgeFolder
            $bridgeFolder = if (-not [string]::IsNullOrWhiteSpace($existingBridgeFolder)) {
                Ensure-FlowCellDirectory -Path $existingBridgeFolder
            }
            else {
                Ensure-FlowCellDirectory -Path (Join-Path $script:FlowCellLocalAppDataRoot 'Bridges\Blender')
            }
            [void](Ensure-FlowCellDirectory -Path (Join-Path $bridgeFolder 'requests'))
            [void](Ensure-FlowCellDirectory -Path (Join-Path $bridgeFolder 'responses'))
            [void](Ensure-FlowCellDirectory -Path (Join-Path $bridgeFolder 'status'))
            $bridgeSetup = Install-FlowCellBlenderBridgeTemplate -ExePath $resolvedExePath -BridgeFolder $bridgeFolder -ProgramName $displayName
            $requiresRestart = $true
            $statusMessage = [string]$bridgeSetup.Message
            break
        }
        default {
            $programType = 'generic'
            $runMethod = 'generic'
            $defaultPanels = @('Files', 'Utility')
            $scriptFolder = Ensure-FlowCellDirectory -Path (Join-Path $script:FlowCellLocalAppDataRoot ("Programs\{0}\Scripts" -f $storageName))
            break
        }
    }

    $programTab = New-FlowCellProgramTab -Id 0 `
        -Label $displayName `
        -NormalizedName $normalizedName `
        -ScriptFolder $scriptFolder `
        -ProgramType $programType `
        -ExePath $resolvedExePath `
        -RunMethod $runMethod `
        -AllowedScriptExtensions $allowedScriptExtensions `
        -BridgeFolder $bridgeFolder `
        -RequiresRestart $requiresRestart `
        -DefaultPanels $defaultPanels

    return [pscustomobject]@{
        ProgramTab = $programTab
        StatusMessage = [string]$statusMessage
    }
}

function Add-FlowCellProgramTab([string]$ProgramName, [string]$ExePath, [bool]$Persist = $true, [bool]$SelectCreatedProgram = $true) {
    $createdProgramTab = $null
    $createdProgramState = $null
    try {
        $templateResult = New-FlowCellProgramTemplateResult -ProgramName $ProgramName -ExePath $ExePath
        $templateProgramTab = $templateResult.ProgramTab
        $nextProgramTabId = [int]$script:State.ProgramTabNextId
        if ($nextProgramTabId -le 0) {
            $nextProgramTabId = [Math]::Max((@($script:State.ProgramTabs | Measure-Object -Property Id -Maximum).Maximum + 1), 1)
        }

        $createdProgramTab = New-FlowCellProgramTab -Id $nextProgramTabId `
            -Label ([string]$templateProgramTab.Label) `
            -NormalizedName ([string]$templateProgramTab.NormalizedName) `
            -ScriptFolder ([string]$templateProgramTab.ScriptFolder) `
            -ProgramType ([string]$templateProgramTab.ProgramType) `
            -ExePath ([string]$templateProgramTab.ExePath) `
            -RunMethod ([string]$templateProgramTab.RunMethod) `
            -AllowedScriptExtensions $templateProgramTab.AllowedScriptExtensions `
            -BridgeFolder ([string]$templateProgramTab.BridgeFolder) `
            -RequiresRestart ([bool]$templateProgramTab.RequiresRestart) `
            -DefaultPanels $templateProgramTab.DefaultPanels `
            -ProcessNames $templateProgramTab.ProcessNames

        $createdProgramState = New-FlowCellProgramState -ProgramTab $createdProgramTab
        $script:State.ProgramTabs += $createdProgramTab
        $script:State.ProgramTabNextId = $nextProgramTabId + 1
        $script:FlowCellState.Programs += $createdProgramState
        if ($SelectCreatedProgram) {
            $script:State.SelectedProgramTabId = $nextProgramTabId
            $script:FlowCellState.SelectedProgramTabId = $nextProgramTabId
        }
        if ($Persist) {
            Save-State
            Save-FlowCellState
        }
        Write-UiLog ('Added FlowCell program tab. ProgramTabId={0}; Label={1}; ProgramType={2}; ExePath={3}' -f $createdProgramTab.Id, $createdProgramTab.Label, $createdProgramTab.ProgramType, $createdProgramTab.ExePath)
        return [pscustomobject]@{
            Succeeded = $true
            ProgramTab = $createdProgramTab
            Message = if ([string]::IsNullOrWhiteSpace([string]$templateResult.StatusMessage)) { ('Added program tab: {0}' -f [string]$createdProgramTab.Label) } else { [string]$templateResult.StatusMessage }
        }
    }
    catch {
        if ($createdProgramTab) {
            $script:State.ProgramTabs = @($script:State.ProgramTabs | Where-Object { $_.Id -ne [int]$createdProgramTab.Id })
            if ($script:State.ProgramTabNextId -gt 1) {
                $script:State.ProgramTabNextId = [Math]::Max($script:State.ProgramTabNextId - 1, 1)
            }
            if ($SelectCreatedProgram -and [int]$script:State.SelectedProgramTabId -eq [int]$createdProgramTab.Id -and @($script:State.ProgramTabs).Count -gt 0) {
                $script:State.SelectedProgramTabId = [int]$script:State.ProgramTabs[0].Id
            }
        }
        if ($createdProgramState) {
            $script:FlowCellState.Programs = @($script:FlowCellState.Programs | Where-Object { $_.ProgramTabId -ne [int]$createdProgramState.ProgramTabId })
            if ($SelectCreatedProgram -and [int]$script:FlowCellState.SelectedProgramTabId -eq [int]$createdProgramState.ProgramTabId -and @($script:FlowCellState.Programs).Count -gt 0) {
                $script:FlowCellState.SelectedProgramTabId = [int]$script:FlowCellState.Programs[0].ProgramTabId
            }
        }
        Write-UiLog ('Add FlowCell program failed. Name={0}; ExePath={1}; Error={2}' -f [string]$ProgramName, [string]$ExePath, $_.Exception.ToString())
        return [pscustomobject]@{
            Succeeded = $false
            ProgramTab = $null
            Message = $_.Exception.Message
        }
    }
}

function Add-FlowCellProgramRailEntry([string]$ProgramName, [string]$ExePath = '') {
    $resolvedName = [string]$ProgramName
    if ([string]::IsNullOrWhiteSpace($resolvedName)) {
        return [pscustomobject]@{
            Succeeded = $false
            ProgramTab = $null
            Message = 'Program name is required.'
        }
    }

    $resolvedName = $resolvedName.Trim()
    $resolvedExePath = if ([string]::IsNullOrWhiteSpace($ExePath)) { '' } else { Resolve-FlowCellProgramExecutablePath -ExePath $ExePath }
    if (-not (Test-FlowCellValidFolderName -Name $resolvedName)) {
        return [pscustomobject]@{
            Succeeded = $false
            ProgramTab = $null
            Message = 'Program names must be valid folder names.'
        }
    }
    [void](Get-FlowCellProgramPanelsRoot -ProgramName $resolvedName -Create)
    $existingTab = @($script:State.ProgramTabs | Where-Object { [string]$_.Label -ieq $resolvedName } | Select-Object -First 1)
    if (@($existingTab).Count -gt 0) {
        $programTab = $existingTab[0]
        $script:State.SelectedProgramTabId = [int]$programTab.Id
        $script:FlowCellState.SelectedProgramTabId = [int]$programTab.Id
        Save-State
        return [pscustomobject]@{
            Succeeded = $true
            ProgramTab = $programTab
            Message = ('Program already exists: {0}' -f [string]$programTab.Label)
        }
    }

    $result = Add-FlowCellProgramTab -ProgramName $resolvedName -ExePath $resolvedExePath
    if ([bool]$result.Succeeded -and $result.ProgramTab) {
        [void](Get-FlowCellPanelRailPanels -ProgramTab $result.ProgramTab)
    }
    return $result
}

function Rename-FlowCellProgramTab([int]$ProgramTabId, [string]$NewLabel) {
    $trimmedLabel = [string]$NewLabel
    if ([string]::IsNullOrWhiteSpace($trimmedLabel)) { return $false }

    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    if ($null -eq $programTab) { return $false }

    $trimmedLabel = $trimmedLabel.Trim()
    if (-not (Test-FlowCellValidFolderName -Name $trimmedLabel)) { return $false }
    $existingProgram = @($script:State.ProgramTabs | Where-Object { [int]$_.Id -ne $ProgramTabId -and [string]$_.Label -ieq $trimmedLabel } | Select-Object -First 1)
    if (@($existingProgram).Count -gt 0) { return $false }

    $currentFolderPath = Get-FlowCellProgramFolderPath -ProgramName ([string]$programTab.Label)
    $targetFolderPath = Get-FlowCellProgramFolderPath -ProgramName $trimmedLabel
    if (-not [string]::IsNullOrWhiteSpace($targetFolderPath) -and (Get-FlowCellNormalizedPath $targetFolderPath) -ne (Get-FlowCellNormalizedPath $currentFolderPath)) {
        return $false
    }

    if (-not [string]::IsNullOrWhiteSpace($currentFolderPath) -and (Test-Path -LiteralPath $currentFolderPath -PathType Container) -and [string]$programTab.Label -ne $trimmedLabel) {
        Rename-Item -LiteralPath $currentFolderPath -NewName $trimmedLabel -Force
    }
    else {
        [void](Get-FlowCellProgramPanelsRoot -ProgramName $trimmedLabel -Create)
    }

    $programTab.Label = $trimmedLabel
    $programTab.NormalizedName = $trimmedLabel.ToLowerInvariant()
    Save-State
    Save-FlowCellState
    Write-UiLog ('Renamed FlowCell program tab. ProgramTabId={0}; Label={1}' -f [int]$ProgramTabId, [string]$programTab.Label)
    return $true
}

function Remove-FlowCellProgramTab([int]$ProgramTabId) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    if ($null -eq $programTab) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'Program tab not found.'
        }
    }
    if (@($script:State.ProgramTabs).Count -le 1) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'FlowCell needs at least one program tab.'
        }
    }

    $programFolderPath = Get-FlowCellProgramFolderPath -ProgramName ([string]$programTab.Label)
    if (-not [string]::IsNullOrWhiteSpace($programFolderPath) -and (Test-Path -LiteralPath $programFolderPath -PathType Container)) {
        try {
            Move-FlowCellDirectoryToRecycleBin -Path $programFolderPath
        }
        catch {
            return [pscustomobject]@{
                Succeeded = $false
                Message = ('Could not move program folder to the Recycle Bin: {0}' -f $_.Exception.Message)
            }
        }
    }

    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $remainingProgramTabs = @($script:State.ProgramTabs | Where-Object { [int]$_.Id -ne $ProgramTabId })
    $fallbackProgramTabId = if (@($remainingProgramTabs).Count -gt 0) { [int]$remainingProgramTabs[0].Id } else { 0 }
    $removedMacroTargets = @()
    if ($programState) {
        $removedMacroTargets = @(
            foreach ($panel in @($programState.Panels)) {
                foreach ($button in @($panel.Buttons)) {
                    if ([string]$button.Kind -eq 'macro' -and -not [string]::IsNullOrWhiteSpace([string]$button.Target)) {
                        [string]$button.Target
                    }
                }
            }
        ) | Select-Object -Unique
    }

    if ($script:FlowCellPanelWindows -is [hashtable]) {
        foreach ($entry in @($script:FlowCellPanelWindows.GetEnumerator())) {
            if ($null -eq $entry.Value) { continue }
            if (-not $entry.Value.PSObject.Properties['ProgramTabId']) { continue }
            if ([int]$entry.Value.ProgramTabId -ne $ProgramTabId) { continue }
            if ($entry.Value.PSObject.Properties['Window'] -and $entry.Value.Window -and $entry.Value.Window.IsLoaded) {
                $entry.Value.Window.Tag = 'shutdown'
                try { $entry.Value.Window.Close() } catch {}
            }
            else {
                [void]$script:FlowCellPanelWindows.Remove([string]$entry.Key)
            }
        }
    }
    if ($script:FlowCellToolPopoutWindows -is [hashtable]) {
        foreach ($entry in @($script:FlowCellToolPopoutWindows.GetEnumerator())) {
            if ($null -eq $entry.Value) { continue }
            if (-not $entry.Value.PSObject.Properties['ProgramTabId']) { continue }
            if ([int]$entry.Value.ProgramTabId -ne $ProgramTabId) { continue }
            if ($entry.Value.PSObject.Properties['Window'] -and $entry.Value.Window -and $entry.Value.Window.IsLoaded) {
                $entry.Value.Window.Tag = 'shutdown'
                try { $entry.Value.Window.Close() } catch {}
            }
            else {
                [void]$script:FlowCellToolPopoutWindows.Remove([string]$entry.Key)
            }
        }
    }
    if ($script:FlowCellToolPopoutTargets -is [hashtable]) {
        foreach ($key in @($script:FlowCellToolPopoutTargets.Keys)) {
            $targetEntry = $script:FlowCellToolPopoutTargets[$key]
            $removeTargetEntry = $false
            if ($targetEntry -and $targetEntry.PSObject.Properties['ProgramTabId']) {
                $removeTargetEntry = ([int]$targetEntry.ProgramTabId -eq $ProgramTabId)
            }
            elseif ([string]$key -like ('{0}|*' -f $ProgramTabId)) {
                $removeTargetEntry = $true
            }
            if ($removeTargetEntry) {
                [void]$script:FlowCellToolPopoutTargets.Remove([string]$key)
            }
        }
    }

    $script:State.ProgramTabs = @($remainingProgramTabs)
    $script:FlowCellState.Programs = @($script:FlowCellState.Programs | Where-Object { [int]$_.ProgramTabId -ne $ProgramTabId })
    $script:State.ScriptBindings = @(
        $script:State.ScriptBindings |
            Where-Object { [int]$(if ($_.PSObject.Properties['ProgramTabId']) { $_.ProgramTabId } else { 0 }) -ne $ProgramTabId }
    )
    if ($script:FlowCellState.PSObject.Properties['ToolPopouts']) {
        $script:FlowCellState.ToolPopouts = @(
            $script:FlowCellState.ToolPopouts |
                Where-Object { [int]$_.ProgramTabId -ne $ProgramTabId }
        )
    }
    if ($script:FlowCellState.PSObject.Properties['PopoutClusters']) {
        $programPopoutPrefixes = @(
            'panel|{0}|' -f $ProgramTabId,
            'tool|{0}|' -f $ProgramTabId
        )
        $script:FlowCellState.PopoutClusters = @(
            foreach ($clusterState in @($script:FlowCellState.PopoutClusters)) {
                $convertedCluster = ConvertTo-FlowCellPopoutClusterState $clusterState
                if ($null -eq $convertedCluster) { continue }
                $remainingMemberIds = @(
                    foreach ($memberId in @($convertedCluster.MemberIds)) {
                        $memberIdText = [string]$memberId
                        $belongsToProgram = $false
                        foreach ($prefix in @($programPopoutPrefixes)) {
                            if ($memberIdText.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                                $belongsToProgram = $true
                                break
                            }
                        }
                        if (-not $belongsToProgram) {
                            $memberIdText
                        }
                    }
                )
                if (@($remainingMemberIds).Count -lt 2) { continue }
                [pscustomobject]@{
                    Id = [string]$convertedCluster.Id
                    MemberIds = @($remainingMemberIds)
                    GrabberOffset = $convertedCluster.GrabberOffset
                }
            }
        )
    }

    if ([int]$script:State.SelectedProgramTabId -eq $ProgramTabId) {
        $script:State.SelectedProgramTabId = $fallbackProgramTabId
    }
    if ([int]$script:FlowCellState.SelectedProgramTabId -eq $ProgramTabId) {
        $script:FlowCellState.SelectedProgramTabId = $fallbackProgramTabId
    }

    if (@($removedMacroTargets).Count -gt 0) {
        $remainingMacroTargets = @(
            foreach ($remainingProgramState in @($script:FlowCellState.Programs)) {
                foreach ($remainingPanel in @($remainingProgramState.Panels)) {
                    foreach ($remainingButton in @($remainingPanel.Buttons)) {
                        if ([string]$remainingButton.Kind -eq 'macro' -and -not [string]::IsNullOrWhiteSpace([string]$remainingButton.Target)) {
                            [string]$remainingButton.Target
                        }
                    }
                }
            }
        ) | Select-Object -Unique
        foreach ($removedMacroTarget in @($removedMacroTargets)) {
            if (-not ($remainingMacroTargets -contains [string]$removedMacroTarget) -and $script:State.ActionHotkeys.Contains([string]$removedMacroTarget)) {
                $script:State.ActionHotkeys.Remove([string]$removedMacroTarget)
            }
        }
    }

    Invoke-FlowCellClusterSafe 'remove-program-tab' { Restore-FlowCellPopoutClusters } | Out-Null
    Save-State
    Save-FlowCellState
    if ($script:FlowCellWindow -and $script:FlowCellWindow.IsLoaded) {
        Save-FlowCellLayoutSnapshot -MainWindow $script:FlowCellWindow | Out-Null
    }
    Restart-Backend
    Write-UiLog ('Removed FlowCell program tab. ProgramTabId={0}; Label={1}' -f [int]$ProgramTabId, [string]$programTab.Label)
    return [pscustomobject]@{
        Succeeded = $true
        Message = ('Deleted program tab: {0}' -f [string]$programTab.Label)
    }
}

function Add-FlowCellPanel([int]$ProgramTabId, [string]$PanelName) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    if ($null -eq $programTab -or $null -eq $programState) {
        return [pscustomobject]@{
            Succeeded = $false
            Panel = $null
            Message = 'Pick a program first.'
        }
    }

    $resolvedName = [string]$PanelName
    if ([string]::IsNullOrWhiteSpace($resolvedName)) {
        return [pscustomobject]@{
            Succeeded = $false
            Panel = $null
            Message = 'Panel name is required.'
        }
    }

    $resolvedName = $resolvedName.Trim()
    if (-not (Test-FlowCellValidFolderName -Name $resolvedName)) {
        return [pscustomobject]@{
            Succeeded = $false
            Panel = $null
            Message = 'Panel names must be valid folder names.'
        }
    }
    [void](Get-FlowCellPanelFolderPath -ProgramName ([string]$programTab.Label) -PanelName $resolvedName -Create)
    $existingPanel = @($programState.Panels | Where-Object { [string]$_.Name -ieq $resolvedName } | Select-Object -First 1)
    if (@($existingPanel).Count -gt 0) {
        $programState.SelectedPanelId = [string]$existingPanel[0].Id
        Save-FlowCellState
        return [pscustomobject]@{
            Succeeded = $true
            Panel = $existingPanel[0]
            Message = ('Panel already exists: {0}' -f [string]$existingPanel[0].Name)
        }
    }

    $panel = New-FlowCellPanelState -Name $resolvedName -Id (Get-FlowCellDefaultPanelId -Name $resolvedName)
    $programState.Panels += $panel
    $programState.SelectedPanelId = [string]$panel.Id
    Save-FlowCellState
    return [pscustomobject]@{
        Succeeded = $true
        Panel = $panel
        Message = ('Added panel {0}.' -f [string]$panel.Name)
    }
}

function Rename-FlowCellPanel([int]$ProgramTabId, [string]$PanelId, [string]$NewName) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $programTab -or $null -eq $programState -or $null -eq $panel) { return $false }

    $resolvedName = [string]$NewName
    if ([string]::IsNullOrWhiteSpace($resolvedName)) { return $false }
    $resolvedName = $resolvedName.Trim()
    if (-not (Test-FlowCellValidFolderName -Name $resolvedName)) { return $false }
    $existingPanel = @($programState.Panels | Where-Object { [string]$_.Id -ne [string]$PanelId -and [string]$_.Name -ieq $resolvedName } | Select-Object -First 1)
    if (@($existingPanel).Count -gt 0) { return $false }

    $currentFolderPath = Get-FlowCellPanelFolderPath -ProgramName ([string]$programTab.Label) -PanelName ([string]$panel.Name)
    $targetFolderPath = Get-FlowCellPanelFolderPath -ProgramName ([string]$programTab.Label) -PanelName $resolvedName
    if (-not [string]::IsNullOrWhiteSpace($targetFolderPath) -and (Get-FlowCellNormalizedPath $targetFolderPath) -ne (Get-FlowCellNormalizedPath $currentFolderPath)) {
        return $false
    }

    if (-not [string]::IsNullOrWhiteSpace($currentFolderPath) -and (Test-Path -LiteralPath $currentFolderPath -PathType Container) -and [string]$panel.Name -ne $resolvedName) {
        Rename-Item -LiteralPath $currentFolderPath -NewName $resolvedName -Force
    }
    else {
        [void](Get-FlowCellPanelFolderPath -ProgramName ([string]$programTab.Label) -PanelName $resolvedName -Create)
    }

    $panel.Name = $resolvedName
    Save-FlowCellState
    return $true
}

function Remove-FlowCellPanel([int]$ProgramTabId, [string]$PanelId) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $programTab -or $null -eq $programState -or $null -eq $panel) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'Panel not found.'
        }
    }
    if (@($programState.Panels).Count -le 1) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'FlowCell needs at least one panel.'
        }
    }

    $panelFolderPath = Get-FlowCellPanelFolderPath -ProgramName ([string]$programTab.Label) -PanelName ([string]$panel.Name)
    if (-not [string]::IsNullOrWhiteSpace($panelFolderPath) -and (Test-Path -LiteralPath $panelFolderPath -PathType Container)) {
        try {
            Move-FlowCellDirectoryToRecycleBin -Path $panelFolderPath
        }
        catch {
            return [pscustomobject]@{
                Succeeded = $false
                Message = ('Could not move panel folder to the Recycle Bin: {0}' -f $_.Exception.Message)
            }
        }
    }

    $programState.Panels = @($programState.Panels | Where-Object { [string]$_.Id -ne [string]$panel.Id })
    $programState.SelectedPanelId = [string]$programState.Panels[0].Id
    Save-FlowCellState
    return [pscustomobject]@{
        Succeeded = $true
        Message = ('Removed panel {0}.' -f [string]$panel.Name)
    }
}

function Show-AddProgramDialog {
    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Add Program"
        Width="620"
        Height="320"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Background="#FF22272E"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Padding="16" Background="#FF2D333B" CornerRadius="14">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Add Program</TextBlock>
            <TextBlock Grid.Row="1" Margin="0,0,0,6">Program Name</TextBlock>
            <TextBox x:Name="ProgramNameBox" Grid.Row="2" MinHeight="40" Margin="0,0,0,12" Padding="10,8" VerticalContentAlignment="Center" />
            <TextBlock Grid.Row="3" Margin="0,0,0,6">Program EXE Path</TextBlock>
            <Grid Grid.Row="4" Margin="0,0,0,8">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*" />
                    <ColumnDefinition Width="Auto" />
                </Grid.ColumnDefinitions>
                <TextBox x:Name="ProgramExePathBox" Grid.Column="0" MinHeight="40" Margin="0,0,10,0" Padding="10,8" VerticalContentAlignment="Center" />
                <Button x:Name="BrowseProgramExeButton" Grid.Column="1" Width="100" Height="40" Margin="0" Background="#FF74C4FF" Foreground="#FF11151A">Browse</Button>
            </Grid>
            <TextBlock x:Name="ProgramValidationErrorText" Grid.Row="5" Margin="0,0,0,10" Foreground="#FFFF8A80" TextWrapping="Wrap" Visibility="Collapsed" />
            <TextBlock Grid.Row="6" Foreground="#FFB6C2CF" TextWrapping="Wrap">Known templates: Illustrator, Photoshop, Blender. Other names create a generic FlowCell program tab.</TextBlock>
            <StackPanel Grid.Row="7" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,14,0,0">
                <Button x:Name="CancelButton" Width="110" Margin="0,0,10,0" Background="#FF586069">Cancel</Button>
                <Button x:Name="CreateButton" Width="110">Create</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $owner = Get-DialogOwnerWindow
    if ($owner) { $dialog.Owner = $owner }

    $nameBox = $dialog.FindName('ProgramNameBox')
    $exePathBox = $dialog.FindName('ProgramExePathBox')
    $validationErrorText = $dialog.FindName('ProgramValidationErrorText')
    $script:__flowCellAddProgramResult = $null

    $setValidationError = {
        param([string]$Message)
        if ([string]::IsNullOrWhiteSpace($Message)) {
            $validationErrorText.Text = ''
            $validationErrorText.Visibility = 'Collapsed'
            return
        }
        $validationErrorText.Text = $Message
        $validationErrorText.Visibility = 'Visible'
    }

    $browseForExe = {
        $dialogBox = New-Object Microsoft.Win32.OpenFileDialog
        $dialogBox.Title = 'Choose Program EXE'
        $dialogBox.Filter = 'Program EXE (*.exe)|*.exe|All Files (*.*)|*.*'
        if (-not [string]::IsNullOrWhiteSpace([string]$exePathBox.Text)) {
            try {
                $existingDirectory = Split-Path -Parent ([string]$exePathBox.Text)
                if (Test-Path -LiteralPath $existingDirectory -PathType Container) {
                    $dialogBox.InitialDirectory = [string]$existingDirectory
                }
            }
            catch {
            }
        }
        if (-not $dialogBox.ShowDialog($dialog)) { return }
        $exePathBox.Text = [string]$dialogBox.FileName
        if ([string]::IsNullOrWhiteSpace([string]$nameBox.Text)) {
            $suggestedName = Get-FlowCellSuggestedProgramNameFromExecutable -ExePath ([string]$dialogBox.FileName)
            if (-not [string]::IsNullOrWhiteSpace($suggestedName)) {
                $nameBox.Text = $suggestedName
                $nameBox.CaretIndex = $nameBox.Text.Length
            }
        }
        & $setValidationError ''
    }

    $createProgram = {
        $programName = [string]$nameBox.Text
        $exePath = [string]$exePathBox.Text
        if ([string]::IsNullOrWhiteSpace($programName)) {
            & $setValidationError 'Program Name is required.'
            return
        }
        if ([string]::IsNullOrWhiteSpace($exePath)) {
            & $setValidationError 'Program EXE path is required.'
            return
        }
        if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
            & $setValidationError 'Program EXE path does not exist.'
            return
        }
        $script:__flowCellAddProgramResult = [pscustomobject]@{
            ProgramName = $programName.Trim()
            ExePath = [System.IO.Path]::GetFullPath($exePath.Trim())
        }
        $dialog.DialogResult = $true
        $dialog.Close()
    }

    $dialog.FindName('BrowseProgramExeButton').Add_Click($browseForExe)
    $dialog.FindName('CreateButton').Add_Click($createProgram)
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })
    $nameBox.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Enter') {
            & $createProgram
            $eventArgs.Handled = $true
        }
    })
    $exePathBox.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Enter') {
            & $createProgram
            $eventArgs.Handled = $true
        }
    })
    $dialog.Add_ContentRendered({
        $nameBox.Focus() | Out-Null
        $nameBox.CaretIndex = $nameBox.Text.Length
    })

    if ($dialog.ShowDialog()) { return $script:__flowCellAddProgramResult }
    return $null
}

function Show-FlowCellMacroPickerDialog {
    $recordedActions = @($script:Actions | Where-Object { $_.Kind -eq 'recorded' } | Sort-Object Label)
    if (@($recordedActions).Count -eq 0) {
        $owner = Get-DialogOwnerWindow
        if ($owner) {
            [System.Windows.MessageBox]::Show($owner, 'No recorded macros exist yet.', 'Macro Lab') | Out-Null
        }
        else {
            [System.Windows.MessageBox]::Show('No recorded macros exist yet.', 'Macro Lab') | Out-Null
        }
        return $null
    }

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Bind Macro"
        Width="460"
        Height="220"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterOwner"
        ShowInTaskbar="False"
        Background="#FF22272E"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Padding="16" Background="#FF2D333B" CornerRadius="14">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Grid.Row="0" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,10">Bind Macro</TextBlock>
            <TextBlock Grid.Row="1" Margin="0,0,0,10">Choose a macro to bind into the active panel.</TextBlock>
            <ComboBox x:Name="MacroCombo" Grid.Row="2" DisplayMemberPath="Label" SelectedValuePath="Id" MinHeight="36" VerticalContentAlignment="Center" />
            <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,14,0,0">
                <Button x:Name="CancelButton" Width="110" Margin="0,0,10,0" Background="#FF586069">Cancel</Button>
                <Button x:Name="OkButton" Width="110">Choose</Button>
            </StackPanel>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $dialog = [Windows.Markup.XamlReader]::Load($reader)
    $owner = Get-DialogOwnerWindow
    if ($owner) { $dialog.Owner = $owner }
    $combo = $dialog.FindName('MacroCombo')
    foreach ($action in $recordedActions) { [void]$combo.Items.Add($action) }
    if ($combo.Items.Count -gt 0) { $combo.SelectedIndex = 0 }
    $script:__flowCellSelectedMacro = $null
    $dialog.FindName('OkButton').Add_Click({
        $script:__flowCellSelectedMacro = $combo.SelectedItem
        if ($null -eq $script:__flowCellSelectedMacro) { return }
        $dialog.DialogResult = $true
        $dialog.Close()
    })
    $dialog.FindName('CancelButton').Add_Click({
        $dialog.DialogResult = $false
        $dialog.Close()
    })

    if ($dialog.ShowDialog()) { return $script:__flowCellSelectedMacro }
    return $null
}

function Get-ProgramScriptDialogFilter($ProgramReference) {
    $programLabel = if ($ProgramReference -and $ProgramReference.PSObject.Properties['Label']) { [string]$ProgramReference.Label } else { [string]$ProgramReference }
    $programConfig = if ($ProgramReference -and $ProgramReference.PSObject.Properties['Label']) { Get-FlowCellProgramConfig -ProgramTab $ProgramReference } else { Get-FlowCellProgramConfig -ProgramTab (New-FlowCellProgramTab -Id 0 -Label $programLabel) }
    $allowedScriptExtensions = @($programConfig.AllowedScriptExtensions | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if (@($allowedScriptExtensions).Count -gt 0) {
        $extensionPatterns = @($allowedScriptExtensions | ForEach-Object { if ([string]$_ -like '.*') { '*{0}' -f [string]$_ } else { [string]$_ } })
        $displayExtensions = $allowedScriptExtensions -join ';'
        $filterPattern = $extensionPatterns -join ';'
        return ('{0} Scripts ({1})|{2}|All Files (*.*)|*.*' -f $programLabel, $displayExtensions, $filterPattern)
    }

    switch (Get-ProgramLabelKey $programLabel) {
        'blender' { return 'Blender Scripts (*.py;*.blend;*.exe;*.lnk)|*.py;*.blend;*.exe;*.lnk|All Files (*.*)|*.*' }
        'windows' { return 'Windows Scripts (*.ps1;*.cmd;*.bat;*.exe;*.lnk;*.vbs;*.ahk)|*.ps1;*.cmd;*.bat;*.exe;*.lnk;*.vbs;*.ahk|All Files (*.*)|*.*' }
        default { return 'All Files (*.*)|*.*' }
    }
}

function Invoke-FlowCellScriptTarget($ProgramTab, [string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
        return [pscustomobject]@{ Succeeded = $false; Message = 'No script path was provided.' }
    }
    if ($null -eq $ProgramTab) {
        return [pscustomobject]@{ Succeeded = $false; Message = 'No program tab was selected.' }
    }

    try {
        $programKey = Get-ProgramLabelKey ([string]$ProgramTab.Label)
        $scriptDisplayName = [System.IO.Path]::GetFileNameWithoutExtension($ScriptPath)
        if ([string]::IsNullOrWhiteSpace($scriptDisplayName)) { $scriptDisplayName = $ScriptPath }
        $lastActionStatusPath = [string]$script:LastActionStatusPath
        $scriptFileName = [System.IO.Path]::GetFileName([string]$ScriptPath)
        $scriptTimeoutSeconds = 120
        if (-not [string]::IsNullOrWhiteSpace($scriptFileName)) {
            $normalizedScriptFileName = [string]$scriptFileName.ToLowerInvariant()
            if ($normalizedScriptFileName -like '*update_github*' -or $normalizedScriptFileName -like '*pull_github*') {
                $scriptTimeoutSeconds = 900
            }
        }
        Set-ActionStatus ('Running script: {0}...' -f $scriptDisplayName)

        $onComplete = {
            param($exitCode)
            Write-UiLog ('Script finished. ScriptPath={0} | Program={1} | ExitCode={2}' -f $ScriptPath, $programKey, $exitCode)
            if ($exitCode -eq 124) {
                Set-ActionStatus ('Script timed out: {0}`r`n`r`nThe backend did not finish in time, but FlowCell stayed responsive.' -f $scriptDisplayName)
                return
            }

            $statusText = Read-AllText -Path $lastActionStatusPath -Default ''
            if ([string]::IsNullOrWhiteSpace($statusText)) {
                $statusText = if ($exitCode -eq 0) { ('Ran script: {0}' -f $ScriptPath) } else { ('Script run failed: {0}' -f $ScriptPath) }
            }
            Set-ActionStatus $statusText
        }.GetNewClosure()

        $started = Start-ControllerOperation -Description ('script {0}' -f $scriptDisplayName) -Kind 'script' -Arguments @(
            ('--run-script-path={0}' -f $ScriptPath),
            ('--run-script-program={0}' -f $programKey),
            ('--run-script-program-tab-id={0}' -f [int]$ProgramTab.Id)
        ) -Metadata @{ TimeoutSeconds = $scriptTimeoutSeconds } -OnComplete $onComplete

        return [pscustomobject]@{
            Succeeded = [bool]$started
            Message = if ($started) { ('Started script: {0}' -f $scriptDisplayName) } else { 'FlowCell is already running another backend task.' }
        }
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            Message = $_.Exception.Message
        }
    }
}

function Invoke-FlowCellCommandResult {
    param(
        [object]$Response,
        [int]$ExitCode,
        [hashtable]$Context
    )

    $statusText = ''
    if ($Response -and $Response.PSObject.Properties['Message']) {
        $statusText = [string]$Response.Message
    }
    if ([string]::IsNullOrWhiteSpace($statusText)) {
        $statusText = Read-AllText -Path $script:LastActionStatusPath -Default ''
    }
    if ([string]::IsNullOrWhiteSpace($statusText)) {
        $statusText = if ($ExitCode -eq 0) { 'Command finished.' } else { 'Command failed.' }
    }

    if ($Response -and $Response.PSObject.Properties['ClientAction']) {
        switch ([string]$Response.ClientAction) {
            'flowcell_toggle_popouts_minimized' {
                Invoke-FlowCellTogglePopoutWindowMinimize | Out-Null
            }
        }
    }

    if ($Response -and $Response.PSObject.Properties['SmartAxisResult'] -and $Context.ContainsKey('ProgramTab') -and $Context['ProgramTab']) {
        $smartAxisResult = $Response.SmartAxisResult
        if ($smartAxisResult) {
            Sync-FlowCellSmartAxisLockStateButtons -ProgramTab $Context['ProgramTab'] -Result $smartAxisResult
        }
    }

    if ($Response -and $Response.PSObject.Properties['ToolOptionState'] -and $Context.ContainsKey('ToolStateApply') -and $Context['ToolStateApply'] -is [scriptblock]) {
        & $Context['ToolStateApply'] $Response.ToolOptionState
    }

    Set-ActionStatus $statusText
    Write-UiLog ('Frontend command completed. CommandId={0}; Surface={1}; ButtonId={2}; ExitCode={3}; Succeeded={4}; Status={5}' -f `
        [string]$(if ($Context.ContainsKey('CommandId')) { $Context['CommandId'] } else { '' }), `
        [string]$(if ($Context.ContainsKey('Surface')) { $Context['Surface'] } else { '' }), `
        [string]$(if ($Context.ContainsKey('ButtonId')) { $Context['ButtonId'] } else { '' }), `
        [int]$ExitCode, `
        [bool]$(if ($Response -and $Response.PSObject.Properties['Succeeded']) { $Response.Succeeded } else { ($ExitCode -eq 0) }), `
        $statusText)
}

function Start-FlowCellBackendCommand {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Envelope,
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [Parameter(Mandatory = $true)]
        [hashtable]$Context,
        [int]$TimeoutSeconds = 120
    )

    if (-not (Test-Path -LiteralPath $script:FlowCellCommandHostScriptPath -PathType Leaf)) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = ('Command backend was not found: {0}' -f $script:FlowCellCommandHostScriptPath)
        }
    }

    $commandId = [guid]::NewGuid().ToString('N')
    $envelopePath = Join-Path $script:FlowCellCommandHostTempRoot ('command_{0}.json' -f $commandId)
    $resultPath = Join-Path $script:FlowCellCommandHostTempRoot ('result_{0}.json' -f $commandId)

    try {
        Set-Content -LiteralPath $envelopePath -Value ($Envelope | ConvertTo-Json -Depth 10) -Encoding UTF8
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            Message = $_.Exception.Message
        }
    }

    $callbackContext = @{}
    foreach ($entry in $Context.GetEnumerator()) {
        $callbackContext[[string]$entry.Key] = $entry.Value
    }
    $callbackContext['CommandId'] = [string]$(if ($Envelope.PSObject.Properties['command_id']) { $Envelope.command_id } else { '' })

    $onComplete = {
        param($exitCode)
        $response = $null
        if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
            try {
                $response = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
            }
            catch {
                Write-UiLog ('Frontend command result parse failed. Path={0}; Error={1}' -f $resultPath, $_.Exception.Message)
            }
        }

        try {
            if (Test-Path -LiteralPath $envelopePath -PathType Leaf) {
                Remove-Item -LiteralPath $envelopePath -Force -ErrorAction SilentlyContinue
            }
            if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
                Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
        }

        Invoke-FlowCellCommandResult -Response $response -ExitCode $exitCode -Context $callbackContext
    }.GetNewClosure()

    $started = Start-ControllerOperation -Description $Description -Kind 'command' -Arguments @(
        '-EnvelopePath',
        $envelopePath,
        '-ResultPath',
        $resultPath
    ) -Metadata @{
        Launcher = 'PowerShell'
        ScriptPath = $script:FlowCellCommandHostScriptPath
        TimeoutSeconds = [Math]::Max($TimeoutSeconds, 5)
        WindowStyle = 'Hidden'
    } -OnComplete $onComplete

    return [pscustomobject]@{
        Succeeded = [bool]$started
        Message = if ($started) { ('Started command: {0}' -f $Description) } else { 'FlowCell is already running another backend task.' }
    }
}

function Update-FlowCellAlignmentModifierStateFromIntent($Metadata) {
    if ($null -eq $Metadata -or [string]$Metadata.Tool -ne 'alignment') { return $null }
    $intent = ConvertFrom-FlowCellAlignmentToolIntent -Intent ([string]$Metadata.Intent)
    if (-not [bool]$intent.Valid -or [string]$intent.ActionType -ne 'toggle_modifier') { return $null }

    $ownerButtonId = [string]$Metadata.OwnerButtonId
    $panelId = [string]$(if (-not [string]::IsNullOrWhiteSpace([string]$Metadata.OwnerPanelId)) { $Metadata.OwnerPanelId } else { $Metadata.PanelId })
    $snapshot = Get-FlowCellAlignmentToolStateSnapshot -ProgramTabId ([int]$Metadata.ProgramTabId) -PanelId $panelId -OwnerButtonId $ownerButtonId
    $currentModifier = [string]$snapshot.Modifiers.($intent.Axis)
    $nextModifier = if ([string]$currentModifier -eq [string]$intent.Modifier) { '' } else { [string]$intent.Modifier }
    [void](Set-FlowCellAlignmentAxisModifier -ProgramTabId ([int]$Metadata.ProgramTabId) -PanelId $panelId -OwnerButtonId $ownerButtonId -Axis $intent.Axis -Modifier $nextModifier)
    $statusText = if ([string]::IsNullOrWhiteSpace($nextModifier)) {
        ('Alignment {0} modifier cleared.' -f [string]$intent.Axis)
    }
    else {
        ('Alignment {0} modifier set to {1}.' -f [string]$intent.Axis, $(if ([string]$nextModifier -eq 'GEOCENTER') { 'origin' } else { [string]$nextModifier.ToLowerInvariant() }))
    }
    Set-Content -LiteralPath $script:LastActionStatusPath -Value $statusText -Encoding UTF8
    Set-ActionStatus $statusText
    return [pscustomobject]@{
        Intent = [string]$intent.Intent
        ActionType = [string]$intent.ActionType
        Axis = [string]$intent.Axis
        Mode = [string]$intent.Mode
        Modifier = [string]$nextModifier
        StatusMessage = [string]$statusText
    }
}

function New-FlowCellButtonCommandEnvelope($Metadata, $ProgramTab, $PreCommandState = $null) {
    $programConfig = Get-FlowCellProgramConfig -ProgramTab $ProgramTab -ProgramConfig $(if ($Metadata.ProgramTab.PSObject.Properties['ProgramConfig']) { $Metadata.ProgramTab.ProgramConfig } else { $null })
    $payload = [ordered]@{
        kind = [string]$Metadata.Kind
        label = [string]$Metadata.Label
        target = [string]$Metadata.Target
        resolved_target = [string]$Metadata.ResolvedTarget
        tooltip = [string]$(if ($Metadata.Button.PSObject.Properties['Tooltip']) { $Metadata.Button.Tooltip } else { '' })
        shortcut = [string]$(if ($Metadata.Button.PSObject.Properties['Shortcut']) { $Metadata.Button.Shortcut } else { '' })
        binding_id = [int]$(if ($Metadata.Button.PSObject.Properties['BindingId']) { $Metadata.Button.BindingId } else { 0 })
        style_group_id = [string]$Metadata.style_group_id
        compound_tool_id = [string]$Metadata.compound_tool_id
        tool = [string]$Metadata.Tool
        intent = [string]$Metadata.Intent
        owner_button_id = [string]$Metadata.OwnerButtonId
        owner_panel_id = [string]$Metadata.OwnerPanelId
    }

    if ([string]$Metadata.Kind -eq 'tool_action' -and [string]$Metadata.Tool -eq 'alignment') {
        $intent = ConvertFrom-FlowCellAlignmentToolIntent -Intent ([string]$Metadata.Intent)
        $payload.command = [string]$intent.ActionType
        $payload.action_type = [string]$intent.ActionType
        $payload.axis = [string]$intent.Axis
        $payload.mode = [string]$intent.Mode
        if ($PreCommandState -and $PreCommandState.PSObject.Properties['Modifier']) {
            $payload.modifier = [string]$PreCommandState.Modifier
        }
        elseif ([string]$intent.ActionType -eq 'align_axis') {
            $snapshot = Get-FlowCellAlignmentToolStateSnapshot -ProgramTabId ([int]$Metadata.ProgramTabId) -PanelId ([string]$Metadata.PanelId) -OwnerButtonId ([string]$Metadata.OwnerButtonId)
            $payload.modifier = [string]$snapshot.Modifiers.($intent.Axis)
        }
        if ($PreCommandState -and $PreCommandState.PSObject.Properties['StatusMessage']) {
            $payload.status_message = [string]$PreCommandState.StatusMessage
        }
    }

    return [pscustomobject]@{
        command_id = [string]$Metadata.CommandId
        source_button_id = [string]$Metadata.ButtonId
        program_id = [int]$Metadata.ProgramTabId
        panel_id = [string]$Metadata.PanelId
        source_surface = [string]$Metadata.Surface
        correlation_id = [guid]::NewGuid().ToString('N')
        program = [pscustomobject]@{
            id = [int]$Metadata.ProgramTabId
            label = [string]$Metadata.ProgramLabel
            normalized_name = [string]$programConfig.NormalizedName
            program_type = [string]$programConfig.ProgramType
            run_method = [string]$programConfig.RunMethod
            script_folder = [string]$programConfig.ScriptFolder
            bridge_folder = [string]$programConfig.BridgeFolder
            exe_path = [string]$programConfig.ExePath
            requires_restart = [bool]$programConfig.RequiresRestart
            process_names = @($programConfig.ProcessNames)
        }
        payload = [pscustomobject]$payload
    }
}

function Invoke-FlowCellButtonAction($Button, $ProgramTab, [string]$PanelId = '', [string]$Surface = 'Unknown') {
    $metadata = Get-FlowCellButtonStateMetadata -Button $Button -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface
    if (-not [bool]$metadata.Valid) {
        Write-UiLog ('Frontend command validation failed. HostVersion={0}; Surface={1}; ProgramTabId={2}; PanelId={3}; ButtonId={4}; Label={5}; Reason={6}' -f `
            $script:FlowCellHostLayerVersion, `
            $metadata.Surface, `
            $metadata.ProgramTabId, `
            $metadata.PanelId, `
            $metadata.ButtonId, `
            $metadata.Label, `
            $metadata.ValidationMessage)
        return [pscustomobject]@{
            Succeeded = $false
            Message = [string]$metadata.ValidationMessage
        }
    }

    $preCommandState = Update-FlowCellAlignmentModifierStateFromIntent -Metadata $metadata
    $envelope = New-FlowCellButtonCommandEnvelope -Metadata $metadata -ProgramTab $ProgramTab -PreCommandState $preCommandState
    Write-UiLog ('Frontend command emitted. HostVersion={0}; Surface={1}; ProgramTabId={2}; PanelId={3}; ButtonId={4}; Label={5}; CommandId={6}; Kind={7}; Target={8}' -f `
        $script:FlowCellHostLayerVersion, `
        $metadata.Surface, `
        $metadata.ProgramTabId, `
        $metadata.PanelId, `
        $metadata.ButtonId, `
        $metadata.Label, `
        $metadata.CommandId, `
        $metadata.Kind, `
        $(if ([string]$metadata.Kind -eq 'script') { [string]$metadata.ResolvedTarget } else { [string]$metadata.Target }))

    $timeoutSeconds = 120
    if ([string]$metadata.Kind -eq 'script') {
        $scriptFileName = [System.IO.Path]::GetFileName([string]$metadata.ResolvedTarget)
        if (-not [string]::IsNullOrWhiteSpace($scriptFileName)) {
            $normalizedScriptFileName = [string]$scriptFileName.ToLowerInvariant()
            if ($normalizedScriptFileName -like '*update_github*' -or $normalizedScriptFileName -like '*pull_github*') {
                $timeoutSeconds = 900
            }
        }
    }

    $result = Start-FlowCellBackendCommand -Envelope $envelope -Description ('command {0}' -f [string]$metadata.Label) -TimeoutSeconds $timeoutSeconds -Context @{
        Surface = [string]$metadata.Surface
        ButtonId = [string]$metadata.ButtonId
        ProgramTab = $ProgramTab
    }
    if (-not [bool]$result.Succeeded) {
        Write-UiLog ('Frontend command dispatch failed. CommandId={0}; Surface={1}; ButtonId={2}; Message={3}' -f `
            $metadata.CommandId, `
            $metadata.Surface, `
            $metadata.ButtonId, `
            [string]$result.Message)
    }
    return $result
}

function Test-FlowCellCompoundToolButton($Button) {
    if ($null -eq $Button) { return $false }
    $resolvedButton = Ensure-FlowCellButtonStateLayer $Button
    return (-not [string]::IsNullOrWhiteSpace([string](Get-FlowCellButtonCompoundToolId $resolvedButton)))
}

function Test-FlowCellAlignmentCompoundToolButton($Button) {
    if ($null -eq $Button) { return $false }
    $resolvedButton = Ensure-FlowCellButtonStateLayer $Button
    return ([string](Get-FlowCellButtonCompoundToolId $resolvedButton) -eq 'alignment')
}

function Test-FlowCellFlattenRevolveToolButton($Button) {
    if ($null -eq $Button) { return $false }
    if ([string]$Button.Kind -ne 'script') { return $false }
    $target = [string]$Button.Target
    if ([string]::IsNullOrWhiteSpace($target)) { return $false }
    return ([System.IO.Path]::GetFileName($target) -ieq 'util_flatten_revolve_tools.ps1')
}

function Test-FlowCellSmartAxisLockToolButton($Button) {
    if ($null -eq $Button) { return $false }
    if ([string]$Button.Kind -ne 'script') { return $false }
    $target = [string]$Button.Target
    if ([string]::IsNullOrWhiteSpace($target)) { return $false }
    $fileName = [string]([System.IO.Path]::GetFileName($target))
    if ([string]::IsNullOrWhiteSpace($fileName)) { return $false }
    if ($fileName -ieq 'util_smart_axis_lock.ps1') { return $true }
    return ($fileName -ieq 'util_smart_axis_base.ps1')
}

function Test-FlowCellSmartAxisStateButton($Button) {
    if ($null -eq $Button) { return $false }
    if ([string]$Button.Kind -ne 'script') { return $false }
    $target = [string]$Button.Target
    if ([string]::IsNullOrWhiteSpace($target)) { return $false }
    return (Test-FlowCellLegacySmartAxisStateTarget $target)
}

function Test-FlowCellMultiButtonToolButton($Button) {
    if ($null -eq $Button) { return $false }
    return ((Test-FlowCellCompoundToolButton $Button) -or (Test-FlowCellFlattenRevolveToolButton $Button))
}

function Get-FlowCellAlignmentToolStateEntry([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId, [switch]$Create) {
    if (-not $script:FlowCellState) { return $null }
    [void](Ensure-FlowCellAlignmentStateCollection -FlowCellState $script:FlowCellState)
    $existingEntries = if ($script:FlowCellState.PSObject.Properties['AlignmentToolStates']) { @($script:FlowCellState.AlignmentToolStates) } else { @() }
    $match = @(
        $existingEntries |
            Where-Object {
                [int]$_.ProgramTabId -eq [int]$ProgramTabId -and
                [string]$_.OwnerButtonId -eq [string]$OwnerButtonId
            } |
            Select-Object -First 1
    )
    if (@($match).Count -gt 0) {
        $entry = $match[0]
        if (-not [string]::IsNullOrWhiteSpace($PanelId) -and [string]$entry.PanelId -ne [string]$PanelId) {
            $entry.PanelId = [string]$PanelId
        }
        return $entry
    }

    if (-not $Create) { return $null }
    $newEntry = New-FlowCellAlignmentToolState -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId
    $script:FlowCellState.AlignmentToolStates = @($existingEntries + $newEntry)
    return $newEntry
}

function Get-FlowCellAlignmentToolStateSnapshot([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId) {
    $entry = Get-FlowCellAlignmentToolStateEntry -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId
    if ($entry) {
        return [pscustomobject]@{
            ProgramTabId = [int]$entry.ProgramTabId
            PanelId = [string]$entry.PanelId
            OwnerButtonId = [string]$entry.OwnerButtonId
            Modifiers = [pscustomobject]@{
                X = [string]$entry.Modifiers.X
                Y = [string]$entry.Modifiers.Y
                Z = [string]$entry.Modifiers.Z
            }
        }
    }

    return (New-FlowCellAlignmentToolState -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId)
}

function Get-FlowCellToolOptionStateEntry([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId, [string]$ToolId, [switch]$Create) {
    if (-not $script:FlowCellState) { return $null }
    [void](Ensure-FlowCellToolOptionStateCollection -FlowCellState $script:FlowCellState)
    $existingEntries = if ($script:FlowCellState.PSObject.Properties['ToolOptionStates']) { @($script:FlowCellState.ToolOptionStates) } else { @() }
    $match = @(
        $existingEntries |
            Where-Object {
                [int]$_.ProgramTabId -eq [int]$ProgramTabId -and
                [string]$_.OwnerButtonId -eq [string]$OwnerButtonId -and
                [string]$_.ToolId -eq [string]$ToolId
            } |
            Select-Object -First 1
    )
    if (@($match).Count -gt 0) {
        $entry = $match[0]
        if (-not [string]::IsNullOrWhiteSpace($PanelId) -and [string]$entry.PanelId -ne [string]$PanelId) {
            $entry.PanelId = [string]$PanelId
        }
        return $entry
    }

    if (-not $Create) { return $null }
    $newEntry = New-FlowCellToolOptionState -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId -ToolId $ToolId
    $script:FlowCellState.ToolOptionStates = @($existingEntries + $newEntry)
    return $newEntry
}

function Get-FlowCellToolOptionStateSnapshot([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId, [string]$ToolId) {
    $entry = Get-FlowCellToolOptionStateEntry -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId -ToolId $ToolId
    if ($entry) {
        return (ConvertTo-FlowCellToolOptionState $entry)
    }
    return (New-FlowCellToolOptionState -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId -ToolId $ToolId)
}

function Sync-FlowCellAlignmentToolSurfaces {
    if ($script:FlowCellMainRefresh -is [scriptblock]) {
        Invoke-FlowCellMainRefreshAsync
    }
    else {
        Refresh-FlowCellPanelWindows
        Refresh-FlowCellToolPopoutWindows
        Invoke-FlowCellMainRefreshAsync
    }
}

function Set-FlowCellAlignmentAxisModifier([int]$ProgramTabId, [string]$PanelId, [string]$OwnerButtonId, [string]$Axis, [string]$Modifier) {
    $axisName = [string]$Axis.ToUpperInvariant()
    $normalizedModifier = switch ([string]$Modifier.ToUpperInvariant()) {
        'SURFACE' { 'SURFACE' }
        'GEOCENTER' { 'GEOCENTER' }
        default { '' }
    }

    if ($axisName -notin @('X', 'Y', 'Z')) {
        throw "Unsupported alignment axis: $Axis"
    }

    $entry = Get-FlowCellAlignmentToolStateEntry -ProgramTabId $ProgramTabId -PanelId $PanelId -OwnerButtonId $OwnerButtonId -Create
    if (-not $entry.Modifiers) {
        $entry | Add-Member -MemberType NoteProperty -Name Modifiers -Value ([pscustomobject]@{ X = ''; Y = ''; Z = '' }) -Force
    }
    foreach ($requiredAxis in @('X', 'Y', 'Z')) {
        if (-not $entry.Modifiers.PSObject.Properties[$requiredAxis]) {
            $entry.Modifiers | Add-Member -MemberType NoteProperty -Name $requiredAxis -Value '' -Force
        }
    }

    $entry.Modifiers.$axisName = [string]$normalizedModifier
    Write-UiLog ('State alignment modifier updated. HostVersion={0}; ProgramTabId={1}; PanelId={2}; OwnerButtonId={3}; Axis={4}; Modifier={5}' -f `
        $script:FlowCellHostLayerVersion, `
        $ProgramTabId, `
        [string]$PanelId, `
        [string]$OwnerButtonId, `
        $axisName, `
        [string]$normalizedModifier)
    Save-FlowCellState
    Sync-FlowCellAlignmentToolSurfaces
    return $entry
}

function Get-FlowCellBlenderConfig {
    $configPath = Get-FlowCellBlenderConfigPath
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Blender config not found: $configPath"
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($null -eq $config.automation -or [string]::IsNullOrWhiteSpace([string]$config.automation.bridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }
    if ($null -eq $config.automation.responseTimeoutSeconds) {
        $config.automation | Add-Member -MemberType NoteProperty -Name responseTimeoutSeconds -Value 20
    }
    return $config
}

function Get-FlowCellBlenderAutomationStringValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$DefaultValue
    )

    if ($null -eq $Config -or $null -eq $Config.automation) {
        return $DefaultValue
    }

    $property = $Config.automation.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $DefaultValue
    }

    $value = [string]$property.Value
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }

    return $value.Trim()
}

function Get-FlowCellBlenderBridgeLayout {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [string]$BridgeFolder = ''
    )

    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        $BridgeFolder = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'bridgeFolder' -DefaultValue ''
    }
    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }

    try {
        $BridgeFolder = [System.IO.Path]::GetFullPath($BridgeFolder)
    }
    catch {
        $BridgeFolder = $BridgeFolder.Trim()
    }

    $bridgeFolderName = Split-Path -Path $BridgeFolder -Leaf
    if ([string]::IsNullOrWhiteSpace($bridgeFolderName)) {
        $bridgeFolderName = 'blender_bridge'
    }

    $addonRoot = Split-Path -Parent $BridgeFolder
    $customActionsFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'customActionsFileName' -DefaultValue 'flowcell_custom_actions.json'
    $addonActionsFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonActionsFileName' -DefaultValue 'flowcell_actions.py'
    $setupStatusFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'setupStatusFileName' -DefaultValue 'flowcell_bridge_setup.json'

    return [pscustomobject]@{
        BridgeFolder = $BridgeFolder
        BridgeFolderName = $bridgeFolderName
        AddonRoot = $addonRoot
        CustomActionsFileName = $customActionsFileName
        CustomRegistryPath = Join-Path $BridgeFolder $customActionsFileName
        AddonActionsFileName = $addonActionsFileName
        AddonActionsPath = Join-Path $addonRoot $addonActionsFileName
        SetupStatusFileName = $setupStatusFileName
        SetupStatusPath = Join-Path $BridgeFolder $setupStatusFileName
    }
}

function Get-FlowCellNormalizedPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    try {
        return [System.IO.Path]::GetFullPath($Path).TrimEnd('\').ToLowerInvariant()
    }
    catch {
        return $Path.Trim().TrimEnd('\').ToLowerInvariant()
    }
}

function Get-FlowCellWrapperAction([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) { return '' }
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { return '' }
    try {
        $raw = Get-Content -LiteralPath $ScriptPath -Raw
        if ($raw -match "-Action\s+'([^']+)'") {
            return [string]$matches[1]
        }
    }
    catch {
    }
    return ''
}

function Get-FlowCellSmartAxisLockCommandForScriptPath([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) { return '' }
    $fileName = [System.IO.Path]::GetFileName([string]$ScriptPath)
    switch ([string]$fileName.ToLowerInvariant()) {
        'util_smart_axis_base.ps1' { return 'baseline' }
        'util_smart_axis_x.ps1' { return 'cycle_x' }
        'util_smart_axis_y.ps1' { return 'cycle_y' }
        'util_smart_axis_z.ps1' { return 'cycle_z' }
        'util_smart_axis_live.ps1' { return 'toggle_live' }
        default { return '' }
    }
}

function Get-FlowCellScriptTopDescription([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) { return '' }
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { return '' }

    try {
        $lines = @(Get-Content -LiteralPath $ScriptPath -TotalCount 20)
        foreach ($line in $lines) {
            $trimmed = [string]$line
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            if ($trimmed -match "^(?:#|//|;|'|::|REM\s+)\s*Description\s*:\s*(.+)$") {
                return [string]$matches[1].Trim()
            }
            if ($trimmed -notmatch "^(#|//|;|'|::|REM\s+)") {
                break
            }
        }
    }
    catch {
    }

    return ''
}

function Resolve-FlowCellButtonTooltip($Button, $ProgramTab) {
    if ($Button -and $Button.PSObject.Properties['Tooltip'] -and -not [string]::IsNullOrWhiteSpace([string]$Button.Tooltip)) {
        return [string]$Button.Tooltip
    }

    $programKey = if ($ProgramTab) { Get-ProgramLabelKey ([string]$ProgramTab.Label) } else { '' }
    if ([string]$programKey -eq 'blender' -and $Button) {
        try {
            $config = Get-FlowCellBlenderConfig
            $targetPath = Get-FlowCellNormalizedPath ([string]$Button.Target)
            foreach ($configButton in @($config.buttons)) {
                if (-not ($configButton.PSObject.Properties['tooltip']) -or [string]::IsNullOrWhiteSpace([string]$configButton.tooltip)) { continue }
                if ($configButton.PSObject.Properties['scriptPath']) {
                    $configPath = Get-FlowCellNormalizedPath ([string]$configButton.scriptPath)
                    if (-not [string]::IsNullOrWhiteSpace($configPath) -and $configPath -eq $targetPath) {
                        return [string]$configButton.tooltip
                    }
                }
            }

            $wrapperAction = Get-FlowCellWrapperAction -ScriptPath ([string]$Button.Target)
            if (-not [string]::IsNullOrWhiteSpace($wrapperAction)) {
                foreach ($configButton in @($config.buttons)) {
                    if (-not ($configButton.PSObject.Properties['tooltip']) -or [string]::IsNullOrWhiteSpace([string]$configButton.tooltip)) { continue }
                    if ($configButton.PSObject.Properties['action'] -and [string]$configButton.action -eq $wrapperAction) {
                        return [string]$configButton.tooltip
                    }
                }
            }
        }
        catch {
            Write-UiLog ('Blender tooltip resolve failed: {0}' -f $_.Exception.Message)
        }
    }

    if ($Button -and [string]$Button.Kind -eq 'macro') {
        $action = @($script:Actions | Where-Object { [string]$_.Id -eq [string]$Button.Target } | Select-Object -First 1)
        if (@($action).Count -gt 0 -and $action[0].PSObject.Properties['Tooltip'] -and -not [string]::IsNullOrWhiteSpace([string]$action[0].Tooltip)) {
            return [string]$action[0].Tooltip
        }
    }

    if ($Button -and [string]$Button.Kind -eq 'script' -and -not [string]::IsNullOrWhiteSpace([string]$Button.Target)) {
        $topDescription = Get-FlowCellScriptTopDescription -ScriptPath ([string]$Button.Target)
        if (-not [string]::IsNullOrWhiteSpace($topDescription)) {
            return $topDescription
        }
    }

    $label = if ($Button -and -not [string]::IsNullOrWhiteSpace([string]$Button.Label)) { [string]$Button.Label } else { 'this tool' }
    if ($Button -and [string]$Button.Kind -eq 'script' -and -not [string]::IsNullOrWhiteSpace([string]$Button.Target)) {
        $fileName = [System.IO.Path]::GetFileName([string]$Button.Target)
        return ('Run {0} from {1}.' -f $label, $fileName)
    }
    return ('Run {0}.' -f $label)
}

function Get-FlowCellTargetBlenderProcessId {
    $blenderProcesses = @(Get-Process blender -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if (@($blenderProcesses).Count -eq 0) {
        throw 'Blender is not running. Open Blender with the addon enabled first.'
    }

    $foregroundProcessId = [CodexWin32]::GetForegroundProcessId()
    if ($foregroundProcessId -gt 0) {
        $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
        if ($foregroundProcess -and [string]$foregroundProcess.ProcessName -ieq 'blender') {
            return [int]$foregroundProcessId
        }
    }

    if (@($blenderProcesses).Count -eq 1) {
        return [int]$blenderProcesses[0].Id
    }

    $latestBlender = @($blenderProcesses | Sort-Object StartTime -Descending | Select-Object -First 1)
    if (@($latestBlender).Count -gt 0) {
        return [int]$latestBlender[0].Id
    }

    throw 'Could not determine which Blender window is active.'
}

function Get-FlowCellBridgeFolderCandidates([object]$Config, [int]$TargetBlenderProcessId) {
    $candidates = New-Object System.Collections.Generic.List[string]
    $configuredBridgeRoot = [string]$Config.automation.bridgeFolder
    $bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $Config -BridgeFolder $configuredBridgeRoot
    $bridgeFolderName = [string]$bridgeLayout.BridgeFolderName

    $addBridgeRootCandidates = {
        param([string]$BridgeRoot)
        if ([string]::IsNullOrWhiteSpace($BridgeRoot)) { return }
        $primaryBridgeFolder = Join-Path $BridgeRoot ([string]$TargetBlenderProcessId)
        if (-not $candidates.Contains($primaryBridgeFolder)) {
            [void]$candidates.Add($primaryBridgeFolder)
        }

        $legacyResponsePath = Join-Path $BridgeRoot 'response.json'
        $legacyRequestPath = Join-Path $BridgeRoot 'request.json'
        if (
            $BridgeRoot -ne $primaryBridgeFolder -and
            (
                (Test-Path -LiteralPath $legacyResponsePath -PathType Leaf) -or
                (Test-Path -LiteralPath $legacyRequestPath -PathType Leaf)
            ) -and
            -not $candidates.Contains($BridgeRoot)
        ) {
            [void]$candidates.Add($BridgeRoot)
        }
    }

    & $addBridgeRootCandidates $configuredBridgeRoot

    $blenderAppDataRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
        Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $fallbackBridgeRoot = Join-Path $_.FullName ('scripts\addons\{0}' -f $bridgeFolderName)
                if (
                    (Test-Path -LiteralPath $fallbackBridgeRoot -PathType Container) -and
                    ((Get-FlowCellNormalizedPath $fallbackBridgeRoot) -ne (Get-FlowCellNormalizedPath $configuredBridgeRoot))
                ) {
                    & $addBridgeRootCandidates $fallbackBridgeRoot
                }
            }
    }

    return @($candidates)
}

function Wait-FlowCellBridgeResponse([string]$ResponsePath, [string]$RequestId, [datetime]$Deadline) {
    $dispatcher = if ($script:Window -and $script:Window.Dispatcher) {
        $script:Window.Dispatcher
    }
    else {
        [System.Windows.Threading.Dispatcher]::CurrentDispatcher
    }
    while ((Get-Date) -lt $Deadline) {
        if (Test-Path -LiteralPath $ResponsePath -PathType Leaf) {
            try {
                $response = Get-Content -LiteralPath $ResponsePath -Raw | ConvertFrom-Json
                if ([string]$response.id -eq $RequestId) {
                    return $response
                }
            }
            catch {
            }
        }

        Start-Sleep -Milliseconds 25
        try {
            $frame = New-Object System.Windows.Threading.DispatcherFrame
            $callback = [System.Windows.Threading.DispatcherOperationCallback]{
                param($state)
                $state.Continue = $false
                return $null
            }
            [void]$dispatcher.BeginInvoke([System.Windows.Threading.DispatcherPriority]::Background, $callback, $frame)
            [System.Windows.Threading.Dispatcher]::PushFrame($frame)
        }
        catch {
        }
    }

    return $null
}

function Invoke-FlowCellBlenderBridgeRequest([string]$Action, [hashtable]$Data = @{}, [int]$TimeoutSeconds = 0) {
    $config = Get-FlowCellBlenderConfig
    $targetBlenderProcessId = Get-FlowCellTargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString()
    if ([int]$TimeoutSeconds -gt 0) {
        $timeoutSeconds = [Math]::Max([int]$TimeoutSeconds, 1)
    }
    else {
        $timeoutSeconds = [Math]::Max([int]$config.automation.responseTimeoutSeconds, 1)
    }
    $bridgeFolders = @(Get-FlowCellBridgeFolderCandidates -Config $config -TargetBlenderProcessId $targetBlenderProcessId)

    $payload = [pscustomobject][ordered]@{
        id        = $requestId
        action    = $Action
        data      = $Data
        requested = (Get-Date).ToString('o')
    }

    $json = $payload | ConvertTo-Json -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $finalDeadline = (Get-Date).AddSeconds($timeoutSeconds)
    $firstAttemptSeconds = if (@($bridgeFolders).Count -gt 1) {
        [Math]::Min([Math]::Max([int][Math]::Ceiling($timeoutSeconds / 2.0), 2), [Math]::Max($timeoutSeconds - 1, 2))
    }
    else {
        $timeoutSeconds
    }

    for ($index = 0; $index -lt @($bridgeFolders).Count; $index++) {
        $bridgeFolder = [string]$bridgeFolders[$index]
        $requestPath = Join-Path $bridgeFolder 'request.json'
        $responsePath = Join-Path $bridgeFolder 'response.json'

        New-Item -ItemType Directory -Path $bridgeFolder -Force | Out-Null
        [System.IO.File]::WriteAllText($requestPath, $json, $utf8NoBom)

        $attemptDeadline = if ($index -lt (@($bridgeFolders).Count - 1)) {
            (Get-Date).AddSeconds($firstAttemptSeconds)
        }
        else {
            $finalDeadline
        }
        if ($attemptDeadline -gt $finalDeadline) {
            $attemptDeadline = $finalDeadline
        }

        $response = Wait-FlowCellBridgeResponse -ResponsePath $responsePath -RequestId $requestId -Deadline $attemptDeadline
        if ($null -eq $response) {
            continue
        }

        if ([string]$response.status -eq 'ok') {
            return $response
        }

        if ($response.PSObject.Properties['message']) {
            throw ([string]$response.message)
        }
        throw 'Blender returned an error.'
    }

    throw ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): {1}" -f $targetBlenderProcessId, ($bridgeFolders -join '; '))
}

function Start-FlowCellBlenderBridgeRequestAsync {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Action,
        [hashtable]$Data = @{},
        [int]$TimeoutSeconds = 0,
        [Parameter(Mandatory = $true)]
        [scriptblock]$OnSuccess,
        [Parameter(Mandatory = $true)]
        [scriptblock]$OnError
    )

    $config = Get-FlowCellBlenderConfig
    $targetBlenderProcessId = Get-FlowCellTargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString()
    if ([int]$TimeoutSeconds -gt 0) {
        $timeoutSeconds = [Math]::Max([int]$TimeoutSeconds, 1)
    }
    else {
        $timeoutSeconds = [Math]::Max([int]$config.automation.responseTimeoutSeconds, 1)
    }
    $bridgeFolders = @(Get-FlowCellBridgeFolderCandidates -Config $config -TargetBlenderProcessId $targetBlenderProcessId)
    if (@($bridgeFolders).Count -eq 0) {
        throw ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): [none]" -f $targetBlenderProcessId)
    }

    $payload = [pscustomobject][ordered]@{
        id        = $requestId
        action    = $Action
        data      = $Data
        requested = (Get-Date).ToString('o')
    }
    $json = $payload | ConvertTo-Json -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $finalDeadline = (Get-Date).AddSeconds($timeoutSeconds)
    $firstAttemptSeconds = if (@($bridgeFolders).Count -gt 1) {
        [Math]::Min([Math]::Max([int][Math]::Ceiling($timeoutSeconds / 2.0), 2), [Math]::Max($timeoutSeconds - 1, 2))
    }
    else {
        $timeoutSeconds
    }

    $requestState = [pscustomobject]@{
        RequestId = [string]$requestId
        TargetBlenderProcessId = [int]$targetBlenderProcessId
        BridgeFolders = @($bridgeFolders)
        CandidateIndex = -1
        ResponsePath = ''
        FinalDeadline = $finalDeadline
        AttemptDeadline = $finalDeadline
        Timer = $null
        Completed = $false
    }

    $finishSuccess = {
        param($response)
        if ([bool]$requestState.Completed) { return }
        $requestState.Completed = $true
        if ($requestState.Timer) {
            $requestState.Timer.Stop()
        }
        if ($OnSuccess -is [scriptblock]) {
            [void]$OnSuccess.Invoke($response)
        }
    }.GetNewClosure()

    $finishError = {
        param([string]$message)
        if ([bool]$requestState.Completed) { return }
        $requestState.Completed = $true
        if ($requestState.Timer) {
            $requestState.Timer.Stop()
        }
        if ($OnError -is [scriptblock]) {
            [void]$OnError.Invoke([string]$message)
        }
    }.GetNewClosure()

    $startAttempt = {
        $requestState.CandidateIndex += 1
        if ([int]$requestState.CandidateIndex -ge @($requestState.BridgeFolders).Count) {
            return $false
        }

        $bridgeFolder = [string]$requestState.BridgeFolders[[int]$requestState.CandidateIndex]
        $requestPath = Join-Path $bridgeFolder 'request.json'
        $requestState.ResponsePath = Join-Path $bridgeFolder 'response.json'
        New-Item -ItemType Directory -Path $bridgeFolder -Force | Out-Null
        [System.IO.File]::WriteAllText($requestPath, $json, $utf8NoBom)

        $attemptDeadline = if ([int]$requestState.CandidateIndex -lt (@($requestState.BridgeFolders).Count - 1)) {
            (Get-Date).AddSeconds($firstAttemptSeconds)
        }
        else {
            $requestState.FinalDeadline
        }
        if ($attemptDeadline -gt $requestState.FinalDeadline) {
            $attemptDeadline = $requestState.FinalDeadline
        }
        $requestState.AttemptDeadline = $attemptDeadline
        return $true
    }.GetNewClosure()

    if (-not [bool]$startAttempt.InvokeReturnAsIs()) {
        throw ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): {1}" -f $targetBlenderProcessId, ($bridgeFolders -join '; '))
    }

    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(35)
    $requestState.Timer = $timer
    $timeoutMessage = "Timed out waiting for Blender. Target PID $targetBlenderProcessId. Checked bridge path(s): $($bridgeFolders -join '; ')"
    $timer.Add_Tick({
        if ([bool]$requestState.Completed) {
            $timer.Stop()
            return
        }

        if ((Get-Date) -ge $requestState.FinalDeadline) {
            [void]$finishError.Invoke($timeoutMessage)
            return
        }

        if (-not [string]::IsNullOrWhiteSpace([string]$requestState.ResponsePath) -and (Test-Path -LiteralPath $requestState.ResponsePath -PathType Leaf)) {
            try {
                $response = Get-Content -LiteralPath $requestState.ResponsePath -Raw | ConvertFrom-Json
                if ([string]$response.id -eq [string]$requestState.RequestId) {
                    if ([string]$response.status -eq 'ok') {
                        [void]$finishSuccess.Invoke($response)
                        return
                    }

                    $message = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Blender returned an error.' }
                    [void]$finishError.Invoke($message)
                    return
                }
            }
            catch {
            }
        }

        if ((Get-Date) -ge $requestState.AttemptDeadline) {
            if (-not [bool]$startAttempt.InvokeReturnAsIs()) {
                [void]$finishError.Invoke($timeoutMessage)
            }
        }
    }.GetNewClosure())
    $timer.Start()
    return $requestState
}

function Convert-FlowCellSmartAxisLockResponseToResult($Response) {
    $statusText = if ($Response.PSObject.Properties['message']) { [string]$Response.message } else { 'Smart Axis Lock complete.' }
    if ([string]::IsNullOrWhiteSpace($statusText)) {
        $statusText = 'Smart Axis Lock complete.'
    }
    $modes = @{ X = 'NONE'; Y = 'NONE'; Z = 'NONE' }
    if ($Response.PSObject.Properties['modes'] -and $Response.modes) {
        foreach ($axis in @('X', 'Y', 'Z')) {
            if ($Response.modes.PSObject.Properties[$axis]) {
                $modes[$axis] = [string]$Response.modes.$axis
            }
        }
    }

    return [pscustomobject]@{
        Succeeded = $true
        Message = $statusText
        Modes = $modes
        LiveEnabled = [bool]$(if ($Response.PSObject.Properties['live_enabled']) { $Response.live_enabled } else { $false })
        RunnerActive = [bool]$(if ($Response.PSObject.Properties['runner_active']) { $Response.runner_active } else { $false })
        Selected = [int]$(if ($Response.PSObject.Properties['selected']) { $Response.selected } else { 0 })
        EnabledToolCount = [int]$(if ($Response.PSObject.Properties['enabled_tool_count']) { $Response.enabled_tool_count } else { 0 })
        Registered = [bool]$(if ($Response.PSObject.Properties['registered']) { $Response.registered } else { $false })
    }
}

function New-FlowCellSmartAxisLockFailedResult([string]$Message) {
    $resolvedMessage = [string]$Message
    if ($resolvedMessage -match 'Unsupported action:\s*smart_axis_lock') {
        $resolvedMessage = 'Reload the FlowCell Blender add-on or restart Blender once.'
    }
    return [pscustomobject]@{
        Succeeded = $false
        Message = $resolvedMessage
        Modes = @{ X = 'NONE'; Y = 'NONE'; Z = 'NONE' }
        LiveEnabled = $false
        RunnerActive = $false
        Selected = 0
        EnabledToolCount = 0
        Registered = $false
    }
}

function ConvertTo-FlowCellSmartAxisToolOptionValues($StateSource) {
    $modeSource = if ($StateSource -and $StateSource.PSObject.Properties['Modes']) { $StateSource.Modes } else { $null }
    return [pscustomobject]@{
        Modes = [pscustomobject]@{
            X = [string]$(if ($modeSource -and $modeSource.PSObject.Properties['X']) { $modeSource.X } else { 'NONE' })
            Y = [string]$(if ($modeSource -and $modeSource.PSObject.Properties['Y']) { $modeSource.Y } else { 'NONE' })
            Z = [string]$(if ($modeSource -and $modeSource.PSObject.Properties['Z']) { $modeSource.Z } else { 'NONE' })
        }
        LiveEnabled = [bool]$(if ($StateSource -and $StateSource.PSObject.Properties['LiveEnabled']) { $StateSource.LiveEnabled } else { $false })
        RunnerActive = [bool]$(if ($StateSource -and $StateSource.PSObject.Properties['RunnerActive']) { $StateSource.RunnerActive } else { $false })
        Selected = [int]$(if ($StateSource -and $StateSource.PSObject.Properties['Selected']) { $StateSource.Selected } else { 0 })
        EnabledToolCount = [int]$(if ($StateSource -and $StateSource.PSObject.Properties['EnabledToolCount']) { $StateSource.EnabledToolCount } else { 0 })
        Registered = [bool]$(if ($StateSource -and $StateSource.PSObject.Properties['Registered']) { $StateSource.Registered } else { $false })
        LastMessage = [string]$(if ($StateSource -and $StateSource.PSObject.Properties['Message']) { $StateSource.Message } elseif ($StateSource -and $StateSource.PSObject.Properties['LastMessage']) { $StateSource.LastMessage } else { 'Smart Axis Lock ready.' })
    }
}

function ConvertFrom-FlowCellAlignmentToolIntent([string]$Intent) {
    $resolvedIntent = [string]$Intent
    if ($resolvedIntent -match '^alignment\.(x|y|z)\.(min|center|max)$') {
        return [pscustomobject]@{
            Valid = $true
            Intent = $resolvedIntent
            ActionType = 'align_axis'
            Axis = [string]$matches[1].ToUpperInvariant()
            Mode = [string]$matches[2].ToUpperInvariant()
            Modifier = ''
        }
    }
    if ($resolvedIntent -match '^alignment\.(x|y|z)\.(surface|geo)$') {
        return [pscustomobject]@{
            Valid = $true
            Intent = $resolvedIntent
            ActionType = 'toggle_modifier'
            Axis = [string]$matches[1].ToUpperInvariant()
            Mode = ''
            Modifier = $(if ([string]$matches[2].ToUpperInvariant() -eq 'SURFACE') { 'SURFACE' } else { 'GEOCENTER' })
        }
    }
    if ($resolvedIntent -eq 'alignment.center_everything') {
        return [pscustomobject]@{
            Valid = $true
            Intent = $resolvedIntent
            ActionType = 'center_all'
            Axis = ''
            Mode = ''
            Modifier = ''
        }
    }

    return [pscustomobject]@{
        Valid = $false
        Intent = $resolvedIntent
        ActionType = ''
        Axis = ''
        Mode = ''
        Modifier = ''
    }
}

function Invoke-FlowCellAlignmentToolCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string]$Axis = '',
        [string]$Mode = '',
        [string]$Modifier = ''
    )

    try {
        Set-ActionStatus ('Running alignment: {0}...' -f $Command)
        $data = @{
            command = [string]$Command
        }
        if ([string]$Command -eq 'align_axis') {
            $data.axis = [string]$Axis
            $data.mode = [string]$Mode
            $data.modifier = if ([string]::IsNullOrWhiteSpace($Modifier)) { '' } else { [string]$Modifier }
        }

        $response = Invoke-FlowCellBlenderBridgeRequest -Action 'alignment_tools' -Data $data
        $statusText = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Alignment complete.' }
        if ([string]::IsNullOrWhiteSpace($statusText)) {
            $statusText = 'Alignment complete.'
        }
        Set-Content -LiteralPath $script:LastActionStatusPath -Value $statusText -Encoding UTF8
        Set-ActionStatus $statusText
        return [pscustomobject]@{
            Succeeded = $true
            Message = $statusText
        }
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            Message = $_.Exception.Message
        }
    }
}

function Invoke-FlowCellAlignmentToolAction($Button, $ProgramTab) {
    if ($null -eq $Button -or $null -eq $ProgramTab) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'Alignment tool context is unavailable.'
        }
    }

    $intent = ConvertFrom-FlowCellAlignmentToolIntent -Intent ([string]$(if ($Button.PSObject.Properties['Intent']) { $Button.Intent } else { $Button.Target }))
    if (-not [bool]$intent.Valid) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = ('Unsupported alignment action: {0}' -f [string]$intent.Intent)
        }
    }

    $ownerButtonId = [string]$(if ($Button.PSObject.Properties['OwnerButtonId']) { $Button.OwnerButtonId } else { '' })
    $panelId = [string]$(if ($Button.PSObject.Properties['OwnerPanelId']) { $Button.OwnerPanelId } elseif ($Button.PSObject.Properties['PanelId']) { $Button.PanelId } else { '' })
    if ([string]::IsNullOrWhiteSpace($ownerButtonId)) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'Alignment owner button is missing.'
        }
    }

    Write-UiLog ('Functional Host alignment action. HostVersion={0}; ProgramTabId={1}; PanelId={2}; OwnerButtonId={3}; Intent={4}; ActionType={5}; Axis={6}; Mode={7}; Modifier={8}' -f `
        $script:FlowCellHostLayerVersion, `
        [int]$ProgramTab.Id, `
        [string]$panelId, `
        $ownerButtonId, `
        [string]$intent.Intent, `
        [string]$intent.ActionType, `
        [string]$intent.Axis, `
        [string]$intent.Mode, `
        [string]$intent.Modifier)

    switch ([string]$intent.ActionType) {
        'toggle_modifier' {
            $snapshot = Get-FlowCellAlignmentToolStateSnapshot -ProgramTabId ([int]$ProgramTab.Id) -PanelId $panelId -OwnerButtonId $ownerButtonId
            $currentModifier = [string]$snapshot.Modifiers.($intent.Axis)
            $nextModifier = if ([string]$currentModifier -eq [string]$intent.Modifier) { '' } else { [string]$intent.Modifier }
            [void](Set-FlowCellAlignmentAxisModifier -ProgramTabId ([int]$ProgramTab.Id) -PanelId $panelId -OwnerButtonId $ownerButtonId -Axis $intent.Axis -Modifier $nextModifier)
            $statusText = if ([string]::IsNullOrWhiteSpace($nextModifier)) {
                ('Alignment {0} modifier cleared.' -f [string]$intent.Axis)
            }
            else {
                ('Alignment {0} modifier set to {1}.' -f [string]$intent.Axis, $(if ([string]$nextModifier -eq 'GEOCENTER') { 'origin' } else { [string]$nextModifier.ToLowerInvariant() }))
            }
            Set-Content -LiteralPath $script:LastActionStatusPath -Value $statusText -Encoding UTF8
            Set-ActionStatus $statusText
            Write-UiLog ('Functional Host alignment action handled. HostVersion={0}; ProgramTabId={1}; PanelId={2}; OwnerButtonId={3}; Intent={4}; Message={5}' -f `
                $script:FlowCellHostLayerVersion, `
                [int]$ProgramTab.Id, `
                [string]$panelId, `
                $ownerButtonId, `
                [string]$intent.Intent, `
                $statusText)
            return [pscustomobject]@{
                Succeeded = $true
                Message = $statusText
            }
        }
        'align_axis' {
            $snapshot = Get-FlowCellAlignmentToolStateSnapshot -ProgramTabId ([int]$ProgramTab.Id) -PanelId $panelId -OwnerButtonId $ownerButtonId
            return (Invoke-FlowCellAlignmentToolCommand -Command 'align_axis' -Axis ([string]$intent.Axis) -Mode ([string]$intent.Mode) -Modifier ([string]$snapshot.Modifiers.($intent.Axis)))
        }
        'center_all' {
            return (Invoke-FlowCellAlignmentToolCommand -Command 'center_all')
        }
        default {
            return [pscustomobject]@{
                Succeeded = $false
                Message = ('Unsupported alignment action type: {0}' -f [string]$intent.ActionType)
            }
        }
    }
}

function Invoke-FlowCellToolAction($Button, $ProgramTab) {
    if ($null -eq $Button -or $null -eq $ProgramTab) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = 'Nothing is selected.'
        }
    }

    switch ([string]$(if ($Button.PSObject.Properties['Tool']) { $Button.Tool } else { '' })) {
        'alignment' {
            return (Invoke-FlowCellAlignmentToolAction -Button $Button -ProgramTab $ProgramTab)
        }
        default {
            return [pscustomobject]@{
                Succeeded = $false
                Message = ('Unknown FlowCell tool action: {0}' -f [string]$(if ($Button.PSObject.Properties['Tool']) { $Button.Tool } else { '' }))
            }
        }
    }
}

function Get-FlowCellAlignmentModifierStyleGroupId([string]$CurrentModifier, [string]$ButtonModifier) {
    if ([string]$CurrentModifier -eq [string]$ButtonModifier) {
        return 'alignment_modifier_active'
    }
    return ''
}

function New-FlowCellAlignmentActionButtonState {
    param(
        [Parameter(Mandatory = $true)]
        [object]$OwnerButton,
        [Parameter(Mandatory = $true)]
        [object]$ProgramTab,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [string]$Intent,
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [string]$Tooltip = '',
        [string]$StyleGroupId = ''
    )

    $resolvedOwnerButton = Ensure-FlowCellButtonStateLayer $OwnerButton
    return [pscustomobject]@{
        Id = ('tool_alignment_{0}_{1}' -f [string]$resolvedOwnerButton.Id, ([string]$Intent -replace '[^a-zA-Z0-9]+', '_'))
        Kind = 'tool_action'
        command_id = 'flowcell.run_tool_action'
        Label = [string]$Label
        Target = [string]$Intent
        Tooltip = [string]$Tooltip
        Shortcut = ''
        BindingId = 0
        style_group_id = [string]$StyleGroupId
        Tool = 'alignment'
        Intent = [string]$Intent
        OwnerButtonId = [string]$resolvedOwnerButton.Id
        OwnerPanelId = [string]$PanelId
        OwnerProgramTabId = [int]$ProgramTab.Id
        compound_tool_id = 'alignment'
    }
}

function New-FlowCellAlignmentActionButtonControl {
    param(
        [Parameter(Mandatory = $true)]
        [object]$ActionButton,
        [Parameter(Mandatory = $true)]
        [object]$ProgramTab,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [string]$Surface,
        [double]$FontSize = 12
    )

    $buttonTag = [pscustomobject]@{
        Button = $ActionButton
        ProgramTab = $ProgramTab
        PanelId = [string]$PanelId
    }
    $buttonControl = New-FlowCellHostButtonControl `
        -Label ([string]$ActionButton.Label) `
        -Tag $buttonTag `
        -Tooltip ([string]$ActionButton.Tooltip) `
        -Width ([double]::NaN) `
        -Height ([double]::NaN) `
        -Padding ('{0},{1}' -f [Math]::Max([int][Math]::Round($FontSize * 0.55), 6), [Math]::Max([int][Math]::Round($FontSize * 0.24), 2)) `
        -FontSize ([double][Math]::Max($FontSize, 9.0)) `
        -HorizontalAlignment 'Stretch' `
        -VerticalAlignment 'Stretch' `
        -OnClick ({
            param($sender, $eventArgs)
            $tag = $sender.Tag
            $result = Invoke-FlowCellButtonAction -Button $tag.Button -ProgramTab $tag.ProgramTab -PanelId ([string]$tag.PanelId) -Surface $Surface
            if (-not [bool]$result.Succeeded) {
                Set-ActionStatus ([string]$result.Message)
            }
        })
    $buttonControl.MinHeight = [Math]::Max([double][Math]::Round($FontSize * 2.25, 0), 26.0)
    $buttonControl.MinWidth = [Math]::Max([double][Math]::Round($FontSize * 3.6, 0), 46.0)
    $buttonControl.FontWeight = 'SemiBold'

    $visualState = New-FlowCellHostVisualState `
        -Label ([string]$ActionButton.Label) `
        -IsSelected $false `
        -IsEnabled $true `
        -StyleGroupId ([string](Get-FlowCellButtonStyleGroupId $ActionButton)) `
        -AccentColor '#FF74C4FF'
    return (New-FlowCellHostVisualSkinSurface -Content $buttonControl -VisualState $visualState -Mode 'CompoundButton')
}

function New-FlowCellAlignmentToolControl {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Button,
        [Parameter(Mandatory = $true)]
        [object]$ProgramTab,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [double]$Width = 292,
        [double]$FontSize = 12,
        [string]$Surface = 'Unknown'
    )

    $ownerButton = Ensure-FlowCellButtonStateLayer $Button
    $stateSnapshot = Get-FlowCellAlignmentToolStateSnapshot -ProgramTabId ([int]$ProgramTab.Id) -PanelId $PanelId -OwnerButtonId ([string]$ownerButton.Id)
    $resolvedWidth = if ([double]$Width -gt 0) { [double]$Width } else { [double]::NaN }
    $resolvedFontSize = [double][Math]::Max($FontSize, 10.0)

    $shell = New-Object System.Windows.Controls.Grid
    $shell.Margin = '0'
    $shell.HorizontalAlignment = 'Stretch'
    $shell.VerticalAlignment = 'Stretch'
    $shell.Width = [double]::NaN
    $shell.MinWidth = [Math]::Max([double][Math]::Round($resolvedFontSize * 17.0, 0), $(if ([double]::IsNaN($resolvedWidth)) { 250.0 } else { $resolvedWidth }))

    for ($rowIndex = 0; $rowIndex -lt 4; $rowIndex++) {
        $rowDefinition = New-Object System.Windows.Controls.RowDefinition
        $rowDefinition.Height = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
        [void]$shell.RowDefinitions.Add($rowDefinition)
    }

    $axisColumn = New-Object System.Windows.Controls.ColumnDefinition
    $axisColumn.Width = New-Object System.Windows.GridLength([Math]::Max($resolvedFontSize * 1.55, 24.0))
    [void]$shell.ColumnDefinitions.Add($axisColumn)
    for ($columnIndex = 0; $columnIndex -lt 5; $columnIndex++) {
        $columnDefinition = New-Object System.Windows.Controls.ColumnDefinition
        $columnDefinition.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
        [void]$shell.ColumnDefinitions.Add($columnDefinition)
    }

    $axisRows = @('Z', 'Y', 'X')
    foreach ($rowIndex in 0..2) {
        $axis = [string]$axisRows[$rowIndex]
        $axisLabel = New-Object System.Windows.Controls.TextBlock
        $axisLabel.Text = $axis
        $axisLabel.FontSize = $resolvedFontSize
        $axisLabel.FontWeight = 'SemiBold'
        $axisLabel.HorizontalAlignment = 'Center'
        $axisLabel.VerticalAlignment = 'Center'
        $axisLabel.Margin = '0,0,6,0'
        [System.Windows.Controls.Grid]::SetRow($axisLabel, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($axisLabel, 0)
        [void]$shell.Children.Add($axisLabel)

        $currentModifier = [string]$stateSnapshot.Modifiers.$axis
        $buttons = @()
        $buttons += New-FlowCellAlignmentActionButtonState -OwnerButton $ownerButton -ProgramTab $ProgramTab -PanelId $PanelId -Intent ('alignment.{0}.min' -f $axis.ToLowerInvariant()) -Label 'Min' -Tooltip ('Align the moved object to the active reference object''s {0} minimum.' -f $axis)
        $buttons += New-FlowCellAlignmentActionButtonState -OwnerButton $ownerButton -ProgramTab $ProgramTab -PanelId $PanelId -Intent ('alignment.{0}.center' -f $axis.ToLowerInvariant()) -Label 'Center' -Tooltip ('Align the moved object to the active reference object''s {0} center.' -f $axis)
        $buttons += New-FlowCellAlignmentActionButtonState -OwnerButton $ownerButton -ProgramTab $ProgramTab -PanelId $PanelId -Intent ('alignment.{0}.max' -f $axis.ToLowerInvariant()) -Label 'Max' -Tooltip ('Align the moved object to the active reference object''s {0} maximum.' -f $axis)
        $buttons += New-FlowCellAlignmentActionButtonState -OwnerButton $ownerButton -ProgramTab $ProgramTab -PanelId $PanelId -Intent ('alignment.{0}.surface' -f $axis.ToLowerInvariant()) -Label 'Surface' -Tooltip ('Toggle surface alignment for the {0} axis.' -f $axis) -StyleGroupId (Get-FlowCellAlignmentModifierStyleGroupId -CurrentModifier $currentModifier -ButtonModifier 'SURFACE')
        $buttons += New-FlowCellAlignmentActionButtonState -OwnerButton $ownerButton -ProgramTab $ProgramTab -PanelId $PanelId -Intent ('alignment.{0}.geo' -f $axis.ToLowerInvariant()) -Label 'Origin' -Tooltip ('Toggle origin alignment for the {0} axis.' -f $axis) -StyleGroupId (Get-FlowCellAlignmentModifierStyleGroupId -CurrentModifier $currentModifier -ButtonModifier 'GEOCENTER')

        for ($buttonIndex = 0; $buttonIndex -lt $buttons.Count; $buttonIndex++) {
            $buttonElement = New-FlowCellAlignmentActionButtonControl -ActionButton $buttons[$buttonIndex] -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface -FontSize $resolvedFontSize
            $buttonElement.Margin = if ($buttonIndex -lt ($buttons.Count - 1)) { '0,0,6,6' } else { '0,0,0,6' }
            [System.Windows.Controls.Grid]::SetRow($buttonElement, $rowIndex)
            [System.Windows.Controls.Grid]::SetColumn($buttonElement, $buttonIndex + 1)
            [void]$shell.Children.Add($buttonElement)
        }
    }

    $centerButton = New-FlowCellAlignmentActionButtonState `
        -OwnerButton $ownerButton `
        -ProgramTab $ProgramTab `
        -PanelId $PanelId `
        -Intent 'alignment.center_everything' `
        -Label 'Center Everything' `
        -Tooltip 'Center all moved objects to the active reference object.'
    $centerElement = New-FlowCellAlignmentActionButtonControl -ActionButton $centerButton -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface -FontSize $resolvedFontSize
    [System.Windows.Controls.Grid]::SetRow($centerElement, 3)
    [System.Windows.Controls.Grid]::SetColumn($centerElement, 0)
    [System.Windows.Controls.Grid]::SetColumnSpan($centerElement, 6)
    [void]$shell.Children.Add($centerElement)

    return $shell
}

function New-FlowCellCompoundToolControl {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Button,
        [Parameter(Mandatory = $true)]
        [object]$ProgramTab,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [double]$Width = 292,
        [double]$FontSize = 12,
        [string]$Surface = 'Unknown'
    )

    $resolvedButton = Ensure-FlowCellButtonStateLayer $Button
    switch ([string](Get-FlowCellButtonCompoundToolId $resolvedButton)) {
        'alignment' {
            return (New-FlowCellAlignmentToolControl -Button $resolvedButton -ProgramTab $ProgramTab -PanelId $PanelId -Width $Width -FontSize $FontSize -Surface $Surface)
        }
        default {
            return $null
        }
    }
}

function New-FlowCellAlignmentMiniButton([string]$Text, [double]$Width, [double]$Height, [double]$FontSize) {
    $button = New-FlowCellHostButtonControl `
        -Label ([string]$Text) `
        -Tag ([pscustomobject]@{ Host = 'EmbeddedMiniButton' }) `
        -Tooltip '' `
        -Width ([double]$Width) `
        -Height ([double]$Height) `
        -Padding '2,0' `
        -FontSize ([double]$FontSize) `
        -HorizontalAlignment 'Left' `
        -VerticalAlignment 'Top'
    $button.MinWidth = 0
    $button.Margin = '0,0,2,2'
    $button.FontWeight = 'SemiBold'
    $button.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(64,70,78)))
    $button.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(95,105,118)))
    $button.BorderThickness = '1'
    $button.Foreground = [System.Windows.Media.Brushes]::White
    return $button
}

function Invoke-FlowCellFlattenRevolveCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string]$FlattenAxis = '',
        [string]$RevolveAxis = '',
        [string]$CenterMode = '',
        [double]$AngleDeg = 360.0,
        [int]$RevolveSteps = 128,
        [double]$MergeDistance = 0.0001
    )

    try {
        Set-ActionStatus ('Running flatten/revolve: {0}...' -f $Command)
        $data = @{
            command = [string]$Command
            center_mode = [string]$CenterMode
            angle_deg = [double]$AngleDeg
            revolve_steps = [int]$RevolveSteps
            merge_distance = [double]$MergeDistance
        }
        if (-not [string]::IsNullOrWhiteSpace($FlattenAxis)) {
            $data.flatten_axis = [string]$FlattenAxis
        }
        if (-not [string]::IsNullOrWhiteSpace($RevolveAxis)) {
            $data.revolve_axis = [string]$RevolveAxis
        }

        try {
            $response = Invoke-FlowCellBlenderBridgeRequest -Action 'flatten_revolve_tools' -Data $data
        }
        catch {
            if ($_.Exception.Message -notmatch 'Unsupported action:\s*flatten_revolve_tools') {
                throw
            }
            $data.tool = 'flatten_revolve'
            $data.tool_command = [string]$Command
            $response = Invoke-FlowCellBlenderBridgeRequest -Action 'alignment_tools' -Data $data
        }
        $statusText = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Flatten/revolve complete.' }
        if ([string]::IsNullOrWhiteSpace($statusText)) {
            $statusText = 'Flatten/revolve complete.'
        }
        Set-Content -LiteralPath $script:LastActionStatusPath -Value $statusText -Encoding UTF8
        Set-ActionStatus $statusText
        return [pscustomobject]@{
            Succeeded = $true
            Message = $statusText
        }
    }
    catch {
        $message = $_.Exception.Message
        if ($message -match 'Unsupported action:\s*flatten_revolve_tools') {
            $message = 'Reload the FlowCell Blender addon or restart Blender once.'
        }
        return [pscustomobject]@{
            Succeeded = $false
            Message = $message
        }
    }
}

function Start-FlowCellEmbeddedToolCommand {
    param(
        [Parameter(Mandatory = $true)]
        $OwnerButton,
        [Parameter(Mandatory = $true)]
        $ProgramTab,
        [string]$PanelId = '',
        [string]$Surface = 'EmbeddedTool',
        [Parameter(Mandatory = $true)]
        [string]$ToolId,
        [Parameter(Mandatory = $true)]
        [string]$ToolCommand,
        [hashtable]$ToolPayload = @{},
        [int]$TimeoutSeconds = 120,
        [scriptblock]$ToolStateApply = $null
    )

    $metadata = Get-FlowCellButtonStateMetadata -Button $OwnerButton -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface
    if (-not [bool]$metadata.Valid) {
        return [pscustomobject]@{
            Succeeded = $false
            Message = [string]$metadata.ValidationMessage
        }
    }

    $programConfig = Get-FlowCellProgramConfig -ProgramTab $ProgramTab -ProgramConfig $(if ($metadata.ProgramTab.PSObject.Properties['ProgramConfig']) { $metadata.ProgramTab.ProgramConfig } else { $null })
    $payload = [ordered]@{
        kind = 'tool_surface'
        label = [string]$metadata.Label
        tool = [string]$ToolId
        command = [string]$ToolCommand
        target = [string]$metadata.Target
        resolved_target = [string]$metadata.ResolvedTarget
        owner_button_id = [string]$metadata.ButtonId
        owner_panel_id = [string]$metadata.PanelId
        style_group_id = [string]$metadata.style_group_id
        compound_tool_id = [string]$metadata.compound_tool_id
    }
    foreach ($entry in $ToolPayload.GetEnumerator()) {
        $payload[[string]$entry.Key] = $entry.Value
    }

    $envelope = [pscustomobject]@{
        command_id = 'flowcell.run_tool_action'
        source_button_id = [string]$metadata.ButtonId
        program_id = [int]$metadata.ProgramTabId
        panel_id = [string]$metadata.PanelId
        source_surface = [string]$Surface
        correlation_id = [guid]::NewGuid().ToString('N')
        program = [pscustomobject]@{
            id = [int]$metadata.ProgramTabId
            label = [string]$metadata.ProgramLabel
            normalized_name = [string]$programConfig.NormalizedName
            program_type = [string]$programConfig.ProgramType
            run_method = [string]$programConfig.RunMethod
            script_folder = [string]$programConfig.ScriptFolder
            bridge_folder = [string]$programConfig.BridgeFolder
            exe_path = [string]$programConfig.ExePath
            requires_restart = [bool]$programConfig.RequiresRestart
            process_names = @($programConfig.ProcessNames)
        }
        payload = [pscustomobject]$payload
    }

    Write-UiLog ('Frontend command emitted. HostVersion={0}; Surface={1}; ProgramTabId={2}; PanelId={3}; ButtonId={4}; Label={5}; CommandId={6}; Tool={7}; ToolCommand={8}' -f `
        $script:FlowCellHostLayerVersion, `
        [string]$Surface, `
        [int]$metadata.ProgramTabId, `
        [string]$metadata.PanelId, `
        [string]$metadata.ButtonId, `
        [string]$metadata.Label, `
        'flowcell.run_tool_action', `
        [string]$ToolId, `
        [string]$ToolCommand)

    return (Start-FlowCellBackendCommand -Envelope $envelope -Description ('command {0} {1}' -f [string]$metadata.Label, [string]$ToolCommand) -TimeoutSeconds $TimeoutSeconds -Context @{
        Surface = [string]$Surface
        ButtonId = [string]$metadata.ButtonId
        ProgramTab = $ProgramTab
        ToolStateApply = $ToolStateApply
    })
}

function New-FlowCellFlattenRevolveToolControl {
    param(
        [Parameter(Mandatory = $true)]
        $Button,
        [Parameter(Mandatory = $true)]
        $ProgramTab,
        [string]$PanelId = '',
        [string]$Surface = 'EmbeddedFlattenRevolve',
        [double]$Width = 320,
        [double]$FontSize = 12,
        [scriptblock]$StatusAction = $null,
        [scriptblock]$CyclePanelAction = $null,
        [scriptblock]$DragWindowAction = $null,
        [scriptblock]$CloseWindowAction = $null
    )

    $Button = Ensure-FlowCellButtonStateLayer $Button
    $stateSnapshot = Get-FlowCellToolOptionStateSnapshot -ProgramTabId ([int]$ProgramTab.Id) -PanelId ([string]$PanelId) -OwnerButtonId ([string]$Button.Id) -ToolId 'flatten_revolve'
    $state = @{
        FlattenAxis = [string]$stateSnapshot.Values.FlattenAxis
        RevolveAxis = [string]$stateSnapshot.Values.RevolveAxis
        CenterMode = [string]$stateSnapshot.Values.CenterMode
        AngleDeg = [double]$stateSnapshot.Values.AngleDeg
        RevolveSteps = [int]$stateSnapshot.Values.RevolveSteps
        MergeDistance = [double]$stateSnapshot.Values.MergeDistance
    }
    $persistToolState = {
        $entry = Get-FlowCellToolOptionStateEntry -ProgramTabId ([int]$ProgramTab.Id) -PanelId ([string]$PanelId) -OwnerButtonId ([string]$Button.Id) -ToolId 'flatten_revolve' -Create
        $entry.Values = [pscustomobject]@{
            FlattenAxis = [string]$state.FlattenAxis
            RevolveAxis = [string]$state.RevolveAxis
            CenterMode = [string]$state.CenterMode
            AngleDeg = [double]$state.AngleDeg
            RevolveSteps = [int]$state.RevolveSteps
            MergeDistance = [double]$state.MergeDistance
        }
        Save-FlowCellState
    }.GetNewClosure()

    $normalBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(64,70,78))
    $activeBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(121,255,51))
    $normalForeground = [System.Windows.Media.Brushes]::White
    $activeForeground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(16,20,12))
    $axisButtons = @{}
    $centerButtons = @{}

    $shell = New-Object System.Windows.Controls.Border
    $shell.Width = $Width
    $shell.Margin = '0'
    $shell.Padding = '0'
    $shell.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(36,42,51)))
    $shell.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(95,105,118)))
    $shell.BorderThickness = '1'
    $shell.CornerRadius = '0'

    $content = New-Object System.Windows.Controls.StackPanel
    $content.Margin = '0'
    $content.Orientation = 'Vertical'
    $shell.Child = $content

    function New-LocalButton([string]$Text, [double]$ButtonWidth) {
        $button = New-FlowCellAlignmentMiniButton -Text $Text -Width $ButtonWidth -Height 22 -FontSize $FontSize
        $button.Margin = '0,0,2,2'
        return $button
    }

    $refreshButtonState = {
        foreach ($axisName in @('X', 'Y', 'Z')) {
            $flattenKey = 'flatten|{0}' -f $axisName
            if ($axisButtons.ContainsKey($flattenKey)) {
                $isActive = ([string]$state.FlattenAxis -eq $axisName)
                $axisButtons[$flattenKey].Background = if ($isActive) { $activeBrush } else { $normalBrush }
                $axisButtons[$flattenKey].Foreground = if ($isActive) { $activeForeground } else { $normalForeground }
            }
            $revolveKey = 'revolve|{0}' -f $axisName
            if ($axisButtons.ContainsKey($revolveKey)) {
                $isActive = ([string]$state.RevolveAxis -eq $axisName)
                $axisButtons[$revolveKey].Background = if ($isActive) { $activeBrush } else { $normalBrush }
                $axisButtons[$revolveKey].Foreground = if ($isActive) { $activeForeground } else { $normalForeground }
            }
        }

        foreach ($modeName in @('GEOMETRY', 'ORIGIN', 'WORLD', 'CURSOR', 'OBJECT')) {
            if (-not $centerButtons.ContainsKey($modeName)) { continue }
            $isActive = ([string]$state.CenterMode -eq $modeName)
            $centerButtons[$modeName].Background = if ($isActive) { $activeBrush } else { $normalBrush }
            $centerButtons[$modeName].Foreground = if ($isActive) { $activeForeground } else { $normalForeground }
        }
    }.GetNewClosure()

    $flattenRow = New-Object System.Windows.Controls.StackPanel
    $flattenRow.Orientation = 'Horizontal'
    $flattenRow.Margin = '0'
    [void]$content.Children.Add($flattenRow)

    foreach ($axis in @('X', 'Y', 'Z')) {
        $axisButton = New-LocalButton -Text $axis -ButtonWidth 30
        [void]$flattenRow.Children.Add($axisButton)
        $axisButtons[('flatten|{0}' -f $axis)] = $axisButton
        $axisValue = [string]$axis
        $axisButton.Add_Click({
            $state.FlattenAxis = $axisValue
            & $persistToolState
            & $refreshButtonState
        }.GetNewClosure())
    }

    $flattenButton = New-LocalButton -Text 'Flatten Profile' -ButtonWidth ([Math]::Max([double]($Width - 98), 136))
    [void]$flattenRow.Children.Add($flattenButton)
    $flattenButton.Add_Click({
        param($sender, $eventArgs)
        & $updateSettings
        $result = Start-FlowCellEmbeddedToolCommand -OwnerButton $Button -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface -ToolId 'flatten_revolve' -ToolCommand 'flatten_profile' -ToolPayload @{
            flatten_axis = [string]$state.FlattenAxis
            revolve_axis = [string]$state.RevolveAxis
            center_mode = [string]$state.CenterMode
            angle_deg = [double]$state.AngleDeg
            revolve_steps = [int]$state.RevolveSteps
            merge_distance = [double]$state.MergeDistance
        }
        if ($StatusAction -is [scriptblock]) { & $StatusAction ([string]$result.Message) }
        if (-not $result.Succeeded) {
            Set-ActionStatus ([string]$result.Message)
            Write-UiLog ('Flatten/revolve command failed: {0}' -f [string]$result.Message)
        }
    }.GetNewClosure())

    $centerRow = New-Object System.Windows.Controls.StackPanel
    $centerRow.Orientation = 'Horizontal'
    $centerRow.Margin = '0'
    [void]$content.Children.Add($centerRow)

    foreach ($centerSpec in @(
        @{ Mode = 'GEOMETRY'; Text = 'Geom' ; Width = 48 },
        @{ Mode = 'ORIGIN'; Text = 'Origin' ; Width = 50 },
        @{ Mode = 'WORLD'; Text = 'World' ; Width = 48 },
        @{ Mode = 'CURSOR'; Text = 'Cursor' ; Width = 50 },
        @{ Mode = 'OBJECT'; Text = 'Object' ; Width = 50 }
    )) {
        $centerButton = New-LocalButton -Text ([string]$centerSpec.Text) -ButtonWidth ([double]$centerSpec.Width)
        [void]$centerRow.Children.Add($centerButton)
        $centerButtons[[string]$centerSpec.Mode] = $centerButton
        $modeValue = [string]$centerSpec.Mode
        $centerButton.Add_Click({
            $state.CenterMode = $modeValue
            & $persistToolState
            & $refreshButtonState
        }.GetNewClosure())
    }

    $revolveRow = New-Object System.Windows.Controls.StackPanel
    $revolveRow.Orientation = 'Horizontal'
    $revolveRow.Margin = '0'
    [void]$content.Children.Add($revolveRow)

    foreach ($axis in @('X', 'Y', 'Z')) {
        $axisButton = New-LocalButton -Text $axis -ButtonWidth 30
        [void]$revolveRow.Children.Add($axisButton)
        $axisButtons[('revolve|{0}' -f $axis)] = $axisButton
        $axisValue = [string]$axis
        $axisButton.Add_Click({
            $state.RevolveAxis = $axisValue
            & $persistToolState
            & $refreshButtonState
        }.GetNewClosure())
    }

    $revolveButton = New-LocalButton -Text 'Generate Revolve' -ButtonWidth ([Math]::Max([double]($Width - 98), 136))
    [void]$revolveRow.Children.Add($revolveButton)
    $revolveButton.Add_Click({
        param($sender, $eventArgs)
        & $updateSettings
        $result = Start-FlowCellEmbeddedToolCommand -OwnerButton $Button -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface -ToolId 'flatten_revolve' -ToolCommand 'generate_revolve' -ToolPayload @{
            flatten_axis = [string]$state.FlattenAxis
            revolve_axis = [string]$state.RevolveAxis
            center_mode = [string]$state.CenterMode
            angle_deg = [double]$state.AngleDeg
            revolve_steps = [int]$state.RevolveSteps
            merge_distance = [double]$state.MergeDistance
        }
        if ($StatusAction -is [scriptblock]) { & $StatusAction ([string]$result.Message) }
        if (-not $result.Succeeded) {
            Set-ActionStatus ([string]$result.Message)
            Write-UiLog ('Flatten/revolve command failed: {0}' -f [string]$result.Message)
        }
    }.GetNewClosure())

    $settingsExpander = New-Object System.Windows.Controls.Expander
    $settingsExpander.Header = 'Revolve Settings'
    $settingsExpander.Foreground = [System.Windows.Media.Brushes]::White
    $settingsExpander.Margin = '2,1,2,0'
    [void]$content.Children.Add($settingsExpander)

    $settingsGrid = New-Object System.Windows.Controls.Grid
    foreach ($widthValue in @(40, 48, 38, 42, 42, 52)) {
        [void]$settingsGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = (New-Object System.Windows.GridLength $widthValue) }))
    }
    $settingsExpander.Content = $settingsGrid

    function New-SettingsLabel([string]$Text, [int]$Column) {
        $label = New-Object System.Windows.Controls.TextBlock
        $label.Text = $Text
        $label.FontSize = $FontSize
        $label.Foreground = [System.Windows.Media.Brushes]::White
        $label.VerticalAlignment = 'Center'
        [System.Windows.Controls.Grid]::SetColumn($label, $Column)
        [void]$settingsGrid.Children.Add($label)
        return $label
    }

    function New-SettingsBox([string]$Text, [int]$Column) {
        $box = New-Object System.Windows.Controls.TextBox
        $box.Text = $Text
        $box.FontSize = $FontSize
        $box.Height = 22
        $box.Margin = '2,0,2,0'
        [System.Windows.Controls.Grid]::SetColumn($box, $Column)
        [void]$settingsGrid.Children.Add($box)
        return $box
    }

    [void](New-SettingsLabel -Text 'Angle' -Column 0)
    $angleBox = New-SettingsBox -Text ([string]$state.AngleDeg) -Column 1
    [void](New-SettingsLabel -Text 'Steps' -Column 2)
    $stepsBox = New-SettingsBox -Text ([string]$state.RevolveSteps) -Column 3
    [void](New-SettingsLabel -Text 'Merge' -Column 4)
    $mergeBox = New-SettingsBox -Text ([string]$state.MergeDistance) -Column 5

    $updateSettings = {
        $parsedDouble = 0.0
        if ([double]::TryParse($angleBox.Text, [ref]$parsedDouble)) {
            $state.AngleDeg = [Math]::Max([Math]::Min($parsedDouble, 360.0), 0.0)
            $angleBox.Text = [string]$state.AngleDeg
        }

        $parsedInt = 0
        if ([int]::TryParse($stepsBox.Text, [ref]$parsedInt)) {
            $state.RevolveSteps = [Math]::Max([Math]::Min($parsedInt, 1024), 3)
            $stepsBox.Text = [string]$state.RevolveSteps
        }

        $parsedMerge = 0.0
        if ([double]::TryParse($mergeBox.Text, [ref]$parsedMerge)) {
            $state.MergeDistance = [Math]::Max($parsedMerge, 0.0)
            $mergeBox.Text = [string]$state.MergeDistance
        }
        & $persistToolState
    }.GetNewClosure()
    $angleBox.Add_LostFocus($updateSettings)
    $stepsBox.Add_LostFocus($updateSettings)
    $mergeBox.Add_LostFocus($updateSettings)

    if ($DragWindowAction -is [scriptblock]) {
        $windowRow = New-Object System.Windows.Controls.StackPanel
        $windowRow.Orientation = 'Horizontal'
        $windowRow.Margin = '0'
        [void]$content.Children.Add($windowRow)

        $dragButton = New-LocalButton -Text '::' -ButtonWidth 22
        $dragButton.ToolTip = 'Drag section'
        [void]$windowRow.Children.Add($dragButton)
        $dragButton.Add_PreviewMouseLeftButtonDown({
            param($sender, $eventArgs)
            if ($DragWindowAction -is [scriptblock]) {
                & $DragWindowAction $sender
                $eventArgs.Handled = $true
            }
        }.GetNewClosure())
    }

    & $refreshButtonState
    return $shell
}

function New-FlowCellMainToolWrapper {
    param(
        [Parameter(Mandatory = $true)]
        $ProgramTab,
        [Parameter(Mandatory = $true)]
        $Panel,
        [Parameter(Mandatory = $true)]
        $Button,
        [Parameter(Mandatory = $true)]
        $Content,
        [Parameter(Mandatory = $true)]
        [string]$Tooltip,
        [Parameter(Mandatory = $true)]
        [System.Windows.Controls.Panel]$ButtonGrid,
        [bool]$ArrangeModeEnabled = $false,
        [scriptblock]$RefreshAction = $null
    )

    $Button = Ensure-FlowCellButtonStateLayer $Button
    $programTabId = [int]$ProgramTab.Id
    $panelId = [string]$Panel.Id
    $buttonId = [string]$Button.Id
    $styleGroupId = Get-FlowCellButtonStyleGroupId $Button
    $isPoppedTarget = Test-FlowCellButtonPopoutTargetOpen -ProgramTabId $programTabId -PanelId $panelId -ButtonId $buttonId
    $isSelected = Is-FlowCellButtonSelected -ProgramTabId $programTabId -PanelId $panelId -ButtonId $buttonId
    $trimmedTooltip = [string]$Tooltip
    if (-not [string]::IsNullOrWhiteSpace($trimmedTooltip)) {
        $trimmedTooltip = $trimmedTooltip.Trim()
    }
    $hoverStatusText = if ($script:FlowCellMainHoverStatusText -is [System.Windows.Controls.TextBlock]) { $script:FlowCellMainHoverStatusText } else { $null }
    $hoverDelayMs = if ([int]$script:FlowCellMainHoverDelayMs -gt 0) { [int]$script:FlowCellMainHoverDelayMs } else { 2000 }
    $hoverTimer = $null
    $hoverPreviousText = ''
    $hoverDisplayed = $false
    $hoverMessage = $trimmedTooltip

    $wrapper = New-Object System.Windows.Controls.Border
    $wrapper.Margin = '0,0,12,12'
    $wrapper.Padding = if ($ArrangeModeEnabled) { '8,8,10,8' } else { '0' }
    $wrapper.CornerRadius = if ($ArrangeModeEnabled) { '12' } else { '0' }
    $wrapper.Background = if ($ArrangeModeEnabled) { (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(48,116,196,255))) } else { [System.Windows.Media.Brushes]::Transparent }
    $wrapper.BorderThickness = if ($ArrangeModeEnabled) { '1' } else { '0' }
    $wrapper.BorderBrush = if ($ArrangeModeEnabled) { (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(116,196,255))) } else { [System.Windows.Media.Brushes]::Transparent }
    $wrapper.VerticalAlignment = 'Top'
    $wrapper.Cursor = if ($ArrangeModeEnabled) { [System.Windows.Input.Cursors]::SizeAll } else { [System.Windows.Input.Cursors]::Arrow }
    $wrapper.AllowDrop = [bool]$ArrangeModeEnabled
    $wrapper.ToolTip = if ($ArrangeModeEnabled) { 'Arrange mode: drag this tile to reorder the main page.' } else { $null }
    $wrapper.Tag = [pscustomobject]@{
        ButtonId = $buttonId
        Button = $Button
        ProgramTabId = $programTabId
        PanelId = $panelId
    }

    $wrapperHost = New-Object System.Windows.Controls.Grid
    $wrapper.Child = $wrapperHost

    $row = New-Object System.Windows.Controls.StackPanel
    $row.Orientation = 'Horizontal'
    $row.VerticalAlignment = 'Top'
    [void]$wrapperHost.Children.Add($row)

    if ($ArrangeModeEnabled) {
        $dragGlyph = New-Object System.Windows.Controls.TextBlock
        $dragGlyph.Text = '::'
        $dragGlyph.Width = 20
        $dragGlyph.Margin = '0,4,8,0'
        $dragGlyph.Foreground = [System.Windows.Media.Brushes]::White
        $dragGlyph.FontWeight = 'Bold'
        $dragGlyph.VerticalAlignment = 'Top'
        $dragGlyph.ToolTip = 'Drag to reorder.'
        [void]$row.Children.Add($dragGlyph)
    }
    else {
        $checkbox = New-Object System.Windows.Controls.CheckBox
        $checkbox.Width = 20
        $checkbox.Height = 20
        $checkbox.Margin = '0,3,6,0'
        $checkbox.VerticalAlignment = 'Top'
        $checkbox.ToolTip = $trimmedTooltip
        [System.Windows.Controls.ToolTipService]::SetShowOnDisabled($checkbox, $true)
        $checkbox.IsChecked = [bool]$isSelected
        $checkbox.IsEnabled = $true
        $checkbox.Tag = [pscustomobject]@{
            ProgramTabId = $programTabId
            PanelId = $panelId
            ButtonId = $buttonId
        }

        $checkbox.Add_Checked({
            param($sender, $eventArgs)
            $tag = $sender.Tag
            Select-FlowCellButton -ProgramTabId ([int]$tag.ProgramTabId) -PanelId ([string]$tag.PanelId) -ButtonId ([string]$tag.ButtonId) -Exclusive $false
        }.GetNewClosure())
        $checkbox.Add_Unchecked({
            param($sender, $eventArgs)
            $tag = $sender.Tag
            $key = Get-FlowCellButtonSelectionKey -ProgramTabId ([int]$tag.ProgramTabId) -PanelId ([string]$tag.PanelId) -ButtonId ([string]$tag.ButtonId)
            if ($script:FlowCellSelectedButtonKeys -and $script:FlowCellSelectedButtonKeys.ContainsKey($key)) {
                $script:FlowCellSelectedButtonKeys.Remove($key) | Out-Null
            }
        }.GetNewClosure())
        [void]$row.Children.Add($checkbox)
    }

    $renderContent = $Content
    if ($renderContent -is [System.Windows.UIElement]) {
        $renderContent.IsHitTestVisible = (-not $ArrangeModeEnabled)
        $renderContent.Opacity = if ($ArrangeModeEnabled) { 0.95 } else { 1.0 }
        $visualState = New-FlowCellHostVisualState `
            -Label ([string]$Button.Label) `
            -IsSelected ([bool]$isSelected) `
            -IsEnabled $true `
            -StyleGroupId ([string]$styleGroupId) `
            -AccentColor $(if ($isSelected) { '#FF79FF33' } elseif ($isPoppedTarget) { '#FF74C4FF' } else { '#FF74C4FF' })
        $renderContent = New-FlowCellHostVisualSkinSurface -Content $renderContent -VisualState $visualState -Mode 'Main'
    }
    [void]$row.Children.Add($renderContent)

    if (-not $ArrangeModeEnabled -and $hoverStatusText -and -not [string]::IsNullOrWhiteSpace($hoverMessage)) {
        $hoverTimer = New-Object System.Windows.Threading.DispatcherTimer
        $hoverTimer.Interval = [TimeSpan]::FromMilliseconds($hoverDelayMs)
        $hoverTimer.Add_Tick({
            $hoverTimer.Stop()
            if ($hoverStatusText) {
                if ([string]::IsNullOrWhiteSpace($hoverPreviousText)) {
                    $hoverPreviousText = [string]$hoverStatusText.Text
                }
                Set-ControlTextValue $hoverStatusText $hoverMessage
                $hoverDisplayed = $true
            }
        }.GetNewClosure())

        $startHoverDescription = {
            param($sender, $eventArgs)
            if ($null -eq $hoverTimer -or $null -eq $hoverStatusText) { return }
            if ($hoverDisplayed) { return }
            $hoverPreviousText = [string]$hoverStatusText.Text
            $hoverTimer.Stop()
            $hoverTimer.Start()
        }.GetNewClosure()

        $stopHoverDescription = {
            param($sender, $eventArgs)
            if ($hoverTimer) {
                $hoverTimer.Stop()
            }
            if ($hoverDisplayed -and $hoverStatusText -and ([string]$hoverStatusText.Text -eq $hoverMessage)) {
                if (-not [string]::IsNullOrWhiteSpace($hoverPreviousText)) {
                    Set-ControlTextValue $hoverStatusText $hoverPreviousText
                }
                elseif (-not [string]::IsNullOrWhiteSpace([string]$script:FlowCellMainHoverHintText)) {
                    Set-ControlTextValue $hoverStatusText ([string]$script:FlowCellMainHoverHintText)
                }
                else {
                    Set-ControlTextValue $hoverStatusText ''
                }
            }
            $hoverDisplayed = $false
        }.GetNewClosure()

        $wrapper.Add_MouseEnter($startHoverDescription)
        $wrapper.Add_MouseLeave($stopHoverDescription)
        if ($renderContent -is [System.Windows.UIElement]) {
            $renderContent.Add_MouseEnter($startHoverDescription)
            $renderContent.Add_MouseLeave($stopHoverDescription)
        }
        $wrapper.Add_Unloaded({
            param($sender, $eventArgs)
            if ($hoverTimer) { $hoverTimer.Stop() }
        }.GetNewClosure())
    }

    if ($ArrangeModeEnabled) {
        $dragSurface = New-Object System.Windows.Controls.Primitives.Thumb
        $dragSurface.HorizontalAlignment = 'Stretch'
        $dragSurface.VerticalAlignment = 'Stretch'
        $dragSurface.Opacity = 0.01
        $dragSurface.Cursor = [System.Windows.Input.Cursors]::SizeAll
        $dragSurface.Focusable = $false
        $dragSurface.ToolTip = 'Arrange mode: drag this tile to reorder the main page.'
        [System.Windows.Controls.Panel]::SetZIndex($dragSurface, 20)
        $dragSurface.Add_DragStarted({
            param($sender, $eventArgs)
            Start-FlowCellMainArrangeDrag -ButtonGrid $ButtonGrid -ProgramTabId ([int]$programTabId) -PanelId ([string]$panelId) -SourceButtonId ([string]$buttonId) -SourceHost $wrapper -RefreshAction $RefreshAction
        }.GetNewClosure())
        $dragSurface.Add_DragDelta({
            param($sender, $eventArgs)
            if ($null -eq $script:FlowCellMainArrangeDragState) { return }
            [void](Update-FlowCellMainArrangeDrag -Point ([System.Windows.Input.Mouse]::GetPosition($ButtonGrid)))
        }.GetNewClosure())
        $dragSurface.Add_DragCompleted({
            param($sender, $eventArgs)
            if ($null -eq $script:FlowCellMainArrangeDragState) { return }
            [void](Complete-FlowCellMainArrangeDrag)
            $script:FlowCellMainArrangeDragState = $null
            $script:FlowCellMainArrangePendingPointer = $null
        }.GetNewClosure())
        [void]$wrapperHost.Children.Add($dragSurface)
    }

    return $wrapper
}

function Get-FlowCellBindRows([int]$ProgramTabId) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    if ($null -eq $programState) { return @() }

    $rows = @()
    foreach ($binding in @($script:State.ScriptBindings | Where-Object { [int]$(if ($_.PSObject.Properties['ProgramTabId']) { $_.ProgramTabId } else { 0 }) -eq $ProgramTabId -and -not [string]::IsNullOrWhiteSpace([string]$_.Shortcut) } | Sort-Object Shortcut, Target)) {
        $rows += [pscustomobject]@{
            ProgramTabId = [int]$ProgramTabId
            PanelId = ''
            ButtonId = ''
            BindingId = [int]$binding.Id
            Target = [string]$binding.Target
            Kind = 'script'
            Shortcut = Format-ShortcutForDisplay -Shortcut ([string]$binding.Shortcut)
            RawShortcut = [string]$binding.Shortcut
            Action = [System.IO.Path]::GetFileNameWithoutExtension([string]$binding.Target)
            Type = 'script'
            Panel = 'Shortcut'
        }
    }
    foreach ($action in @($script:Actions | Sort-Object Label)) {
        $actionId = [string]$action.Id
        if ([string]::IsNullOrWhiteSpace($actionId)) { continue }
        if (-not $script:State.ActionHotkeys.Contains($actionId)) { continue }
        $rows += [pscustomobject]@{
            ProgramTabId = [int]$ProgramTabId
            PanelId = ''
            ButtonId = ''
            BindingId = 0
            Target = $actionId
            Kind = 'macro'
            Shortcut = Format-ShortcutForDisplay -Shortcut ([string]$script:State.ActionHotkeys[$actionId])
            RawShortcut = [string]$script:State.ActionHotkeys[$actionId]
            Action = [string]$action.Label
            Type = 'macro'
            Panel = 'Shortcut'
        }
    }
    return @($rows | Sort-Object Shortcut, Type, Action)
}

function Get-FlowCellSmartAxisAxisButtonLabel {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Axis,
        [string]$Mode = 'NONE'
    )

    switch ([string]$Mode) {
        'MIN' { return ('{0}-' -f $Axis) }
        'MAX' { return ('{0}+' -f $Axis) }
        default { return [string]$Axis }
    }
}

function Sync-FlowCellSmartAxisLockStateButtons {
    param(
        [Parameter(Mandatory = $true)]
        $ProgramTab,
        [Parameter(Mandatory = $true)]
        $Result
    )

    if ($null -eq $ProgramTab -or $null -eq $Result) { return }
    $programState = Get-FlowCellProgramState -ProgramTabId ([int]$ProgramTab.Id)
    if ($null -eq $programState) { return }

    $normalizedValues = ConvertTo-FlowCellSmartAxisToolOptionValues -StateSource $Result
    $didChange = $false
    foreach ($panel in @($programState.Panels)) {
        $ownerButton = Get-FlowCellSmartAxisOwnerButtonFromPanel -Panel $panel
        if ($ownerButton) {
            $entry = Get-FlowCellToolOptionStateEntry -ProgramTabId ([int]$ProgramTab.Id) -PanelId ([string]$panel.Id) -OwnerButtonId ([string]$ownerButton.Id) -ToolId 'smart_axis_lock' -Create
            $existingValuesJson = ConvertTo-Json -InputObject $entry.Values -Depth 8 -Compress
            $normalizedValuesJson = ConvertTo-Json -InputObject $normalizedValues -Depth 8 -Compress
            if ($existingValuesJson -ne $normalizedValuesJson) {
                $entry.Values = $normalizedValues
                $didChange = $true
            }
        }

        foreach ($button in @($panel.Buttons)) {
            if ($null -eq $button -or [string]$button.Kind -ne 'script') { continue }
            $command = Get-FlowCellSmartAxisLockCommandForScriptPath -ScriptPath ([string]$button.Target)
            if ([string]::IsNullOrWhiteSpace($command)) { continue }

            $newLabel = switch ([string]$command) {
                'baseline' { 'Base' }
                'cycle_x' { Get-FlowCellSmartAxisAxisButtonLabel -Axis 'X' -Mode ([string]$normalizedValues.Modes.X) }
                'cycle_y' { Get-FlowCellSmartAxisAxisButtonLabel -Axis 'Y' -Mode ([string]$normalizedValues.Modes.Y) }
                'cycle_z' { Get-FlowCellSmartAxisAxisButtonLabel -Axis 'Z' -Mode ([string]$normalizedValues.Modes.Z) }
                'toggle_live' { 'Live' }
                default { [string]$button.Label }
            }
            $newStyleGroupId = switch ([string]$command) {
                'cycle_x' { if ([string]$normalizedValues.Modes.X -in @('MIN', 'MAX')) { 'smart_axis_axis_active' } else { '' } }
                'cycle_y' { if ([string]$normalizedValues.Modes.Y -in @('MIN', 'MAX')) { 'smart_axis_axis_active' } else { '' } }
                'cycle_z' { if ([string]$normalizedValues.Modes.Z -in @('MIN', 'MAX')) { 'smart_axis_axis_active' } else { '' } }
                'toggle_live' { if ([bool]$normalizedValues.LiveEnabled) { 'smart_axis_live_active' } else { '' } }
                default { '' }
            }

            if ([string]$button.Label -ne [string]$newLabel) {
                $button.Label = [string]$newLabel
                $didChange = $true
            }
            $button = Ensure-FlowCellButtonStateLayer $button
            if ([string](Get-FlowCellButtonStyleGroupId $button) -ne [string]$newStyleGroupId) {
                $button.style_group_id = [string]$newStyleGroupId
                $didChange = $true
            }
        }
    }

    if ($didChange) {
        Save-FlowCellState
        if ($script:FlowCellMainRefresh -is [scriptblock]) {
            & $script:FlowCellMainRefresh
        }
        else {
            Refresh-FlowCellPanelWindows
            Refresh-FlowCellToolPopoutWindows
        }
    }
}

function New-FlowCellSmartAxisLockToolControl {
    param(
        [Parameter(Mandatory = $true)]
        $Button,
        [Parameter(Mandatory = $true)]
        $ProgramTab,
        [string]$PanelId = '',
        [string]$Surface = 'EmbeddedSmartAxis',
        [double]$Width = 338,
        [double]$FontSize = 12,
        [scriptblock]$StatusAction = $null,
        [scriptblock]$CyclePanelAction = $null,
        [scriptblock]$DragWindowAction = $null,
        [scriptblock]$CloseWindowAction = $null
    )
    $ownerButton = Ensure-FlowCellButtonStateLayer $Button
    $stateSnapshot = Get-FlowCellToolOptionStateSnapshot -ProgramTabId ([int]$ProgramTab.Id) -PanelId $PanelId -OwnerButtonId ([string]$ownerButton.Id) -ToolId 'smart_axis_lock'
    $normalizedSnapshot = ConvertTo-FlowCellSmartAxisToolOptionValues -StateSource $(if ($stateSnapshot -and $stateSnapshot.PSObject.Properties['Values']) { $stateSnapshot.Values } else { $stateSnapshot })
    $state = [ordered]@{
        Modes = [ordered]@{
            X = [string]$normalizedSnapshot.Modes.X
            Y = [string]$normalizedSnapshot.Modes.Y
            Z = [string]$normalizedSnapshot.Modes.Z
        }
        LiveEnabled = [bool]$normalizedSnapshot.LiveEnabled
        RunnerActive = [bool]$normalizedSnapshot.RunnerActive
        Selected = [int]$normalizedSnapshot.Selected
        EnabledToolCount = [int]$normalizedSnapshot.EnabledToolCount
        Registered = [bool]$normalizedSnapshot.Registered
        LastMessage = [string]$normalizedSnapshot.LastMessage
    }

    $normalBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(64,70,78))
    $axisActiveBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(121,255,51))
    $liveActiveBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(220,64,64))
    $normalForeground = [System.Windows.Media.Brushes]::White
    $axisActiveForeground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(16,20,12))
    $liveActiveForeground = [System.Windows.Media.Brushes]::White

    $shell = New-Object System.Windows.Controls.Border
    $shell.Width = if ([double]$Width -gt 0) { [double]$Width } else { [double]::NaN }
    $shell.MinWidth = 340
    $shell.MinHeight = 36
    $shell.Margin = '0'
    $shell.Padding = '0'
    $shell.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(36,42,51)))
    $shell.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(95,105,118)))
    $shell.BorderThickness = '1'
    $shell.CornerRadius = '0'
    $shell.HorizontalAlignment = 'Stretch'

    $topRow = New-Object System.Windows.Controls.Grid
    $topRow.Margin = '0'
    $topRow.HorizontalAlignment = 'Stretch'
    $shell.Child = $topRow

    $columnWeights = @(1.1, 1.0, 1.0, 1.0, 1.15)
    foreach ($weight in $columnWeights) {
        $column = New-Object System.Windows.Controls.ColumnDefinition
        $column.Width = New-Object System.Windows.GridLength([double]$weight, [System.Windows.GridUnitType]::Star)
        [void]$topRow.ColumnDefinitions.Add($column)
    }
    if ($DragWindowAction -is [scriptblock]) {
        $dragColumn = New-Object System.Windows.Controls.ColumnDefinition
        $dragColumn.Width = New-Object System.Windows.GridLength(26)
        [void]$topRow.ColumnDefinitions.Add($dragColumn)
    }

    function New-SmartAxisMiniButton([string]$Text) {
        $resolvedFontSize = [Math]::Max([double]$FontSize, 14.0)
        $miniButton = New-FlowCellHostButtonControl `
            -Label ([string]$Text) `
            -Tag ([pscustomobject]@{ Host = 'EmbeddedSmartAxisButton' }) `
            -Tooltip '' `
            -Width ([double]::NaN) `
            -Height 34 `
            -Padding '8,2' `
            -FontSize $resolvedFontSize `
            -HorizontalAlignment 'Stretch' `
            -VerticalAlignment 'Stretch'
        $miniButton.MinWidth = 44
        $miniButton.MinHeight = 34
        $miniButton.Margin = '0'
        $miniButton.FontWeight = 'SemiBold'
        $miniButton.BorderThickness = '1'
        $miniButton.HorizontalContentAlignment = 'Center'
        $miniButton.VerticalContentAlignment = 'Center'
        return $miniButton
    }

    $baselineButton = New-SmartAxisMiniButton -Text 'Base'
    $baselineButton.ToolTip = 'Store the current bounds as the Smart Axis baseline.'
    [System.Windows.Controls.Grid]::SetColumn($baselineButton, 0)
    [void]$topRow.Children.Add($baselineButton)

    $axisButtons = @{}
    $axisColumnIndex = 1
    foreach ($axis in @('X', 'Y', 'Z')) {
        $axisButton = New-SmartAxisMiniButton -Text $axis
        $axisButton.ToolTip = ('Cycle {0}: none -> minus -> plus -> none.' -f $axis)
        [System.Windows.Controls.Grid]::SetColumn($axisButton, $axisColumnIndex)
        $axisButtons[$axis] = $axisButton
        [void]$topRow.Children.Add($axisButton)
        $axisColumnIndex += 1
    }

    $liveButton = New-SmartAxisMiniButton -Text 'Live'
    $liveButton.ToolTip = 'Toggle Smart Axis live pinning.'
    [System.Windows.Controls.Grid]::SetColumn($liveButton, 4)
    [void]$topRow.Children.Add($liveButton)

    if ($DragWindowAction -is [scriptblock]) {
        $dragButton = New-SmartAxisMiniButton -Text '::'
        $dragButton.ToolTip = 'Drag section'
        $dragButton.MinWidth = 22
        $dragButton.Padding = '0'
        [System.Windows.Controls.Grid]::SetColumn($dragButton, 5)
        [void]$topRow.Children.Add($dragButton)
        $dragButton.Add_PreviewMouseLeftButtonDown({
            param($sender, $eventArgs)
            & $DragWindowAction $sender
            $eventArgs.Handled = $true
        }.GetNewClosure())
    }

    $getAxisLabel = {
        param([string]$Axis, [string]$Mode)
        switch ([string]$Mode) {
            'MIN' { return ('{0}-' -f $Axis) }
            'MAX' { return ('{0}+' -f $Axis) }
            default { return [string]$Axis }
        }
    }.GetNewClosure()

    $applyVisualState = {
        foreach ($axis in @('X', 'Y', 'Z')) {
            $mode = [string]$state.Modes[$axis]
            $axisButtons[$axis].Content = & $getAxisLabel $axis $mode
            $isActive = $mode -in @('MIN', 'MAX')
            $axisButtons[$axis].Background = if ($isActive) { $axisActiveBrush } else { $normalBrush }
            $axisButtons[$axis].Foreground = if ($isActive) { $axisActiveForeground } else { $normalForeground }
        }

        $liveButton.Background = if ([bool]$state.LiveEnabled) { $liveActiveBrush } else { $normalBrush }
        $liveButton.Foreground = if ([bool]$state.LiveEnabled) { $liveActiveForeground } else { $normalForeground }
        $liveButton.Content = 'Live'
    }.GetNewClosure()

    $applyToolState = {
        param($ToolState)
        $normalizedState = ConvertTo-FlowCellSmartAxisToolOptionValues -StateSource $ToolState
        $entry = Get-FlowCellToolOptionStateEntry -ProgramTabId ([int]$ProgramTab.Id) -PanelId $PanelId -OwnerButtonId ([string]$ownerButton.Id) -ToolId 'smart_axis_lock' -Create
        $entry.Values = $normalizedState
        Save-FlowCellState

        $state.Modes['X'] = [string]$normalizedState.Modes.X
        $state.Modes['Y'] = [string]$normalizedState.Modes.Y
        $state.Modes['Z'] = [string]$normalizedState.Modes.Z
        $state.LiveEnabled = [bool]$normalizedState.LiveEnabled
        $state.RunnerActive = [bool]$normalizedState.RunnerActive
        $state.Selected = [int]$normalizedState.Selected
        $state.EnabledToolCount = [int]$normalizedState.EnabledToolCount
        $state.Registered = [bool]$normalizedState.Registered
        $state.LastMessage = [string]$normalizedState.LastMessage
        & $applyVisualState

        if ($StatusAction -is [scriptblock] -and -not [string]::IsNullOrWhiteSpace([string]$normalizedState.LastMessage)) {
            & $StatusAction ([string]$normalizedState.LastMessage)
        }
    }.GetNewClosure()

    $runCommand = {
        param([string]$Command)
        $result = Start-FlowCellEmbeddedToolCommand -OwnerButton $ownerButton -ProgramTab $ProgramTab -PanelId $PanelId -Surface $Surface -ToolId 'smart_axis_lock' -ToolCommand ([string]$Command) -ToolStateApply $applyToolState
        if (-not [bool]$result.Succeeded) {
            $message = if ($result.PSObject.Properties['Message']) { [string]$result.Message } else { 'Smart Axis Lock command failed.' }
            if ($StatusAction -is [scriptblock]) {
                & $StatusAction $message
            }
            else {
                Set-ActionStatus $message
            }
        }
    }.GetNewClosure()

    $baselineButton.Add_Click({ & $runCommand 'baseline' }.GetNewClosure())
    $axisButtons['X'].Add_Click({ & $runCommand 'cycle_x' }.GetNewClosure())
    $axisButtons['Y'].Add_Click({ & $runCommand 'cycle_y' }.GetNewClosure())
    $axisButtons['Z'].Add_Click({ & $runCommand 'cycle_z' }.GetNewClosure())
    $liveButton.Add_Click({ & $runCommand 'toggle_live' }.GetNewClosure())

    & $applyVisualState
    $initialStatusRefresh = {
        try {
            & $runCommand 'status'
        }
        catch {
        }
    }.GetNewClosure()
    [void]$shell.Dispatcher.InvokeAsync([action]$initialStatusRefresh, [System.Windows.Threading.DispatcherPriority]::Background)
    return $shell
}

function Get-FlowCellButtonEntry([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $programState -or $null -eq $panel) { return $null }
    $button = @($panel.Buttons | Where-Object { [string]$_.Id -eq [string]$ButtonId } | Select-Object -First 1)
    if (@($button).Count -eq 0) { return $null }
    $button = $button[0]
    return [pscustomobject]@{
        ProgramTabId = [int]$ProgramTabId
        ProgramTab = (Get-FlowCellProgramTab -ProgramTabId $ProgramTabId)
        PanelId = [string]$PanelId
        ButtonId = [string]$button.Id
        Button = $button
        BindingId = [int]$(if ($button.PSObject.Properties['BindingId']) { $button.BindingId } else { 0 })
        Target = [string]$button.Target
        Kind = [string]$button.Kind
        Shortcut = [string]$(if ($button.PSObject.Properties['Shortcut']) { $button.Shortcut } else { '' })
        style_group_id = [string](Get-FlowCellButtonStyleGroupId $button)
        Action = [string]$button.Label
        Type = [string]$button.Kind
        Panel = [string]$panel.Name
    }
}

function Remove-FlowCellBindEntry($Entry) {
    if ($null -eq $Entry) { return $false }

    $programState = Get-FlowCellProgramState -ProgramTabId ([int]$Entry.ProgramTabId)
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId ([string]$Entry.PanelId)
    if ($null -eq $programState) { return $false }
    if ($null -eq $panel -and [string]::IsNullOrWhiteSpace([string]$Entry.PanelId)) {
        if ([string]$Entry.Kind -eq 'script') {
            $bindingId = [int]$Entry.BindingId
            if ($bindingId -gt 0) {
                $script:State.ScriptBindings = @($script:State.ScriptBindings | Where-Object { $_.Id -ne $bindingId })
                Save-State
                Restart-Backend
                return $true
            }
        }
        elseif (-not [string]::IsNullOrWhiteSpace([string]$Entry.Target) -and $script:State.ActionHotkeys.Contains([string]$Entry.Target)) {
            $script:State.ActionHotkeys.Remove([string]$Entry.Target)
            Save-State
            Restart-Backend
            return $true
        }
        return $false
    }
    if ($null -eq $panel) { return $false }

    $panel.Buttons = @($panel.Buttons | Where-Object { [string]$_.Id -ne [string]$Entry.ButtonId })

    if ([string]$Entry.Kind -eq 'script') {
        $bindingId = [int]$Entry.BindingId
        if ($bindingId -gt 0) {
            $stillUsed = $false
            foreach ($program in @($script:FlowCellState.Programs)) {
                foreach ($otherPanel in @($program.Panels)) {
                    if (@($otherPanel.Buttons | Where-Object { [string]$_.Kind -eq 'script' -and [int]$_.BindingId -eq $bindingId }).Count -gt 0) {
                        $stillUsed = $true
                        break
                    }
                }
                if ($stillUsed) { break }
            }
            if (-not $stillUsed) {
                $script:State.ScriptBindings = @($script:State.ScriptBindings | Where-Object { $_.Id -ne $bindingId })
            }
        }
    }
    else {
        $target = [string]$Entry.Target
        $stillUsed = $false
        foreach ($program in @($script:FlowCellState.Programs)) {
            foreach ($otherPanel in @($program.Panels)) {
                if (@($otherPanel.Buttons | Where-Object { [string]$_.Kind -eq 'macro' -and [string]$_.Target -eq $target }).Count -gt 0) {
                    $stillUsed = $true
                    break
                }
            }
            if ($stillUsed) { break }
        }
        if (-not $stillUsed -and $script:State.ActionHotkeys.Contains($target)) {
            $script:State.ActionHotkeys.Remove($target)
        }
    }

    Save-FlowCellState
    [void](Invoke-FlowCellBlenderButtonDeleteCleanup -Entry $Entry)
    Save-State
    Restart-Backend
    return $true
}

function Rename-FlowCellButton([int]$ProgramTabId, [string]$PanelId, [string]$ButtonId, [string]$NewLabel) {
    if ([string]::IsNullOrWhiteSpace($NewLabel)) { return $false }
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $programState -or $null -eq $panel) { return $false }
    $button = @($panel.Buttons | Where-Object { [string]$_.Id -eq [string]$ButtonId } | Select-Object -First 1)
    if (@($button).Count -eq 0) { return $false }
    $button[0].Label = $NewLabel.Trim()
    Save-FlowCellState
    return $true
}

function Move-FlowCellFileToRecycleBin([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

function Move-FlowCellDirectoryToRecycleBin([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        return
    }

    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

function Invoke-FlowCellBlenderButtonDeleteCleanup($Entry) {
    if ($null -eq $Entry) { return $false }
    $programTab = if ($Entry.PSObject.Properties['ProgramTab'] -and $Entry.ProgramTab) { $Entry.ProgramTab } else { Get-FlowCellProgramTab -ProgramTabId ([int]$Entry.ProgramTabId) }
    if ($null -eq $programTab -or (Get-ProgramLabelKey ([string]$programTab.Label)) -ne 'blender') {
        return $false
    }

    $configPath = Get-FlowCellBlenderConfigPath
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        return $false
    }

    $targetPath = [string]$Entry.Target
    $normalizedTargetPath = Get-FlowCellNormalizedPath $targetPath
    $wrapperAction = Get-FlowCellWrapperAction -ScriptPath $targetPath
    if ([string]::IsNullOrWhiteSpace($normalizedTargetPath) -and [string]::IsNullOrWhiteSpace($wrapperAction)) {
        return $false
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($null -eq $config.buttons) {
        $config | Add-Member -MemberType NoteProperty -Name buttons -Value @() -Force
    }

    $removedActions = New-Object System.Collections.Generic.List[string]
    $remainingButtons = New-Object System.Collections.Generic.List[object]
    foreach ($button in @($config.buttons)) {
        $buttonScriptPath = if ($button.PSObject.Properties['scriptPath']) { Get-FlowCellNormalizedPath ([string]$button.scriptPath) } else { '' }
        $buttonAction = if ($button.PSObject.Properties['action']) { [string]$button.action } else { '' }
        $matchesTarget = (-not [string]::IsNullOrWhiteSpace($normalizedTargetPath) -and -not [string]::IsNullOrWhiteSpace($buttonScriptPath) -and $buttonScriptPath -eq $normalizedTargetPath)
        $matchesAction = (-not [string]::IsNullOrWhiteSpace($wrapperAction) -and -not [string]::IsNullOrWhiteSpace($buttonAction) -and $buttonAction -ieq $wrapperAction)
        if ($matchesTarget -or $matchesAction) {
            if (-not [string]::IsNullOrWhiteSpace($buttonAction) -and -not $removedActions.Contains($buttonAction)) {
                [void]$removedActions.Add($buttonAction)
            }
            continue
        }
        [void]$remainingButtons.Add($button)
    }

    if (@($config.buttons).Count -eq $remainingButtons.Count) {
        return $false
    }

    $config.buttons = @($remainingButtons.ToArray())
    Set-Content -LiteralPath $configPath -Value ($config | ConvertTo-Json -Depth 16) -Encoding UTF8

    $bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config
    $bridgeFolder = [string]$bridgeLayout.BridgeFolder
    $customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
    if (-not [string]::IsNullOrWhiteSpace($customRegistryPath)) {
        $registry = [pscustomobject]@{ actions = @() }
        if (Test-Path -LiteralPath $customRegistryPath -PathType Leaf) {
            try {
                $registry = Get-Content -LiteralPath $customRegistryPath -Raw | ConvertFrom-Json
                if ($null -eq $registry.actions) {
                    $registry | Add-Member -MemberType NoteProperty -Name actions -Value @() -Force
                }
            }
            catch {
                $registry = [pscustomobject]@{ actions = @() }
            }
        }

        $managedRoot = Get-FlowCellNormalizedPath (Join-Path $script:FlowCellHomeRoot 'Programs\Blender\ManagedActions')
        $liveActionsPath = Get-FlowCellNormalizedPath ([string]$bridgeLayout.AddonActionsPath)
        $prunedSourcePaths = New-Object System.Collections.Generic.List[string]
        $remainingRegistry = New-Object System.Collections.Generic.List[object]
        foreach ($registryEntry in @($registry.actions)) {
            $registryAction = if ($registryEntry.PSObject.Properties['action']) { [string]$registryEntry.action } else { '' }
            if (
                -not [string]::IsNullOrWhiteSpace($registryAction) -and
                $removedActions.Contains($registryAction) -and
                @($config.buttons | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $registryAction }).Count -eq 0
            ) {
                $sourcePath = if ($registryEntry.PSObject.Properties['sourcePythonPath'] -and -not [string]::IsNullOrWhiteSpace([string]$registryEntry.sourcePythonPath)) {
                    Get-FlowCellNormalizedPath ([string]$registryEntry.sourcePythonPath)
                }
                elseif ($registryEntry.PSObject.Properties['pythonPath']) {
                    Get-FlowCellNormalizedPath ([string]$registryEntry.pythonPath)
                }
                else {
                    ''
                }
                if (
                    -not [string]::IsNullOrWhiteSpace($sourcePath) -and
                    $sourcePath -ne $liveActionsPath -and
                    $sourcePath.StartsWith($managedRoot)
                ) {
                    [void]$prunedSourcePaths.Add($sourcePath)
                }
                continue
            }
            [void]$remainingRegistry.Add($registryEntry)
        }

        $registry.actions = @($remainingRegistry.ToArray())
        Set-Content -LiteralPath $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8

        foreach ($sourcePath in @($prunedSourcePaths.ToArray() | Select-Object -Unique)) {
            Move-FlowCellFileToRecycleBin -Path $sourcePath
        }
    }

    $supportRoot = Get-FlowCellBlenderSupportFolder
    $customActionSyncPath = Join-Path $supportRoot 'Sync-BlenderCustomActionCode.ps1'
    if (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf) {
        & $customActionSyncPath -ConfigPath $configPath -BridgeFolder $bridgeFolder | Out-Null
    }

    $script:FlowCellState = Read-FlowCellState
    return $true
}

function Show-BindViewerWindow([int]$ProgramTabId) {
    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    if ($null -eq $programTab) { return }

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Bind Viewer"
        Width="760"
        Height="560"
        WindowStartupLocation="CenterOwner"
        Background="#FF1D2128"
        Foreground="#FFF2F2F2">
    <Border Margin="14" Padding="16" Background="#FF262B33" CornerRadius="16">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
            </Grid.RowDefinitions>
            <TextBlock x:Name="ViewerTitle" Grid.Row="0" FontSize="20" FontWeight="SemiBold" Margin="0,0,0,12">Bind Viewer</TextBlock>
            <TextBox x:Name="FilterBox" Grid.Row="1" MinHeight="36" Margin="0,0,0,12" Padding="10,6" VerticalContentAlignment="Center" />
            <DataGrid x:Name="BindGrid"
                      Grid.Row="2"
                      AutoGenerateColumns="False"
                      CanUserAddRows="False"
                      CanUserDeleteRows="False"
                      IsReadOnly="True"
                      SelectionMode="Extended"
                      SelectionUnit="FullRow"
                      HeadersVisibility="Column"
                      RowHeaderWidth="0"
                      GridLinesVisibility="Horizontal"
                      AlternatingRowBackground="#FF303743"
                      Background="#FF262B33"
                      Foreground="#FFF2F2F2">
                <DataGrid.Resources>
                    <Style TargetType="DataGridColumnHeader">
                        <Setter Property="Background" Value="#FF1A1F26" />
                        <Setter Property="Foreground" Value="#FFF2F2F2" />
                        <Setter Property="BorderBrush" Value="#FF4B5563" />
                        <Setter Property="BorderThickness" Value="0,0,1,1" />
                        <Setter Property="Padding" Value="8,6" />
                    </Style>
                    <Style TargetType="DataGridCell">
                        <Setter Property="Foreground" Value="#FFF2F2F2" />
                        <Setter Property="Background" Value="#FF262B33" />
                        <Setter Property="BorderBrush" Value="#FF4B5563" />
                        <Setter Property="BorderThickness" Value="0,0,1,1" />
                        <Setter Property="Padding" Value="6,4" />
                        <Style.Triggers>
                            <Trigger Property="IsSelected" Value="True">
                                <Setter Property="Background" Value="#FF0E7AD1" />
                                <Setter Property="Foreground" Value="#FFFFFFFF" />
                            </Trigger>
                        </Style.Triggers>
                    </Style>
                    <Style TargetType="DataGridRow">
                        <Setter Property="Foreground" Value="#FFF2F2F2" />
                        <Setter Property="Background" Value="#FF262B33" />
                        <Style.Triggers>
                            <Trigger Property="IsSelected" Value="True">
                                <Setter Property="Background" Value="#FF0E7AD1" />
                                <Setter Property="Foreground" Value="#FFFFFFFF" />
                            </Trigger>
                        </Style.Triggers>
                    </Style>
                </DataGrid.Resources>
                <DataGrid.Columns>
                    <DataGridTextColumn Header="Shortcut" Binding="{Binding Shortcut}" Width="170" />
                    <DataGridTextColumn Header="Bound Action" Binding="{Binding Action}" Width="250" />
                    <DataGridTextColumn Header="Type" Binding="{Binding Type}" Width="110" />
                    <DataGridTextColumn Header="Panel" Binding="{Binding Panel}" Width="*" />
                </DataGrid.Columns>
            </DataGrid>
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $owner = Get-DialogOwnerWindow
    if ($owner) { $window.Owner = $owner }
    $window.FindName('ViewerTitle').Text = ('Bind Viewer - {0}' -f $programTab.Label)
    $filterBox = $window.FindName('FilterBox')
    $filterBox.Text = 'Filter binds'
    $bindGrid = $window.FindName('BindGrid')
    $allRows = @(Get-FlowCellBindRows -ProgramTabId $ProgramTabId)
    $bindGrid.ContextMenu = New-Object System.Windows.Controls.ContextMenu
    $deleteMenuItem = New-Object System.Windows.Controls.MenuItem
    $deleteMenuItem.Header = 'Delete Bind'
    $bindGrid.ContextMenu.Items.Add($deleteMenuItem) | Out-Null
    $refresh = {
        $allRows = @(Get-FlowCellBindRows -ProgramTabId $ProgramTabId)
        $term = [string]$filterBox.Text
        $rows = if ([string]::IsNullOrWhiteSpace($term) -or $term -eq 'Filter binds') {
            @($allRows)
        }
        else {
            @($allRows | Where-Object {
                ([string]$_.Shortcut -like ('*{0}*' -f $term)) -or
                ([string]$_.Action -like ('*{0}*' -f $term)) -or
                ([string]$_.Type -like ('*{0}*' -f $term)) -or
                ([string]$_.Panel -like ('*{0}*' -f $term))
            })
        }
        $bindGrid.ItemsSource = $null
        $bindGrid.ItemsSource = @($rows)
    }.GetNewClosure()
    $filterBox.Add_GotFocus({
        if ($filterBox.Text -eq 'Filter binds') { $filterBox.Text = '' }
    })
    $filterBox.Add_LostFocus({
        if ([string]::IsNullOrWhiteSpace($filterBox.Text)) { $filterBox.Text = 'Filter binds' }
        & $refresh
    })
    $filterBox.Add_TextChanged({ & $refresh }.GetNewClosure())
    $bindGrid.Add_PreviewMouseRightButtonDown({
        param($sender, $eventArgs)
        try {
            $dep = [System.Windows.DependencyObject]$eventArgs.OriginalSource
            while ($dep -and -not ($dep -is [System.Windows.Controls.DataGridRow])) {
                $dep = [System.Windows.Media.VisualTreeHelper]::GetParent($dep)
            }
            if ($dep -and $dep.Item) {
                $clickedItem = $dep.Item
                $alreadySelected = $false
                foreach ($selectedItem in @($bindGrid.SelectedItems)) {
                    if ($selectedItem -eq $clickedItem) {
                        $alreadySelected = $true
                        break
                    }
                }
                if (-not $alreadySelected) {
                    $bindGrid.SelectedItem = $clickedItem
                }
            }
        }
        catch {
        }
    }.GetNewClosure())
    $deleteMenuItem.Add_Click({
        $selectedRows = @($bindGrid.SelectedItems)
        if (@($selectedRows).Count -eq 0 -and $bindGrid.SelectedItem) { $selectedRows = @($bindGrid.SelectedItem) }
        if (@($selectedRows).Count -eq 0) { return }
        $confirmText = if (@($selectedRows).Count -gt 1) { 'Delete {0} selected binds?' -f @($selectedRows).Count } else { 'Delete bind for {0}?' -f [string]$selectedRows[0].Action }
        if ([System.Windows.MessageBox]::Show($window, $confirmText, 'Bind Viewer', 'YesNo', 'Question') -ne 'Yes') { return }
        $removedAny = $false
        foreach ($selectedRow in @($selectedRows)) {
            if (Remove-FlowCellBindEntry $selectedRow) {
                $removedAny = $true
            }
        }
        if ($removedAny) {
            Invoke-FlowCellMainRefresh
            & $refresh
        }
    }.GetNewClosure())
    & $refresh
    [void]$window.ShowDialog()
}

function Show-FlowCellButtonPopoutWindow {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProgramTabId,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [object[]]$Entries,
        [ValidateSet('Group', 'Individual')]
        [string]$LayoutMode = 'Group',
        [scriptblock]$OnStateChanged = $null
    )

    $resolvedEntries = @($Entries | Where-Object { $null -ne $_ -and $_.PSObject.Properties['Button'] -and $null -ne $_.Button })
    if (@($resolvedEntries).Count -eq 0) { return }
    $resolvedLayoutMode = Get-FlowCellNormalizedToolPopoutLayoutMode -LayoutMode $LayoutMode
    if ([string]$resolvedLayoutMode -eq 'Individual' -and @($resolvedEntries).Count -gt 1) {
        $resolvedLayoutMode = 'Group'
    }
    $stateButtonIds = @($resolvedEntries | ForEach-Object { [string]$_.Button.Id })
    $targetKeys = @(
        foreach ($entry in @($resolvedEntries)) {
            $entryProgramTabId = if ($entry.PSObject.Properties['ProgramTabId']) {
                [int]$entry.ProgramTabId
            }
            elseif ($entry.PSObject.Properties['ProgramTab'] -and $entry.ProgramTab -and $entry.ProgramTab.PSObject.Properties['Id']) {
                [int]$entry.ProgramTab.Id
            }
            else {
                [int]$ProgramTabId
            }
            Get-FlowCellButtonPopoutTargetKey -ProgramTabId $entryProgramTabId -PanelId ([string]$entry.PanelId) -ButtonId ([string]$entry.Button.Id)
        }
    )
    $sortedTargetKeys = @($targetKeys | Sort-Object)
    $windowKey = 'tools|{0}|{1}' -f $resolvedLayoutMode, ($sortedTargetKeys -join ';')

    if (-not ($script:FlowCellToolPopoutWindows -is [hashtable])) { $script:FlowCellToolPopoutWindows = @{} }
    if (-not ($script:FlowCellToolPopoutTargets -is [hashtable])) { $script:FlowCellToolPopoutTargets = @{} }

    if ($script:FlowCellToolPopoutWindows.ContainsKey($windowKey)) {
        $existing = $script:FlowCellToolPopoutWindows[$windowKey]
        if ($existing -and $existing.Window -and $existing.Window.IsLoaded -and [string]$existing.Window.Tag -ne 'closing' -and [string]$existing.Window.Tag -ne 'shutdown') {
            if ($existing.Refresh -is [scriptblock]) { & $existing.Refresh }
            if ($existing.PSObject.Properties['PopoutId'] -and (Invoke-FlowCellClusterSafe 'show-existing-panel' { Bring-FlowCellPopoutClusterToFrontByPopoutId -PopoutId ([string]$existing.PopoutId) })) {
                return
            }
            Show-FlowCellWindowFront -Window $existing.Window
            return
        }
        $script:FlowCellToolPopoutWindows.Remove($windowKey)
    }

    $programTab = Get-FlowCellProgramTab -ProgramTabId $ProgramTabId
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
    if ($null -eq $programTab -or $null -eq $panel) { return }
    $toolPopoutState = Set-FlowCellToolPopoutState -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $resolvedLayoutMode

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="FlowCell Tools"
        Width="760"
        Height="420"
        MinWidth="96"
        MinHeight="48"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None"
        ResizeMode="CanResizeWithGrip"
        Background="#FF171B22"
        Foreground="#FFF2F2F2">
    <Border Margin="0" Padding="0" Background="#FF171B22" CornerRadius="0">
        <Grid>
            <ContentControl x:Name="ToolHost" Margin="0" />
            <Button x:Name="ToolMoveGrabber"
                    Width="14"
                    Height="14"
                    HorizontalAlignment="Left"
                    VerticalAlignment="Top"
                    Margin="0"
                    Padding="0"
                    Opacity="0.5"
                    Content=""
                    Background="#FF8A96A8"
                    BorderBrush="#FFD7DEE8"
                    BorderThickness="1"
                    Cursor="SizeAll"
                    ToolTip="Drag popout" />
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $window = [Windows.Markup.XamlReader]::Load($reader)
    Enable-FlowCellTaskbarCloseSupport -Window $window
    $window.ShowInTaskbar = $false
    if ([bool]$script:FlowCellStartupRestoreInProgress) {
        $window.ShowActivated = $false
    }
    $window.SizeToContent = 'Manual'
    $hasSavedToolBounds = $false
    if ($toolPopoutState -and $toolPopoutState.PSObject.Properties['Bounds'] -and $toolPopoutState.Bounds -and (Test-FlowCellPopoutBoundsVisible $toolPopoutState.Bounds)) {
        $hasSavedToolBounds = $true
        $window.WindowStartupLocation = 'Manual'
        $window.Left = [double]$toolPopoutState.Bounds.Left
        $window.Top = [double]$toolPopoutState.Bounds.Top
        $window.Width = [Math]::Max([double]$toolPopoutState.Bounds.Width, [double]$window.MinWidth)
        $window.Height = [Math]::Max([double]$toolPopoutState.Bounds.Height, [double]$window.MinHeight)
    }
    $window.Title = if (@($resolvedEntries).Count -eq 1) {
        'FlowCell - {0} - {1}' -f $programTab.Label, [string]$resolvedEntries[0].Button.Label
    }
    else {
        'FlowCell - {0} - {1} tools' -f $programTab.Label, @($resolvedEntries).Count
    }

    $toolHost = $window.FindName('ToolHost')
    $toolMoveGrabber = $window.FindName('ToolMoveGrabber')

    $ownerSyncTimer = New-Object System.Windows.Threading.DispatcherTimer
    $ownerSyncTimer.Interval = [TimeSpan]::FromMilliseconds(900)
    $primaryButtonId = if (@($stateButtonIds).Count -gt 0) { [string]$stateButtonIds[0] } else { '' }
    $popoutId = Get-FlowCellToolButtonPopoutId -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonId $primaryButtonId
    $windowEntry = [pscustomobject]@{
        Window = $window
        Refresh = $null
        Kind = 'Tool'
        ProgramTabId = [int]$ProgramTabId
        PanelId = [string]$PanelId
        ButtonIds = @($stateButtonIds)
        LayoutMode = [string]$resolvedLayoutMode
        TargetKeys = @($targetKeys)
        OwnerSyncTimer = $ownerSyncTimer
        CurrentTopmost = $false
        CurrentOwnerHandle = 0
        PopoutId = $popoutId
        ClusterId = ''
        SuppressSnapHandling = $false
        InitializedSize = [bool]$hasSavedToolBounds
    }
    $script:FlowCellToolPopoutWindows[$windowKey] = $windowEntry
    foreach ($targetKey in @($targetKeys)) {
        $script:FlowCellToolPopoutTargets[[string]$targetKey] = $windowKey
    }
    Enable-FlowCellPopoutGrabberDrag -Grabber $toolMoveGrabber -Window $window -Entry $windowEntry

    $updateWindowTopmost = {
        $ownership = Update-FlowCellPopoutWindowOwnership -Window $window -ProgramTab $programTab -WindowEntry $windowEntry
        if ([bool]$ownership.OwnerChanged -and [long]$ownership.OwnerHandle -ne 0) {
            Push-FlowCellWindowAboveOwner -Window $window
        }
    }.GetNewClosure()

    $refreshWindow = {
        $buttonScale = Get-FlowCellButtonScale
        $availableWidth = [Math]::Max($(if ([double]$window.ActualWidth -gt 0) { [double]$window.ActualWidth } else { [double]$window.Width }), 120.0)
        $availableHeight = [Math]::Max($(if ([double]$window.ActualHeight -gt 0) { [double]$window.ActualHeight } else { [double]$window.Height }), 70.0)

        if ([string]$resolvedLayoutMode -eq 'Group') {
            $container = New-Object System.Windows.Controls.Primitives.UniformGrid
            $container.Margin = '0'

            $buttonCount = [Math]::Max((Get-FlowCellRenderedButtonCount -Buttons @($resolvedEntries | ForEach-Object { $_.Button })), 1)
            $targetAspect = 164.0 / 56.0
            $bestColumns = 1
            $bestRows = $buttonCount
            $bestScore = [double]::PositiveInfinity
            for ($candidateColumns = 1; $candidateColumns -le $buttonCount; $candidateColumns++) {
                $candidateRows = [int][Math]::Ceiling($buttonCount / [double]$candidateColumns)
                $cellWidth = $availableWidth / [double]$candidateColumns
                $cellHeight = $availableHeight / [double]$candidateRows
                $aspectScore = [Math]::Abs(($cellWidth / [Math]::Max($cellHeight, 1.0)) - $targetAspect)
                $rowPenalty = [Math]::Abs($candidateRows - [Math]::Max([Math]::Round($availableHeight / 70.0), 1.0)) * 0.08
                $score = $aspectScore + $rowPenalty
                if ($score -lt $bestScore) {
                    $bestScore = $score
                    $bestColumns = $candidateColumns
                    $bestRows = $candidateRows
                }
            }
            if ($container.PSObject.Properties['Columns']) { $container.Columns = [int]$bestColumns }
            if ($container.PSObject.Properties['Rows']) { $container.Rows = [int]$bestRows }

            $cellWidthForFont = $availableWidth / [double][Math]::Max($bestColumns, 1)
            $cellHeightForFont = $availableHeight / [double][Math]::Max($bestRows, 1)
            $paddingX = [Math]::Max([int][Math]::Round([Math]::Min(6 * $buttonScale, $cellHeightForFont * 0.08)), 0)
            $paddingY = [Math]::Max([int][Math]::Round([Math]::Min(4 * $buttonScale, $cellHeightForFont * 0.05)), 0)
            $buttonPadding = ('{0},{1}' -f $paddingX, $paddingY)
            $buttonFontSize = [Math]::Max([double][Math]::Min([Math]::Round([Math]::Min($cellHeightForFont * 0.42, $cellWidthForFont * 0.12), 1), 28.0), 5.0)
            $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
            $sourcePanel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
            $smartAxisOwnerButton = Get-FlowCellSmartAxisOwnerButtonFromPanel -Panel $sourcePanel
            $smartAxisOwnerButtonId = if ($smartAxisOwnerButton) { [string]$smartAxisOwnerButton.Id } else { '' }

            foreach ($entry in @($resolvedEntries)) {
                $button = Ensure-FlowCellButtonStateLayer $entry.Button
                if (Test-FlowCellSmartAxisStateButton $button) {
                    if ([string]$button.Id -ne $smartAxisOwnerButtonId) {
                        continue
                    }
                    try {
                        $smartAxisControl = New-FlowCellSmartAxisLockToolControl -Button $smartAxisOwnerButton -ProgramTab $programTab -PanelId $PanelId -Surface 'ToolPopoutGroup' -Width ([Math]::Round(338 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8))
                        $wrappedSmartAxis = New-FlowCellPopoutButtonHost -Content $smartAxisControl -Button $smartAxisOwnerButton -ProgramTabId ([int]$ProgramTabId) -PanelId ([string]$PanelId) -ButtonGrid $container
                        [void]$container.Children.Add($wrappedSmartAxis)
                        continue
                    }
                    catch {
                        Write-UiLog ('Smart Axis Lock control render failed in grouped tool popout: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                    }
                }
                $buttonTooltip = Resolve-FlowCellButtonTooltip -Button $button -ProgramTab $entry.ProgramTab
                $buttonTag = [pscustomobject]@{
                    Button = $button
                    ProgramTab = if ($entry.PSObject.Properties['ProgramTab'] -and $entry.ProgramTab) { $entry.ProgramTab } else { $programTab }
                    PanelId = [string]$entry.PanelId
                }
                $buttonControl = New-FlowCellHostButtonControl `
                    -Label ([string]$button.Label) `
                    -Tag $buttonTag `
                    -Tooltip $buttonTooltip `
                    -Width ([double]::NaN) `
                    -Height ([double]::NaN) `
                    -Padding $buttonPadding `
                    -FontSize $buttonFontSize `
                    -OnClick ({
                    param($sender, $eventArgs)
                    $tag = $sender.Tag
                    $result = Invoke-FlowCellButtonAction -Button $tag.Button -ProgramTab $tag.ProgramTab -PanelId ([string]$tag.PanelId) -Surface 'ToolPopoutGroup'
                    if (-not $result.Succeeded) {
                        Set-ActionStatus ([string]$result.Message)
                    }
                })
                $wrappedButton = New-FlowCellPopoutButtonHost -Content $buttonControl -Button $button -ProgramTabId ([int]$ProgramTabId) -PanelId ([string]$PanelId) -ButtonGrid $container
                [void]$container.Children.Add($wrappedButton)
            }

            $toolHost.Content = $container
            $window.MinWidth = 80.0
            $window.MinHeight = 24.0
            if (-not [bool]$windowEntry.InitializedSize) {
                $windowEntry.InitializedSize = $true
            }
            return
        }

        $container = New-Object System.Windows.Controls.Grid
        $container.Margin = '0'
        $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
        $sourcePanel = Get-FlowCellPanel -ProgramState $programState -PanelId $PanelId
        $smartAxisOwnerButton = Get-FlowCellSmartAxisOwnerButtonFromPanel -Panel $sourcePanel
        $smartAxisOwnerButtonId = if ($smartAxisOwnerButton) { [string]$smartAxisOwnerButton.Id } else { '' }
        foreach ($entry in @($resolvedEntries)) {
            $button = Ensure-FlowCellButtonStateLayer $entry.Button
            if (Test-FlowCellSmartAxisStateButton $button) {
                if ([string]$button.Id -ne $smartAxisOwnerButtonId) {
                    continue
                }
                try {
                    $smartAxisControl = New-FlowCellSmartAxisLockToolControl -Button $smartAxisOwnerButton -ProgramTab $programTab -PanelId $PanelId -Surface 'ToolPopoutIndividual' -Width ([Math]::Round(338 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8))
                    $wrappedSmartAxis = New-FlowCellPopoutButtonHost -Content $smartAxisControl -Button $smartAxisOwnerButton -ProgramTabId ([int]$ProgramTabId) -PanelId ([string]$PanelId) -ButtonGrid $container
                    [void]$container.Children.Add($wrappedSmartAxis)
                    continue
                }
                catch {
                    Write-UiLog ('Smart Axis Lock control render failed in tool popout: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            if (Test-FlowCellCompoundToolButton $button) {
                try {
                    $compoundControl = New-FlowCellCompoundToolControl -Button $button -ProgramTab $entry.ProgramTab -PanelId ([string]$entry.PanelId) -Width ([Math]::Round(360 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8)) -Surface 'ToolPopoutCompound'
                    if ($compoundControl) {
                        $compoundControl.Margin = '0'
                        [void]$container.Children.Add($compoundControl)
                        continue
                    }
                }
                catch {
                    Write-UiLog ('Compound tool render failed in tool popout: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            if (Test-FlowCellFlattenRevolveToolButton $button) {
                try {
                    $flattenRevolveControl = New-FlowCellFlattenRevolveToolControl -Button $button -ProgramTab $ProgramTab -PanelId $PanelId -Surface 'ToolPopoutGroup' -Width 290 -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8))
                    $flattenRevolveControl.Margin = '0'
                    [void]$container.Children.Add($flattenRevolveControl)
                    continue
                }
                catch {
                    Write-UiLog ('Flatten/revolve control render failed in tool popout: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            $buttonPadding = ('{0},{1}' -f [Math]::Max([int][Math]::Round(6 * $buttonScale), 1), [Math]::Max([int][Math]::Round(4 * $buttonScale), 1))
            $buttonFontSize = [Math]::Max([double][Math]::Round(14 * $buttonScale, 1), 8)
            $button = Ensure-FlowCellButtonStateLayer $button
            $buttonTooltip = Resolve-FlowCellButtonTooltip -Button $button -ProgramTab $entry.ProgramTab
            $buttonTag = [pscustomobject]@{
                Button = $button
                ProgramTab = if ($entry.PSObject.Properties['ProgramTab'] -and $entry.ProgramTab) { $entry.ProgramTab } else { $programTab }
                PanelId = [string]$entry.PanelId
            }
            $buttonControl = New-FlowCellHostButtonControl `
                -Label ([string]$button.Label) `
                -Tag $buttonTag `
                -Tooltip $buttonTooltip `
                -Width ([double]::NaN) `
                -Height ([double]::NaN) `
                -Padding $buttonPadding `
                -FontSize $buttonFontSize `
                -OnClick ({
                param($sender, $eventArgs)
                $tag = $sender.Tag
                $result = Invoke-FlowCellButtonAction -Button $tag.Button -ProgramTab $tag.ProgramTab -PanelId ([string]$tag.PanelId) -Surface 'ToolPopoutIndividual'
                if (-not $result.Succeeded) {
                    Set-ActionStatus ([string]$result.Message)
                }
            })
            $wrappedButton = New-FlowCellPopoutButtonHost -Content $buttonControl -Button $button -ProgramTabId ([int]$ProgramTabId) -PanelId ([string]$PanelId) -ButtonGrid $container
            [void]$container.Children.Add($wrappedButton)
        }

        $toolHost.Content = $container
        $container.Measure((New-Object System.Windows.Size([double]::PositiveInfinity, [double]::PositiveInfinity)))
        $desiredSize = $container.DesiredSize
        $contentWidth = [Math]::Max([double]$desiredSize.Width + 2.0, 96.0)
        $contentHeight = [Math]::Max([double]$desiredSize.Height + 2.0, 48.0)
        $window.MinWidth = [Math]::Min($contentWidth, 320.0)
        $window.MinHeight = [Math]::Min($contentHeight, 220.0)
        if (-not [bool]$windowEntry.InitializedSize) {
            $window.Width = $contentWidth
            $window.Height = $contentHeight
            $windowEntry.InitializedSize = $true
        }
    }.GetNewClosure()

    $windowEntry.Refresh = $refreshWindow
    $window.Add_LocationChanged({
        try {
            Save-FlowCellToolPopoutWindowBounds -Window $window -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $resolvedLayoutMode
            $cluster = Invoke-FlowCellClusterSafe 'tool-location-changed:get-cluster' { Get-FlowCellClusterEntryForPopoutId -PopoutId ([string]$windowEntry.PopoutId) }
            if ($cluster) {
                Invoke-FlowCellClusterSafe 'tool-location-changed:update-grabber' { Update-FlowCellClusterGrabberWindow -ClusterEntry $cluster } | Out-Null
            }
        }
        catch {
            Write-UiLog ('FlowCell tool popout move handler failed. ProgramTabId={0}; PanelId={1}; Error={2}' -f $ProgramTabId, [string]$PanelId, $_.Exception.ToString())
        }
    }.GetNewClosure())
    $window.Add_SizeChanged({
        try {
            Save-FlowCellToolPopoutWindowBounds -Window $window -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $resolvedLayoutMode
            if ($windowEntry.Refresh -is [scriptblock]) {
                & $windowEntry.Refresh
            }
        }
        catch {
            Write-UiLog ('FlowCell tool popout resize handler failed. ProgramTabId={0}; PanelId={1}; Error={2}' -f $ProgramTabId, [string]$PanelId, $_.Exception.ToString())
        }
    }.GetNewClosure())
    $ownerSyncTimer.Add_Tick({
        if (-not $window.IsLoaded -or [string]$window.Tag -eq 'closing' -or [string]$window.Tag -eq 'shutdown') {
            $ownerSyncTimer.Stop()
            return
        }
        & $updateWindowTopmost
    }.GetNewClosure())
    $window.Add_Activated({
        try {
            Register-FlowCellTaskbarPreviewTab -Window $window
            $ownerHandle = Get-FlowCellWindowHandle $script:FlowCellWindow
            $childHandle = Get-FlowCellWindowHandle $window
            if ($ownerHandle -ne 0 -and $childHandle -ne 0) {
                [FlowCellTaskbarTabs]::SetTabActive($childHandle, $ownerHandle)
            }
            & $updateWindowTopmost
            Push-FlowCellWindowAboveOwner -Window $window
        }
        catch {
        }
    }.GetNewClosure())
    $window.Add_Closing({
        Unregister-FlowCellTaskbarPreviewTab -Window $window
    }.GetNewClosure())
    $window.Add_Closed({
        try {
            $closeTag = [string]$window.Tag
            $window.Tag = 'closing'
            if ($ownerSyncTimer) { $ownerSyncTimer.Stop() }
            Save-FlowCellToolPopoutWindowBounds -Window $window -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $resolvedLayoutMode
            if ($closeTag -ne 'shutdown' -and $windowEntry.PSObject.Properties['PopoutId']) {
                Invoke-FlowCellClusterSafe 'tool-close:remove-cluster' { Remove-FlowCellPopoutFromCluster -PopoutId ([string]$windowEntry.PopoutId) } | Out-Null
            }
            if ($script:FlowCellToolPopoutWindows -and $script:FlowCellToolPopoutWindows.ContainsKey($windowKey)) {
                $script:FlowCellToolPopoutWindows.Remove($windowKey)
            }
            foreach ($targetKey in @($targetKeys)) {
                if ($script:FlowCellToolPopoutTargets -and $script:FlowCellToolPopoutTargets.ContainsKey([string]$targetKey)) {
                    $script:FlowCellToolPopoutTargets.Remove([string]$targetKey) | Out-Null
                }
                if ($script:FlowCellSelectedButtonKeys -and $script:FlowCellSelectedButtonKeys.ContainsKey([string]$targetKey)) {
                    $script:FlowCellSelectedButtonKeys.Remove([string]$targetKey) | Out-Null
                }
            }
            if ($closeTag -ne 'shutdown') {
                Remove-FlowCellToolPopoutState -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $resolvedLayoutMode
                Save-FlowCellState
            }
            if ($OnStateChanged -is [scriptblock]) { & $OnStateChanged }
            Invoke-FlowCellMainRefreshAsync
        }
        catch {
            Write-UiLog ('FlowCell tool popout close failed: {0}' -f $_.Exception.ToString())
        }
    }.GetNewClosure())

    & $refreshWindow
    [void]$window.Show()
    Register-FlowCellTaskbarPreviewTab -Window $window
    Set-FlowCellWindowEnabledState -Window $window -IsEnabled $true
    Save-FlowCellToolPopoutWindowBounds -Window $window -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $resolvedLayoutMode
    Save-FlowCellState
    & $updateWindowTopmost
    Push-FlowCellWindowAboveOwner -Window $window
    $ownerSyncTimer.Start()
}

function Show-FlowCellButtonPopoutSelection {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProgramTabId,
        [Parameter(Mandatory = $true)]
        [string]$PanelId,
        [Parameter(Mandatory = $true)]
        [object[]]$Entries,
        [ValidateSet('Group', 'Individual')]
        [string]$LayoutMode = 'Group',
        [scriptblock]$OnStateChanged = $null
    )

    $resolvedEntries = @($Entries | Where-Object { $null -ne $_ -and $_.PSObject.Properties['Button'] -and $null -ne $_.Button })
    if (@($resolvedEntries).Count -eq 0) {
        Clear-FlowCellButtonSelection -ProgramTabId $ProgramTabId -PanelId $PanelId
        Invoke-FlowCellMainRefresh
        Invoke-FlowCellMainRefreshAsync
        if ($OnStateChanged -is [scriptblock]) { & $OnStateChanged }
        return
    }

    $normalizedEntries = @()
    $normalizedEntryIds = New-Object System.Collections.Generic.HashSet[string]
    $smartAxisExpanded = $false
    foreach ($entry in @($resolvedEntries)) {
        if (Test-FlowCellSmartAxisStateButton $entry.Button) {
            if (-not $smartAxisExpanded) {
                foreach ($unitEntry in @(Get-FlowCellSmartAxisGroupEntries -ProgramTabId $ProgramTabId -PanelId $PanelId)) {
                    $unitButtonId = [string]$unitEntry.Button.Id
                    if ($normalizedEntryIds.Add($unitButtonId)) {
                        $normalizedEntries += $unitEntry
                    }
                }
                $smartAxisExpanded = $true
            }
            continue
        }

        $entryButtonId = [string]$entry.Button.Id
        if ($normalizedEntryIds.Add($entryButtonId)) {
            $normalizedEntries += $entry
        }
    }
    $resolvedEntries = @($normalizedEntries)

    $openedEntries = @()
    $openedEntryIds = New-Object System.Collections.Generic.HashSet[string]
    $addOpenedEntry = {
        param($Entry)
        if ($null -eq $Entry) { return }
        $entryId = if ($Entry.PSObject.Properties['PopoutId'] -and -not [string]::IsNullOrWhiteSpace([string]$Entry.PopoutId)) {
            [string]$Entry.PopoutId
        }
        else {
            [string]$Entry.Window.Title
        }
        if ($openedEntryIds.Add($entryId)) {
            $openedEntries += $Entry
        }
    }.GetNewClosure()
    $showEntryFront = {
        param($Entry)
        if ($null -eq $Entry) { return }
        if ($Entry.Refresh -is [scriptblock]) { & $Entry.Refresh }
        if (-not ($Entry.PSObject.Properties['PopoutId'] -and (Bring-FlowCellPopoutClusterToFrontByPopoutId -PopoutId ([string]$Entry.PopoutId)))) {
            Show-FlowCellWindowFront -Window $Entry.Window
        }
    }.GetNewClosure()
    $openOrReuseSelection = {
        param(
            [object[]]$DesiredEntries,
            [string]$DesiredLayoutMode
        )

        $resolvedDesiredEntries = @($DesiredEntries | Where-Object { $null -ne $_ -and $_.PSObject.Properties['Button'] -and $null -ne $_.Button })
        if (@($resolvedDesiredEntries).Count -eq 0) { return $null }

        $stateButtonIds = @($resolvedDesiredEntries | ForEach-Object { [string]$_.Button.Id })
        $targetKeys = @(
            foreach ($desiredEntry in @($resolvedDesiredEntries)) {
                $entryProgramTabId = if ($desiredEntry.PSObject.Properties['ProgramTabId']) {
                    [int]$desiredEntry.ProgramTabId
                }
                elseif ($desiredEntry.PSObject.Properties['ProgramTab'] -and $desiredEntry.ProgramTab -and $desiredEntry.ProgramTab.PSObject.Properties['Id']) {
                    [int]$desiredEntry.ProgramTab.Id
                }
                else {
                    [int]$ProgramTabId
                }
                Get-FlowCellButtonPopoutTargetKey -ProgramTabId $entryProgramTabId -PanelId ([string]$desiredEntry.PanelId) -ButtonId ([string]$desiredEntry.Button.Id)
            }
        )
        $existingEntries = @(Get-FlowCellLiveToolPopoutEntriesForTargetKeys -TargetKeys $targetKeys)
        $matchingEntry = @(
            $existingEntries |
                Where-Object {
                    Test-FlowCellToolPopoutEntryMatchesSpec -Entry $_ -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $DesiredLayoutMode
                } |
                Select-Object -First 1
        )
        if (@($matchingEntry).Count -gt 0) {
            $matchingEntry = $matchingEntry[0]
            & $showEntryFront $matchingEntry
            return $matchingEntry
        }

        foreach ($existingEntry in @($existingEntries)) {
            Close-FlowCellToolPopoutEntry -Entry $existingEntry
        }

        Show-FlowCellButtonPopoutWindow -ProgramTabId $ProgramTabId -PanelId $PanelId -Entries $resolvedDesiredEntries -LayoutMode $DesiredLayoutMode -OnStateChanged $OnStateChanged
        return @(
            Get-FlowCellLiveToolPopoutEntriesForTargetKeys -TargetKeys $targetKeys |
                Where-Object {
                    Test-FlowCellToolPopoutEntryMatchesSpec -Entry $_ -ProgramTabId $ProgramTabId -PanelId $PanelId -ButtonIds $stateButtonIds -LayoutMode $DesiredLayoutMode
                } |
                Select-Object -First 1
        )[0]
    }.GetNewClosure()

    $lockedGroupEntries = @()
    $chunkEntries = @()
    $individualEntries = @()
    foreach ($entry in @($resolvedEntries)) {
        if (Test-FlowCellSmartAxisStateButton $entry.Button) {
            $lockedGroupEntries += $entry
        }
        elseif (Test-FlowCellMultiButtonToolButton $entry.Button) {
            $individualEntries += $entry
        }
        else {
            $chunkEntries += $entry
        }
    }

    if ([string]$LayoutMode -eq 'Individual') {
        $individualEntries = @($individualEntries + $chunkEntries)
        $chunkEntries = @()
    }

    if (@($lockedGroupEntries).Count -gt 0) {
        $lockedEntry = & $openOrReuseSelection -DesiredEntries $lockedGroupEntries -DesiredLayoutMode 'Group'
        & $addOpenedEntry $lockedEntry
    }

    if (@($chunkEntries).Count -gt 0) {
        $chunkEntry = & $openOrReuseSelection -DesiredEntries $chunkEntries -DesiredLayoutMode $LayoutMode
        & $addOpenedEntry $chunkEntry
    }

    foreach ($entry in @($individualEntries)) {
        $individualEntry = & $openOrReuseSelection -DesiredEntries @($entry) -DesiredLayoutMode 'Individual'
        & $addOpenedEntry $individualEntry
    }
    Clear-FlowCellButtonSelection -ProgramTabId $ProgramTabId -PanelId $PanelId
    Invoke-FlowCellMainRefresh
    Invoke-FlowCellMainRefreshAsync
    if ($OnStateChanged -is [scriptblock]) { & $OnStateChanged }
}

function Refresh-FlowCellPanelWindows {
    foreach ($entry in @($script:FlowCellPanelWindows.GetEnumerator())) {
        try {
            if ($null -eq $entry.Value -or $null -eq $entry.Value.Window) {
                if ($script:FlowCellPanelWindows.ContainsKey([string]$entry.Key)) {
                    $script:FlowCellPanelWindows.Remove([string]$entry.Key)
                }
                continue
            }

            if (-not $entry.Value.Window.IsLoaded -or [string]$entry.Value.Window.Tag -eq 'closing' -or [string]$entry.Value.Window.Tag -eq 'shutdown') {
                if ($script:FlowCellPanelWindows.ContainsKey([string]$entry.Key)) {
                    $script:FlowCellPanelWindows.Remove([string]$entry.Key)
                }
                continue
            }

            if ($entry.Value.Refresh -is [scriptblock]) {
                $entry.Value.Refresh.Invoke()
            }
        }
        catch {
            Write-UiLog ('Refresh-FlowCellPanelWindows failed for {0}: {1}' -f [string]$entry.Key, $_.Exception.ToString())
            if ($script:FlowCellPanelWindows.ContainsKey([string]$entry.Key)) {
                $script:FlowCellPanelWindows.Remove([string]$entry.Key)
            }
        }
    }
    Repair-FlowCellPopoutState
}

function Refresh-FlowCellToolPopoutWindows {
    if (-not ($script:FlowCellToolPopoutWindows -is [hashtable])) { return }
    foreach ($entry in @($script:FlowCellToolPopoutWindows.GetEnumerator())) {
        try {
            if ($null -eq $entry.Value -or $null -eq $entry.Value.Window -or -not $entry.Value.Window.IsLoaded -or [string]$entry.Value.Window.Tag -eq 'closing' -or [string]$entry.Value.Window.Tag -eq 'shutdown') {
                if ($entry.Value -and $entry.Value.PSObject.Properties['TargetKeys']) {
                    foreach ($targetKey in @($entry.Value.TargetKeys)) {
                        if ($script:FlowCellToolPopoutTargets -and $script:FlowCellToolPopoutTargets.ContainsKey([string]$targetKey)) {
                            $script:FlowCellToolPopoutTargets.Remove([string]$targetKey) | Out-Null
                        }
                    }
                }
                if ($script:FlowCellToolPopoutWindows.ContainsKey([string]$entry.Key)) {
                    $script:FlowCellToolPopoutWindows.Remove([string]$entry.Key)
                }
                continue
            }
            if ($entry.Value.Refresh -is [scriptblock]) {
                $entry.Value.Refresh.Invoke()
            }
        }
        catch {
            Write-UiLog ('Refresh-FlowCellToolPopoutWindows failed for {0}: {1}' -f [string]$entry.Key, $_.Exception.ToString())
        }
    }
}

function Get-FlowCellPanelWindowActivePanelId([string]$WindowKey, [string]$FallbackPanelId) {
    if ($script:FlowCellPanelWindows -and $script:FlowCellPanelWindows.ContainsKey($WindowKey)) {
        $entry = $script:FlowCellPanelWindows[$WindowKey]
        if ($entry -and $entry.PSObject.Properties['ActivePanelId'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.ActivePanelId)) {
            return [string]$entry.ActivePanelId
        }
    }
    return [string]$FallbackPanelId
}

function Set-FlowCellPanelWindowActivePanelId([string]$WindowKey, [string]$PanelId) {
    if (-not $script:FlowCellPanelWindows) { return }
    if (-not $script:FlowCellPanelWindows.ContainsKey($WindowKey)) { return }
    $entry = $script:FlowCellPanelWindows[$WindowKey]
    if ($entry -and $entry.PSObject.Properties['ActivePanelId']) {
        $entry.ActivePanelId = [string]$PanelId
    }
}

function Invoke-FlowCellPanelWindowRefresh([string]$WindowKey) {
    if (-not $script:FlowCellPanelWindows) { return }
    if (-not $script:FlowCellPanelWindows.ContainsKey($WindowKey)) { return }
    $entry = $script:FlowCellPanelWindows[$WindowKey]
    if ($entry -and $entry.PSObject.Properties['Refresh'] -and $entry.Refresh -is [scriptblock]) {
        & $entry.Refresh
    }
}

function Step-FlowCellPanelWindowActivePanel([int]$ProgramTabId, [string]$WindowKey, [string]$FallbackPanelId) {
    $programState = Get-FlowCellProgramState -ProgramTabId $ProgramTabId
    if ($null -eq $programState) { return }
    $panelList = @($programState.Panels)
    if (@($panelList).Count -le 1) { return }

    $currentPanelId = Get-FlowCellPanelWindowActivePanelId -WindowKey $WindowKey -FallbackPanelId $FallbackPanelId
    $currentIndex = -1
    for ($index = 0; $index -lt @($panelList).Count; $index++) {
        if ([string]$panelList[$index].Id -eq [string]$currentPanelId) {
            $currentIndex = $index
            break
        }
    }
    if ($currentIndex -lt 0) { $currentIndex = 0 }

    $nextIndex = ($currentIndex + 1) % @($panelList).Count
    Set-FlowCellPanelWindowActivePanelId -WindowKey $WindowKey -PanelId ([string]$panelList[$nextIndex].Id)
    Invoke-FlowCellPanelWindowRefresh -WindowKey $WindowKey
}

function Invoke-FlowCellMainRefresh {
    try {
        if ((Get-Variable -Name FlowCellMainRefresh -Scope Script -ErrorAction SilentlyContinue).Value -is [scriptblock]) {
            & $script:FlowCellMainRefresh
        }
    }
    catch {
    }
}

function Invoke-FlowCellMainRefreshAsync {
    try {
        $dispatcher = [System.Windows.Application]::Current.Dispatcher
        if ($dispatcher) {
            $refreshAction = [System.Action]{
                Invoke-FlowCellMainRefresh
            }
            [void]$dispatcher.BeginInvoke($refreshAction)
            return
        }
    }
    catch {
    }
    Invoke-FlowCellMainRefresh
}

function Show-FlowCellPanelWindow {
    param(
        [int]$ProgramTabId,
        [string]$PanelId,
        [scriptblock]$OnStateChanged = $null
    )

    $windowProgramTabId = [int]$ProgramTabId
    $windowPanelId = [string]$PanelId
    $windowOnStateChanged = $OnStateChanged
    $windowKey = '{0}|{1}' -f $windowProgramTabId, $windowPanelId
    if ($script:FlowCellPanelWindows.ContainsKey($windowKey)) {
        $existing = $script:FlowCellPanelWindows[$windowKey]
        $existingTag = if ($existing.Window) { [string]$existing.Window.Tag } else { '' }
        if ($existing.Window -and $existing.Window.IsLoaded -and $existingTag -ne 'closing' -and $existingTag -ne 'shutdown') {
            if ($existing.Refresh -is [scriptblock]) {
                & $existing.Refresh
            }
            if ($existing.PSObject.Properties['PopoutId'] -and (Invoke-FlowCellClusterSafe 'show-existing-tool-popout' { Bring-FlowCellPopoutClusterToFrontByPopoutId -PopoutId ([string]$existing.PopoutId) })) {
                return
            }
            $existing.Window.WindowState = 'Normal'
            $existing.Window.Show()
            $existing.Window.Activate() | Out-Null
            Push-FlowCellWindowAboveOwner -Window $existing.Window
            return
        }
        $script:FlowCellPanelWindows.Remove($windowKey)
    }

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="FlowCell Panel"
        Width="820"
        Height="620"
        WindowStartupLocation="CenterOwner"
        WindowStyle="None"
        ResizeMode="CanResizeWithGrip"
        MinWidth="80"
        MinHeight="24"
        Background="#FF171B22"
        Foreground="#FFF2F2F2">
    <Border Margin="0" Padding="0" Background="#FF171B22" CornerRadius="0">
        <Grid>
            <UniformGrid x:Name="PanelButtonGrid" Margin="0" />
            <Button x:Name="PanelMoveGrabber"
                    Width="14"
                    Height="14"
                    HorizontalAlignment="Left"
                    VerticalAlignment="Top"
                    Margin="0"
                    Padding="0"
                    Opacity="0.5"
                    Content=""
                    Background="#FF8A96A8"
                    BorderBrush="#FFD7DEE8"
                    BorderThickness="1"
                    Cursor="SizeAll"
                    ToolTip="Drag popout" />
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $window = [Windows.Markup.XamlReader]::Load($reader)
    Enable-FlowCellTaskbarCloseSupport -Window $window
    $window.ShowInTaskbar = $false
    if ([bool]$script:FlowCellStartupRestoreInProgress) {
        $window.ShowActivated = $false
    }
    $window.SizeToContent = 'Manual'
    $savedBounds = Get-FlowCellPanelBounds -ProgramTabId $windowProgramTabId -PanelId $windowPanelId
    if ($savedBounds) {
        $window.WindowStartupLocation = 'Manual'
        $window.Left = [double]$savedBounds.Left
        $window.Top = [double]$savedBounds.Top
        $window.Width = [Math]::Max([double]$savedBounds.Width, 96.0)
        $window.Height = [Math]::Max([double]$savedBounds.Height, 48.0)
    }
    else {
        $window.WindowStartupLocation = 'CenterScreen'
    }
    $window.Topmost = $false
    if (-not ($script:FlowCellPanelWindows -is [hashtable])) {
        $script:FlowCellPanelWindows = @{}
    }
    $ownerSyncTimer = New-Object System.Windows.Threading.DispatcherTimer
    $ownerSyncTimer.Interval = [TimeSpan]::FromMilliseconds(900)
    $panelPopoutId = Get-FlowCellPanelPopoutId -ProgramTabId $windowProgramTabId -PanelId $windowPanelId
    $windowEntry = [pscustomobject]@{
        Window = $window
        Refresh = $null
        Kind = 'Panel'
        ProgramTabId = [int]$windowProgramTabId
        PanelId = [string]$windowPanelId
        ActivePanelId = [string]$PanelId
        OwnerSyncTimer = $ownerSyncTimer
        CurrentTopmost = $false
        CurrentOwnerHandle = 0
        PopoutId = $panelPopoutId
        ClusterId = ''
        SuppressSnapHandling = $false
        InitializedSize = [bool]($null -ne $savedBounds)
    }
    $script:FlowCellPanelWindows[$windowKey] = $windowEntry
    $window.Dispatcher.add_UnhandledException({
        param($sender, $eventArgs)
        try {
            Write-UiLog ('FlowCell panel window failed. ProgramTabId={0}; PanelId={1}; Error={2}' -f $windowProgramTabId, $windowPanelId, $eventArgs.Exception.ToString())
        }
        catch {
        }
        $eventArgs.Handled = $true
    }.GetNewClosure())
    $buttonGrid = $window.FindName('PanelButtonGrid')
    $panelMoveGrabber = $window.FindName('PanelMoveGrabber')
    Enable-FlowCellPopoutGrabberDrag -Grabber $panelMoveGrabber -Window $window -Entry $windowEntry
    $updateWindowTopmost = {
        $programTab = Get-FlowCellProgramTab -ProgramTabId $windowProgramTabId
        $ownership = Update-FlowCellPopoutWindowOwnership -Window $window -ProgramTab $programTab -WindowEntry $windowEntry
        if ([bool]$ownership.OwnerChanged -and [long]$ownership.OwnerHandle -ne 0) {
            Push-FlowCellWindowAboveOwner -Window $window
        }
    }.GetNewClosure()
    $showButtonMenu = {
        param($buttonControl)
        $menu = New-Object System.Windows.Controls.ContextMenu
        $renameItem = New-Object System.Windows.Controls.MenuItem
        $renameItem.Header = 'Rename'
        $deleteItem = New-Object System.Windows.Controls.MenuItem
        $deleteItem.Header = 'Delete'
        $tag = $buttonControl.Tag
        $renameItem.Add_Click({
            Invoke-UiSafe 'Rename button failed.' {
                $currentTag = $buttonControl.Tag
                $newLabel = Show-TextEntryDialog -Title 'Rename Button' -Prompt 'Enter the new button name.' -InitialValue ([string]$currentTag.Button.Label) -AcceptText 'Rename' -OwnerWindow $window
                if ([string]::IsNullOrWhiteSpace($newLabel)) { return }
                if (Rename-FlowCellButton -ProgramTabId ([int]$windowProgramTabId) -PanelId ([string]$currentTag.PanelId) -ButtonId ([string]$currentTag.Button.Id) -NewLabel $newLabel) {
                    Invoke-FlowCellMainRefresh
                    Invoke-FlowCellPanelWindowRefresh -WindowKey $windowKey
                }
            }
        }.GetNewClosure())
        $deleteItem.Add_Click({
            Invoke-UiSafe 'Delete button failed.' {
                $currentTag = $buttonControl.Tag
                $deleteEntries = @(Get-FlowCellDeleteButtonEntries -ProgramTabId ([int]$windowProgramTabId) -PanelId ([string]$currentTag.PanelId) -ButtonId ([string]$currentTag.Button.Id))
                if (@($deleteEntries).Count -eq 0) { return }
                $confirmText = if (@($deleteEntries).Count -gt 1) { 'Delete {0} selected buttons?' -f @($deleteEntries).Count } else { 'Delete button {0}?' -f [string]$deleteEntries[0].Action }
                if (-not (Confirm-UiAction -Message $confirmText -Title 'FlowCell' -OwnerWindow $window)) { return }
                $removedAny = $false
                foreach ($deleteEntry in @($deleteEntries)) {
                    if (Remove-FlowCellBindEntry $deleteEntry) { $removedAny = $true }
                }
                if ($removedAny) {
                    Clear-FlowCellButtonSelection -ProgramTabId ([int]$windowProgramTabId) -PanelId ([string]$currentTag.PanelId
                    )
                    Invoke-FlowCellMainRefresh
                    Invoke-FlowCellPanelWindowRefresh -WindowKey $windowKey
                }
            }
        }.GetNewClosure())
        [void]$menu.Items.Add($renameItem)
        [void]$menu.Items.Add($deleteItem)
        $buttonControl.ContextMenu = $menu
    }
    $refreshWindow = {
        $programTab = Get-FlowCellProgramTab -ProgramTabId $windowProgramTabId
        $programState = Get-FlowCellProgramState -ProgramTabId $windowProgramTabId
        $activePanelId = Get-FlowCellPanelWindowActivePanelId -WindowKey $windowKey -FallbackPanelId $windowPanelId
        $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $activePanelId
        if ($null -eq $panel -and $programState) {
            $fallbackPanelId = [string]$programState.SelectedPanelId
            if ([string]::IsNullOrWhiteSpace($fallbackPanelId) -or -not (@($programState.Panels).Id -contains $fallbackPanelId)) {
                $firstPanel = @($programState.Panels | Select-Object -First 1)
                if (@($firstPanel).Count -gt 0) {
                    $fallbackPanelId = [string]$firstPanel[0].Id
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($fallbackPanelId)) {
                Set-FlowCellPanelWindowActivePanelId -WindowKey $windowKey -PanelId $fallbackPanelId
                $activePanelId = $fallbackPanelId
                $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $activePanelId
            }
        }
        if ($null -eq $programTab -or $null -eq $panel) { return }
        $window.Title = ('FlowCell - {0} - {1}' -f $programTab.Label, $panel.Name)
        $buttonGrid.Children.Clear()
        $buttonScale = Get-FlowCellButtonScale
        $buttonCount = [Math]::Max((Get-FlowCellRenderedButtonCount -Buttons @($panel.Buttons)), 1)
        $availableWidth = [Math]::Max($(if ([double]$window.ActualWidth -gt 0) { [double]$window.ActualWidth } else { [double]$window.Width }), 120.0)
        $availableHeight = [Math]::Max($(if ([double]$window.ActualHeight -gt 0) { [double]$window.ActualHeight } else { [double]$window.Height }), 70.0)
        $targetAspect = 164.0 / 56.0
        $bestColumns = 1
        $bestRows = $buttonCount
        $bestScore = [double]::PositiveInfinity
        for ($candidateColumns = 1; $candidateColumns -le $buttonCount; $candidateColumns++) {
            $candidateRows = [int][Math]::Ceiling($buttonCount / [double]$candidateColumns)
            $cellWidth = $availableWidth / [double]$candidateColumns
            $cellHeight = $availableHeight / [double]$candidateRows
            $aspectScore = [Math]::Abs(($cellWidth / [Math]::Max($cellHeight, 1.0)) - $targetAspect)
            $rowPenalty = [Math]::Abs($candidateRows - [Math]::Max([Math]::Round($availableHeight / 70.0), 1.0)) * 0.08
            $score = $aspectScore + $rowPenalty
            if ($score -lt $bestScore) {
                $bestScore = $score
                $bestColumns = $candidateColumns
                $bestRows = $candidateRows
            }
        }
        if ($buttonGrid.PSObject.Properties['Columns']) { $buttonGrid.Columns = [int]$bestColumns }
        if ($buttonGrid.PSObject.Properties['Rows']) { $buttonGrid.Rows = [int]$bestRows }
        $cellWidthForFont = $availableWidth / [double][Math]::Max($bestColumns, 1)
        $cellHeightForFont = $availableHeight / [double][Math]::Max($bestRows, 1)
        $buttonWidth = [double]::NaN
        $buttonHeight = [double]::NaN
        $paddingX = [Math]::Max([int][Math]::Round([Math]::Min(6 * $buttonScale, $cellHeightForFont * 0.08)), 0)
        $paddingY = [Math]::Max([int][Math]::Round([Math]::Min(4 * $buttonScale, $cellHeightForFont * 0.05)), 0)
        $buttonPadding = ('{0},{1}' -f $paddingX, $paddingY)
        $buttonFontSize = [Math]::Max([double][Math]::Min([Math]::Round([Math]::Min($cellHeightForFont * 0.42, $cellWidthForFont * 0.12), 1), 28.0), 5.0)
        $controlWidth = [Math]::Max([Math]::Round(28 * $buttonScale, 2), 20)
        $panelCycleAction = {
            Step-FlowCellPanelWindowActivePanel -ProgramTabId $windowProgramTabId -WindowKey $windowKey -FallbackPanelId $windowPanelId
        }.GetNewClosure()
        $closeWindowAction = {
            $window.Close()
        }.GetNewClosure()
        $panelHasEmbeddedControl = $false
        $smartAxisOwnerButton = Get-FlowCellSmartAxisOwnerButtonFromPanel -Panel $panel
        $smartAxisOwnerButtonId = if ($smartAxisOwnerButton) { [string]$smartAxisOwnerButton.Id } else { '' }

        foreach ($actionButton in @($panel.Buttons)) {
            $actionButton = Ensure-FlowCellButtonStateLayer $actionButton
            if (Test-FlowCellSmartAxisStateButton $actionButton) {
                if ([string]$actionButton.Id -ne $smartAxisOwnerButtonId) {
                    continue
                }
                try {
                    $smartAxisControl = New-FlowCellSmartAxisLockToolControl -Button $smartAxisOwnerButton -ProgramTab $programTab -PanelId ([string]$panel.Id) -Surface 'PanelPopoutSmartAxis' -Width ([Math]::Round(338 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8))
                    $smartAxisControl.Margin = '0'
                    $wrappedSmartAxis = New-FlowCellPopoutButtonHost -Content $smartAxisControl -Button $smartAxisOwnerButton -ProgramTabId $windowProgramTabId -PanelId ([string]$panel.Id) -ButtonGrid $buttonGrid
                    [void]$buttonGrid.Children.Add($wrappedSmartAxis)
                    $panelHasEmbeddedControl = $true
                    continue
                }
                catch {
                    Write-UiLog ('Smart Axis Lock control render failed in panel window: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            if (Test-FlowCellCompoundToolButton $actionButton) {
                try {
                    $compoundControl = New-FlowCellCompoundToolControl -Button $actionButton -ProgramTab $programTab -PanelId ([string]$panel.Id) -Width ([Math]::Round(360 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8)) -Surface 'PanelPopoutCompound'
                    if ($compoundControl) {
                        $compoundControl.Margin = '0'
                        $wrappedCompound = New-FlowCellPopoutButtonHost -Content $compoundControl -Button $actionButton -ProgramTabId $windowProgramTabId -PanelId ([string]$panel.Id) -ButtonGrid $buttonGrid
                        [void]$buttonGrid.Children.Add($wrappedCompound)
                        $panelHasEmbeddedControl = $true
                        continue
                    }
                }
                catch {
                    Write-UiLog ('Compound tool render failed in panel window: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            if (Test-FlowCellFlattenRevolveToolButton $actionButton) {
                try {
                    $flattenRevolveControl = New-FlowCellFlattenRevolveToolControl -Button $actionButton -ProgramTab $windowProgramTab -PanelId ([string]$panel.Id) -Surface 'PanelPopout' -Width 290 -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8))
                    $flattenRevolveControl.Margin = '0'
                    $wrappedFlattenRevolve = New-FlowCellPopoutButtonHost -Content $flattenRevolveControl -Button $actionButton -ProgramTabId $windowProgramTabId -PanelId ([string]$panel.Id) -ButtonGrid $buttonGrid
                    [void]$buttonGrid.Children.Add($wrappedFlattenRevolve)
                    $panelHasEmbeddedControl = $true
                    continue
                }
                catch {
                    Write-UiLog ('Flatten/revolve control render failed in panel window: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            $actionButton = Ensure-FlowCellButtonStateLayer $actionButton
            $buttonTooltip = Resolve-FlowCellButtonTooltip -Button $actionButton -ProgramTab $programTab
            $buttonTag = [pscustomobject]@{
                Button = $actionButton
                ProgramTab = $programTab
                PanelId = [string]$panel.Id
            }
            $buttonControl = New-FlowCellHostButtonControl `
                -Label ([string]$actionButton.Label) `
                -Tag $buttonTag `
                -Tooltip $buttonTooltip `
                -Width ([double]$buttonWidth) `
                -Height ([double]$buttonHeight) `
                -Padding $buttonPadding `
                -FontSize $buttonFontSize
            & $showButtonMenu $buttonControl
            $buttonControl.Add_PreviewMouseRightButtonUp({
                param($sender, $eventArgs)
                if ($sender.ContextMenu) {
                    $sender.ContextMenu.PlacementTarget = $sender
                    $sender.ContextMenu.IsOpen = $true
                    $eventArgs.Handled = $true
                }
            }.GetNewClosure())
            $buttonControl.Add_Click({
                param($sender, $eventArgs)
                $tag = $sender.Tag
                $result = Invoke-FlowCellButtonAction -Button $tag.Button -ProgramTab $tag.ProgramTab -PanelId ([string]$tag.PanelId) -Surface 'PanelPopout'
                if (-not $result.Succeeded) {
                    Set-ActionStatus ([string]$result.Message)
                }
            }.GetNewClosure())
            $wrappedButton = New-FlowCellPopoutButtonHost -Content $buttonControl -Button $actionButton -ProgramTabId $windowProgramTabId -PanelId ([string]$panel.Id) -ButtonGrid $buttonGrid
            [void]$buttonGrid.Children.Add($wrappedButton)
        }
        $window.MinWidth = 80.0
        $window.MinHeight = 24.0
        if (-not [bool]$windowEntry.InitializedSize) {
            $windowEntry.InitializedSize = $true
        }
    }.GetNewClosure()
    $ownerSyncTimer.Add_Tick({
        if (-not $window.IsLoaded -or [string]$window.Tag -eq 'closing' -or [string]$window.Tag -eq 'shutdown') {
            $ownerSyncTimer.Stop()
            return
        }
        & $updateWindowTopmost
    }.GetNewClosure())
    $window.Add_LocationChanged({
        try {
            Save-FlowCellPanelWindowBounds -Window $window -ProgramTabId $windowProgramTabId -PanelId $windowPanelId
            $cluster = Invoke-FlowCellClusterSafe 'panel-location-changed:get-cluster' { Get-FlowCellClusterEntryForPopoutId -PopoutId ([string]$windowEntry.PopoutId) }
            if ($cluster) {
                Invoke-FlowCellClusterSafe 'panel-location-changed:update-grabber' { Update-FlowCellClusterGrabberWindow -ClusterEntry $cluster } | Out-Null
            }
        }
        catch {
            Write-UiLog ('FlowCell panel move handler failed. ProgramTabId={0}; PanelId={1}; Error={2}' -f $windowProgramTabId, $windowPanelId, $_.Exception.ToString())
        }
    }.GetNewClosure())
    $window.Add_SizeChanged({
        try {
            Save-FlowCellPanelWindowBounds -Window $window -ProgramTabId $windowProgramTabId -PanelId $windowPanelId
            if ($windowEntry.Refresh -is [scriptblock]) {
                & $windowEntry.Refresh
            }
        }
        catch {
            Write-UiLog ('FlowCell panel resize handler failed. ProgramTabId={0}; PanelId={1}; Error={2}' -f $windowProgramTabId, $windowPanelId, $_.Exception.ToString())
        }
    }.GetNewClosure())
    $window.Add_Activated({
        try {
            Register-FlowCellTaskbarPreviewTab -Window $window
            $ownerHandle = Get-FlowCellWindowHandle $script:FlowCellWindow
            $childHandle = Get-FlowCellWindowHandle $window
            if ($ownerHandle -ne 0 -and $childHandle -ne 0) {
                [FlowCellTaskbarTabs]::SetTabActive($childHandle, $ownerHandle)
            }
            & $updateWindowTopmost
            Push-FlowCellWindowAboveOwner -Window $window
        }
        catch {
        }
    }.GetNewClosure())
    $window.Add_Closing({
        Unregister-FlowCellTaskbarPreviewTab -Window $window
    }.GetNewClosure())
    $window.Add_Deactivated({
        try {
            $deferredTopmostUpdate = [System.Action]{
                try {
                    & $updateWindowTopmost
                }
                catch {
                }
            }
            [void]$window.Dispatcher.BeginInvoke($deferredTopmostUpdate, [System.Windows.Threading.DispatcherPriority]::Background)
        }
        catch {
        }
    }.GetNewClosure())
    $window.Add_Closed({
        try {
            $closeTag = [string]$window.Tag
            $window.Tag = 'closing'
            Write-UiLog ('FlowCell panel window closing. ProgramTabId={0}; PanelId={1}; Tag={2}' -f $windowProgramTabId, $windowPanelId, $closeTag)
            if ($ownerSyncTimer) { $ownerSyncTimer.Stop() }
            Save-FlowCellPanelWindowBounds -Window $window -ProgramTabId $windowProgramTabId -PanelId $windowPanelId
            $activePanelIdOnClose = Get-FlowCellPanelWindowActivePanelId -WindowKey $windowKey -FallbackPanelId $windowPanelId
            if ($closeTag -ne 'shutdown' -and $windowEntry.PSObject.Properties['PopoutId']) {
                Invoke-FlowCellClusterSafe 'panel-close:remove-cluster' { Remove-FlowCellPopoutFromCluster -PopoutId ([string]$windowEntry.PopoutId) } | Out-Null
            }
            if ($script:FlowCellPanelWindows -and $script:FlowCellPanelWindows.ContainsKey($windowKey)) {
                $script:FlowCellPanelWindows.Remove($windowKey)
            }
            if ($closeTag -ne 'shutdown') {
                $programState = Get-FlowCellProgramState -ProgramTabId $windowProgramTabId
                if ($programState) {
                    $panelIdsToReset = New-Object System.Collections.Generic.List[string]
                    foreach ($candidatePanelId in @([string]$windowPanelId, [string]$activePanelIdOnClose)) {
                        if ([string]::IsNullOrWhiteSpace([string]$candidatePanelId)) { continue }
                        if (-not $panelIdsToReset.Contains([string]$candidatePanelId)) {
                            [void]$panelIdsToReset.Add([string]$candidatePanelId)
                        }
                    }
                    foreach ($panelIdToReset in @($panelIdsToReset)) {
                        $panel = Get-FlowCellPanel -ProgramState $programState -PanelId $panelIdToReset
                        if ($panel) {
                            $panel.IsPoppedOut = $false
                        }
                    }
                    Save-FlowCellState
                }
                Invoke-FlowCellMainRefresh
                Invoke-FlowCellMainRefreshAsync
            }
        }
        catch {
            Write-UiLog ('FlowCell panel close failed: {0}' -f $_.Exception.ToString())
        }
    }.GetNewClosure())

    $windowEntry.Refresh = $refreshWindow
    & $refreshWindow
    [void]$window.Show()
    Register-FlowCellTaskbarPreviewTab -Window $window
    Set-FlowCellWindowEnabledState -Window $window -IsEnabled $true
    $windowEntry.CurrentTopmost = $false
    & $updateWindowTopmost
    Push-FlowCellWindowAboveOwner -Window $window
    $ownerSyncTimer.Start()
}

function Start-Ui {
    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="FlowCell"
        Width="1500"
        Height="940"
        MinWidth="1240"
        MinHeight="780"
        WindowStartupLocation="CenterScreen"
        Background="#FF161A21"
        Foreground="#FFF2F2F2">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="Background" Value="#FF79FF33" />
            <Setter Property="Foreground" Value="#FF151A11" />
            <Setter Property="BorderThickness" Value="0" />
            <Setter Property="Padding" Value="12,8" />
            <Setter Property="Margin" Value="0,0,10,0" />
            <Setter Property="FontWeight" Value="SemiBold" />
            <Setter Property="Cursor" Value="Hand" />
        </Style>
    </Window.Resources>
    <Border Margin="16" Padding="18" Background="#FF20252D" CornerRadius="18">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <DockPanel Grid.Row="0" Margin="0,0,0,14">
                <TextBlock x:Name="AppTitleText" DockPanel.Dock="Left" FontSize="28" FontWeight="SemiBold" VerticalAlignment="Center">FlowCell</TextBlock>
                <StackPanel DockPanel.Dock="Right" Orientation="Horizontal">
                    <Button x:Name="MacroLabButton" Width="130" Height="38" Background="#FF6EC8FF">Macro Lab</Button>
                    <Button x:Name="BindViewerButton" Width="130" Height="38" Background="#FF6EC8FF">Bind Viewer</Button>
                </StackPanel>
            </DockPanel>
            <Grid Grid.Row="1">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="210" />
                    <ColumnDefinition Width="210" />
                    <ColumnDefinition Width="*" />
                    <ColumnDefinition Width="420" />
                </Grid.ColumnDefinitions>
                <Border x:Name="ProgramRail" Grid.Column="0" Margin="0,0,12,0" Background="#FF272E38" CornerRadius="16" Padding="12">
                    <Grid>
                        <Grid.RowDefinitions>
                            <RowDefinition Height="*" />
                            <RowDefinition Height="Auto" />
                        </Grid.RowDefinitions>
                        <ListBox x:Name="ProgramTabStrip" Grid.Row="0" BorderThickness="0" Background="Transparent" ScrollViewer.HorizontalScrollBarVisibility="Disabled" ScrollViewer.VerticalScrollBarVisibility="Auto" DisplayMemberPath="Label" />
                        <Button x:Name="AddProgramButton" Grid.Row="1" Height="40" Margin="0,12,0,0" Background="#FF1F2731" Foreground="#FFF2F2F2" BorderThickness="1" BorderBrush="#FF4C5A6E">Add Program</Button>
                    </Grid>
                </Border>
                <Border x:Name="PanelRail" Grid.Column="1" Margin="0,0,12,0" Background="#FF272E38" CornerRadius="16" Padding="12">
                    <Grid>
                        <Grid.RowDefinitions>
                            <RowDefinition Height="*" />
                            <RowDefinition Height="Auto" />
                        </Grid.RowDefinitions>
                        <ListBox x:Name="PanelTabStrip" Grid.Row="0" BorderThickness="0" Background="Transparent" ScrollViewer.HorizontalScrollBarVisibility="Disabled" ScrollViewer.VerticalScrollBarVisibility="Auto" DisplayMemberPath="Name" />
                        <Button x:Name="AddPanelButton" Grid.Row="1" Height="40" Margin="0,12,0,0">Add Panel</Button>
                    </Grid>
                </Border>
                <Border x:Name="ButtonsRail" Grid.Column="2" Margin="0,0,12,0" Background="#FF1A1F26" CornerRadius="16" Padding="16">
                    <Grid>
                        <Grid.RowDefinitions>
                            <RowDefinition Height="Auto" />
                            <RowDefinition Height="*" />
                        </Grid.RowDefinitions>
                        <TextBlock x:Name="PanelStateText" Grid.Row="0" Margin="0,0,0,12" Foreground="#FFB6C2CF" TextWrapping="Wrap" />
                        <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto">
                            <WrapPanel x:Name="PanelButtonGrid" Background="Transparent" AllowDrop="True" />
                        </ScrollViewer>
                    </Grid>
                </Border>
                <Border x:Name="InfoRail" Grid.Column="3" Background="#FF272E38" CornerRadius="16" Padding="16">
                    <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
                        <StackPanel>
                            <TextBlock x:Name="ProgramNameText" FontSize="24" FontWeight="SemiBold" />
                            <Grid Margin="0,12,0,0">
                                <Grid.RowDefinitions>
                                    <RowDefinition Height="Auto" />
                                    <RowDefinition Height="Auto" />
                                    <RowDefinition Height="Auto" />
                                    <RowDefinition Height="Auto" />
                                </Grid.RowDefinitions>
                                <Grid.ColumnDefinitions>
                                    <ColumnDefinition Width="*" />
                                    <ColumnDefinition Width="*" />
                                </Grid.ColumnDefinitions>
                                <Button x:Name="RenamePanelButton" Grid.Row="0" Grid.Column="0" Height="36" Margin="0,0,8,10">Rename Panel</Button>
                                <Button x:Name="RemovePanelButton" Grid.Row="0" Grid.Column="1" Height="36" Margin="0,0,0,10" Background="#FFFF8A65">Remove Panel</Button>
                                <Button x:Name="SaveLayoutButton" Grid.Row="1" Grid.Column="0" Height="36" Margin="0,0,8,10" Background="#FF74C4FF">Save Layout</Button>
                                <Button x:Name="LoadLayoutButton" Grid.Row="1" Grid.Column="1" Height="36" Margin="0,0,0,10" Background="#FF74C4FF">Load Layout</Button>
                                <Button x:Name="BindScriptButton" Grid.Row="2" Grid.Column="0" Height="36" Margin="0,0,8,10">Add Script</Button>
                                <Button x:Name="BindMacroButton" Grid.Row="2" Grid.Column="1" Height="36" Margin="0,0,0,10">Add Macro</Button>
                                <Button x:Name="SavePanelButton" Grid.Row="3" Grid.Column="0" Height="36" Margin="0,0,8,0">Save Panel</Button>
                                <Button x:Name="LoadPanelButton" Grid.Row="3" Grid.Column="1" Height="36" Margin="0">Load Panel</Button>
                            </Grid>
                            <Grid Margin="0,12,0,0">
                                <Grid.RowDefinitions>
                                    <RowDefinition Height="Auto" />
                                    <RowDefinition Height="Auto" />
                                </Grid.RowDefinitions>
                                <Grid.ColumnDefinitions>
                                    <ColumnDefinition Width="*" />
                                    <ColumnDefinition Width="*" />
                                </Grid.ColumnDefinitions>
                                <Button x:Name="PopTabButton" Grid.Row="0" Grid.Column="0" Height="34" Margin="0,0,8,10" Background="#FF74C4FF">Pop Tab</Button>
                                <Button x:Name="PopToolsButton" Grid.Row="0" Grid.Column="1" Height="34" Margin="0,0,0,10">Pop Tools</Button>
                                <ComboBox x:Name="PopOutModeBox" Grid.Row="1" Grid.Column="0" Height="34" Margin="0,0,8,0" VerticalContentAlignment="Center" />
                                <Button x:Name="ArrangeButtonsButton" Grid.Row="1" Grid.Column="1" Height="34" Margin="0" Background="#FF3C4654">Arrange</Button>
                            </Grid>
                            <Border Margin="0,12,0,0" Background="#FF1D222A" BorderBrush="#FF3C4654" BorderThickness="1" CornerRadius="12" Padding="12">
                                <StackPanel>
                                    <TextBlock FontSize="13" FontWeight="SemiBold" Foreground="#FF9FB0C2">Bind Area</TextBlock>
                                    <WrapPanel Margin="0,8,0,0">
                                        <Button x:Name="BindAreaScriptButton" Width="78" Height="34">Script</Button>
                                        <Button x:Name="BindAreaMacroButton" Width="78" Height="34">Macro</Button>
                                        <TextBlock x:Name="SelectedBindNameText" Width="150" Height="34" Margin="0,0,10,0" VerticalAlignment="Center" TextTrimming="CharacterEllipsis" Foreground="#FFEAF7FF">Nothing selected</TextBlock>
                                        <ComboBox x:Name="ShortcutDropdown" Width="170" Height="34" Margin="0,0,10,0" VerticalContentAlignment="Center" />
                                        <Button x:Name="ApplyBindButton" Width="84" Height="34">Bind</Button>
                                        <Button x:Name="ShowBindsButton" Width="110" Height="34" Background="#FF74C4FF">Show Binds</Button>
                                    </WrapPanel>
                                    <TextBlock x:Name="BindSelectionText" Margin="0,10,0,0" TextWrapping="Wrap" Foreground="#FFEAF7FF">No pending bind.</TextBlock>
                                </StackPanel>
                            </Border>
                            <WrapPanel Margin="0,12,0,0" VerticalAlignment="Center">
                                <TextBlock VerticalAlignment="Center" Margin="0,0,10,0" Foreground="#FFB6C2CF">Button Size</TextBlock>
                                <Slider x:Name="ButtonSizeSlider" Width="180" Minimum="0.2" Maximum="1.0" Value="1.0" TickFrequency="0.1" IsSnapToTickEnabled="False" SmallChange="0.05" LargeChange="0.1" />
                                <TextBlock x:Name="ButtonSizeValueText" Width="48" Margin="10,0,0,0" VerticalAlignment="Center" Foreground="#FFEAF7FF">1.00x</TextBlock>
                            </WrapPanel>
                            <CheckBox x:Name="StartupRestorePopoutsOnlyCheckBox"
                                      Margin="0,12,0,0"
                                      Foreground="#FFEAF7FF"
                                      IsChecked="True"
                                      Content="Start minimized and reopen the last pop-out-only layout" />
                        </StackPanel>
                    </ScrollViewer>
                </Border>
            </Grid>
            <TextBlock x:Name="FlowCellStatusText" Grid.Row="2" Margin="4,12,0,0" Foreground="#FFB6C2CF" TextWrapping="Wrap" />
        </Grid>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $flowWindow = [Windows.Markup.XamlReader]::Load($reader)
    $script:FlowCellWindow = $flowWindow
    $script:Window = $flowWindow
    Restore-FlowCellMainWindowBounds -Window $flowWindow
    $flowWindow.Dispatcher.add_UnhandledException({
        param($sender, $eventArgs)
        try {
            Write-UiLog ('FlowCell window failed: {0}' -f $eventArgs.Exception.ToString())
            Set-ControlTextValue $flowCellStatusText ('FlowCell hit an internal UI error: {0}' -f $eventArgs.Exception.Message)
        }
        catch {
        }
        $eventArgs.Handled = $true
    })

    $programTabStrip = $flowWindow.FindName('ProgramTabStrip')
    $panelTabStrip = $flowWindow.FindName('PanelTabStrip')
    if ($programTabStrip) {
        $programTabStrip.ItemContainerStyle = New-FlowCellHostTabItemStyle -Mode 'ProgramTab'
    }
    if ($panelTabStrip) {
        $panelTabStrip.ItemContainerStyle = New-FlowCellHostTabItemStyle -Mode 'PanelTab'
    }
    $programNameText = $flowWindow.FindName('ProgramNameText')
    $panelStateText = $flowWindow.FindName('PanelStateText')
    $panelButtonGrid = $flowWindow.FindName('PanelButtonGrid')
    $buttonSizeSlider = $flowWindow.FindName('ButtonSizeSlider')
    $buttonSizeValueText = $flowWindow.FindName('ButtonSizeValueText')
    $startupRestorePopoutsOnlyCheckBox = $flowWindow.FindName('StartupRestorePopoutsOnlyCheckBox')
    $shortcutDropdown = $flowWindow.FindName('ShortcutDropdown')
    if ($shortcutDropdown) {
        $shortcutDropdown.DisplayMemberPath = 'Display'
        $shortcutDropdown.SelectedValuePath = 'RawShortcut'
    }
    $selectedBindNameText = $flowWindow.FindName('SelectedBindNameText')
    $applyBindButton = $flowWindow.FindName('ApplyBindButton')
    $bindSelectionText = $flowWindow.FindName('BindSelectionText')
    $flowCellStatusText = $flowWindow.FindName('FlowCellStatusText')
    $script:FlowCellMainHoverStatusText = $flowCellStatusText
    if ($flowCellStatusText -and [string]::IsNullOrWhiteSpace([string]$flowCellStatusText.Text)) {
        Set-ControlTextValue $flowCellStatusText ([string]$script:FlowCellMainHoverHintText)
    }
    $addProgramButton = $flowWindow.FindName('AddProgramButton')
    $showBindsButton = $flowWindow.FindName('ShowBindsButton')
    $bindAreaScriptButton = $flowWindow.FindName('BindAreaScriptButton')
    $bindAreaMacroButton = $flowWindow.FindName('BindAreaMacroButton')
    $popTabButton = $flowWindow.FindName('PopTabButton')
    $popToolsButton = $flowWindow.FindName('PopToolsButton')
    $popOutModeBox = $flowWindow.FindName('PopOutModeBox')
    $arrangeButtonsButton = $flowWindow.FindName('ArrangeButtonsButton')
    $renamePanelButton = $flowWindow.FindName('RenamePanelButton')
    $addPanelButton = $flowWindow.FindName('AddPanelButton')
    $removePanelButton = $flowWindow.FindName('RemovePanelButton')
    $saveLayoutButton = $flowWindow.FindName('SaveLayoutButton')
    $loadLayoutButton = $flowWindow.FindName('LoadLayoutButton')
    $savePanelButton = $flowWindow.FindName('SavePanelButton')
    $loadPanelButton = $flowWindow.FindName('LoadPanelButton')
    $bindScriptButton = $flowWindow.FindName('BindScriptButton')
    $script:__flowCellSuppressProgramSelection = $false
    $script:__flowCellSuppressPanelSelection = $false
    $script:FlowCellPopoutFirstStartupPending = Test-FlowCellStartupRestorePopoutsOnlyEnabled
    if ($startupRestorePopoutsOnlyCheckBox) {
        $startupRestorePopoutsOnlyCheckBox.IsChecked = [bool](Test-FlowCellStartupRestorePopoutsOnlyEnabled)
        $startupRestorePopoutsOnlyCheckBox.ToolTip = 'When checked, FlowCell starts minimized and restores the last saved pop-out-only layout on launch.'
    }
    if ($popOutModeBox) {
        foreach ($mode in @('Group', 'Individual')) {
            [void]$popOutModeBox.Items.Add($mode)
        }
        $popOutModeBox.SelectedIndex = 0
        $popOutModeBox.ToolTip = 'Choose whether checked tools open together in one popout or one window per tool.'
    }

    $setStatus = { param([string]$Text) Set-ControlTextValue $flowCellStatusText $Text }
    $getResolvedProgramState = {
        $selectedProgramItem = Get-ControlSelectedItem $programTabStrip
        if ($selectedProgramItem -and $selectedProgramItem.PSObject.Properties['Id']) {
            return (Get-FlowCellProgramState -ProgramTabId ([int]$selectedProgramItem.Id))
        }
        return (Get-FlowCellSelectedProgramState)
    }
    $getResolvedProgramTab = {
        $selectedProgramItem = Get-ControlSelectedItem $programTabStrip
        if ($selectedProgramItem -and $selectedProgramItem.PSObject.Properties['Id']) {
            return (Get-FlowCellProgramTab -ProgramTabId ([int]$selectedProgramItem.Id))
        }
        return (Get-FlowCellSelectedProgramTab)
    }
    $getResolvedPanel = {
        $programState = & $getResolvedProgramState
        if ($null -eq $programState) { return $null }
        $selectedPanelItem = Get-ControlSelectedItem $panelTabStrip
        if ($selectedPanelItem -and $selectedPanelItem.PSObject.Properties['Id']) {
            return (Get-FlowCellPanel -ProgramState $programState -PanelId ([string]$selectedPanelItem.Id))
        }
        return (Get-FlowCellPanel -ProgramState $programState -PanelId ([string]$programState.SelectedPanelId))
    }
    $clearPendingBinding = {
        $script:FlowCellPendingShortcutBinding = $null
        $selectedBindNameText.Text = 'Nothing selected'
        $selectedBindNameText.ToolTip = $null
        $bindSelectionText.Text = 'No pending bind.'
        $bindSelectionText.ToolTip = $null
        if ($shortcutDropdown) { $shortcutDropdown.SelectedIndex = 0 }
    }
    $showButtonContextMenu = {
        param($buttonControl)
        $menu = New-Object System.Windows.Controls.ContextMenu
        $renameItem = New-Object System.Windows.Controls.MenuItem
        $renameItem.Header = 'Rename'
        $deleteItem = New-Object System.Windows.Controls.MenuItem
        $deleteItem.Header = 'Delete'
        $renameItem.Add_Click({
            Invoke-UiSafe 'Rename button failed.' {
                $currentTag = $buttonControl.Tag
                $buttonData = $currentTag.Button
                $programTabData = $currentTag.ProgramTab
                $panelId = [string]$currentTag.PanelId
                $newLabel = Show-TextEntryDialog -Title 'Rename Button' -Prompt 'Enter the new button name.' -InitialValue ([string]$buttonData.Label) -AcceptText 'Rename' -OwnerWindow $flowWindow
                if ([string]::IsNullOrWhiteSpace($newLabel)) { return }
                if (Rename-FlowCellButton -ProgramTabId ([int]$programTabData.Id) -PanelId $panelId -ButtonId ([string]$buttonData.Id) -NewLabel $newLabel) {
                    if ($refreshAll -is [scriptblock]) { $refreshAll.Invoke() }
                }
            }
        }.GetNewClosure())
        $deleteItem.Add_Click({
            Invoke-UiSafe 'Delete button failed.' {
                $currentTag = $buttonControl.Tag
                $buttonData = $currentTag.Button
                $programTabData = $currentTag.ProgramTab
                $panelId = [string]$currentTag.PanelId
                $deleteEntries = @(Get-FlowCellDeleteButtonEntries -ProgramTabId ([int]$programTabData.Id) -PanelId $panelId -ButtonId ([string]$buttonData.Id))
                if (@($deleteEntries).Count -eq 0) { return }
                $confirmText = if (@($deleteEntries).Count -gt 1) { 'Delete {0} selected buttons?' -f @($deleteEntries).Count } else { 'Delete button {0}?' -f [string]$deleteEntries[0].Action }
                if (-not (Confirm-UiAction -Message $confirmText -Title 'FlowCell' -OwnerWindow $flowWindow)) { return }
                $removedAny = $false
                foreach ($deleteEntry in @($deleteEntries)) {
                    if (Remove-FlowCellBindEntry $deleteEntry) { $removedAny = $true }
                }
                if ($removedAny) {
                    Clear-FlowCellButtonSelection -ProgramTabId ([int]$programTabData.Id) -PanelId $panelId
                    if ($refreshAll -is [scriptblock]) { $refreshAll.Invoke() }
                }
            }
        }.GetNewClosure())
        [void]$menu.Items.Add($renameItem)
        [void]$menu.Items.Add($deleteItem)
        $buttonControl.ContextMenu = $menu
    }
    $showProgramTabContextMenu = {
        param($programTab)
        if ($null -eq $programTab) { return $null }

        $menu = New-Object System.Windows.Controls.ContextMenu
        $renameItem = New-Object System.Windows.Controls.MenuItem
        $renameItem.Header = 'Rename Program'
        $deleteItem = New-Object System.Windows.Controls.MenuItem
        $deleteItem.Header = 'Delete Program'
        $deleteItem.IsEnabled = (@($script:State.ProgramTabs).Count -gt 1)

        $renameItem.Add_Click({
            Invoke-UiSafe 'Rename program failed.' {
                $newLabel = Show-TextEntryDialog -Title 'Rename Program' -Prompt 'Enter the new program name.' -InitialValue ([string]$programTab.Label) -AcceptText 'Rename' -OwnerWindow $flowWindow
                if ([string]::IsNullOrWhiteSpace($newLabel)) { return }
                if (Rename-FlowCellProgramTab -ProgramTabId ([int]$programTab.Id) -NewLabel $newLabel) {
                    Clear-FlowCellButtonSelection
                    & $refreshAll
                    & $setStatus ('Renamed program tab to {0}.' -f [string]$newLabel.Trim())
                }
                else {
                    & $setStatus 'Rename program failed: choose a unique folder-backed program name.'
                }
            }
        }.GetNewClosure())
        $deleteItem.Add_Click({
            Invoke-UiSafe 'Delete program failed.' {
                $confirmText = 'Delete program {0}? This removes its FlowCell panels, buttons, shortcuts, and popout state.' -f [string]$programTab.Label
                if (-not (Confirm-UiAction -Message $confirmText -Title 'FlowCell' -OwnerWindow $flowWindow)) { return }
                $result = Remove-FlowCellProgramTab -ProgramTabId ([int]$programTab.Id)
                if (-not [bool]$result.Succeeded) {
                    & $setStatus ([string]$result.Message)
                    return
                }
                Clear-FlowCellButtonSelection
                & $refreshAll
                & $setStatus ([string]$result.Message)
            }
        }.GetNewClosure())

        [void]$menu.Items.Add($renameItem)
        [void]$menu.Items.Add($deleteItem)
        return $menu
    }
    $refreshShortcutDropdown = {
        $current = if ($shortcutDropdown -and $shortcutDropdown.SelectedItem -and $shortcutDropdown.SelectedItem.PSObject.Properties['RawShortcut']) {
            [string]$shortcutDropdown.SelectedItem.RawShortcut
        }
        else {
            ''
        }
        $items = @(
            New-ShortcutDisplayItem -RawShortcut ''
            foreach ($candidate in @(Get-AvailableCandidateShortcuts -IncludeShortcut $current)) {
                New-ShortcutDisplayItem -RawShortcut ([string]$candidate)
            }
        )
        $shortcutDropdown.Items.Clear()
        foreach ($item in $items) { [void]$shortcutDropdown.Items.Add($item) }
        $selectedItem = @($items | Where-Object { [string]$_.RawShortcut -eq $current } | Select-Object -First 1)
        if (@($selectedItem).Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($current)) {
            $normalizedCurrent = Normalize-Shortcut -Value $current
            $selectedItem = @($items | Where-Object { (Normalize-Shortcut -Value ([string]$_.RawShortcut)) -eq $normalizedCurrent } | Select-Object -First 1)
        }
        if (@($selectedItem).Count -gt 0) { $shortcutDropdown.SelectedItem = $selectedItem[0] } else { $shortcutDropdown.SelectedIndex = 0 }
    }
    $updateButtonSizeDisplay = {
        $scale = Get-FlowCellButtonScale
        if ($buttonSizeSlider) { $buttonSizeSlider.Value = $scale }
        if ($buttonSizeValueText) { $buttonSizeValueText.Text = ('{0:N2}x' -f $scale) }
    }
    $refreshProgramTabs = {
        $script:__flowCellSuppressProgramSelection = $true
        $programTabStrip.ItemsSource = $null
        $programTabStrip.ItemsSource = @(Get-FlowCellProgramRailTabs)
        $selectedProgram = Get-FlowCellSelectedProgramTab
        if ($selectedProgram) { $programTabStrip.SelectedItem = $selectedProgram }
        $script:__flowCellSuppressProgramSelection = $false
    }
    $refreshPanelTabs = {
        $programTab = Get-FlowCellSelectedProgramTab
        if ($null -eq $programTab) { $script:__flowCellSuppressPanelSelection = $true; $panelTabStrip.ItemsSource = $null; $script:__flowCellSuppressPanelSelection = $false; return }
        $programState = Get-FlowCellSelectedProgramState
        if ($null -eq $programState) { $script:__flowCellSuppressPanelSelection = $true; $panelTabStrip.ItemsSource = $null; $script:__flowCellSuppressPanelSelection = $false; return }
        $script:__flowCellSuppressPanelSelection = $true
        $items = @(Get-FlowCellPanelRailPanels -ProgramTab $programTab)
        $panelTabStrip.ItemsSource = $null
        $panelTabStrip.ItemsSource = $items
        $selectedItem = $items | Where-Object { [string]$_.Id -eq [string]$programState.SelectedPanelId } | Select-Object -First 1
        if ($selectedItem) { $panelTabStrip.SelectedItem = $selectedItem }
        $script:__flowCellSuppressPanelSelection = $false
    }
    $refreshButtonGrid = {
        Sync-FlowCellButtonsFromBindings
        $panelButtonGrid.Children.Clear()
        $programTab = & $getResolvedProgramTab
        $panel = & $getResolvedPanel
        if ($null -eq $programTab -or $null -eq $panel) { return }
        if (@($panel.Buttons).Count -eq 0) {
            $empty = New-Object System.Windows.Controls.TextBlock
            $empty.Text = 'No buttons in this panel yet. Use Bind Script or Bind Macro to add one.'
            $empty.Foreground = [System.Windows.Media.Brushes]::White
            $empty.TextWrapping = 'Wrap'
            [void]$panelButtonGrid.Children.Add($empty)
            return
        }
        $smartAxisOwnerButton = Get-FlowCellSmartAxisOwnerButtonFromPanel -Panel $panel
        $smartAxisOwnerButtonId = if ($smartAxisOwnerButton) { [string]$smartAxisOwnerButton.Id } else { '' }
        foreach ($buttonItem in @($panel.Buttons)) {
            $buttonScale = Get-FlowCellButtonScale
            $buttonItem = Ensure-FlowCellButtonStateLayer $buttonItem
            if (Test-FlowCellSmartAxisStateButton $buttonItem) {
                if ([string]$buttonItem.Id -ne $smartAxisOwnerButtonId) {
                    continue
                }
                try {
                    $smartAxisControl = New-FlowCellSmartAxisLockToolControl -Button $smartAxisOwnerButton -ProgramTab $programTab -PanelId ([string]$panel.Id) -Surface 'MainSmartAxis' -Width ([Math]::Round(338 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8)) -StatusAction $setStatus
                    $smartAxisControl.Margin = '0'
                    $wrappedControl = New-FlowCellMainToolWrapper -ProgramTab $programTab -Panel $panel -Button $smartAxisOwnerButton -Content $smartAxisControl -Tooltip (Get-FlowCellSmartAxisGroupTooltip) -ButtonGrid $panelButtonGrid -ArrangeModeEnabled (Get-FlowCellMainArrangeModeEnabled) -RefreshAction $refreshAll
                    [void]$panelButtonGrid.Children.Add($wrappedControl)
                    continue
                }
                catch {
                    Write-UiLog ('Smart Axis Lock control render failed in main window: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            if (Test-FlowCellCompoundToolButton $buttonItem) {
                try {
                    $compoundControl = New-FlowCellCompoundToolControl -Button $buttonItem -ProgramTab $programTab -PanelId ([string]$panel.Id) -Width ([Math]::Round(360 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8)) -Surface 'MainCompound'
                    if ($compoundControl) {
                        $compoundControl.Margin = '0'
                        $tooltip = Resolve-FlowCellButtonTooltip -Button $buttonItem -ProgramTab $programTab
                        $wrappedControl = New-FlowCellMainToolWrapper -ProgramTab $programTab -Panel $panel -Button $buttonItem -Content $compoundControl -Tooltip $tooltip -ButtonGrid $panelButtonGrid -ArrangeModeEnabled (Get-FlowCellMainArrangeModeEnabled) -RefreshAction $refreshAll
                        [void]$panelButtonGrid.Children.Add($wrappedControl)
                        continue
                    }
                }
                catch {
                    Write-UiLog ('Compound tool render failed in main window: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            if (Test-FlowCellFlattenRevolveToolButton $buttonItem) {
                try {
                    $flattenRevolveControl = New-FlowCellFlattenRevolveToolControl -Button $buttonItem -ProgramTab $programTab -PanelId ([string]$panel.Id) -Surface 'MainWindow' -Width ([Math]::Round(290 * $buttonScale, 2)) -FontSize ([Math]::Max([double][Math]::Round(12 * $buttonScale, 1), 8)) -StatusAction $setStatus
                    $flattenRevolveControl.Margin = '0'
                    $tooltip = Resolve-FlowCellButtonTooltip -Button $buttonItem -ProgramTab $programTab
                    $wrappedControl = New-FlowCellMainToolWrapper -ProgramTab $programTab -Panel $panel -Button $buttonItem -Content $flattenRevolveControl -Tooltip $tooltip -ButtonGrid $panelButtonGrid -ArrangeModeEnabled (Get-FlowCellMainArrangeModeEnabled) -RefreshAction $refreshAll
                    [void]$panelButtonGrid.Children.Add($wrappedControl)
                    continue
                }
                catch {
                    Write-UiLog ('Flatten/revolve control render failed in main window: {0} | {1}' -f $_.Exception.Message, $_.InvocationInfo.PositionMessage)
                }
            }
            $buttonPadding = ('{0},{1}' -f [Math]::Max([int][Math]::Round(12 * $buttonScale), 2), [Math]::Max([int][Math]::Round(10 * $buttonScale), 2))
            $buttonFontSize = [Math]::Max([double][Math]::Round(16 * $buttonScale, 1), 8)
            $buttonTooltip = Resolve-FlowCellButtonTooltip -Button $buttonItem -ProgramTab $programTab
            $buttonTag = [pscustomobject]@{
                Button = $buttonItem
                ProgramTab = $programTab
                PanelId = [string]$panel.Id
            }
            $buttonControl = New-FlowCellHostButtonControl `
                -Label ([string]$buttonItem.Label) `
                -Tag $buttonTag `
                -Tooltip $buttonTooltip `
                -Width ([Math]::Round(176 * $buttonScale, 2)) `
                -Height ([Math]::Round(84 * $buttonScale, 2)) `
                -Padding $buttonPadding `
                -FontSize $buttonFontSize `
                -HorizontalAlignment 'Left' `
                -VerticalAlignment 'Top'
            & $showButtonContextMenu $buttonControl
            $buttonControl.Add_PreviewMouseRightButtonUp({
                param($sender, $eventArgs)
                if ($sender.ContextMenu) {
                    $sender.ContextMenu.PlacementTarget = $sender
                    $sender.ContextMenu.IsOpen = $true
                    $eventArgs.Handled = $true
                }
            }.GetNewClosure())
            $buttonControl.Add_Click({
                param($sender, $eventArgs)
                Invoke-UiSafe 'Button action failed.' {
                    $tag = $sender.Tag
                    $result = Invoke-FlowCellButtonAction -Button $tag.Button -ProgramTab $tag.ProgramTab -PanelId ([string]$tag.PanelId) -Surface 'MainWindow'
                    if ($result -and $result.PSObject.Properties['Message']) {
                        if ($setStatus -is [scriptblock]) {
                            & $setStatus ([string]$result.Message)
                        }
                        else {
                            Set-ControlTextValue $flowCellStatusText ([string]$result.Message)
                        }
                    }
                }
            }.GetNewClosure())
            $wrappedButton = New-FlowCellMainToolWrapper -ProgramTab $programTab -Panel $panel -Button $buttonItem -Content $buttonControl -Tooltip $buttonTooltip -ButtonGrid $panelButtonGrid -ArrangeModeEnabled (Get-FlowCellMainArrangeModeEnabled) -RefreshAction $refreshAll
            [void]$panelButtonGrid.Children.Add($wrappedButton)
        }
    }
    if ($panelButtonGrid) {
        $panelButtonGrid.Add_LostMouseCapture({
            param($sender, $eventArgs)
            $dragState = $script:FlowCellMainArrangeDragState
            if ($null -eq $dragState -or $dragState.ButtonGrid -ne $sender) { return }
            if ([bool]$dragState.DropCompleted) { return }
            Cancel-FlowCellMainArrangeDrag
            $script:FlowCellMainArrangeDragState = $null
            $script:FlowCellMainArrangePendingPointer = $null
        }.GetNewClosure())
    }
    $refreshHeader = {
        $programTab = & $getResolvedProgramTab
        $panel = & $getResolvedPanel
        $panelIsPoppedOutLive = $false
        if ($programTab -and $panel) {
            $panelIsPoppedOutLive = Test-FlowCellPanelWindowOpen -ProgramTabId ([int]$programTab.Id) -PanelId ([string]$panel.Id)
        }
        $isArrangeModeEnabled = Get-FlowCellMainArrangeModeEnabled
        $programNameText.Text = if ($programTab) { [string]$programTab.Label } else { 'FlowCell' }
        $panelStateText.Text = if ($panel) {
            if ($isArrangeModeEnabled) {
                '{0} is in arrange mode. Drag tiles to reorder this panel before you pop it out.' -f $panel.Name
            }
            elseif ($panelIsPoppedOutLive) {
                '{0} is popped out. Use the button to bring it forward.' -f $panel.Name
            }
            else {
                '{0} is docked in the main program surface.' -f $panel.Name
            }
        }
        else {
            'No panel selected.'
        }
        if ($addPanelButton) { $addPanelButton.IsEnabled = ($null -ne $programTab) }
        $hasPanel = ($null -ne $panel)
        $resolvedProgramState = & $getResolvedProgramState
        if ($popTabButton) {
            $popTabButton.IsEnabled = $hasPanel
            $popTabButton.Content = if ($panelIsPoppedOutLive) { 'Show Tab' } else { 'Pop Tab' }
        }
        if ($popToolsButton) { $popToolsButton.IsEnabled = $hasPanel }
        if ($popOutModeBox) { $popOutModeBox.IsEnabled = $hasPanel }
        if ($arrangeButtonsButton) {
            $arrangeButtonsButton.IsEnabled = $hasPanel
            $arrangeButtonsButton.Content = if ($isArrangeModeEnabled) { 'Done' } else { 'Arrange' }
            $arrangeButtonsButton.ToolTip = if ($isArrangeModeEnabled) { 'Leave arrange mode and return to normal clicks.' } else { 'Turn on drag-and-drop reordering for the main FlowCell page.' }
            $arrangeButtonsButton.Background = if ($isArrangeModeEnabled) { (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(255,170,79))) } else { (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(60,70,84))) }
            $arrangeButtonsButton.Foreground = if ($isArrangeModeEnabled) { (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(24,20,14))) } else { [System.Windows.Media.Brushes]::White }
        }
        $renamePanelButton.IsEnabled = $hasPanel
        $removePanelButton.IsEnabled = $hasPanel -and ($null -ne $resolvedProgramState) -and (@($resolvedProgramState.Panels).Count -gt 1)
        if ($savePanelButton) { $savePanelButton.IsEnabled = $hasPanel }
        if ($loadPanelButton) { $loadPanelButton.IsEnabled = ($null -ne $programTab) }
        if ($bindScriptButton) {
            $bindScriptButton.Content = if ($programTab -and (Get-ProgramLabelKey ([string]$programTab.Label)) -eq 'blender') { 'Add Button' } else { 'Add Script' }
        }
        if ($saveLayoutButton) { $saveLayoutButton.IsEnabled = $true }
        if ($loadLayoutButton) { $loadLayoutButton.IsEnabled = $true }
        $applyBindButton.IsEnabled = ($null -ne $script:FlowCellPendingShortcutBinding)
    }
    $refreshAll = { & $refreshProgramTabs; & $refreshPanelTabs; & $refreshShortcutDropdown; & $refreshHeader; & $updateButtonSizeDisplay; & $refreshButtonGrid; Refresh-FlowCellPanelWindows; Refresh-FlowCellToolPopoutWindows }
    $script:FlowCellMainRefresh = $refreshAll
    $completePendingBinding = {
        $pending = $script:FlowCellPendingShortcutBinding
        $shortcut = if ($shortcutDropdown.SelectedItem -and $shortcutDropdown.SelectedItem.PSObject.Properties['RawShortcut']) {
            [string]$shortcutDropdown.SelectedItem.RawShortcut
        }
        else {
            ''
        }
        if ($null -eq $pending -or [string]::IsNullOrWhiteSpace($shortcut)) { return }
        $normalizedShortcut = Normalize-Shortcut -Value $shortcut
        if ((Get-UsedShortcuts).ContainsKey($normalizedShortcut)) {
            & $setStatus ('Shortcut already in use: {0}' -f (Format-ShortcutForDisplay -Shortcut $shortcut))
            Write-UiLog ('FlowCell bind rejected because shortcut is already in use: {0}' -f $shortcut)
            return
        }
        $programTab = Get-FlowCellProgramTab -ProgramTabId ([int]$pending.ProgramTabId)
        if ($null -eq $programTab) {
            Write-UiLog ('FlowCell shortcut bind failed to resolve program tab. ProgramTabId={0}' -f $pending.ProgramTabId)
            return
        }
        if ([string]$pending.Kind -eq 'script') {
            $bindingId = [int]$script:State.NextId
            $script:State.NextId = $bindingId + 1
            $script:State.ScriptBindings += [pscustomobject]@{
                Kind = 'script'
                Id = $bindingId
                Shortcut = $shortcut
                Target = [string]$pending.Target
                Status = 'Active'
                ProgramTabId = [int]$pending.ProgramTabId
            }
            Save-State
            Restart-Backend
            & $clearPendingBinding
            & $refreshAll
            Write-UiLog ('FlowCell saved shortcut bind for script {0} to {1} in program {2}.' -f $pending.Label, $shortcut, $programTab.Label)
            & $setStatus ('Saved script shortcut {0} for {1}.' -f (Format-ShortcutForDisplay -Shortcut $shortcut), $pending.Label)
        }
        else {
            $script:State.ActionHotkeys[[string]$pending.Target] = $shortcut
            Save-State
            Restart-Backend
            & $clearPendingBinding
            & $refreshAll
            Write-UiLog ('FlowCell saved shortcut bind for macro {0} to {1}.' -f $pending.Label, $shortcut)
            & $setStatus ('Saved macro shortcut {0} for {1}.' -f (Format-ShortcutForDisplay -Shortcut $shortcut), $pending.Label)
        }
    }

    $programTabStrip.Add_SelectionChanged({ if ($script:__flowCellSuppressProgramSelection) { return }; if ($programTabStrip.SelectedItem -and $programTabStrip.SelectedItem.PSObject.Properties['Id']) { Clear-FlowCellButtonSelection; $script:FlowCellState.SelectedProgramTabId = [int]$programTabStrip.SelectedItem.Id; Save-FlowCellState; & $refreshAll } })
    $programTabStrip.Add_PreviewMouseRightButtonUp({
        param($sender, $eventArgs)
        try {
            $dep = [System.Windows.DependencyObject]$eventArgs.OriginalSource
            while ($dep -and -not ($dep -is [System.Windows.Controls.ListBoxItem])) {
                $dep = [System.Windows.Media.VisualTreeHelper]::GetParent($dep)
            }
            if (-not $dep -or -not ($dep -is [System.Windows.Controls.ListBoxItem])) { return }
            $clickedProgramTab = $dep.DataContext
            if ($null -eq $clickedProgramTab -or -not $clickedProgramTab.PSObject.Properties['Id']) { return }
            $programTabStrip.SelectedItem = $clickedProgramTab
            $menu = & $showProgramTabContextMenu $clickedProgramTab
            if ($menu) {
                $menu.PlacementTarget = $dep
                $menu.IsOpen = $true
                $eventArgs.Handled = $true
            }
        }
        catch {
            Write-UiLog ('Program tab context menu failed: {0}' -f $_.Exception.ToString())
        }
    }.GetNewClosure())
    $panelTabStrip.Add_SelectionChanged({ if ($script:__flowCellSuppressPanelSelection) { return }; if ($panelTabStrip.SelectedItem -and $panelTabStrip.SelectedItem.PSObject.Properties['Id']) { $programState = Get-FlowCellSelectedProgramState; if ($programState) { Clear-FlowCellButtonSelection -ProgramTabId ([int]$programState.ProgramTabId) -PanelId ([string]$programState.SelectedPanelId); $programState.SelectedPanelId = [string]$panelTabStrip.SelectedItem.Id; Save-FlowCellState; & $refreshAll } } })
    if ($addProgramButton) {
        $addProgramButton.Add_Click({
            Invoke-UiSafe 'Add Program failed.' {
                $programSelection = Show-AddProgramDialog
                if ($null -eq $programSelection) { return }
                $result = Add-FlowCellProgramRailEntry -ProgramName ([string]$programSelection.ProgramName) -ExePath ([string]$programSelection.ExePath)
                if (-not [bool]$result.Succeeded) {
                    & $setStatus ('Add Program failed: {0}' -f [string]$result.Message)
                    return
                }
                Clear-FlowCellButtonSelection
                & $refreshAll
                & $setStatus ([string]$result.Message)
            }
        })
    }
    if ($startupRestorePopoutsOnlyCheckBox) {
        $startupRestorePopoutsOnlyCheckBox.Add_Click({
            $isEnabled = [bool]$startupRestorePopoutsOnlyCheckBox.IsChecked
            Set-FlowCellStartupRestorePopoutsOnly -Enabled $isEnabled
            Save-FlowCellState
            & $setStatus $(if ($isEnabled) {
                'Startup pop-out-only mode is on. FlowCell will start minimized and restore the last pop-out layout next launch.'
            } else {
                'Startup pop-out-only mode is off. FlowCell will open the main window normally next launch.'
            })
        })
    }
    $applyBindButton.Add_Click({
        if (-not $script:FlowCellPendingShortcutBinding) {
            & $setStatus 'Pick Script or Macro first.'
            return
        }
        if (-not $shortcutDropdown.SelectedItem -or -not $shortcutDropdown.SelectedItem.PSObject.Properties['RawShortcut'] -or [string]::IsNullOrWhiteSpace([string]$shortcutDropdown.SelectedItem.RawShortcut)) {
            & $setStatus 'Choose a shortcut first, then click Bind.'
            return
        }
        & $completePendingBinding
    })
    if ($buttonSizeSlider) {
        $buttonSizeSlider.Add_ValueChanged({
            param($sender, $eventArgs)
            if (-not $script:FlowCellState) { return }
            $script:FlowCellState.ButtonScale = [Math]::Round([double]$sender.Value, 2)
            Save-FlowCellState
            if ($buttonSizeValueText) { $buttonSizeValueText.Text = ('{0:N2}x' -f [double]$sender.Value) }
            & $refreshButtonGrid
            Refresh-FlowCellPanelWindows
            Refresh-FlowCellToolPopoutWindows
        })
    }
    $bindAreaScriptButton.Add_Click({
        $programTab = & $getResolvedProgramTab
        if ($null -eq $programTab) { return }
        $dialog = New-Object Microsoft.Win32.OpenFileDialog
        $dialog.Title = ('Choose {0} script shortcut target' -f $programTab.Label)
        $dialog.Filter = Get-ProgramScriptDialogFilter -ProgramReference $programTab
        $initialDir = Get-ProgramInitialScriptFolder -ProgramTab $programTab
        if (Test-Path -LiteralPath $initialDir -PathType Container) { $dialog.InitialDirectory = $initialDir }
        if (-not $dialog.ShowDialog($flowWindow)) { return }
        Set-ProgramLastScriptFolder -ProgramTab $programTab -FilePath ([string]$dialog.FileName)
        Save-State
        $script:FlowCellPendingShortcutBinding = [pscustomobject]@{
            Kind = 'script'
            ProgramTabId = [int]$programTab.Id
            Target = [string]$dialog.FileName
            Label = [System.IO.Path]::GetFileNameWithoutExtension([string]$dialog.FileName)
        }
        $selectedBindNameText.Text = [System.IO.Path]::GetFileName([string]$dialog.FileName)
        $selectedBindNameText.ToolTip = [string]$dialog.FileName
        $bindSelectionText.Text = ('Script shortcut for {0}' -f [string]$programTab.Label)
        $bindSelectionText.ToolTip = [string]$dialog.FileName
        if ($shortcutDropdown) { $shortcutDropdown.SelectedIndex = 0 }
        & $refreshAll
        & $setStatus 'Script selected for permanent shortcut. Choose a shortcut, then click Bind.'
    })
    $bindAreaMacroButton.Add_Click({
        $programTab = & $getResolvedProgramTab
        if ($null -eq $programTab) { return }
        $macroChoice = Show-FlowCellMacroPickerDialog
        if ($null -eq $macroChoice) { return }
        $script:FlowCellPendingShortcutBinding = [pscustomobject]@{
            Kind = 'macro'
            ProgramTabId = [int]$programTab.Id
            Target = [string]$macroChoice.Id
            Label = [string]$macroChoice.Label
        }
        $selectedBindNameText.Text = [string]$macroChoice.Label
        $selectedBindNameText.ToolTip = [string]$macroChoice.Path
        $bindSelectionText.Text = ('Macro shortcut for {0}' -f [string]$programTab.Label)
        $bindSelectionText.ToolTip = [string]$macroChoice.Path
        if ($shortcutDropdown) { $shortcutDropdown.SelectedIndex = 0 }
        & $refreshAll
        & $setStatus 'Macro selected for permanent shortcut. Choose a shortcut, then click Bind.'
    })
    $flowWindow.FindName('BindScriptButton').Add_Click({
        $programTab = & $getResolvedProgramTab
        $programState = & $getResolvedProgramState
        $panel = & $getResolvedPanel
        if ($null -eq $programTab -or $null -eq $programState -or $null -eq $panel) { return }
        $script:FlowCellState.SelectedProgramTabId = [int]$programTab.Id
        $programState.SelectedPanelId = [string]$panel.Id
        $programKey = Get-ProgramLabelKey ([string]$programTab.Label)
        $dialog = New-Object Microsoft.Win32.OpenFileDialog
        if ([string]$programKey -eq 'blender') {
            $dialog.Title = ('Choose {0} button source (.py or .ps1)' -f $programTab.Label)
            $dialog.Filter = 'Blender Button Sources (*.py;*.ps1)|*.py;*.ps1|All Files (*.*)|*.*'
        }
        else {
            $dialog.Title = ('Choose {0} script' -f $programTab.Label)
            $dialog.Filter = Get-ProgramScriptDialogFilter -ProgramReference $programTab
        }
        $dialog.Multiselect = $true
        $initialDir = Get-ProgramInitialScriptFolder -ProgramTab $programTab
        if (Test-Path -LiteralPath $initialDir -PathType Container) { $dialog.InitialDirectory = $initialDir }
        if (-not $dialog.ShowDialog($flowWindow)) { return }
        $selectedPaths = @($dialog.FileNames | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if (@($selectedPaths).Count -eq 0) { return }
        Set-ProgramLastScriptFolder -ProgramTab $programTab -FilePath ([string]$selectedPaths[0])

        if ([string]$programKey -eq 'blender') {
            $installerPath = Join-Path $script:FlowCellHomeRoot 'Programs\Blender\SupportScripts\Install-BlenderFlowCellButtons.ps1'
            if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
                & $setStatus ('Blender Add Button installer script was not found: {0}' -f $installerPath)
                return
            }

            try {
                $installResultJson = & $installerPath -SelectedPaths $selectedPaths -PanelName ([string]$panel.Name)
            }
            catch {
                Write-UiLog ('Blender Add Button installer failed. Panel={0}; Error={1}' -f [string]$panel.Name, $_.Exception.ToString())
                & $setStatus ('Blender Add Button failed: {0}' -f $_.Exception.Message)
                return
            }
            $installResult = $null
            try {
                $installResult = $installResultJson | ConvertFrom-Json
            }
            catch {
                Write-UiLog ('Blender Add Button installer returned invalid JSON. Output={0}' -f [string]$installResultJson)
                & $setStatus 'Blender Add Button installer returned invalid output. Check logs.'
                return
            }

            $script:State = Read-State
            $script:FlowCellState = Read-FlowCellState
            Sync-FlowCellButtonsFromBindings
            Save-State
            Save-FlowCellState
            & $refreshAll

            $installedCount = if ($installResult.PSObject.Properties['InstalledCount']) { [int]$installResult.InstalledCount } else { 0 }
            $failedCount = if ($installResult.PSObject.Properties['FailedCount']) { [int]$installResult.FailedCount } else { 0 }
            $reloadRequired = ($installResult.PSObject.Properties['ReloadRequired'] -and [bool]$installResult.ReloadRequired)
            $reloadReason = if ($installResult.PSObject.Properties['ReloadReason']) { [string]$installResult.ReloadReason } else { '' }
            $regeneratedFlowcellActions = ($installResult.PSObject.Properties['RegeneratedFlowcellActions'] -and [bool]$installResult.RegeneratedFlowcellActions)
            $syncedFlowCellButtons = ($installResult.PSObject.Properties['SyncedFlowCellButtons'] -and [bool]$installResult.SyncedFlowCellButtons)
            $callableCheckStatus = if ($installResult.PSObject.Properties['CallableCheckStatus']) { [string]$installResult.CallableCheckStatus } else { 'unknown' }
            $statusMessage = if ($installResult.PSObject.Properties['StatusMessage']) { [string]$installResult.StatusMessage } else { '' }
            Write-UiLog ('Blender Add Button install finished. Panel={0}; Installed={1}; Failed={2}; ReloadRequired={3}; RegeneratedFlowcellActions={4}; SyncedFlowCellButtons={5}; CallableCheckStatus={6}' -f [string]$panel.Name, $installedCount, $failedCount, $reloadRequired, $regeneratedFlowcellActions, $syncedFlowCellButtons, $callableCheckStatus)

            if ($installedCount -le 0) {
                $firstFailure = @(
                    @($installResult.Results) |
                        Where-Object { $_ -and $_.PSObject.Properties['Installed'] -and (-not [bool]$_.Installed) -and $_.PSObject.Properties['Message'] -and -not [string]::IsNullOrWhiteSpace([string]$_.Message) } |
                        Select-Object -First 1
                )
                if (@($firstFailure).Count -gt 0) {
                    & $setStatus ('No Blender buttons were installed. {0}' -f [string]$firstFailure[0].Message)
                }
                else {
                    & $setStatus 'No Blender buttons were installed. Check logs for skipped files.'
                }
                return
            }

            if (-not [string]::IsNullOrWhiteSpace($statusMessage)) {
                & $setStatus $statusMessage
            }
            elseif ($reloadRequired -and -not [string]::IsNullOrWhiteSpace($reloadReason)) {
                & $setStatus ('Installed {0} Blender button(s) on {1}. {2}' -f $installedCount, [string]$panel.Name, $reloadReason)
            }
            elseif ($reloadRequired) {
                & $setStatus ('Installed {0} Blender button(s) on {1}. Reload the Blender addon or restart Blender before first use.' -f $installedCount, [string]$panel.Name)
            }
            elseif ($failedCount -gt 0) {
                & $setStatus ('Installed {0} Blender button(s) on {1}. Skipped {2} file(s).' -f $installedCount, [string]$panel.Name, $failedCount)
            }
            else {
                & $setStatus ('Installed {0} Blender button(s) on {1}. Action list synced.' -f $installedCount, [string]$panel.Name)
            }
            return
        }

        $addedCount = 0
        $importedCount = 0
        foreach ($selectedPath in @($selectedPaths)) {
            $targetResolution = Resolve-FlowCellButtonTargetPath -ProgramTab $programTab -SelectedPath ([string]$selectedPath)
            if (-not [bool]$targetResolution.Succeeded -or [string]::IsNullOrWhiteSpace([string]$targetResolution.Path)) {
                Write-UiLog ('Skipped script button import. ProgramTabId={0}; PanelId={1}; Source={2}; Reason={3}' -f $programTab.Id, $panel.Id, [string]$selectedPath, [string]$targetResolution.Message)
                continue
            }
            if ([bool]$targetResolution.Imported) {
                $importedCount++
            }
            $buttonId = 'button_{0}' -f [guid]::NewGuid().ToString('N')
            $panel.Buttons += [pscustomobject]@{
                Id = $buttonId
                Kind = 'script'
                Label = Get-FlowCellDisplayButtonLabelFromPath -Path ([string]$targetResolution.Path)
                Target = [string]$targetResolution.Path
                Shortcut = ''
                BindingId = 0
                style_group_id = ''
            }
            $addedCount++
        }
        if ($addedCount -le 0) {
            & $setStatus 'No buttons were added. Check logs for skipped files.'
            return
        }
        Save-State
        Write-UiLog ('Added FlowCell script button(s). ProgramTabId={0}; PanelId={1}; Count={2}; Imported={3}' -f $programTab.Id, $panel.Id, $addedCount, $importedCount)
        & $refreshAll
        $buttonWord = if ($addedCount -eq 1) { 'button' } else { 'buttons' }
        if ($importedCount -gt 0) {
            & $setStatus ('Added {0} {1} to {2}. Imported {3} file(s) into Blender\\FlowCellButtons.' -f $addedCount, $buttonWord, $panel.Name, $importedCount)
        }
        else {
            & $setStatus ('Added {0} script {1} to {2}.' -f $addedCount, $buttonWord, $panel.Name)
        }
    })
    $flowWindow.FindName('BindMacroButton').Add_Click({
        $programTab = & $getResolvedProgramTab
        $programState = & $getResolvedProgramState
        $panel = & $getResolvedPanel
        if ($null -eq $programTab -or $null -eq $programState -or $null -eq $panel) { return }
        $script:FlowCellState.SelectedProgramTabId = [int]$programTab.Id
        $programState.SelectedPanelId = [string]$panel.Id
        $macroChoice = Show-FlowCellMacroPickerDialog
        if ($null -eq $macroChoice) { return }
        $buttonId = 'button_{0}' -f [guid]::NewGuid().ToString('N')
        $panel.Buttons += [pscustomobject]@{
            Id = $buttonId
            Kind = 'macro'
            Label = [string]$macroChoice.Label
            Target = [string]$macroChoice.Id
            Shortcut = ''
            BindingId = 0
            style_group_id = ''
        }
        Save-FlowCellState
        Write-UiLog ('Added FlowCell macro button. ProgramTabId={0}; PanelId={1}; Label={2}' -f $programTab.Id, $panel.Id, [string]$macroChoice.Label)
        & $refreshAll
        & $setStatus ('Added macro button {0} to {1}.' -f [string]$macroChoice.Label, $panel.Name)
    })
    $showBindsButton.Add_Click({ Invoke-UiSafe 'Bind Viewer failed.' { Show-BindViewerWindow -ProgramTabId ([int]$script:FlowCellState.SelectedProgramTabId) } })
    $flowWindow.FindName('BindViewerButton').Add_Click({ Invoke-UiSafe 'Bind Viewer failed.' { Show-BindViewerWindow -ProgramTabId ([int]$script:FlowCellState.SelectedProgramTabId) } })
    $flowWindow.FindName('MacroLabButton').Add_Click({
        Invoke-UiSafe 'Macro Lab failed.' {
            $programTab = Get-FlowCellSelectedProgramTab
            Edit-RecordedMacro -ProgramLabel $(if ($programTab) { [string]$programTab.Label } else { 'Illustrator' }) | Out-Null
            Load-Actions
            $script:State = Read-State
            $script:FlowCellState = Read-FlowCellState
            Sync-FlowCellButtonsFromBindings
            & $refreshAll
        }
    })
    $addPanelButton.Add_Click({
        $programTab = Get-FlowCellSelectedProgramTab
        if ($null -eq $programTab) { return }
        $name = Show-TextEntryDialog -Title 'Add Panel' -Prompt 'Name the new panel.' -InitialValue '' -AcceptText 'Add'
        if ([string]::IsNullOrWhiteSpace($name)) { return }
        $result = Add-FlowCellPanel -ProgramTabId ([int]$programTab.Id) -PanelName ([string]$name)
        if (-not [bool]$result.Succeeded) {
            & $setStatus ('Add Panel failed: {0}' -f [string]$result.Message)
            return
        }
        & $refreshAll
        & $setStatus ([string]$result.Message)
    })
    $renamePanelButton.Add_Click({
        $programTab = Get-FlowCellSelectedProgramTab
        $panel = Get-FlowCellSelectedPanel
        if ($null -eq $programTab -or $null -eq $panel) { return }
        $name = Show-TextEntryDialog -Title 'Rename Panel' -Prompt 'Enter the new panel name.' -InitialValue ([string]$panel.Name) -AcceptText 'Rename'
        if ([string]::IsNullOrWhiteSpace($name)) { return }
        if (-not (Rename-FlowCellPanel -ProgramTabId ([int]$programTab.Id) -PanelId ([string]$panel.Id) -NewName ([string]$name))) {
            & $setStatus 'Rename Panel failed: choose a unique panel name.'
            return
        }
        & $refreshAll
        & $setStatus ('Renamed panel to {0}.' -f $name.Trim())
    })
    $removePanelButton.Add_Click({
        $programTab = Get-FlowCellSelectedProgramTab
        $programState = Get-FlowCellSelectedProgramState
        $panel = Get-FlowCellSelectedPanel
        if ($null -eq $programTab -or $null -eq $programState -or $null -eq $panel -or @($programState.Panels).Count -le 1) { return }
        if ([System.Windows.MessageBox]::Show($flowWindow, ('Remove panel {0}?' -f $panel.Name), 'FlowCell', 'YesNo', 'Question') -ne 'Yes') { return }
        $result = Remove-FlowCellPanel -ProgramTabId ([int]$programTab.Id) -PanelId ([string]$panel.Id)
        if (-not [bool]$result.Succeeded) {
            & $setStatus ('Remove Panel failed: {0}' -f [string]$result.Message)
            return
        }
        & $refreshAll
        & $setStatus ([string]$result.Message)
    })
    if ($saveLayoutButton) {
        $saveLayoutButton.Add_Click({
            $initialFolder = if (-not [string]::IsNullOrWhiteSpace([string]$script:FlowCellLastLayoutFolder) -and (Test-Path -LiteralPath $script:FlowCellLastLayoutFolder -PathType Container)) {
                $script:FlowCellLastLayoutFolder
            } else {
                $script:FlowCellLayoutsRoot
            }
            New-Item -ItemType Directory -Path $initialFolder -Force | Out-Null
            $dialog = New-Object Microsoft.Win32.SaveFileDialog
            $dialog.Title = 'Save Layout'
            $dialog.InitialDirectory = $initialFolder
            $dialog.Filter = 'FlowCell Layout (*.flowlayout.json)|*.flowlayout.json|JSON Files (*.json)|*.json'
            $dialog.FileName = ('layout-{0}.flowlayout.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
            if (-not $dialog.ShowDialog($flowWindow)) { return }
            $layoutPath = Save-FlowCellLayoutSnapshot -MainWindow $flowWindow -Path ([string]$dialog.FileName)
            $script:FlowCellLastLayoutFolder = Split-Path -Parent ([string]$dialog.FileName)
            & $setStatus ('Saved FlowCell popout layout to {0}.' -f $layoutPath)
            & $refreshAll
        })
    }
    if ($loadLayoutButton) {
        $loadLayoutButton.Add_Click({
            $layoutPath = Show-FlowCellLayoutPickerDialog -OwnerWindow $flowWindow
            if ([string]::IsNullOrWhiteSpace($layoutPath)) { return }
            Import-FlowCellLayout -Path $layoutPath -MainWindow $flowWindow -OnStateChanged $refreshAll | Out-Null
            $script:FlowCellLastLayoutFolder = Split-Path -Parent $layoutPath
            & $refreshAll
            & $setStatus ('Loaded FlowCell popout layout from {0}.' -f $layoutPath)
        })
    }
    if ($savePanelButton) {
        $savePanelButton.Add_Click({
            $programTab = & $getResolvedProgramTab
            $panel = & $getResolvedPanel
            if ($null -eq $programTab -or $null -eq $panel) { return }
            $initialFolder = Get-FlowCellProgramPanelSaveFolder -ProgramTabId ([int]$programTab.Id)
            $dialog = New-Object Microsoft.Win32.SaveFileDialog
            $dialog.Title = 'Save Panel'
            $dialog.InitialDirectory = $initialFolder
            $dialog.Filter = 'Panel Files (*.flowpanel.json)|*.flowpanel.json|JSON Files (*.json)|*.json'
            $dialog.FileName = (([string]$panel.Name -replace '[\\/:*?"<>|]+', '_').Trim() + '.flowpanel.json')
            if (-not $dialog.ShowDialog($flowWindow)) { return }
            Export-FlowCellPanel -Panel $panel -ProgramTabId ([int]$programTab.Id) -Path ([string]$dialog.FileName)
            $script:FlowCellLastPanelSaveFolder = Split-Path -Parent ([string]$dialog.FileName)
            & $setStatus ('Saved panel {0}.' -f [string]$panel.Name)
        })
    }
    if ($loadPanelButton) {
        $loadPanelButton.Add_Click({
            $programTab = & $getResolvedProgramTab
            $programState = & $getResolvedProgramState
            if ($null -eq $programTab -or $null -eq $programState) { return }
            $initialFolder = if (-not [string]::IsNullOrWhiteSpace([string]$script:FlowCellLastPanelSaveFolder) -and (Test-Path -LiteralPath $script:FlowCellLastPanelSaveFolder -PathType Container)) {
                $script:FlowCellLastPanelSaveFolder
            } else {
                Get-FlowCellProgramPanelSaveFolder -ProgramTabId ([int]$programTab.Id)
            }
            $dialog = New-Object Microsoft.Win32.OpenFileDialog
            $dialog.Title = 'Load Panel'
            $dialog.InitialDirectory = $initialFolder
            $dialog.Filter = 'Panel Files (*.flowpanel.json)|*.flowpanel.json|JSON Files (*.json)|*.json'
            if (-not $dialog.ShowDialog($flowWindow)) { return }
            $importedPanel = Import-FlowCellPanel -ProgramTabId ([int]$programTab.Id) -Path ([string]$dialog.FileName)
            Save-FlowCellState
            $script:FlowCellLastPanelSaveFolder = Split-Path -Parent ([string]$dialog.FileName)
            & $refreshAll
            & $setStatus ('Loaded panel {0}.' -f [string]$importedPanel.Name)
        })
    }
    $openActivePanelWindow = {
        $panel = & $getResolvedPanel
        $programState = & $getResolvedProgramState
        if ($null -eq $panel -or $null -eq $programState) { return }
        $targetProgramTabId = [int]$programState.ProgramTabId
        $targetPanelId = [string]$panel.Id
        if ([bool]$panel.IsPoppedOut) {
            if (Test-FlowCellPanelWindowOpen -ProgramTabId $targetProgramTabId -PanelId $targetPanelId) {
                Show-FlowCellPanelWindow -ProgramTabId $targetProgramTabId -PanelId $targetPanelId -OnStateChanged $refreshAll
                & $refreshAll
                return
            }
            else {
                $panel.IsPoppedOut = $false
                Save-FlowCellState
            }
        }
        $panel.IsPoppedOut = $true
        $programState.SelectedPanelId = $targetPanelId
        Save-FlowCellState
        Write-UiLog ('Opening FlowCell panel window. ProgramTabId={0}; PanelId={1}' -f $targetProgramTabId, $targetPanelId)
        Show-FlowCellPanelWindow -ProgramTabId $targetProgramTabId -PanelId $targetPanelId -OnStateChanged $refreshAll
        & $refreshAll
    }
    $openSelectedToolsWindow = {
        $panel = & $getResolvedPanel
        $programState = & $getResolvedProgramState
        if ($null -eq $panel -or $null -eq $programState) { return }
        $targetProgramTabId = [int]$programState.ProgramTabId
        $targetPanelId = [string]$panel.Id
        $selectedEntries = @(Get-FlowCellSelectedButtonEntries -ProgramTabId $targetProgramTabId -PanelId $targetPanelId)
        if (@($selectedEntries).Count -eq 0) {
            & $setStatus 'Check one or more tools first, then press Pop Tools.'
            return
        }
        $popoutMode = Get-FlowCellPopoutMode -ModeControl $popOutModeBox
        Show-FlowCellButtonPopoutSelection -ProgramTabId $targetProgramTabId -PanelId $targetPanelId -Entries $selectedEntries -LayoutMode $popoutMode -OnStateChanged $refreshAll
        & $refreshAll
    }
    if ($popTabButton) { $popTabButton.Add_Click({ Invoke-UiSafe 'Pop out panel failed.' { & $openActivePanelWindow } }) }
    if ($popToolsButton) { $popToolsButton.Add_Click({ Invoke-UiSafe 'Pop out tools failed.' { & $openSelectedToolsWindow } }) }
    if ($arrangeButtonsButton) {
        $arrangeButtonsButton.Add_Click({
            $script:FlowCellMainArrangeModeEnabled = -not [bool]$script:FlowCellMainArrangeModeEnabled
            $script:FlowCellMainArrangePendingPointer = $null
            $script:FlowCellMainArrangeDragState = $null
            & $refreshAll
            if ($script:FlowCellMainArrangeModeEnabled) {
                & $setStatus 'Arrange mode is on. Drag tiles on the main page to reorder them.'
            }
            else {
                & $setStatus 'Arrange mode is off. Button clicks and checkboxes are back to normal.'
            }
        })
    }
    $flowWindow.Add_LocationChanged({
        Save-FlowCellMainWindowBounds -Window $flowWindow
    }.GetNewClosure())
    $flowWindow.Add_SizeChanged({
        Save-FlowCellMainWindowBounds -Window $flowWindow
    }.GetNewClosure())
    $flowWindow.Add_ContentRendered({
        try {
            if (-not [bool]$script:FlowCellPopoutFirstStartupPending -and -not [bool]$script:FlowCellStartupRestoreInProgress) {
                Invoke-FlowCellWindowFrontPulse -Window $flowWindow
            }
            $enablePopoutsAction = [System.Action]{
                Enable-FlowCellPanelWindows
            }
            [void]$flowWindow.Dispatcher.BeginInvoke($enablePopoutsAction, [System.Windows.Threading.DispatcherPriority]::ApplicationIdle)
        }
        catch {
        }
    }.GetNewClosure())
    $flowWindow.Add_Activated({
        if (-not [bool]$script:FlowCellPopoutFirstStartupPending -and -not [bool]$script:FlowCellStartupRestoreInProgress) {
            Invoke-FlowCellWindowFrontPulse -Window $flowWindow
        }
        Enable-FlowCellPanelWindows
    }.GetNewClosure())
    $flowWindow.Add_Closed({
        Save-FlowCellLayoutSnapshot -MainWindow $flowWindow | Out-Null
        $script:FlowCellMainRefresh = $null
        Close-FlowCellToolPopoutWindows
        Close-FlowCellPanelWindowsForLayout
        Save-FlowCellState
        if ($script:DocumentPollTimer) { $script:DocumentPollTimer.Stop() }
        if ($script:CliWatchTimer) { $script:CliWatchTimer.Stop() }
        if ($script:BackendStartedByUi) { Stop-Backend }
        Write-UiLog 'FlowCell window closed.'
    })
    & $clearPendingBinding
    & $refreshAll
    & $setStatus 'FlowCell is ready. Choose a program rail button, pick a panel rail button, and add buttons with Bind Script or Bind Macro.'
    Write-UiLog 'FlowCell window loaded.'
    if (Test-FlowCellStartupRestorePopoutsOnlyEnabled) {
        $flowWindow.ShowActivated = $false
        $flowWindow.WindowState = 'Minimized'
        $flowWindow.Add_SourceInitialized({
            try {
                $startupRestoreAction = [System.Action]{
                    Restore-FlowCellPopoutFirstWorkspace -MainWindow $flowWindow -OnStateChanged $refreshAll
                }
                [void]$flowWindow.Dispatcher.BeginInvoke($startupRestoreAction, [System.Windows.Threading.DispatcherPriority]::ApplicationIdle)
            }
            catch {
                Write-UiLog ('FlowCell failed to schedule popout-first startup restore: {0}' -f $_.Exception.ToString())
                $script:FlowCellPopoutFirstStartupPending = $false
                $script:FlowCellStartupRestoreInProgress = $false
            }
        }.GetNewClosure())
    }
    else {
        $flowWindow.ShowActivated = $true
        $script:FlowCellPopoutFirstStartupPending = $false
    }
    [void]$flowWindow.ShowDialog()
}

try {
    Initialize-FlowCellLocalStorage
    Write-UiLog 'FlowCell UI starting.'
    Initialize-FlowCellTaskbarGrouping
    Load-Actions
    $script:State = Read-State
    $script:FlowCellState = Read-FlowCellState
    Migrate-FlowCellIllustratorScriptReferences
    Migrate-FlowCellBlenderScriptFolders
    Start-Backend
    Start-Ui
}
catch {
    Write-UiLog ('FlowCell UI failed: {0}' -f $_.Exception.ToString())
    throw
}

