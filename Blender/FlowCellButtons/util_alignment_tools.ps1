# Description: Open FlowCell alignment controls for active-object min, center, max, surface, and geocenter alignment.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_flowcell_alignment_tool
# Source Action Start Line: 565

# Source Action Logic:

# def perform_flowcell_alignment_tool(context: bpy.types.Context, data: dict) -> dict[str, str]:
#     command = str(data.get("command", "align_axis") or "align_axis").strip().lower()
#     if str(data.get("tool", "") or "").strip().lower() == "flatten_revolve":
#         delegated_data = dict(data)
#         delegated_data["command"] = str(data.get("tool_command", command) or command)
#         return perform_flowcell_flatten_revolve_tool(context, delegated_data)
#     if command == "cursor_center_hole":
#         return {"message": perform_cursor_center_hole(context)}
#     if command == "probe":
#         return {"message": "Alignment tools bridge is ready."}
# 
#     selected_objects = list(context.selected_objects)
#     active = getattr(context.view_layer.objects, "active", None)
#     if active is None or active not in selected_objects:
#         raise ValueError("Select an active reference object and one object to move.")
# 
#     moved_objects = [obj for obj in selected_objects if obj != active]
#     if not moved_objects:
#         raise ValueError("Select at least one object besides the active reference object.")
# 
#     active_min, active_max = get_flowcell_alignment_bounds(active)
#     active_center = (active_min + active_max) / 2.0
# 
#     axis_lookup = {"X": 0, "Y": 1, "Z": 2}
#     mode = str(data.get("mode", "CENTER") or "CENTER").strip().upper()
#     modifier = str(data.get("modifier", "") or "").strip().upper()
#     if modifier not in {"", "SURFACE", "GEOCENTER"}:
#         raise ValueError(f"Unsupported alignment modifier: {modifier}")
# 
#     if command == "center_all":
#         for obj in moved_objects:
#             obj_min, obj_max = get_flowcell_alignment_bounds(obj)
#             obj_center = (obj_min + obj_max) / 2.0
#             offset = active_center - obj_center
#             matrix = obj.matrix_world.copy()
#             matrix.translation = matrix.translation + offset
#             obj.matrix_world = matrix
#         restore_flowcell_alignment_selection(context, selected_objects, active)
#         return {"message": f"Centered {len(moved_objects)} object(s)."}
# 
#     axis = str(data.get("axis", "X") or "X").strip().upper()
#     if axis not in axis_lookup:
#         raise ValueError(f"Unsupported alignment axis: {axis}")
#     if mode not in {"MIN", "CENTER", "MAX"}:
#         raise ValueError(f"Unsupported alignment mode: {mode}")
# 
#     axis_index = axis_lookup[axis]
#     moved_count = 0
#     for obj in moved_objects:
#         obj_min, obj_max = get_flowcell_alignment_bounds(obj)
#         obj_center = (obj_min + obj_max) / 2.0
#         source = obj_center
#         if modifier == "SURFACE":
#             target = active_min[axis_index] if obj_center[axis_index] > active_center[axis_index] else active_max[axis_index]
#             source = obj_min if obj_center[axis_index] <= active_center[axis_index] else obj_max
#         elif modifier == "GEOCENTER":
#             if mode == "MIN":
#                 target = active_min[axis_index]
#             elif mode == "MAX":
#                 target = active_max[axis_index]
#             else:
#                 target = active_center[axis_index]
#         elif mode == "MIN":
#             source = obj_min
#             target = active_min[axis_index]
#         elif mode == "MAX":
#             source = obj_max
#             target = active_max[axis_index]
#         else:
#             target = active_center[axis_index]
# 
#         offset_flowcell_object_world_axis(obj, axis_index, target - source[axis_index])
#         moved_count += 1
# 
#     restore_flowcell_alignment_selection(context, selected_objects, active)
#     return {"message": f"Aligned {moved_count} object(s)."}
# 
# 

