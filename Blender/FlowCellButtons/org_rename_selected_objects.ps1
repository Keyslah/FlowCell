# Description: Prompt for rename values and batch-rename the selected Blender objects through the FlowCell bridge.

# Source Bridge Action: rename_selected_objects
# Source Python Filename: flowtest_bridge.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_bridge.py

# Source Action Function: perform_batch_rename_selected_objects
# Source Action Start Line: 711

# Source Action Logic:

# def perform_batch_rename_selected_objects(
#     context: bpy.types.Context,
#     items: list[dict[str, str]],
# ) -> str:
#     selected_objects = list(context.selected_objects)
#     if not selected_objects:
#         raise ValueError("Select at least one object.")
# 
#     if not items:
#         raise ValueError("No rename items were provided.")
# 
#     selected_by_name = {obj.name: obj for obj in selected_objects}
#     rename_pairs: list[tuple[bpy.types.Object, str]] = []
# 
#     for entry in items:
#         current_name = str(entry.get("current_name", "")).strip()
#         new_name = str(entry.get("new_name", "")).strip()
#         if not current_name:
#             raise ValueError("Each rename item needs a current_name.")
#         if not new_name:
#             raise ValueError(f"New name is missing for '{current_name}'.")
#         obj = selected_by_name.get(current_name)
#         if obj is None:
#             raise ValueError(f"'{current_name}' is no longer selected.")
#         rename_pairs.append((obj, new_name))
# 
#     if len(rename_pairs) != len(selected_objects):
#         raise ValueError("Rename list must include every selected object.")
# 
#     new_names = [new_name for _, new_name in rename_pairs]
#     if len(set(new_names)) != len(new_names):
#         raise ValueError("New names must be unique.")
# 
#     selected_name_set = {obj.name for obj in selected_objects}
#     for _, new_name in rename_pairs:
#         if new_name in selected_name_set:
#             continue
#         existing = bpy.data.objects.get(new_name)
#         if existing is not None and existing not in selected_objects:
#             raise ValueError(f"Another object already uses '{new_name}'.")
# 
#     temp_prefix = "__flowtest_collection_rename__"
#     for index, (obj, _) in enumerate(rename_pairs, start=1):
#         temp_name = f"{temp_prefix}{index}"
#         while bpy.data.objects.get(temp_name) is not None:
#             temp_name += "_x"
#         obj.name = temp_name
# 
#     for obj, new_name in rename_pairs:
#         obj.name = new_name
# 
#     return f"Renamed {len(rename_pairs)} object(s)."
# 
# 

param(
    [string]$ConfigPath = '',
    [string]$StatusPath = ''
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

if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Sta',
        '-File', $PSCommandPath,
        '-ConfigPath', $ConfigPath,
        '-StatusPath', $StatusPath
    )
    $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -PassThru -Wait
    exit $child.ExitCode
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

