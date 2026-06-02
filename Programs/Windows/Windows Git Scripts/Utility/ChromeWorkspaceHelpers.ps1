Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ChromeWorkspaceNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint uFlags
    );

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@

$script:ChromeWorkspaceLogName = 'windows_chrome_workspace.log'
$script:ChromeWorkspaceFileName = 'chrome_workspace.json'
$script:ChromeWorkspaceLastSelectionFileName = 'chrome_workspace_last_path.txt'
$script:EnumWindowsProc = $null

function Get-RepoRoot {
    $current = [System.IO.DirectoryInfo]$PSScriptRoot
    while ($null -ne $current) {
        $flowCellPath = Join-Path $current.FullName 'FlowCell'
        $summaryPath = Join-Path $current.FullName 'PROGRAM_SUMMARY.txt'
        if (
            (Test-Path -LiteralPath $flowCellPath -PathType Container) -and
            (Test-Path -LiteralPath $summaryPath -PathType Leaf)
        ) {
            return $current.FullName
        }
        $current = $current.Parent
    }

    throw 'Could not locate the FlowCell repository root from the Chrome workspace helper.'
}

function Get-FlowCellLocalRoot {
    return Join-Path (Get-RepoRoot) 'FlowCell\local'
}

function Get-ChromeWorkspaceEnvironmentPath {
    $workspacePath = [string][Environment]::GetEnvironmentVariable('FLOWCELL_CHROME_WORKSPACE_PATH')
    if ([string]::IsNullOrWhiteSpace($workspacePath)) {
        return ''
    }

    return [System.IO.Path]::GetFullPath($workspacePath.Trim().Trim('"'))
}

function Get-ChromeWorkspaceDirectory {
    $workspacePath = Get-ChromeWorkspaceEnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($workspacePath)) {
        return Split-Path -Parent $workspacePath
    }

    return Join-Path (Get-FlowCellLocalRoot) 'data\workspaces'
}

function Get-ChromeWorkspaceFilePath {
    $workspacePath = Get-ChromeWorkspaceEnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($workspacePath)) {
        return $workspacePath
    }

    return Join-Path (Get-ChromeWorkspaceDirectory) $script:ChromeWorkspaceFileName
}

function Get-ChromeWorkspaceLastSelectionPath {
    return Join-Path (Get-ChromeWorkspaceDirectory) $script:ChromeWorkspaceLastSelectionFileName
}

function Get-ChromeWorkspaceLogPath {
    return Join-Path (Join-Path (Get-FlowCellLocalRoot) 'logs') $script:ChromeWorkspaceLogName
}

function Get-ChromeWorkspaceStatusPath {
    return Join-Path (Join-Path (Get-FlowCellLocalRoot) 'logs') 'last_action_status.txt'
}

function Ensure-ParentDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $parent = Split-Path -Parent $Path
    if ([string]::IsNullOrWhiteSpace($parent)) {
        return
    }
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function Read-LastChromeWorkspacePath {
    $statePath = Get-ChromeWorkspaceLastSelectionPath
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return ''
    }

    $rawPath = [string](Get-Content -LiteralPath $statePath -Raw -Encoding UTF8)
    if ([string]::IsNullOrWhiteSpace($rawPath)) {
        return ''
    }

    try {
        return [System.IO.Path]::GetFullPath($rawPath.Trim())
    }
    catch {
        return ''
    }
}

function Save-LastChromeWorkspacePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath
    )

    if ([string]::IsNullOrWhiteSpace($WorkspacePath)) {
        return
    }

    $statePath = Get-ChromeWorkspaceLastSelectionPath
    Ensure-ParentDirectory -Path $statePath
    Set-Content -LiteralPath $statePath -Value ([System.IO.Path]::GetFullPath($WorkspacePath)) -Encoding UTF8
}

function Resolve-ChromeWorkspaceInitialDirectory {
    $candidateDirectories = New-Object System.Collections.Generic.List[string]

    $overridePath = Get-ChromeWorkspaceEnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($overridePath)) {
        [void]$candidateDirectories.Add((Split-Path -Parent $overridePath))
    }

    $lastWorkspacePath = Read-LastChromeWorkspacePath
    if (-not [string]::IsNullOrWhiteSpace($lastWorkspacePath)) {
        [void]$candidateDirectories.Add((Split-Path -Parent $lastWorkspacePath))
    }

    [void]$candidateDirectories.Add((Get-ChromeWorkspaceDirectory))

    foreach ($candidate in $candidateDirectories) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Container)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    return [System.IO.Path]::GetFullPath((Get-ChromeWorkspaceDirectory))
}

function Get-ChromeWorkspaceDefaultFileName {
    $overridePath = Get-ChromeWorkspaceEnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($overridePath)) {
        return (Split-Path -Leaf $overridePath)
    }

    $lastWorkspacePath = Read-LastChromeWorkspacePath
    if (-not [string]::IsNullOrWhiteSpace($lastWorkspacePath)) {
        return (Split-Path -Leaf $lastWorkspacePath)
    }

    return $script:ChromeWorkspaceFileName
}

function Invoke-WithChromeWorkspaceDialogOwner {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    $owner = New-Object System.Windows.Forms.Form
    try {
        $owner.Text = 'Chrome Workspace Dialog Owner'
        $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
        $owner.Size = New-Object System.Drawing.Size(1, 1)
        $owner.ShowInTaskbar = $false
        $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
        $owner.Opacity = 0
        $owner.TopMost = $true
        $owner.MinimizeBox = $false
        $owner.MaximizeBox = $false
        [void]$owner.Show()
        $owner.Activate()
        $owner.BringToFront()
        [System.Windows.Forms.Application]::DoEvents()
        return (& $Action $owner)
    }
    finally {
        if ($null -ne $owner) {
            $owner.Close()
            $owner.Dispose()
        }
    }
}

