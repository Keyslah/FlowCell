# Description: Rename all selected Blender objects in one prompt.

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy


def _load_flowcell_bridge():
    first_error = None
    for module_name in ("flowcell_bridge",):
        try:
            module = importlib.import_module(module_name)
            try:
                module = importlib.reload(module)
            except Exception:
                pass
            return module
        except Exception as exc:
            if first_error is None:
                first_error = exc

    search_roots = []
    user_scripts = bpy.utils.user_resource("SCRIPTS")
    if user_scripts:
        search_roots.append(Path(user_scripts) / "addons")
    for root in bpy.utils.script_paths():
        if root:
            search_roots.append(Path(root) / "addons")

    seen = set()
    for addon_root in search_roots:
        try:
            addon_root = addon_root.resolve()
        except Exception:
            continue
        addon_key = str(addon_root)
        if addon_key in seen or not addon_root.is_dir():
            continue
        seen.add(addon_key)
        addon_root_text = str(addon_root)
        if addon_root_text not in sys.path:
            sys.path.insert(0, addon_root_text)
        try:
            module = importlib.import_module("flowcell_bridge")
            try:
                module = importlib.reload(module)
            except Exception:
                pass
            return module
        except Exception:
            continue

    raise RuntimeError(
        "FlowCell Blender bridge module was not found. Reload the FlowCell add-on or restart Blender."
    ) from first_error


def _merge_payload(default_payload, override_payload):
    payload = dict(default_payload or {})
    if override_payload:
        payload.update(dict(override_payload))
    return payload


_PROMPT_POLL_SECONDS = 0.15


def _flowcell_bridge_root():
    scripts_root = Path(bpy.utils.user_resource("SCRIPTS"))
    return scripts_root / "addons" / "blender_bridge_flowcell"