param(
    [string]$ConfigPath = '',
    [string]$StatusPath = '',
    [string]$ToolCommand = '',
    [ValidateSet('', 'X', 'Y', 'Z')]
    [string]$Axis = '',
    [ValidateSet('', 'MIN', 'CENTER', 'MAX')]
    [string]$Mode = '',
    [ValidateSet('', 'SURFACE', 'GEOCENTER')]
    [string]$Modifier = '',
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$localConfigPath = Join-Path $flowCellLocalRoot 'private\blender.config.local.json'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) { $localConfigPath } else { Join-Path $repoRoot 'Blender\config.json' }
}
if ([string]::IsNullOrWhiteSpace($StatusPath)) {
    $StatusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FlowCellWindowNative {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FlowCellForegroundWindow {
    public const uint GW_HWNDNEXT = 2;

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
}
"@

if ([string]::IsNullOrWhiteSpace($ToolCommand) -and [Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Sta',
        '-File', $PSCommandPath,
        '-ConfigPath', $ConfigPath,
        '-StatusPath', $StatusPath
    )
    if ($SelfTest) {
        $argList += '-SelfTest'
    }
    $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -PassThru -Wait
    exit $child.ExitCode
}

function New-SolidBrush([byte]$Red, [byte]$Green, [byte]$Blue) {
    return New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb($Red, $Green, $Blue))
}

function Write-Status([string]$Message) {
    if ([string]::IsNullOrWhiteSpace($StatusPath)) { return }
    try {
        $folder = Split-Path -Parent $StatusPath
        if (-not [string]::IsNullOrWhiteSpace($folder)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        Set-Content -LiteralPath $StatusPath -Value $Message -Encoding UTF8
    }
    catch {
    }
}

function Read-ConfigFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Blender config not found: $Path"
    }

    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($null -eq $config.automation -or [string]::IsNullOrWhiteSpace([string]$config.automation.bridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }

    if ($null -eq $config.automation.responseTimeoutSeconds) {
        $config.automation | Add-Member -MemberType NoteProperty -Name responseTimeoutSeconds -Value 20
    }

    return $config
}

function Get-ConfiguredBridgeFolderLeafName([object]$Config) {
    $configuredBridgeRoot = if ($Config -and $Config.automation) { [string]$Config.automation.bridgeFolder } else { '' }
    $bridgeFolderLeafName = if ([string]::IsNullOrWhiteSpace($configuredBridgeRoot)) { '' } else { Split-Path -Path $configuredBridgeRoot -Leaf }
    if ([string]::IsNullOrWhiteSpace($bridgeFolderLeafName)) {
        return 'blender_bridge'
    }
    return $bridgeFolderLeafName
}

function Test-BlenderRunning {
    return $null -ne (Get-Process blender -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-ForegroundWindowHandle {
    return [FlowCellForegroundWindow]::GetForegroundWindow()
}

function Get-WindowProcessId([IntPtr]$WindowHandle) {
    if ($WindowHandle -eq [IntPtr]::Zero) {
        return 0
    }

    $processId = 0
    [void][FlowCellForegroundWindow]::GetWindowThreadProcessId($WindowHandle, [ref]$processId)
    return [int]$processId
}

function Get-VisibleBlenderProcesses {
    return @(Get-Process blender -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
}

function Find-BlenderProcessIdBelowWindow([IntPtr]$StartHandle) {
    if ($StartHandle -eq [IntPtr]::Zero) {
        return 0
    }

    $visitedHandles = New-Object 'System.Collections.Generic.HashSet[string]'
    $windowHandle = $StartHandle
    for ($index = 0; $index -lt 250; $index++) {
        $windowHandle = [FlowCellForegroundWindow]::GetWindow($windowHandle, [FlowCellForegroundWindow]::GW_HWNDNEXT)
        if ($windowHandle -eq [IntPtr]::Zero) {
            break
        }

        $windowKey = $windowHandle.ToString()
        if (-not $visitedHandles.Add($windowKey)) {
            break
        }

        if (-not [FlowCellForegroundWindow]::IsWindowVisible($windowHandle)) {
            continue
        }

        $processId = Get-WindowProcessId -WindowHandle $windowHandle
        if ($processId -le 0) {
            continue
        }

        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process -and [string]$process.ProcessName -ieq 'blender') {
            return [int]$processId
        }
    }

    return 0
}

function Get-TargetBlenderProcessId {
    $foregroundWindowHandle = Get-ForegroundWindowHandle
    $foregroundProcessId = Get-WindowProcessId -WindowHandle $foregroundWindowHandle
    if ($foregroundProcessId -gt 0) {
        $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
        if ($foregroundProcess -and [string]$foregroundProcess.ProcessName -ieq 'blender') {
            return [int]$foregroundProcessId
        }
    }

    $belowForegroundProcessId = Find-BlenderProcessIdBelowWindow -StartHandle $foregroundWindowHandle
    if ($belowForegroundProcessId -gt 0) {
        return [int]$belowForegroundProcessId
    }

    $blenderProcesses = @(Get-VisibleBlenderProcesses | Sort-Object StartTime -Descending)
    if (@($blenderProcesses).Count -eq 1) {
        return [int]$blenderProcesses[0].Id
    }

    throw 'Could not determine which Blender window is active. Activate the target Blender window and try again.'
}

function Get-BridgeFolderCandidates([object]$Config, [int]$TargetBlenderProcessId) {
    $candidates = New-Object System.Collections.Generic.List[string]
    $configuredBridgeRoot = [string]$Config.automation.bridgeFolder
    $bridgeFolderLeafName = Get-ConfiguredBridgeFolderLeafName -Config $Config

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
                $fallbackBridgeRoot = Join-Path $_.FullName ('scripts\addons\{0}' -f $bridgeFolderLeafName)
                if (
                    (Test-Path -LiteralPath $fallbackBridgeRoot -PathType Container) -and
                    ($fallbackBridgeRoot.TrimEnd('\').ToLowerInvariant() -ne $configuredBridgeRoot.TrimEnd('\').ToLowerInvariant())
                ) {
                    & $addBridgeRootCandidates $fallbackBridgeRoot
                }
            }
    }

    return @($candidates)
}

function Wait-ForBridgeResponse([string]$ResponsePath, [string]$RequestId, [datetime]$Deadline) {
    while ((Get-Date) -lt $Deadline) {
        if (Test-Path -LiteralPath $ResponsePath -PathType Leaf) {
            $response = Get-Content -LiteralPath $ResponsePath -Raw | ConvertFrom-Json
            if ([string]$response.id -eq $RequestId) {
                return $response
            }
        }

        Start-Sleep -Milliseconds 60
    }

    return $null
}

function Invoke-BlenderBridgeRequest {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Config,
        [Parameter(Mandatory = $true)]
        [string]$Action,
        [hashtable]$Data = @{}
    )

    if (-not (Test-BlenderRunning)) {
        throw 'Blender is not running. Open Blender with the addon enabled first.'
    }

    $targetBlenderProcessId = Get-TargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString()
    $timeoutSeconds = [Math]::Max([int]$Config.automation.responseTimeoutSeconds, 1)
    $bridgeFolders = @(Get-BridgeFolderCandidates -Config $Config -TargetBlenderProcessId $targetBlenderProcessId)

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
        if (Test-Path -LiteralPath $responsePath -PathType Leaf) {
            Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
        }

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

        $response = Wait-ForBridgeResponse -ResponsePath $responsePath -RequestId $requestId -Deadline $attemptDeadline
        if ($null -eq $response) {
            continue
        }

        if ([string]$response.status -eq 'ok') {
            return $response
        }

        $errorMessage = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Blender returned an error.' }
        throw $errorMessage
    }

    $bridgeSummary = ($bridgeFolders -join '; ')
    throw ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): {1}" -f $targetBlenderProcessId, $bridgeSummary)
}