function Select-ChromeWorkspaceSavePath {
    $overridePath = Get-ChromeWorkspaceEnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($overridePath)) {
        return $overridePath
    }

    $initialDirectory = Resolve-ChromeWorkspaceInitialDirectory
    if (-not (Test-Path -LiteralPath $initialDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $initialDirectory -Force | Out-Null
    }

    return Invoke-WithChromeWorkspaceDialogOwner {
        param($owner)

        $dialog = New-Object System.Windows.Forms.SaveFileDialog
        try {
            $dialog.Title = 'Save Chrome Workspace'
            $dialog.InitialDirectory = $initialDirectory
            $dialog.FileName = Get-ChromeWorkspaceDefaultFileName
            $dialog.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'
            $dialog.DefaultExt = 'json'
            $dialog.AddExtension = $true
            $dialog.OverwritePrompt = $true
            $dialog.RestoreDirectory = $false

            if ($dialog.ShowDialog($owner) -ne [System.Windows.Forms.DialogResult]::OK) {
                return $null
            }

            if ([string]::IsNullOrWhiteSpace($dialog.FileName)) {
                return $null
            }

            $workspacePath = [System.IO.Path]::GetFullPath($dialog.FileName)
            Save-LastChromeWorkspacePath -WorkspacePath $workspacePath
            return $workspacePath
        }
        finally {
            $dialog.Dispose()
        }
    }
}

function Select-ChromeWorkspaceOpenPath {
    $overridePath = Get-ChromeWorkspaceEnvironmentPath
    if (-not [string]::IsNullOrWhiteSpace($overridePath)) {
        return $overridePath
    }

    $initialDirectory = Resolve-ChromeWorkspaceInitialDirectory
    if (-not (Test-Path -LiteralPath $initialDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $initialDirectory -Force | Out-Null
    }

    return Invoke-WithChromeWorkspaceDialogOwner {
        param($owner)

        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        try {
            $dialog.Title = 'Open Chrome Workspace'
            $dialog.InitialDirectory = $initialDirectory
            $dialog.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'
            $dialog.Multiselect = $false
            $dialog.CheckFileExists = $true
            $dialog.CheckPathExists = $true
            $dialog.RestoreDirectory = $false
            $lastWorkspacePath = Read-LastChromeWorkspacePath
            if (-not [string]::IsNullOrWhiteSpace($lastWorkspacePath)) {
                $dialog.FileName = Split-Path -Leaf $lastWorkspacePath
            }

            if ($dialog.ShowDialog($owner) -ne [System.Windows.Forms.DialogResult]::OK) {
                return $null
            }

            if ([string]::IsNullOrWhiteSpace($dialog.FileName)) {
                return $null
            }

            $workspacePath = [System.IO.Path]::GetFullPath($dialog.FileName)
            Save-LastChromeWorkspacePath -WorkspacePath $workspacePath
            return $workspacePath
        }
        finally {
            $dialog.Dispose()
        }
    }
}

function Write-ChromeWorkspaceLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $logPath = Get-ChromeWorkspaceLogPath
    Ensure-ParentDirectory -Path $logPath
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f $timestamp, $Message) -Encoding UTF8
}

function Write-ChromeWorkspaceStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $statusPath = Get-ChromeWorkspaceStatusPath
    Ensure-ParentDirectory -Path $statusPath
    Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
}

function Get-ChromeActiveTabTitleFromWindowTitle {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$WindowTitle
    )

    $title = $WindowTitle.Trim()
    if ([string]::IsNullOrWhiteSpace($title)) {
        return ''
    }

    $patterns = @(
        '\s+-\s+Google Chrome$',
        '\s+-\s+Chrome$'
    )

    foreach ($pattern in $patterns) {
        if ($title -match $pattern) {
            return ($title -replace $pattern, '').Trim()
        }
    }

    return $title
}

function Get-ChromeActiveTabObservation {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    $windowTitle = ''
    try {
        $windowTitle = Get-WindowTitle -Handle $Handle
    }
    catch {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($windowTitle)) {
        return $null
    }

    $url = ''
    try {
        $url = [string](Try-GetChromeActiveUrl -Handle $Handle)
    }
    catch {
        $url = ''
    }

    $url = $url.Trim()
    $tabTitle = Get-ChromeActiveTabTitleFromWindowTitle -WindowTitle $windowTitle
    if ([string]::IsNullOrWhiteSpace($tabTitle) -and [string]::IsNullOrWhiteSpace($url)) {
        return $null
    }

    $key = if (-not [string]::IsNullOrWhiteSpace($url)) {
        "url::$url"
    }
    else {
        "title::$tabTitle"
    }

    return [pscustomobject]@{
        key = $key
        title = $tabTitle
        url = $url
        window_title = $windowTitle
    }
}

function Get-ChromeGuidedCaptureStatusText {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$WindowRecords,
        [Parameter(Mandatory = $true)]
        [hashtable]$CaptureByWindow
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('Captured tab activations:') | Out-Null

    foreach ($window in $WindowRecords) {
        $windowKey = [string]$window.hwnd_numeric
        $capture = $CaptureByWindow[$windowKey]
        $observationKeys = @($capture.observations | ForEach-Object { $_.key })
        $recordedCount = $capture.observations.Count
        if ($null -ne $capture.seed -and $observationKeys -notcontains $capture.seed.key) {
            $recordedCount++
        }

        $label = Get-ChromeActiveTabTitleFromWindowTitle -WindowTitle ([string]$window.title)
        if ([string]::IsNullOrWhiteSpace($label)) {
            $label = [string]$window.title
        }
        if ($label.Length -gt 52) {
            $label = '{0}...' -f $label.Substring(0, 49)
        }

        $lines.Add(('{0} tab{1}: {2}' -f $recordedCount, $(if ($recordedCount -eq 1) { '' } else { 's' }), $label)) | Out-Null
    }

    return ($lines -join [Environment]::NewLine)
}