def _write_rename_status(event, message="", **payload):
    try:
        status_path = _flowcell_bridge_root() / "rename_selected_status.json"
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(
            json.dumps(
                {
                    "event": str(event or ""),
                    "message": str(message or ""),
                    "pid": os.getpid(),
                    **payload,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception:
        pass


def _selected_rename_items(context):
    selected = [
        obj
        for obj in list(getattr(context, "selected_objects", []) or [])
        if str(getattr(obj, "name", "") or "")
    ]
    if not selected:
        raise ValueError("Select at least one object.")

    active = getattr(getattr(context, "view_layer", None), "objects", None)
    active_obj = getattr(active, "active", None) or getattr(context, "active_object", None)
    ordered = []
    if active_obj in selected:
        ordered.append(active_obj)
    ordered.extend(obj for obj in selected if obj not in ordered)

    return [
        {
            "current_name": str(obj.name),
            "new_name": str(obj.name),
            "is_active": bool(obj == active_obj),
        }
        for obj in ordered
    ]


def _prompt_script_text():
    return r'''
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Write-PromptResult([object]$Payload) {
    $Payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

function Get-DefaultRenameValue([string]$BaseName, [int]$Index) {
    if ($Index -le 0) {
        return $BaseName
    }
    return ('{0}{1}' -f $BaseName, $Index)
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
    $rawSelectionJson = Get-Content -LiteralPath $InputPath -Raw
    $parsedSelection = ConvertFrom-Json -InputObject $rawSelectionJson
    $selectedObjects = if ($parsedSelection -is [System.Array]) { @($parsedSelection) } else { @($parsedSelection) }
    if (@($selectedObjects).Count -eq 0) {
        Write-PromptResult @{ cancelled = $true }
        exit 0
    }

    $initialBaseName = if ($selectedObjects[0].PSObject.Properties['new_name']) {
        [string]$selectedObjects[0].new_name
    }
    else {
        [string]$selectedObjects[0].current_name
    }

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
        <DockPanel LastChildFill="True">
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
            <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CancelButton" Width="120" Height="36" Margin="0,0,10,0" Background="#FF586069">Cancel</Button>
                <Button x:Name="RenameButton" Width="140" Height="36">Apply</Button>
            </StackPanel>
            <ScrollViewer VerticalScrollBarVisibility="Auto" Margin="0,0,0,16">
                <Grid x:Name="NamesGrid" />
            </ScrollViewer>
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

        $currentObjectName = if ($selectedObject.PSObject.Properties['current_name']) {
            [string]$selectedObject.current_name
        }
        elseif ($selectedObject.PSObject.Properties['name']) {
            [string]$selectedObject.name
        }
        else {
            ''
        }
        if ([string]::IsNullOrWhiteSpace($currentObjectName)) {
            continue
        }

        $currentName = New-Object System.Windows.Controls.TextBlock
        $currentName.Text = $currentObjectName
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
    if ($rowControls.Count -eq 0) {
        throw 'No selected object rows were loaded.'
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

    $baseNameTextBox.Add_KeyDown({
        if ($_.Key -eq [System.Windows.Input.Key]::Return -or $_.Key -eq [System.Windows.Input.Key]::Enter) {
            & $applyBaseName
            $_.Handled = $true
        }
    })
    $applyBaseNameButton.Add_Click({
        & $applyBaseName
    })
    $cancelButton.Add_Click({
        Write-PromptResult @{ cancelled = $true }
        $window.DialogResult = $false
        $window.Close()
    })
    $window.Add_KeyDown({
        if ($_.Key -eq [System.Windows.Input.Key]::Escape) {
            Write-PromptResult @{ cancelled = $true }
            $window.DialogResult = $false
            $window.Close()
        }
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

            Write-PromptResult @{ cancelled = $false; items = @($items) }
            $window.DialogResult = $true
            $window.Close()
        }
        catch {
            [System.Windows.MessageBox]::Show($window, $_.Exception.Message, 'Collection Rename Selected') | Out-Null
        }
    })

    [void]$window.ShowDialog()
    if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
        Write-PromptResult @{ cancelled = $true }
    }
    exit 0
}
catch {
    try {
        Write-PromptResult @{ cancelled = $true; error = $_.Exception.Message }
    }
    catch {
    }
    exit 1
}
'''


def _cleanup_prompt_files(paths):
    for path in paths:
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            pass


def _start_prompt_process(items):
    temp_dir = Path(tempfile.gettempdir())
    token = f"{os.getpid()}_{id(items)}"
    input_path = temp_dir / f"flowcell_rename_selected_{token}_input.json"
    output_path = temp_dir / f"flowcell_rename_selected_{token}_output.json"
    script_path = temp_dir / f"flowcell_rename_selected_{token}.ps1"

    input_path.write_text(json.dumps(items, indent=2), encoding="utf-8")
    script_path.write_text(_prompt_script_text(), encoding="utf-8")
    try:
        output_path.unlink(missing_ok=True)
    except Exception:
        pass

    powershell = os.environ.get("SystemRoot", r"C:\Windows")
    powershell = str(Path(powershell) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")
    if not Path(powershell).exists():
        powershell = "powershell.exe"

    process = subprocess.Popen(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Sta",
            "-File",
            str(script_path),
            "-InputPath",
            str(input_path),
            "-OutputPath",
            str(output_path),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    return process, input_path, output_path, script_path


def _apply_prompt_result(context, output_path):
    try:
        result = json.loads(Path(output_path).read_text(encoding="utf-8-sig"))
    except Exception as exc:
        _write_rename_status("error", f"Rename Selected prompt result was not readable: {exc}")
        print(f"FlowCell Rename Selected failed: {exc}")
        return

    if result.get("cancelled"):
        message = str(result.get("error") or "Cancelled rename.")
        _write_rename_status("cancelled", message)
        print(f"FlowCell Rename Selected: {message}")
        return

    items = result.get("items", []) or []
    if not items:
        _write_rename_status("cancelled", "Cancelled rename.")
        print("FlowCell Rename Selected: Cancelled rename.")
        return

    try:
        bridge = _load_flowcell_bridge()
        message = bridge.perform_batch_rename_selected_objects(context, items)
        _write_rename_status("applied", message, count=len(items))
        print(f"FlowCell Rename Selected: {message}")
    except Exception as exc:
        _write_rename_status("error", str(exc), count=len(items))
        print(f"FlowCell Rename Selected failed: {exc}")


def _watch_prompt_process(context, process, input_path, output_path, script_path):
    def _poll():
        if Path(output_path).exists():
            _apply_prompt_result(context, output_path)
            _cleanup_prompt_files((input_path, output_path, script_path))
            return None
        if process.poll() is not None:
            _write_rename_status("error", "Rename Selected prompt closed without a result.")
            _cleanup_prompt_files((input_path, output_path, script_path))
            return None
        return _PROMPT_POLL_SECONDS

    bpy.app.timers.register(_poll, first_interval=_PROMPT_POLL_SECONDS)


def _open_prompt_later(context, items):
    def _open_prompt():
        try:
            process, input_path, output_path, script_path = _start_prompt_process(items)
            _write_rename_status("opened", "Opened Rename Selected prompt.", count=len(items))
            _watch_prompt_process(context, process, input_path, output_path, script_path)
        except Exception as exc:
            _write_rename_status("error", str(exc), count=len(items))
            print(f"FlowCell Rename Selected failed to open prompt: {exc}")
        return None

    bpy.app.timers.register(_open_prompt, first_interval=0.05)
    _write_rename_status("scheduled", "Opening Rename Selected prompt.", count=len(items))
    return "Opening Rename Selected prompt."


def run_flowcell_action(context=None, data=None):
    ctx = context or bpy.context
    payload = _merge_payload({}, data)
    items = payload.get("items")
    if not items:
        items = _selected_rename_items(ctx)
        return {"message": _open_prompt_later(ctx, items)}

    bridge = _load_flowcell_bridge()
    message = bridge.perform_batch_rename_selected_objects(ctx, items)
    _write_rename_status("applied", message, count=len(items))
    return {"message": message}
