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
    module_names = ("flowcell_bridge", "flowcell_bridge")
    first_error = None
    for module_name in module_names:
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
        for module_name in module_names:
            try:
                module = importlib.import_module(module_name)
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
    items = []
    for obj in list(context.selected_objects):
        current_name = str(getattr(obj, "name", "") or "")
        if not current_name:
            continue
        items.append({"current_name": current_name, "new_name": current_name})
    if not items:
        raise ValueError("Select at least one object.")
    return items


def _prompt_script_text():
    return r'''
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$items = @(Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Rename Selected'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Size = New-Object System.Drawing.Size(620, [Math]::Min(760, [Math]::Max(210, 130 + ($items.Count * 34))))
$form.MinimumSize = New-Object System.Drawing.Size(520, 210)
$form.TopMost = $true
$form.KeyPreview = $true

$table = New-Object System.Windows.Forms.TableLayoutPanel
$table.Dock = [System.Windows.Forms.DockStyle]::Fill
$table.AutoScroll = $true
$table.ColumnCount = 2
$table.RowCount = $items.Count + 1
$table.Padding = New-Object System.Windows.Forms.Padding(10)
$table.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 45))) | Out-Null
$table.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 55))) | Out-Null

$currentHeader = New-Object System.Windows.Forms.Label
$currentHeader.Text = 'Current'
$currentHeader.AutoSize = $true
$currentHeader.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9)
$table.Controls.Add($currentHeader, 0, 0)

$newHeader = New-Object System.Windows.Forms.Label
$newHeader.Text = 'New name'
$newHeader.AutoSize = $true
$newHeader.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9)
$table.Controls.Add($newHeader, 1, 0)

$textBoxes = New-Object System.Collections.Generic.List[System.Windows.Forms.TextBox]
for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items[$index]
    $row = $index + 1

    $label = New-Object System.Windows.Forms.Label
    $label.Text = [string]$item.current_name
    $label.AutoEllipsis = $true
    $label.Dock = [System.Windows.Forms.DockStyle]::Fill
    $label.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $table.Controls.Add($label, 0, $row)

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Text = [string]$item.new_name
    $textBox.Tag = [string]$item.current_name
    $textBox.Dock = [System.Windows.Forms.DockStyle]::Fill
    $table.Controls.Add($textBox, 1, $row)
    $textBoxes.Add($textBox)
}

$buttons = New-Object System.Windows.Forms.FlowLayoutPanel
$buttons.Dock = [System.Windows.Forms.DockStyle]::Bottom
$buttons.FlowDirection = [System.Windows.Forms.FlowDirection]::RightToLeft
$buttons.Padding = New-Object System.Windows.Forms.Padding(10)
$buttons.Height = 56

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = 'OK'
$okButton.Width = 92
$okButton.Height = 30

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancel'
$cancelButton.Width = 92
$cancelButton.Height = 30

$buttons.Controls.Add($okButton)
$buttons.Controls.Add($cancelButton)
$form.Controls.Add($table)
$form.Controls.Add($buttons)
$form.AcceptButton = $okButton
$form.CancelButton = $cancelButton

$writeCancel = {
    @{ cancelled = $true } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

$cancelButton.Add_Click({
    & $writeCancel
    $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Close()
})

$form.Add_KeyDown({
    if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
        & $writeCancel
        $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $form.Close()
    }
})

$okButton.Add_Click({
    $renameItems = @()
    $newNames = New-Object System.Collections.Generic.HashSet[string]
    foreach ($textBox in $textBoxes) {
        $currentName = [string]$textBox.Tag
        $newName = ([string]$textBox.Text).Trim()
        if ([string]::IsNullOrWhiteSpace($newName)) {
            [System.Windows.Forms.MessageBox]::Show("New name is required for '$currentName'.", 'Rename Selected') | Out-Null
            return
        }
        if (-not $newNames.Add($newName)) {
            [System.Windows.Forms.MessageBox]::Show("Duplicate new name: '$newName'.", 'Rename Selected') | Out-Null
            return
        }
        $renameItems += [pscustomobject]@{
            current_name = $currentName
            new_name = $newName
        }
    }

    @{ cancelled = $false; items = $renameItems } |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $OutputPath -Encoding UTF8
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

[void]$form.ShowDialog()
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
    & $writeCancel
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

    command = [
        "powershell.exe",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        "-InputPath",
        str(input_path),
        "-OutputPath",
        str(output_path),
    ]
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return {
        "process": process,
        "input_path": input_path,
        "output_path": output_path,
        "script_path": script_path,
    }


def _finish_prompted_rename(state):
    process = state["process"]
    if process.poll() is None:
        return _PROMPT_POLL_SECONDS

    temp_paths = (state["input_path"], state["output_path"], state["script_path"])
    try:
        output_path = state["output_path"]
        if not output_path.exists():
            _write_rename_status("error", "Rename Selected prompt closed without a result.")
            return None

        result = json.loads(output_path.read_text(encoding="utf-8-sig"))
        if result.get("cancelled"):
            _write_rename_status("cancelled", "Cancelled rename selected.")
            return None

        items = result.get("items") or []
        ctx = bpy.context
        bridge = _load_flowcell_bridge()
        message = bridge.perform_batch_rename_selected_objects(ctx, items)
        try:
            bridge.set_bridge_result(message)
        except Exception:
            pass
        _write_rename_status("applied", message, count=len(items))
        print(f"FlowCell Rename Selected: {message}")
    except Exception as exc:
        _write_rename_status("error", str(exc))
        print(f"FlowCell Rename Selected failed: {exc}")
    finally:
        _cleanup_prompt_files(temp_paths)
    return None


def _schedule_prompted_rename(context):
    items = _selected_rename_items(context)

    def _open_prompt():
        try:
            state = _start_prompt_process(items)
            _write_rename_status("opened", "Opened Rename Selected prompt.", count=len(items))

            def _poll_prompt():
                return _finish_prompted_rename(state)

            bpy.app.timers.register(_poll_prompt, first_interval=_PROMPT_POLL_SECONDS)
        except Exception as exc:
            _write_rename_status("error", str(exc))
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
        return {"message": _schedule_prompted_rename(ctx)}
    bridge = _load_flowcell_bridge()
    message = bridge.perform_batch_rename_selected_objects(ctx, items)
    return {"message": message}