function Invoke-ChromeGuidedTabCapture {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$WindowRecords
    )

    if ($WindowRecords.Count -eq 0) {
        return [pscustomobject]@{
            cancelled = $false
            windows = @{}
        }
    }

    Write-ChromeWorkspaceLog ("capture guided start | windows={0}" -f $WindowRecords.Count)

    $captureByWindow = @{}
    foreach ($window in $WindowRecords) {
        $windowKey = [string]$window.hwnd_numeric
        $captureByWindow[$windowKey] = [ordered]@{
            seed = Get-ChromeActiveTabObservation -Handle $window.hwnd
            observations = (New-Object System.Collections.ArrayList)
        }
    }

    $originalForeground = [ChromeWorkspaceNative]::GetForegroundWindow()
    $form = $null
    $statusBox = $null
    $dialogResult = 'cancel'

    try {
        $form = New-Object System.Windows.Forms.Form
        $form.Text = 'Save Chrome Workspace'
        $form.Size = New-Object System.Drawing.Size(520, 300)
        $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
        $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
        $form.MaximizeBox = $false
        $form.MinimizeBox = $false
        $form.ShowInTaskbar = $true
        $form.TopMost = $true

        $screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
        $locationX = [math]::Max($screen.WorkingArea.Left, $screen.WorkingArea.Right - $form.Width - 24)
        $locationY = [math]::Max($screen.WorkingArea.Top, $screen.WorkingArea.Bottom - $form.Height - 24)
        $form.Location = New-Object System.Drawing.Point($locationX, $locationY)

        $instructionLabel = New-Object System.Windows.Forms.Label
        $instructionLabel.AutoSize = $false
        $instructionLabel.Location = New-Object System.Drawing.Point(16, 14)
        $instructionLabel.Size = New-Object System.Drawing.Size(486, 76)
        $instructionLabel.Text = "Click each Chrome tab once from left to right in every Chrome window. Include the tab that was already selected. If a window only has one tab, you can leave it alone. When finished, click Continue to save."
        $instructionLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
        $form.Controls.Add($instructionLabel)

        $statusBox = New-Object System.Windows.Forms.TextBox
        $statusBox.Location = New-Object System.Drawing.Point(16, 96)
        $statusBox.Size = New-Object System.Drawing.Size(486, 120)
        $statusBox.Multiline = $true
        $statusBox.ReadOnly = $true
        $statusBox.TabStop = $false
        $statusBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
        $statusBox.BackColor = [System.Drawing.SystemColors]::Window
        $statusBox.Text = Get-ChromeGuidedCaptureStatusText -WindowRecords $WindowRecords -CaptureByWindow $captureByWindow
        $form.Controls.Add($statusBox)

        $continueButton = New-Object System.Windows.Forms.Button
        $continueButton.Text = 'Continue'
        $continueButton.Size = New-Object System.Drawing.Size(100, 30)
        $continueButton.Location = New-Object System.Drawing.Point(292, 228)
        $continueButton.Add_Click({
            $this.FindForm().Tag = 'continue'
        })
        $form.Controls.Add($continueButton)

        $cancelButton = New-Object System.Windows.Forms.Button
        $cancelButton.Text = 'Cancel'
        $cancelButton.Size = New-Object System.Drawing.Size(100, 30)
        $cancelButton.Location = New-Object System.Drawing.Point(402, 228)
        $cancelButton.Add_Click({
            $this.FindForm().Tag = 'cancel'
        })
        $form.Controls.Add($cancelButton)

        $form.AcceptButton = $continueButton
        $form.CancelButton = $cancelButton
        $form.Add_FormClosing({
            param($sender, $eventArgs)

            if ([string]::IsNullOrWhiteSpace([string]$sender.Tag)) {
                $sender.Tag = 'cancel'
            }
        })

        [void]$form.Show()
        $form.Activate()
        $form.BringToFront()
        [System.Windows.Forms.Application]::DoEvents()

        $lastStatusText = [string]$statusBox.Text
        while ([string]::IsNullOrWhiteSpace([string]$form.Tag)) {
            $foregroundWindow = [ChromeWorkspaceNative]::GetForegroundWindow()
            foreach ($window in $WindowRecords) {
                if ($foregroundWindow -ne $window.hwnd) {
                    continue
                }

                $windowKey = [string]$window.hwnd_numeric
                $capture = $captureByWindow[$windowKey]
                $snapshot = Get-ChromeActiveTabObservation -Handle $window.hwnd
                if ($null -eq $snapshot) {
                    continue
                }

                if ($null -eq $capture.seed) {
                    $capture.seed = $snapshot
                    continue
                }

                $lastRecordedKey = ''
                if ($capture.observations.Count -gt 0) {
                    $lastRecordedKey = [string]$capture.observations[$capture.observations.Count - 1].key
                }

                if ($capture.observations.Count -eq 0) {
                    if ($snapshot.key -ne $capture.seed.key) {
                        [void]$capture.observations.Add($snapshot)
                    }
                }
                elseif ($snapshot.key -ne $lastRecordedKey) {
                    [void]$capture.observations.Add($snapshot)
                }
            }

            $statusText = Get-ChromeGuidedCaptureStatusText -WindowRecords $WindowRecords -CaptureByWindow $captureByWindow
            if ($statusText -ne $lastStatusText) {
                $statusBox.Text = $statusText
                $lastStatusText = $statusText
            }

            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 180
        }

        $dialogResult = [string]$form.Tag
    }
    finally {
        if ($null -ne $form) {
            $form.Close()
            $form.Dispose()
        }

        if ($originalForeground -ne [IntPtr]::Zero) {
            [void][ChromeWorkspaceNative]::SetForegroundWindow($originalForeground)
        }
    }

    if ($dialogResult -ne 'continue') {
        Write-ChromeWorkspaceLog 'capture guided result | cancelled by user'
        return [pscustomobject]@{
            cancelled = $true
            windows = @{}
        }
    }

    $capturedWindows = @{}
    foreach ($window in $WindowRecords) {
        $windowKey = [string]$window.hwnd_numeric
        $capture = $captureByWindow[$windowKey]
        $tabs = New-Object System.Collections.Generic.List[object]
        $observationKeys = @($capture.observations | ForEach-Object { $_.key })

        if ($null -ne $capture.seed -and $observationKeys -notcontains $capture.seed.key) {
            $tabs.Add([ordered]@{
                title = [string]$capture.seed.title
                url = [string]$capture.seed.url
                is_active = $false
            }) | Out-Null
        }

        foreach ($observation in @($capture.observations)) {
            $tabs.Add([ordered]@{
                title = [string]$observation.title
                url = [string]$observation.url
                is_active = $false
            }) | Out-Null
        }

        if ($tabs.Count -eq 0 -and $null -ne $capture.seed) {
            $tabs.Add([ordered]@{
                title = [string]$capture.seed.title
                url = [string]$capture.seed.url
                is_active = $true
            }) | Out-Null
        }
        elseif ($tabs.Count -gt 0) {
            for ($index = 0; $index -lt $tabs.Count; $index++) {
                $tabs[$index].is_active = $false
            }
            $tabs[$tabs.Count - 1].is_active = $true
        }

        $capturedWindows[$windowKey] = @($tabs)
        Write-ChromeWorkspaceLog ("capture guided result | hwnd={0} | recorded_tabs={1}" -f $window.hwnd_numeric, $tabs.Count)
    }

    return [pscustomobject]@{
        cancelled = $false
        windows = $capturedWindows
    }
}