function Show-WindowFront([System.Windows.Window]$Window) {
    if ($null -eq $Window) { return }
    try {
        $helper = New-Object System.Windows.Interop.WindowInteropHelper($Window)
        $hwnd = $helper.Handle
        if ($hwnd -eq [IntPtr]::Zero) { return }
        [FlowCellWindowNative]::ShowWindowAsync($hwnd, 5) | Out-Null
        [FlowCellWindowNative]::SetForegroundWindow($hwnd) | Out-Null
        $Window.Activate() | Out-Null
        $Window.Focus() | Out-Null
    }
    catch {
    }
}

if (-not [string]::IsNullOrWhiteSpace($ToolCommand)) {
    try {
        $config = Read-ConfigFile -Path $ConfigPath
        $normalizedCommand = $ToolCommand.Trim().ToLowerInvariant()
        $data = @{
            command = $normalizedCommand
        }

        if ($normalizedCommand -eq 'align_axis') {
            if ([string]::IsNullOrWhiteSpace($Axis) -or [string]::IsNullOrWhiteSpace($Mode)) {
                throw 'Alignment axis and mode are required.'
            }
            $data.axis = $Axis.Trim().ToUpperInvariant()
            $data.mode = $Mode.Trim().ToUpperInvariant()
            $data.modifier = if ([string]::IsNullOrWhiteSpace($Modifier)) { '' } else { $Modifier.Trim().ToUpperInvariant() }
        }
        elseif ($normalizedCommand -ne 'center_all' -and $normalizedCommand -ne 'probe') {
            throw "Unsupported alignment command: $ToolCommand"
        }

        $response = Invoke-BlenderBridgeRequest -Config $config -Action 'alignment_tools' -Data $data
        $message = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Aligned objects.' }
        Write-Status $message
        Write-Output $message
        exit 0
    }
    catch {
        $message = $_.Exception.Message
        if ($message -match 'Unsupported action:\s*alignment_tools') {
            $message = 'Reload the FlowCell Blender addon or restart Blender once.'
        }
        Write-Status $message
        Write-Error $message
        exit 1
    }
}