function Get-DefaultRenameValue([string]$BaseName, [int]$Index) {
    if ($Index -le 0) {
        return $BaseName
    }
    return ('{0} {1}' -f $BaseName, ($Index + 1))
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

try {
    $config = Read-ConfigFile -Path $ConfigPath
    $selectionResponse = Invoke-BlenderBridgeRequest -Config $config -Action 'get_selected_objects'
    $selectedObjects = @($selectionResponse.selected_objects)
    if (@($selectedObjects).Count -eq 0) {
        Write-Status 'Rename selected skipped. Select at least one Blender object first.'
        exit 0
    }

    $initialBaseName = [string]$selectedObjects[0].name

    $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Collection Rename Selected"
        Width="920"
        Height="680"
        MinWidth="820"
        MinHeight="560"
        WindowStartupLocation="CenterScreen"
        Background="#FF1D232B"
        Foreground="#FFF2F2F2">
    <Border Margin="16" Padding="18" Background="#FF262D36" CornerRadius="18">
        <DockPanel>
            <StackPanel DockPanel.Dock="Top">
                <TextBlock FontSize="24" FontWeight="SemiBold">Rename Selected Objects</TextBlock>
                <TextBlock Margin="0,8,0,0" Foreground="#FFB6C2CF" TextWrapping="Wrap">Type one base name, then adjust any individual names you want before applying.</TextBlock>
                <Grid Margin="0,16,0,0">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*" />
                        <ColumnDefinition Width="140" />
                    </Grid.ColumnDefinitions>
                    <TextBox x:Name="BaseNameTextBox" Grid.Column="0" Height="36" VerticalContentAlignment="Center" Padding="10,6" />
                    <Button x:Name="ApplyBaseNameButton" Grid.Column="1" Width="128" Height="36" Margin="12,0,0,0">Apply Name</Button>
                </Grid>
                <Grid Margin="0,16,0,8">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*" />
                        <ColumnDefinition Width="*" />
                    </Grid.ColumnDefinitions>
                    <TextBlock Grid.Column="0" FontWeight="SemiBold" Foreground="#FF9FB0C2">Current Name</TextBlock>
                    <TextBlock Grid.Column="1" FontWeight="SemiBold" Foreground="#FF9FB0C2">New Name</TextBlock>
                </Grid>
            </StackPanel>
            <ScrollViewer VerticalScrollBarVisibility="Auto" Margin="0,0,0,16">
                <Grid x:Name="NamesGrid" />
            </ScrollViewer>
            <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CancelButton" Width="120" Height="36" Margin="0,0,10,0" Background="#FF586069">Cancel</Button>
                <Button x:Name="RenameButton" Width="140" Height="36">Rename</Button>
            </StackPanel>
        </DockPanel>
    </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $window.Topmost = $true
    $window.ShowActivated = $true
    $baseNameTextBox = $window.FindName('BaseNameTextBox')
    $applyBaseNameButton = $window.FindName('ApplyBaseNameButton')
    $namesGrid = $window.FindName('NamesGrid')
    $cancelButton = $window.FindName('CancelButton')
    $renameButton = $window.FindName('RenameButton')

    $rowControls = New-Object System.Collections.Generic.List[object]
    $rowIndex = 0
    foreach ($selectedObject in @($selectedObjects)) {
        $rowDefinition = New-Object System.Windows.Controls.RowDefinition
        $rowDefinition.Height = [System.Windows.GridLength]::Auto
        [void]$namesGrid.RowDefinitions.Add($rowDefinition)

        $currentName = New-Object System.Windows.Controls.TextBlock
        $currentName.Text = [string]$selectedObject.name
        $currentName.Margin = '0,0,12,10'
        $currentName.VerticalAlignment = 'Center'
        $currentName.TextWrapping = 'Wrap'
        [System.Windows.Controls.Grid]::SetRow($currentName, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($currentName, 0)

        $newNameBox = New-Object System.Windows.Controls.TextBox
        $newNameBox.Margin = '0,0,0,10'
        $newNameBox.MinHeight = 34
        $newNameBox.Padding = '8,6'
        $newNameBox.VerticalContentAlignment = 'Center'
        [System.Windows.Controls.Grid]::SetRow($newNameBox, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($newNameBox, 1)

        if ($namesGrid.ColumnDefinitions.Count -eq 0) {
            $leftColumn = New-Object System.Windows.Controls.ColumnDefinition
            $leftColumn.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
            $rightColumn = New-Object System.Windows.Controls.ColumnDefinition
            $rightColumn.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
            [void]$namesGrid.ColumnDefinitions.Add($leftColumn)
            [void]$namesGrid.ColumnDefinitions.Add($rightColumn)
        }

        [void]$namesGrid.Children.Add($currentName)
        [void]$namesGrid.Children.Add($newNameBox)
        [void]$rowControls.Add([pscustomobject]@{
            CurrentNameText = $currentName
            NewNameTextBox  = $newNameBox
        })
        $rowIndex += 1
    }

    $applyBaseName = {
        $baseName = $baseNameTextBox.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($baseName)) { return }
        for ($i = 0; $i -lt $rowControls.Count; $i++) {
            $rowControls[$i].NewNameTextBox.Text = Get-DefaultRenameValue -BaseName $baseName -Index $i
        }
    }

    $baseNameTextBox.Text = $initialBaseName
    & $applyBaseName
    $baseNameTextBox.SelectAll()
    $window.Add_SourceInitialized({
        Show-WindowFront -Window $window
    })
    $window.Add_ContentRendered({
        Show-WindowFront -Window $window
        $baseNameTextBox.Focus() | Out-Null
        $baseNameTextBox.SelectAll()
    })

    $applyBaseNameButton.Add_Click({
        & $applyBaseName
    })
    $cancelButton.Add_Click({
        $window.DialogResult = $false
        $window.Close()
    })
    $renameButton.Add_Click({
        try {
            $items = @()
            foreach ($row in $rowControls) {
                $currentName = [string]$row.CurrentNameText.Text
                $newName = [string]$row.NewNameTextBox.Text.Trim()
                if ([string]::IsNullOrWhiteSpace($newName)) {
                    throw "New name is blank for '$currentName'."
                }
                $items += [pscustomobject]@{
                    current_name = $currentName
                    new_name     = $newName
                }
            }

            $response = Invoke-BlenderBridgeRequest -Config $config -Action 'rename_selected_objects' -Data @{ items = @($items) }
            $message = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Renamed selected objects.' }
            Write-Status $message
            $window.DialogResult = $true
            $window.Close()
        }
        catch {
            [System.Windows.MessageBox]::Show($window, $_.Exception.Message, 'Collection Rename Selected') | Out-Null
        }
    })

    [void]$window.ShowDialog()
    exit 0
}
catch {
    $message = $_.Exception.Message
    if ($message -match 'Unsupported action:\s*rename_selected_objects') {
        $message = 'The open Blender session is using an older addon build. Reload the Live Snapshot Sorter addon or restart Blender, then try Rename Selected again.'
    }
    Write-Status $message
    try {
        [System.Windows.MessageBox]::Show($message, 'Collection Rename Selected') | Out-Null
    }
    catch {
    }
    exit 1
}




































































