function New-BoundsObject {
    param(
        [double]$Left,
        [double]$Top,
        [double]$Width,
        [double]$Height
    )

    return [ordered]@{
        left = [math]::Round($Left, 2)
        top = [math]::Round($Top, 2)
        width = [math]::Round($Width, 2)
        height = [math]::Round($Height, 2)
    }
}

function Convert-RectToBounds {
    param(
        [Parameter(Mandatory = $true)]
        [ChromeWorkspaceNative+RECT]$Rect
    )

    return (New-BoundsObject -Left $Rect.Left -Top $Rect.Top -Width ($Rect.Right - $Rect.Left) -Height ($Rect.Bottom - $Rect.Top))
}

function Get-WindowTitle {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    $builder = New-Object System.Text.StringBuilder 1024
    [void][ChromeWorkspaceNative]::GetWindowText($Handle, $builder, $builder.Capacity)
    return $builder.ToString().Trim()
}

function Get-WindowClassName {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    $builder = New-Object System.Text.StringBuilder 256
    [void][ChromeWorkspaceNative]::GetClassName($Handle, $builder, $builder.Capacity)
    return $builder.ToString().Trim()
}

function Get-WindowPlacementInfo {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    $placement = New-Object ChromeWorkspaceNative+WINDOWPLACEMENT
    $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type][ChromeWorkspaceNative+WINDOWPLACEMENT])
    if (-not [ChromeWorkspaceNative]::GetWindowPlacement($Handle, [ref]$placement)) {
        throw ('GetWindowPlacement failed for hwnd {0}.' -f $Handle.ToInt64())
    }

    $windowState = switch ([int]$placement.showCmd) {
        2 { 'minimized' }
        3 { 'maximized' }
        default { 'normal' }
    }

    $restoreBounds = Convert-RectToBounds -Rect $placement.rcNormalPosition
    return [pscustomobject]@{
        state = $windowState
        showCmd = [int]$placement.showCmd
        restoreBounds = $restoreBounds
    }
}

function Get-WindowRectBounds {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    $rect = New-Object ChromeWorkspaceNative+RECT
    if (-not [ChromeWorkspaceNative]::GetWindowRect($Handle, [ref]$rect)) {
        throw ('GetWindowRect failed for hwnd {0}.' -f $Handle.ToInt64())
    }

    return Convert-RectToBounds -Rect $rect
}

function Get-MonitorInfoForWindow {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    $monitor = [ChromeWorkspaceNative]::MonitorFromWindow($Handle, 2)
    $info = New-Object ChromeWorkspaceNative+MONITORINFOEX
    $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][ChromeWorkspaceNative+MONITORINFOEX])
    if (-not [ChromeWorkspaceNative]::GetMonitorInfo($monitor, [ref]$info)) {
        throw ('GetMonitorInfo failed for hwnd {0}.' -f $Handle.ToInt64())
    }

    $screens = [System.Windows.Forms.Screen]::AllScreens
    $monitorIndex = 0
    for ($index = 0; $index -lt $screens.Length; $index++) {
        if ($screens[$index].DeviceName -eq $info.szDevice) {
            $monitorIndex = $index
            break
        }
    }

    return [ordered]@{
        monitor_index = $monitorIndex
        device_name = $info.szDevice
        is_primary = [bool]($info.dwFlags -band 1)
        monitor_bounds = Convert-RectToBounds -Rect $info.rcMonitor
        work_area = Convert-RectToBounds -Rect $info.rcWork
    }
}