try {
    $config = Read-ConfigFile -Path $ConfigPath
    $alignmentState = @{
        X = ''
        Y = ''
        Z = ''
    }
    $modeButtons = @{}
    $normalBrush = New-SolidBrush 64 70 78
    $activeBrush = New-SolidBrush 121 255 51
    $foregroundBrush = New-SolidBrush 242 242 242
    $activeForegroundBrush = New-SolidBrush 16 20 12

    $window = New-Object System.Windows.Window
    $window.Title = 'Alignment Tools'
    $window.Width = 374
    $window.Height = 122
    $window.MinWidth = 374
    $window.MinHeight = 122
    $window.WindowStartupLocation = 'CenterScreen'
    $window.WindowStyle = 'None'
    $window.ResizeMode = 'NoResize'
    $window.Background = New-SolidBrush 29 35 43
    $window.Foreground = $foregroundBrush
    $window.Topmost = $false
    $window.ShowActivated = $true

    $border = New-Object System.Windows.Controls.Border
    $border.Margin = '0'
    $border.Padding = '6'
    $border.Background = New-SolidBrush 38 45 54
    $border.CornerRadius = '0'
    $window.Content = $border

    $root = New-Object System.Windows.Controls.Grid
    $border.Child = $root
    foreach ($height in @('Auto', 'Auto', 'Auto', 'Auto')) {
        $rowDefinition = New-Object System.Windows.Controls.RowDefinition
        $rowDefinition.Height = [System.Windows.GridLength]::Auto
        [void]$root.RowDefinitions.Add($rowDefinition)
    }

    function New-ToolButton([string]$Text) {
        $button = New-Object System.Windows.Controls.Button
        $button.Content = $Text
        $button.Height = 23
        $button.MinWidth = 0
        $button.Margin = '0'
        $button.Padding = '3,1'
        $button.FontSize = 12
        $button.Background = $normalBrush
        $button.Foreground = $foregroundBrush
        $button.BorderBrush = New-SolidBrush 95 105 118
        $button.BorderThickness = '1'
        return $button
    }

    function Set-ModeButtonState([System.Windows.Controls.Button]$Button, [bool]$IsActive) {
        $Button.Background = if ($IsActive) { $activeBrush } else { $normalBrush }
        $Button.Foreground = if ($IsActive) { $activeForegroundBrush } else { $foregroundBrush }
    }

    function Refresh-AlignmentUi {
        foreach ($axis in @('X', 'Y', 'Z')) {
            foreach ($mode in @('SURFACE', 'GEOCENTER')) {
                Set-ModeButtonState -Button $modeButtons[$axis][$mode] -IsActive ([string]$alignmentState[$axis] -eq $mode)
            }
        }
    }

    function Invoke-AlignmentCommand([hashtable]$Data) {
        try {
            $response = Invoke-BlenderBridgeRequest -Config $config -Action 'alignment_tools' -Data $Data
        }
        catch {
            $message = $_.Exception.Message
            if ($message -match 'Unsupported action:\s*alignment_tools') {
                $message = 'Reload the FlowCell Blender addon or restart Blender once.'
            }
            throw $message
        }
        $message = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Aligned objects.' }
        Write-Status $message
    }

    $axisRowIndex = 0
    foreach ($axis in @('Z', 'Y', 'X')) {
        $axisGrid = New-Object System.Windows.Controls.Grid
        $axisGrid.Margin = '0,0,0,3'
        $axisGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = (New-Object System.Windows.GridLength 24) })) | Out-Null
        foreach ($width in @(48, 58, 48, 62, 76, 18)) {
            [void]$axisGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = (New-Object System.Windows.GridLength $width) }))
        }
        [System.Windows.Controls.Grid]::SetRow($axisGrid, $axisRowIndex)
        [void]$root.Children.Add($axisGrid)

        $label = New-Object System.Windows.Controls.TextBlock
        $label.Text = ('{0}:' -f $axis)
        $label.VerticalAlignment = 'Center'
        $label.FontSize = 13
        [System.Windows.Controls.Grid]::SetColumn($label, 0)
        [void]$axisGrid.Children.Add($label)

        $modeButtons[$axis] = @{}
        $columnIndex = 1
        foreach ($mode in @('MIN', 'CENTER', 'MAX')) {
            $buttonText = switch ($mode) {
                'MIN' { 'Min' }
                'CENTER' { 'Center' }
                default { 'Max' }
            }
            $button = New-ToolButton -Text $buttonText
            $button.Margin = if ($columnIndex -eq 1) { '0' } else { '3,0,0,0' }
            [System.Windows.Controls.Grid]::SetColumn($button, $columnIndex)
            [void]$axisGrid.Children.Add($button)

            $axisValue = [string]$axis
            $modeValue = [string]$mode
            $button.Add_Click({
                try {
                    Invoke-AlignmentCommand @{
                        command = 'align_axis'
                        axis = $axisValue
                        mode = $modeValue
                        modifier = [string]$alignmentState[$axisValue]
                    }
                }
                catch {
                    Write-Status $_.Exception.Message
                    [System.Windows.MessageBox]::Show($window, $_.Exception.Message, 'Alignment Tools') | Out-Null
                }
            }.GetNewClosure())
            $columnIndex += 1
        }

        foreach ($toggleMode in @('SURFACE', 'GEOCENTER')) {
            $buttonText = if ($toggleMode -eq 'SURFACE') { 'Surface' } else { 'Geocenter' }
            $button = New-ToolButton -Text $buttonText
            $button.Margin = '3,0,0,0'
            [System.Windows.Controls.Grid]::SetColumn($button, $columnIndex)
            [void]$axisGrid.Children.Add($button)
            $modeButtons[$axis][$toggleMode] = $button

            $axisValue = [string]$axis
            $toggleValue = [string]$toggleMode
            $button.Add_Click({
                if ([string]$alignmentState[$axisValue] -eq $toggleValue) {
                    $alignmentState[$axisValue] = ''
                }
                else {
                    $alignmentState[$axisValue] = $toggleValue
                }
                Refresh-AlignmentUi
            }.GetNewClosure())
            $columnIndex += 1
        }

        if ($axis -eq 'Z') {
            $closeButton = New-ToolButton -Text 'x'
            $closeButton.Width = 18
            $closeButton.Margin = '3,0,0,0'
            $closeButton.Padding = '0'
            [System.Windows.Controls.Grid]::SetColumn($closeButton, $columnIndex)
            [void]$axisGrid.Children.Add($closeButton)
            $closeButton.Add_Click({
                $window.Close()
            }.GetNewClosure())
        }

        $axisRowIndex += 1
    }

    $bottomGrid = New-Object System.Windows.Controls.Grid
    $bottomGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition -Property @{ Width = (New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)) })) | Out-Null
    $bottomGrid.Margin = '0,2,0,0'
    [System.Windows.Controls.Grid]::SetRow($bottomGrid, 3)
    [void]$root.Children.Add($bottomGrid)

    $centerButton = New-ToolButton -Text 'Center Everything'
    [System.Windows.Controls.Grid]::SetColumn($centerButton, 0)
    [void]$bottomGrid.Children.Add($centerButton)
    $centerButton.Add_Click({
        try {
            Invoke-AlignmentCommand @{
                command = 'center_all'
            }
        }
        catch {
            Write-Status $_.Exception.Message
            [System.Windows.MessageBox]::Show($window, $_.Exception.Message, 'Alignment Tools') | Out-Null
        }
    }.GetNewClosure())

    Refresh-AlignmentUi
    $border.Add_PreviewMouseLeftButtonDown({
        param($sender, $eventArgs)
        if ($eventArgs.OriginalSource -is [System.Windows.Controls.Button]) {
            return
        }
        try {
            $window.DragMove()
            $eventArgs.Handled = $true
        }
        catch {
        }
    })
    $window.Add_SourceInitialized({
        Show-WindowFront -Window $window
    })
    $window.Add_ContentRendered({
        Show-WindowFront -Window $window
    })
    $window.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq [System.Windows.Input.Key]::Escape) {
            $sender.Close()
        }
    })
    $topmostTimer = New-Object System.Windows.Threading.DispatcherTimer
    $topmostTimer.Interval = [TimeSpan]::FromMilliseconds(150)
    $topmostTimer.Add_Tick({
        if (-not $window.IsLoaded) {
            $topmostTimer.Stop()
            return
        }

        $foregroundHandle = Get-ForegroundWindowHandle
        $foregroundProcessId = Get-WindowProcessId -WindowHandle $foregroundHandle
        $foregroundProcess = if ($foregroundProcessId -gt 0) { Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue } else { $null }
        $shouldFloat = ($foregroundProcess -and [string]$foregroundProcess.ProcessName -ieq 'blender') -or ($foregroundProcessId -eq $PID)
        if ([bool]$window.Topmost -ne [bool]$shouldFloat) {
            $window.Topmost = [bool]$shouldFloat
        }
    }.GetNewClosure())
    $topmostTimer.Start()

    if ($SelfTest) {
        $timer = New-Object System.Windows.Threading.DispatcherTimer
        $timer.Interval = [TimeSpan]::FromMilliseconds(100)
        $timer.Add_Tick({
            $timer.Stop()
            $window.Close()
        }.GetNewClosure())
        $timer.Start()
    }

    [void]$window.ShowDialog()
    if ($SelfTest) {
        Write-Output 'Alignment tools UI self-test OK'
    }
    exit 0
}
catch {
    $message = $_.Exception.Message
    if ($message -match 'Unsupported action:\s*alignment_tools') {
        $message = 'Reload the FlowCell Blender addon or restart Blender once.'
    }
    Write-Status $message
    try {
        [System.Windows.MessageBox]::Show($message, 'Alignment Tools') | Out-Null
    }
    catch {
    }
    exit 1
}































































