function Get-ChromeWindowRecords {
    $records = New-Object System.Collections.Generic.List[object]
    $processNameCache = @{}

    $script:EnumWindowsProc = [ChromeWorkspaceNative+EnumWindowsProc]{
        param([IntPtr]$handle, [IntPtr]$lParam)

        try {
            if (-not [ChromeWorkspaceNative]::IsWindowVisible($handle)) {
                return $true
            }

            $processId = [uint32]0
            [void][ChromeWorkspaceNative]::GetWindowThreadProcessId($handle, [ref]$processId)
            if ($processId -eq 0) {
                return $true
            }

            if (-not $processNameCache.ContainsKey($processId)) {
                try {
                    $processNameCache[$processId] = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
                }
                catch {
                    $processNameCache[$processId] = ''
                }
            }

            if ($processNameCache[$processId] -ne 'chrome') {
                return $true
            }

            $title = Get-WindowTitle -Handle $handle
            if ([string]::IsNullOrWhiteSpace($title)) {
                return $true
            }

            $className = Get-WindowClassName -Handle $handle
            if (-not $className.StartsWith('Chrome_WidgetWin_', [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }

            $records.Add([pscustomobject]@{
                hwnd = $handle
                hwnd_numeric = [int64]$handle.ToInt64()
                process_id = [int]$processId
                title = $title
                class_name = $className
            })
        }
        catch {
        }

        return $true
    }

    [void][ChromeWorkspaceNative]::EnumWindows($script:EnumWindowsProc, [IntPtr]::Zero)
    return @($records | Sort-Object title, hwnd_numeric)
}

function Try-GetChromeActiveUrl {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle
    )

    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
        if ($null -eq $root) {
            return ''
        }

        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        foreach ($edit in @($edits)) {
            $name = [string]$edit.Current.Name
            if ($name -notmatch 'address|search') {
                continue
            }

            $valuePattern = $null
            if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
                $value = [string]$valuePattern.Current.Value
                if (-not [string]::IsNullOrWhiteSpace($value)) {
                    return $value.Trim()
                }
            }
        }
    }
    catch {
    }

    return ''
}

function Get-ChromeTabSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle,
        [string]$ActiveUrl
    )

    $tabs = @()
    $fullTabCaptureAvailable = $true

    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
        if ($null -eq $root) {
            return [pscustomobject]@{
                tabs = @()
                fullTabCaptureAvailable = $false
            }
        }

        $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem
        )
        $tabItems = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition))
        if ($tabItems.Count -eq 0) {
            return [pscustomobject]@{
                tabs = @()
                fullTabCaptureAvailable = $false
            }
        }

        foreach ($tab in $tabItems) {
            $title = [string]$tab.Current.Name
            $isActive = $false
            $selectionPattern = $null
            if ($tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
                $isActive = [bool]$selectionPattern.Current.IsSelected
            }

            $url = ''
            if ($isActive -and -not [string]::IsNullOrWhiteSpace($ActiveUrl)) {
                $url = $ActiveUrl
            }
            elseif (-not [string]::IsNullOrWhiteSpace($ActiveUrl) -and $tabItems.Count -eq 1) {
                $url = $ActiveUrl
            }
            else {
                $fullTabCaptureAvailable = $false
            }

            $tabs += [ordered]@{
                title = $title
                url = $url
                is_active = $isActive
            }
        }
    }
    catch {
        $fullTabCaptureAvailable = $false
    }

    if ($tabs.Count -eq 0) {
        $fullTabCaptureAvailable = $false
    }

    return [pscustomobject]@{
        tabs = $tabs
        fullTabCaptureAvailable = $fullTabCaptureAvailable
    }
}

function Get-ChromeExecutablePath {
    $command = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($command) {
        return [string]$command.Source
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
    )

    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }

    throw 'Google Chrome executable was not found on this machine.'
}

function Get-ChromeRestoreMode {
    param(
        [int]$CurrentWindowCount
    )

    $mode = [string][Environment]::GetEnvironmentVariable('FLOWCELL_CHROME_WORKSPACE_RESTORE_MODE')
    if (-not [string]::IsNullOrWhiteSpace($mode)) {
        $normalized = $mode.Trim().ToLowerInvariant()
        if ($normalized -in @('add', 'replace', 'cancel')) {
            return $normalized
        }
    }

    if ($CurrentWindowCount -le 0) {
        return 'add'
    }

    $result = Invoke-WithChromeWorkspaceDialogOwner {
        param($owner)

        return [System.Windows.Forms.MessageBox]::Show(
            $owner,
            "Chrome is already open.`r`n`r`nYes = open the saved workspace alongside current Chrome windows.`r`nNo = replace the current Chrome workspace.`r`nCancel = abort.",
            'Open Chrome Workspace',
            [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
    }

    switch ($result) {
        ([System.Windows.Forms.DialogResult]::No) { return 'replace' }
        ([System.Windows.Forms.DialogResult]::Cancel) { return 'cancel' }
        default { return 'add' }
    }
}

function Close-ChromeWindowsGracefully {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$WindowRecords
    )

    foreach ($record in $WindowRecords) {
        [void][ChromeWorkspaceNative]::PostMessage($record.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }

    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        $remainingHandles = @((Get-ChromeWindowRecords) | ForEach-Object { $_.hwnd_numeric })
        $stillOpen = @($WindowRecords | Where-Object { $remainingHandles -contains $_.hwnd_numeric })
        if ($stillOpen.Count -eq 0) {
            return @()
        }
        Start-Sleep -Milliseconds 250
    }

    $remaining = @(Get-ChromeWindowRecords)
    return @($remaining | Where-Object { $WindowRecords.hwnd_numeric -contains $_.hwnd_numeric })
}

function Get-RestoreUrlsForWindow {
    param(
        [Parameter(Mandatory = $true)]
        $WindowSnapshot
    )

    $tabUrls = @()
    foreach ($tab in @($WindowSnapshot.tabs)) {
        $url = Normalize-ChromeRestoreUrl -Url ([string]$tab.url)
        if (-not [string]::IsNullOrWhiteSpace($url)) {
            $tabUrls += $url.Trim()
        }
    }

    $tabUrls = @($tabUrls | Select-Object -Unique)
    if ($tabUrls.Count -gt 0) {
        return $tabUrls
    }

    $activeUrl = Normalize-ChromeRestoreUrl -Url ([string]$WindowSnapshot.active_url)
    if (-not [string]::IsNullOrWhiteSpace($activeUrl)) {
        return @($activeUrl)
    }

    return @('about:blank')
}

function Normalize-ChromeRestoreUrl {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Url
    )

    $trimmed = $Url.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return ''
    }

    if ($trimmed -match '^[a-zA-Z][a-zA-Z0-9+\.-]*://') {
        return $trimmed
    }

    if ($trimmed -match '^(about:|chrome:|edge:|file:|mailto:|data:|javascript:)') {
        return $trimmed
    }

    if ($trimmed -match '^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}([/:?#].*)?$') {
        return "https://$trimmed"
    }

    return $trimmed
}

function Resolve-TargetMonitorBounds {
    param(
        [Parameter(Mandatory = $true)]
        $WindowSnapshot
    )

    $screens = [System.Windows.Forms.Screen]::AllScreens
    if ($screens.Length -eq 0) {
        return $null
    }

    $savedBounds = $WindowSnapshot.monitor_bounds
    $match = $null
    foreach ($screen in $screens) {
        if (
            $screen.Bounds.Left -eq [int]$savedBounds.left -and
            $screen.Bounds.Top -eq [int]$savedBounds.top -and
            $screen.Bounds.Width -eq [int]$savedBounds.width -and
            $screen.Bounds.Height -eq [int]$savedBounds.height
        ) {
            $match = $screen
            break
        }
    }

    if ($null -eq $match) {
        $monitorIndex = [int]$WindowSnapshot.monitor_index
        if ($monitorIndex -ge 0 -and $monitorIndex -lt $screens.Length) {
            $match = $screens[$monitorIndex]
        }
    }

    if ($null -eq $match) {
        $match = $screens | Where-Object { $_.Primary } | Select-Object -First 1
    }

    if ($null -eq $match) {
        $match = $screens[0]
    }

    return $match.Bounds
}

function Resolve-TargetWindowBounds {
    param(
        [Parameter(Mandatory = $true)]
        $WindowSnapshot
    )

    $targetMonitor = Resolve-TargetMonitorBounds -WindowSnapshot $WindowSnapshot
    if ($null -eq $targetMonitor) {
        return (New-BoundsObject -Left $WindowSnapshot.x -Top $WindowSnapshot.y -Width $WindowSnapshot.width -Height $WindowSnapshot.height)
    }

    $savedMonitor = $WindowSnapshot.monitor_bounds
    $offsetX = [double]$WindowSnapshot.x - [double]$savedMonitor.left
    $offsetY = [double]$WindowSnapshot.y - [double]$savedMonitor.top
    $width = [math]::Max(320, [math]::Min([double]$WindowSnapshot.width, [double]$targetMonitor.Width))
    $height = [math]::Max(240, [math]::Min([double]$WindowSnapshot.height, [double]$targetMonitor.Height))
    $left = [double]$targetMonitor.Left + $offsetX
    $top = [double]$targetMonitor.Top + $offsetY

    $maxLeft = [double]$targetMonitor.Right - $width
    $maxTop = [double]$targetMonitor.Bottom - $height
    if ($maxLeft -lt [double]$targetMonitor.Left) {
        $maxLeft = [double]$targetMonitor.Left
    }
    if ($maxTop -lt [double]$targetMonitor.Top) {
        $maxTop = [double]$targetMonitor.Top
    }

    $left = [math]::Min([math]::Max($left, [double]$targetMonitor.Left), $maxLeft)
    $top = [math]::Min([math]::Max($top, [double]$targetMonitor.Top), $maxTop)

    return (New-BoundsObject -Left $left -Top $top -Width $width -Height $height)
}

function Test-BoundsMatch {
    param(
        [Parameter(Mandatory = $true)]
        $Expected,
        [Parameter(Mandatory = $true)]
        $Actual,
        [double]$Tolerance = 24
    )

    return (
        ([math]::Abs([double]$Expected.left - [double]$Actual.left) -le $Tolerance) -and
        ([math]::Abs([double]$Expected.top - [double]$Actual.top) -le $Tolerance) -and
        ([math]::Abs([double]$Expected.width - [double]$Actual.width) -le $Tolerance) -and
        ([math]::Abs([double]$Expected.height - [double]$Actual.height) -le $Tolerance)
    )
}

function Select-NewChromeWindow {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Candidates,
        [string]$ExpectedTitle
    )

    if ($Candidates.Count -eq 1) {
        return $Candidates[0]
    }

    if (-not [string]::IsNullOrWhiteSpace($ExpectedTitle)) {
        $exact = @($Candidates | Where-Object { $_.title -eq $ExpectedTitle })
        if ($exact.Count -gt 0) {
            return ($exact | Sort-Object hwnd_numeric -Descending | Select-Object -First 1)
        }

        $partial = @($Candidates | Where-Object { $_.title -like "*$ExpectedTitle*" -or $ExpectedTitle -like "*$($_.title)*" })
        if ($partial.Count -gt 0) {
            return ($partial | Sort-Object hwnd_numeric -Descending | Select-Object -First 1)
        }
    }

    return ($Candidates | Sort-Object hwnd_numeric -Descending | Select-Object -First 1)
}

function Wait-ForChromeWindow {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [long[]]$KnownHandles,
        [string]$ExpectedTitle,
        [int]$TimeoutSeconds = 18
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $current = @(Get-ChromeWindowRecords)
        $newWindows = @($current | Where-Object { $KnownHandles -notcontains $_.hwnd_numeric })
        if ($newWindows.Count -gt 0) {
            return (Select-NewChromeWindow -Candidates $newWindows -ExpectedTitle $ExpectedTitle)
        }
        Start-Sleep -Milliseconds 250
    }

    return $null
}

function Set-ChromeWindowPlacement {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle,
        [Parameter(Mandatory = $true)]
        $TargetBounds,
        [Parameter(Mandatory = $true)]
        [string]$WindowState
    )

    [void][ChromeWorkspaceNative]::ShowWindowAsync($Handle, 9)
    Start-Sleep -Milliseconds 200

    $success = $false
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        [void][ChromeWorkspaceNative]::SetWindowPos(
            $Handle,
            [IntPtr]::Zero,
            [int][math]::Round([double]$TargetBounds.left),
            [int][math]::Round([double]$TargetBounds.top),
            [int][math]::Round([double]$TargetBounds.width),
            [int][math]::Round([double]$TargetBounds.height),
            0x0014
        )
        Start-Sleep -Milliseconds 180
        $actual = Get-WindowRectBounds -Handle $Handle
        if (Test-BoundsMatch -Expected $TargetBounds -Actual $actual) {
            $success = $true
            break
        }
    }

    switch ($WindowState) {
        'maximized' {
            [void][ChromeWorkspaceNative]::ShowWindowAsync($Handle, 3)
            Start-Sleep -Milliseconds 220
        }
        'minimized' {
            [void][ChromeWorkspaceNative]::ShowWindowAsync($Handle, 6)
            Start-Sleep -Milliseconds 220
        }
        default { }
    }

    return $success
}

function Read-ChromeWorkspaceFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkspacePath
    )

    $workspacePath = [System.IO.Path]::GetFullPath($WorkspacePath)
    if (-not (Test-Path -LiteralPath $workspacePath -PathType Leaf)) {
        throw "Chrome workspace file not found: $workspacePath"
    }

    $content = Get-Content -LiteralPath $workspacePath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($content)) {
        throw "Chrome workspace file is empty: $workspacePath"
    }

    return ($content | ConvertFrom-Json)
}

function Invoke-SaveChromeWorkspace {
    $chromeWindows = @(Get-ChromeWindowRecords)
    Write-ChromeWorkspaceLog ("capture start | windows={0} | tab_capture_mode=guided_manual" -f $chromeWindows.Count)
    $guidedCapture = Invoke-ChromeGuidedTabCapture -WindowRecords $chromeWindows
    if ($guidedCapture.cancelled) {
        $statusMessage = 'Save Chrome Workspace cancelled.'
        Write-ChromeWorkspaceStatus -Message $statusMessage
        Write-ChromeWorkspaceLog 'capture result | cancelled during guided tab capture'
        return
    }

    $workspacePath = Select-ChromeWorkspaceSavePath
    if ([string]::IsNullOrWhiteSpace([string]$workspacePath)) {
        $statusMessage = 'Save Chrome Workspace cancelled.'
        Write-ChromeWorkspaceStatus -Message $statusMessage
        Write-ChromeWorkspaceLog 'capture result | cancelled during save path selection'
        return
    }

    Ensure-ParentDirectory -Path $workspacePath
    Write-ChromeWorkspaceLog ("capture continue | path={0}" -f $workspacePath)

    $workspaceWindows = @()
    $fullTabCaptureAvailable = $true

    foreach ($window in $chromeWindows) {
        $placement = Get-WindowPlacementInfo -Handle $window.hwnd
        $monitorInfo = Get-MonitorInfoForWindow -Handle $window.hwnd
        $windowTabs = @($guidedCapture.windows[[string]$window.hwnd_numeric])
        $activeTab = @($windowTabs | Where-Object { $_.is_active } | Select-Object -Last 1)
        $activeUrl = ''
        if ($activeTab.Count -gt 0) {
            $activeUrl = [string]$activeTab[0].url
        }

        if ($windowTabs.Count -eq 0) {
            $fullTabCaptureAvailable = $false
            Write-ChromeWorkspaceLog ("capture result | hwnd={0} | guided tab capture recorded 0 tabs" -f $window.hwnd_numeric)
        }
        elseif (@($windowTabs | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.url) }).Count -gt 0) {
            $fullTabCaptureAvailable = $false
            Write-ChromeWorkspaceLog ("capture result | hwnd={0} | one or more guided tabs did not expose a URL" -f $window.hwnd_numeric)
        }

        $workspaceWindows += [ordered]@{
            title = $window.title
            active_url = $activeUrl
            tabs = @($windowTabs)
            monitor_index = $monitorInfo.monitor_index
            monitor_device_name = $monitorInfo.device_name
            monitor_bounds = $monitorInfo.monitor_bounds
            monitor_work_area = $monitorInfo.work_area
            x = $placement.restoreBounds.left
            y = $placement.restoreBounds.top
            width = $placement.restoreBounds.width
            height = $placement.restoreBounds.height
            window_state = $placement.state
            current_bounds = Get-WindowRectBounds -Handle $window.hwnd
        }
    }

    $workspace = [ordered]@{
        version = 1
        saved_at = (Get-Date).ToString('o')
        workspace_kind = 'chrome'
        workspace_path = $workspacePath
        full_tab_capture_available = $fullTabCaptureAvailable
        note = if ($chromeWindows.Count -gt 0) {
            'Tabs were captured using guided manual activation. Saved tab order matches the order tabs were activated during save.'
        }
        elseif ($fullTabCaptureAvailable) {
            ''
        }
        else {
            'Full tab URL capture was unavailable for one or more Chrome windows. Active URLs and geometry were still saved where possible.'
        }
        windows = @($workspaceWindows)
    }

    $workspace | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $workspacePath -Encoding UTF8

    $savedCount = $workspaceWindows.Count
    $savedTabCount = @($workspaceWindows | ForEach-Object { @($_.tabs).Count } | Measure-Object -Sum).Sum
    if ($null -eq $savedTabCount) {
        $savedTabCount = 0
    }

    $statusMessage = if ($chromeWindows.Count -gt 0 -and $fullTabCaptureAvailable) {
        "Saved $savedCount Chrome windows and $savedTabCount tabs."
    }
    elseif ($fullTabCaptureAvailable) {
        "Saved $savedCount Chrome windows."
    }
    else {
        "Saved $savedCount Chrome windows. One or more tabs did not expose a URL during guided capture; geometry and captured tabs were still saved."
    }

    Write-ChromeWorkspaceStatus -Message $statusMessage
    Write-ChromeWorkspaceLog ("capture result | saved_windows={0} | saved_tabs={1} | full_tab_capture_available={2} | path={3} | tab_capture_mode=guided_manual" -f $savedCount, $savedTabCount, $fullTabCaptureAvailable, $workspacePath)
}

function Invoke-OpenChromeWorkspace {
    $workspacePath = Select-ChromeWorkspaceOpenPath
    if ([string]::IsNullOrWhiteSpace([string]$workspacePath)) {
        $statusMessage = 'Open Chrome Workspace cancelled.'
        Write-ChromeWorkspaceStatus -Message $statusMessage
        Write-ChromeWorkspaceLog 'restore complete | cancelled by user during workspace selection'
        return
    }

    $workspace = Read-ChromeWorkspaceFile -WorkspacePath $workspacePath
    $workspaceWindows = @($workspace.windows)
    $existingWindows = @(Get-ChromeWindowRecords)
    $restoreMode = Get-ChromeRestoreMode -CurrentWindowCount $existingWindows.Count

    if ($restoreMode -eq 'cancel') {
        $statusMessage = 'Open Chrome Workspace cancelled.'
        Write-ChromeWorkspaceStatus -Message $statusMessage
        Write-ChromeWorkspaceLog 'restore complete | cancelled by user'
        return
    }

    $replaceRequested = $restoreMode -eq 'replace' -and $existingWindows.Count -gt 0
    $originalWindowsToClose = @()

    if ($restoreMode -eq 'replace' -and $existingWindows.Count -gt 0) {
        $originalWindowsToClose = @($existingWindows)
        Write-ChromeWorkspaceLog ("launch start | workspace_path={0} | replace requested | current_windows={1} | close_original_after_full_restore=true" -f $workspacePath, $existingWindows.Count)
    }
    else {
        Write-ChromeWorkspaceLog ("launch start | workspace_path={0} | preserve current Chrome workspace | current_windows={1}" -f $workspacePath, $existingWindows.Count)
    }

    if ($workspaceWindows.Count -eq 0) {
        $statusMessage = 'Restored 0 Chrome windows. Failed to place 0 windows.'
        Write-ChromeWorkspaceStatus -Message $statusMessage
        Write-ChromeWorkspaceLog 'restore complete | restored_windows=0 | failed_to_place=0'
        return
    }

    $chromePath = Get-ChromeExecutablePath
    $restoredCount = 0
    $failedPlacementCount = 0
    $requestedWindowCount = $workspaceWindows.Count

    foreach ($windowSnapshot in $workspaceWindows) {
        $knownHandles = @((Get-ChromeWindowRecords) | ForEach-Object { $_.hwnd_numeric })
        $urls = @(Get-RestoreUrlsForWindow -WindowSnapshot $windowSnapshot)
        Write-ChromeWorkspaceLog ("launch start | title={0} | urls={1}" -f [string]$windowSnapshot.title, $urls.Count)
        Start-Process -FilePath $chromePath -ArgumentList (@('--new-window') + $urls) | Out-Null

        $detectedWindow = Wait-ForChromeWindow -KnownHandles $knownHandles -ExpectedTitle ([string]$windowSnapshot.title)
        if ($null -eq $detectedWindow) {
            $failedPlacementCount++
            Write-ChromeWorkspaceLog ("window detected | failed | expected_title={0}" -f [string]$windowSnapshot.title)
            continue
        }

        Write-ChromeWorkspaceLog ("window detected | hwnd={0} | title={1}" -f $detectedWindow.hwnd_numeric, $detectedWindow.title)
        $targetBounds = Resolve-TargetWindowBounds -WindowSnapshot $windowSnapshot
        $placed = Set-ChromeWindowPlacement -Handle $detectedWindow.hwnd -TargetBounds $targetBounds -WindowState ([string]$windowSnapshot.window_state)
        if ($placed) {
            Write-ChromeWorkspaceLog ("window moved | hwnd={0} | left={1} | top={2} | width={3} | height={4} | state={5}" -f `
                $detectedWindow.hwnd_numeric, `
                $targetBounds.left, `
                $targetBounds.top, `
                $targetBounds.width, `
                $targetBounds.height, `
                [string]$windowSnapshot.window_state)
        }
        else {
            $failedPlacementCount++
            Write-ChromeWorkspaceLog ("window moved | failed | hwnd={0}" -f $detectedWindow.hwnd_numeric)
        }

        $restoredCount++
    }

    $fullRestoreSucceeded = ($restoredCount -eq $requestedWindowCount) -and ($failedPlacementCount -eq 0)
    $leftOriginalWindowsOpen = $false

    if ($replaceRequested) {
        if ($fullRestoreSucceeded) {
            $remaining = Close-ChromeWindowsGracefully -WindowRecords $originalWindowsToClose
            if ($remaining.Count -gt 0) {
                Write-ChromeWorkspaceLog ("replace cleanup | some original Chrome windows stayed open after successful restore | remaining={0}" -f $remaining.Count)
            }
            else {
                Write-ChromeWorkspaceLog ("replace cleanup | original Chrome windows closed after successful restore | closed={0}" -f $originalWindowsToClose.Count)
            }
        }
        else {
            $leftOriginalWindowsOpen = $true
            Write-ChromeWorkspaceLog ("replace cleanup | skipped closing original Chrome windows because restore was incomplete | restored_windows={0} | requested_windows={1} | failed_to_place={2}" -f $restoredCount, $requestedWindowCount, $failedPlacementCount)
        }
    }

    $statusMessage = "Restored $restoredCount Chrome windows. Failed to place $failedPlacementCount windows."
    if ($workspace.PSObject.Properties['full_tab_capture_available'] -and -not [bool]$workspace.full_tab_capture_available) {
        $statusMessage += ' Some windows were restored with only their active URL because full tab capture was unavailable during save.'
    }
    if ($leftOriginalWindowsOpen) {
        $statusMessage += ' Original Chrome windows were left open because the restore did not complete successfully.'
    }

    Write-ChromeWorkspaceStatus -Message $statusMessage
    Write-ChromeWorkspaceLog ("restore complete | restored_windows={0} | failed_to_place={1}" -f $restoredCount, $failedPlacementCount)
}
