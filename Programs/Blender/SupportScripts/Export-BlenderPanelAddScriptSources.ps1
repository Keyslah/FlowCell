param(
    [string]$StatePath = '',
    [string]$OutputRoot = '',
    [string]$ManifestPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$projectRoot = Join-Path $repoRoot 'Programs\Blender'
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    $projectRoot = Join-Path $repoRoot 'Blender'
}
if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $repoRoot 'FlowCell\local\flowcell_state.json'
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $projectRoot 'Blender Git Scripts'
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $OutputRoot 'panel-add-script-manifest.json'
}
$legacyManifestPath = Join-Path $OutputRoot 'panel-backup-manifest.json'

function Write-FlowCellTextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value,
        [ValidateSet('ASCII', 'UTF8')]
        [string]$Encoding = 'UTF8'
    )

    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $resolvedEncoding = switch ($Encoding) {
        'ASCII' { [System.Text.Encoding]::ASCII }
        default { New-Object System.Text.UTF8Encoding($false) }
    }
    [System.IO.File]::WriteAllText($Path, $Value, $resolvedEncoding)
}

$script:RecycleSupportLoaded = $false
function Ensure-RecycleSupport {
    if ($script:RecycleSupportLoaded) {
        return
    }

    Add-Type -AssemblyName Microsoft.VisualBasic
    $script:RecycleSupportLoaded = $true
}

function Send-FileToRecycleBin {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    Ensure-RecycleSupport
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
    return $true
}

function ConvertTo-PlainValue {
    param(
        [Parameter(Mandatory = $false)]
        $Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [string] -or $Value -is [ValueType]) {
        return $Value
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in @($Value.Keys)) {
            $result[[string]$key] = ConvertTo-PlainValue -Value $Value[$key]
        }
        return $result
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        $items = New-Object System.Collections.Generic.List[object]
        foreach ($item in $Value) {
            $items.Add((ConvertTo-PlainValue -Value $item)) | Out-Null
        }
        return @($items)
    }

    if ($Value.PSObject -and @($Value.PSObject.Properties).Count -gt 0) {
        $result = @{}
        foreach ($property in @($Value.PSObject.Properties)) {
            $result[[string]$property.Name] = ConvertTo-PlainValue -Value $property.Value
        }
        return $result
    }

    return $Value
}

function Test-FlowCellPythonEntrypoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    return [regex]::IsMatch(
        $raw,
        '(?m)^\s*def\s+(run_flowcell_action|main|perform_[A-Za-z0-9_]+)\s*\('
    )
}

function Get-HeaderValue {
    param(
        [string[]]$Lines,
        [string]$Key
    )

    foreach ($line in @($Lines)) {
        $pattern = '^\s*#\s*' + [regex]::Escape($Key) + '\s*:\s*(.+)$'
        if ([string]$line -match $pattern) {
            return [string]$matches[1].Trim()
        }
    }

    return ''
}

function Get-WrapperMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $lines = @(Get-Content -LiteralPath $Path -TotalCount 60)
    $raw = Get-Content -LiteralPath $Path -Raw

    $action = ''
    $data = @{}
    $direction = ''
    $actionMatch = [regex]::Match($raw, "-Action\s+'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($actionMatch.Success) {
        $action = [string]$actionMatch.Groups[1].Value
    }

    $dataMatch = [regex]::Match($raw, "-DataJson\s+'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($dataMatch.Success) {
        try {
            $dataObject = ConvertFrom-Json -InputObject ([string]$dataMatch.Groups[1].Value)
            $convertedData = ConvertTo-PlainValue -Value $dataObject
            if ($convertedData -is [System.Collections.IDictionary]) {
                $data = @{}
                foreach ($key in @($convertedData.Keys)) {
                    $data[[string]$key] = $convertedData[$key]
                }
            }
        }
        catch {
            $data = @{}
        }
    }

    $directionMatch = [regex]::Match($raw, "-Direction\s+'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($directionMatch.Success) {
        $direction = [string]$directionMatch.Groups[1].Value
    }

    return [pscustomobject]@{
        Description          = Get-HeaderValue -Lines $lines -Key 'Description'
        SourceBridgeAction   = Get-HeaderValue -Lines $lines -Key 'Source Bridge Action'
        SourcePythonFile     = Get-HeaderValue -Lines $lines -Key 'Source Python File'
        SourceActionFunction = Get-HeaderValue -Lines $lines -Key 'Source Action Function'
        Action               = $action
        Data                 = $data
        Direction            = $direction
    }
}

function Get-FirstNonEmptyValue {
    param(
        [string[]]$Values
    )

    foreach ($value in @($Values)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            return [string]$value
        }
    }

    return ''
}

function Get-NormalizedPathKey([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }

    try {
        return ([System.IO.Path]::GetFullPath([string]$Path)).TrimEnd('\').ToLowerInvariant()
    }
    catch {
        return ([string]$Path).Trim().TrimEnd('\').ToLowerInvariant()
    }
}

function Test-IsManagedMirrorPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    $normalizedPath = (Get-NormalizedPathKey -Path $Path)
    if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
        return $false
    }

    $mirrorRoots = @(
        (Join-Path $projectRoot 'Blender Git Scripts'),
        (Join-Path $projectRoot 'Blender Local Scripts')
    )
    foreach ($mirrorRoot in @($mirrorRoots)) {
        $normalizedRoot = Get-NormalizedPathKey -Path $mirrorRoot
        if ([string]::IsNullOrWhiteSpace($normalizedRoot)) {
            continue
        }
        if ($normalizedPath -eq $normalizedRoot -or $normalizedPath.StartsWith($normalizedRoot + '\')) {
            return $true
        }
    }

    return $false
}

function Get-BaseExportStem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    switch ($Label) {
        'cycle versions <' { return 'cycle versions back' }
        'cycle versions >' { return 'cycle versions forward' }
        default { return $Label }
    }
}

function Get-SafeExportStem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [int]$OccurrenceIndex = 1
    )

    $stem = Get-BaseExportStem -Label $Label
    $invalidPattern = ([regex]::Escape((-join [System.IO.Path]::GetInvalidFileNameChars())))
    $stem = [regex]::Replace($stem, '[' + $invalidPattern + ']+', ' ')
    $stem = [regex]::Replace($stem, '\s+', ' ').Trim().Trim('.')
    if ([string]::IsNullOrWhiteSpace($stem)) {
        $stem = 'button'
    }
    if ($OccurrenceIndex -gt 1) {
        $stem = '{0} {1}' -f $stem, $OccurrenceIndex
    }
    return $stem
}

function Ensure-DescriptionComment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $normalized = ($Content -replace "`r`n", "`n").TrimStart([char]0xFEFF)
    if ($normalized -match '^\s*#\s*Description\s*:') {
        return $normalized
    }

    return ('# Description: {0}' -f $Description) + "`n`n" + $normalized
}

function Get-FlowCellChildMetadataLines {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    switch ($Label.Trim().ToLowerInvariant()) {
        'smart axis' {
            return @(
                '# FLOWCELL_CHILD: baseline | Base | Store the current bounds as the Smart Axis baseline.',
                '# FLOWCELL_CHILD: cycle_x | X | Cycle Smart Axis X between none, minus, and plus pinning.',
                '# FLOWCELL_CHILD: cycle_y | Y | Cycle Smart Axis Y between none, minus, and plus pinning.',
                '# FLOWCELL_CHILD: cycle_z | Z | Cycle Smart Axis Z between none, minus, and plus pinning.',
                '# FLOWCELL_CHILD: toggle_live | Live | Toggle Smart Axis live pinning.'
            )
        }
        'smart axis lock' {
            return @(
                '# FLOWCELL_CHILD: baseline | Base | Store the current bounds as the Smart Axis baseline.',
                '# FLOWCELL_CHILD: cycle_x | X | Cycle Smart Axis X between none, minus, and plus pinning.',
                '# FLOWCELL_CHILD: cycle_y | Y | Cycle Smart Axis Y between none, minus, and plus pinning.',
                '# FLOWCELL_CHILD: cycle_z | Z | Cycle Smart Axis Z between none, minus, and plus pinning.',
                '# FLOWCELL_CHILD: toggle_live | Live | Toggle Smart Axis live pinning.'
            )
        }
        'alignment tools' {
            return @(
                '# FLOWCELL_CHILD: z_min | Z Min | Align the active object to the minimum Z bound of the selection.',
                '# FLOWCELL_CHILD: z_center | Z Center | Align the active object to the center Z position of the selection.',
                '# FLOWCELL_CHILD: z_max | Z Max | Align the active object to the maximum Z bound of the selection.',
                '# FLOWCELL_CHILD: z_surface | Z Surface | Align the active object using the saved Z surface modifier.',
                '# FLOWCELL_CHILD: z_geo | Z Origin | Align the active object using the saved Z origin modifier.',
                '# FLOWCELL_CHILD: y_min | Y Min | Align the active object to the minimum Y bound of the selection.',
                '# FLOWCELL_CHILD: y_center | Y Center | Align the active object to the center Y position of the selection.',
                '# FLOWCELL_CHILD: y_max | Y Max | Align the active object to the maximum Y bound of the selection.',
                '# FLOWCELL_CHILD: y_surface | Y Surface | Align the active object using the saved Y surface modifier.',
                '# FLOWCELL_CHILD: y_geo | Y Origin | Align the active object using the saved Y origin modifier.',
                '# FLOWCELL_CHILD: x_min | X Min | Align the active object to the minimum X bound of the selection.',
                '# FLOWCELL_CHILD: x_center | X Center | Align the active object to the center X position of the selection.',
                '# FLOWCELL_CHILD: x_max | X Max | Align the active object to the maximum X bound of the selection.',
                '# FLOWCELL_CHILD: x_surface | X Surface | Align the active object using the saved X surface modifier.',
                '# FLOWCELL_CHILD: x_geo | X Origin | Align the active object using the saved X origin modifier.',
                '# FLOWCELL_CHILD: center_everything | Center Everything | Center the full selection across all supported axes.'
            )
        }
        'flatten revolve' {
            return @(
                '# FLOWCELL_CHILD: flatten_profile | Flatten | Flatten the active mesh into a centered profile using the current field values.',
                '# FLOWCELL_CHILD: generate_revolve | Revolve | Generate revolve geometry from the current flattened profile and field values.'
            )
        }
        'rotate' { break }
        'custom_quick_rotate_group' { break }
        'theme' { break }
        default {
            return @()
        }
    }

    if ($Label.Trim().ToLowerInvariant() -in @('rotate', 'custom_quick_rotate_group')) {
        return @(
            '# FLOWCELL_CHILD: axis_z | Z | Set the quick-rotate axis to Z.',
            '# FLOWCELL_CHILD: axis_y | Y | Set the quick-rotate axis to Y.',
            '# FLOWCELL_CHILD: axis_x | X | Set the quick-rotate axis to X.',
            '# FLOWCELL_CHILD: preset_30 | 30 deg | Apply a 30 degree positive quick-rotate immediately and stage the angle.',
            '# FLOWCELL_CHILD: preset_45 | 45 deg | Apply a 45 degree positive quick-rotate immediately and stage the angle.',
            '# FLOWCELL_CHILD: preset_90 | 90 deg | Apply a 90 degree positive quick-rotate immediately and stage the angle.',
            '# FLOWCELL_CHILD: preset_180 | 180 deg | Apply a 180 degree positive quick-rotate immediately and stage the angle.',
            '# FLOWCELL_CHILD: preset_270 | 270 deg | Apply a 270 degree positive quick-rotate immediately and stage the angle.',
            '# FLOWCELL_CHILD: center_geometry | Geometry | Use geometry center as the quick-rotate pivot.',
            '# FLOWCELL_CHILD: center_origin | Origin | Use object origin as the quick-rotate pivot.',
            '# FLOWCELL_CHILD: center_world | World | Use world origin as the quick-rotate pivot.',
            '# FLOWCELL_CHILD: center_cursor | Cursor | Use 3D cursor as the quick-rotate pivot.',
            '# FLOWCELL_CHILD: center_object | Object | Use the active object as the quick-rotate pivot.',
            '# FLOWCELL_CHILD: mode_transform | Transform | Use quick rotate in transform mode.',
            '# FLOWCELL_CHILD: mode_distribute | Distribute | Use quick rotate in distribute mode.',
            '# FLOWCELL_CHILD: apply_negative | Negative | Apply the staged quick-rotate values in the negative direction.',
            '# FLOWCELL_CHILD: apply_positive | Positive | Apply the staged quick-rotate values in the positive direction.'
        )
    }

    return @(
        '# FLOWCELL_CHILD: browse_theme | Browse | Choose a theme source image to sample colors from.',
        '# FLOWCELL_CHILD: absorb_theme | Absorb Theme | Pull the current Blender theme values back into the tool fields.',
        '# FLOWCELL_CHILD: save_theme | Save Theme | Save the currently staged Blender theme preset.',
        '# FLOWCELL_CHILD: load_theme | Load Theme | Load a saved Blender theme preset into the tool fields.',
        '# FLOWCELL_CHILD: dark_theme | Dark Theme | Stage the sampled palette as a dark Blender theme.',
        '# FLOWCELL_CHILD: light_theme | Light Theme | Stage the sampled palette as a light Blender theme.',
        '# FLOWCELL_CHILD: apply_theme | Apply | Apply the currently visible Blender theme role colors.',
        '# FLOWCELL_CHILD: apply_background_pic | Place Picture | Creates fake gizmos and a fake grid on top of a background image.',
        '# FLOWCELL_CHILD: apply_grid | Grid | Apply near and far grid spacing using the world-origin distance threshold.',
        '# FLOWCELL_CHILD: browse_background_pic | Browse | Choose the Place Picture background image path.',
        '# FLOWCELL_CHILD: startup_background_pic | Startup | Save the current Place Picture image so Blender restores it on startup.',
        '# FLOWCELL_CHILD: clear_background_pic | Clear | Remove the Place Picture fake background, grid, and gizmos while keeping the path field.',
        '# FLOWCELL_CHILD: apply_hdri | HDRI Apply | Apply the HDRI path in the field.',
        '# FLOWCELL_CHILD: clear_world | Clear | Reset the current file to a plain world without the staged HDRI.',
        '# FLOWCELL_CHILD: reset_world | Reset | Rebuild a clean world and reapply the staged HDRI values.',
        '# FLOWCELL_CHILD: browse_hdri | HDRI Browse | Choose the HDRI file path.',
        '# FLOWCELL_CHILD: apply_rotation_z | Z | Apply the staged Z rotation value.',
        '# FLOWCELL_CHILD: apply_rotation_y | Y | Apply the staged Y rotation value.',
        '# FLOWCELL_CHILD: apply_rotation_x | X | Apply the staged X rotation value.',
        '# FLOWCELL_CHILD: apply_world_strength | WS | Apply the staged world strength value.'
    )
}

function Ensure-FlowCellChildMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $metadataLines = @(Get-FlowCellChildMetadataLines -Label $Label)
    if ($metadataLines.Count -eq 0) {
        return $Content
    }

    $normalized = ($Content -replace "`r`n", "`n").TrimStart([char]0xFEFF)
    if ($normalized -match '(?m)^\s*#\s*FLOWCELL_CHILD\s*:') {
        return $normalized
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @($normalized -split "`n")) {
        [void]$lines.Add([string]$line)
    }

    $insertIndex = 0
    while ($insertIndex -lt $lines.Count) {
        $currentLine = [string]$lines[$insertIndex]
        if ([string]::IsNullOrWhiteSpace($currentLine) -or $currentLine -match '^\s*#') {
            $insertIndex++
            continue
        }
        break
    }

    $nextLines = New-Object System.Collections.Generic.List[string]
    if ($insertIndex -gt 0) {
        foreach ($line in @($lines[0..($insertIndex - 1)])) {
            [void]$nextLines.Add([string]$line)
        }
    }
    if ($nextLines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$nextLines[$nextLines.Count - 1])) {
        [void]$nextLines.Add('')
    }
    foreach ($line in @($metadataLines)) {
        [void]$nextLines.Add([string]$line)
    }
    [void]$nextLines.Add('')
    if ($insertIndex -lt $lines.Count) {
        foreach ($line in @($lines[$insertIndex..($lines.Count - 1)])) {
            [void]$nextLines.Add([string]$line)
        }
    }

    return ($nextLines -join "`n").TrimEnd() + "`n"
}

function Transform-HdriWorldExportSource {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $normalized = $Content -replace "`r`n", "`n"
    $normalized = [regex]::Replace(
        $normalized,
        '(?ms)^def _flowcell_script_root\(\) -> Path:\n.*?^DEFAULT_HDRI_PATH = str\(\n.*?\n\)\n?',
        "DEFAULT_HDRI_PATH = ""`n",
        1
    )
    $normalized = [regex]::Replace(
        $normalized,
        '(?ms)^DEFAULT_HDRI_PATH = str\(\n.*?\n\)\n?',
        "DEFAULT_HDRI_PATH = ""`n",
        1
    )

    return $normalized
}

function Get-BridgeHelperPython {
    return @'
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import bpy


def _load_flowcell_bridge():
    module_names = ("flowcell_bridge", "flowcell_bridge", "flowcell_bridge")
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
'@
}

function Get-GenericBridgePython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [Parameter(Mandatory = $true)]
        [string]$ActionName,
        [hashtable]$DefaultData = @{}
    )

    $helper = Get-BridgeHelperPython
    $payloadJson = ConvertTo-Json -InputObject $DefaultData -Compress -Depth 20
    return @"
# Description: $Description

$helper

ACTION_NAME = "$ActionName"
DEFAULT_DATA = json.loads(r'''$payloadJson''')


def run_flowcell_action(context=None, data=None):
    del context
    bridge = _load_flowcell_bridge()
    payload = _merge_payload(DEFAULT_DATA, data)
    return bridge.execute_bridge_operator(ACTION_NAME, payload)
"@
}

function Get-NewCollectionPython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $helper = Get-BridgeHelperPython
    return @"
# Description: $Description

$helper


def _ask_string(title, prompt, initial_value):
    root = None
    try:
        import tkinter as tk
        from tkinter import simpledialog

        root = tk.Tk()
        root.withdraw()
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass
        return simpledialog.askstring(title, prompt, initialvalue=initial_value, parent=root)
    except Exception:
        return None
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


def run_flowcell_action(context=None, data=None):
    del context
    payload = _merge_payload({}, data)
    name = str(payload.get("name", "") or "").strip()
    if not name:
        prompted = _ask_string("New Collection", "Name for the new collection:", "Collection")
        if prompted is None:
            return {"message": "Cancelled new collection."}
        name = prompted.strip() or "Collection"
    payload["name"] = name
    bridge = _load_flowcell_bridge()
    return bridge.execute_bridge_operator("new_collection", payload)
"@
}

function Get-RenameSelectedPython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $sourcePath = Join-Path $projectRoot 'Blender Git Scripts\Collections\rename selected.py'
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Rename Selected source script was not found: $sourcePath"
    }

    $content = Get-Content -LiteralPath $sourcePath -Raw
    $content = $content -replace "`r`n", "`n"
    $content = Ensure-DescriptionComment -Content $content -Description $Description
    return $content.TrimEnd() + "`n"
}

function Get-SlicerLauncherPython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [Parameter(Mandatory = $true)]
        [string]$DisplayName,
        [Parameter(Mandatory = $true)]
        [string[]]$SearchPatterns
    )

    $helper = Get-BridgeHelperPython
    $patternBlock = @($SearchPatterns | ForEach-Object { ('    r''{0}'',' -f $_) }) -join "`n"
    return @"
# Description: $Description

$helper

import os
import subprocess


SEARCH_PATTERNS = [
$patternBlock
]


def _find_executable():
    roots = []
    for env_name in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        value = os.environ.get(env_name, "").strip()
        if value:
            roots.append(Path(value))

    seen = set()
    for root in roots:
        for pattern in SEARCH_PATTERNS:
            for candidate in root.glob(pattern):
                try:
                    candidate = candidate.resolve()
                except Exception:
                    continue
                key = str(candidate).lower()
                if key in seen:
                    continue
                seen.add(key)
                if candidate.is_file():
                    return candidate
    return None


def run_flowcell_action(context=None, data=None):
    del context
    bridge = _load_flowcell_bridge()
    result = bridge.execute_bridge_operator("save_selected_stl_to_assets", _merge_payload({}, data))
    exported_paths = [str(path) for path in result.get("exported_paths", []) if str(path).strip()]
    if not exported_paths:
        raise ValueError("STL export did not return any file paths.")

    executable = _find_executable()
    if executable is None:
        message = str(result.get("message", "Saved STL files."))
        return {"message": f"{message} Could not find $DisplayName.", "exported_paths": exported_paths}

    try:
        subprocess.Popen([str(executable), *exported_paths], cwd=str(executable.parent))
    except Exception as exc:
        message = str(result.get("message", "Saved STL files."))
        return {"message": f"{message} $DisplayName launch failed: {exc}", "exported_paths": exported_paths}

    count = len(exported_paths)
    file_label = "file" if count == 1 else "files"
    return {"message": f"Launched $DisplayName with {count} STL {file_label}.", "exported_paths": exported_paths}
"@
}

$copySourceOverridesByLabel = @{
    'theme'                    = Join-Path $projectRoot 'ManagedActions\custom_hdri_world_tools.py'
    'rotate'                   = Join-Path $projectRoot 'ManagedActions\custom_quick_rotate_group.py'
    'custom_quick_rotate_group' = Join-Path $projectRoot 'ManagedActions\custom_quick_rotate_group.py'
    'smart axis'               = Join-Path $projectRoot 'ManagedActions\custom_util_smart_axis_lock.py'
}

function Test-SmartAxisExportGroupMember {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Button
    )

    $smartAxisLeafNames = @(
        'util_smart_axis_base.ps1',
        'util_smart_axis_x.ps1',
        'util_smart_axis_y.ps1',
        'util_smart_axis_z.ps1',
        'util_smart_axis_live.ps1'
    )

    foreach ($candidatePath in @(
        [string]$(if ($Button.PSObject.Properties['Target']) { $Button.Target } else { '' }),
        [string]$(if ($Button.PSObject.Properties['ExecutionTarget']) { $Button.ExecutionTarget } else { '' })
    )) {
        if ([string]::IsNullOrWhiteSpace($candidatePath)) {
            continue
        }

        $leafName = [System.IO.Path]::GetFileName([string]$candidatePath)
        if ($smartAxisLeafNames -contains $leafName) {
            return $true
        }
    }

    return $false
}

function New-SmartAxisExportButton {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Buttons
    )

    $firstButton = @($Buttons | Select-Object -First 1)[0]
    return [pscustomobject]@{
        Id              = [string]$(if ($firstButton.PSObject.Properties['Id']) { $firstButton.Id } else { 'smart-axis-export' })
        Label           = 'smart axis'
        Tooltip         = 'Open Smart Axis controls for baseline, X/Y/Z locking, and live pinning.'
        Target          = [string]$(if ($firstButton.PSObject.Properties['Target']) { $firstButton.Target } else { '' })
        ExecutionTarget = [string]$(if ($firstButton.PSObject.Properties['ExecutionTarget']) { $firstButton.ExecutionTarget } else { '' })
    }
}

$builtInSpecsByLeafName = @{
    'org_make_layers.ps1'                    = @{ Mode = 'bridge'; Action = 'make_layers'; Data = @{} }
    'org_sort.ps1'                           = @{ Mode = 'bridge'; Action = 'sort'; Data = @{} }
    'org_sort_live.ps1'                      = @{ Mode = 'bridge'; Action = 'sort_live'; Data = @{} }
    'org_snapshot.ps1'                       = @{ Mode = 'bridge'; Action = 'snapshot'; Data = @{} }
    'org_back.ps1'                           = @{ Mode = 'bridge'; Action = 'back'; Data = @{} }
    'org_restore.ps1'                        = @{ Mode = 'bridge'; Action = 'restore'; Data = @{} }
    'org_add_to_live.ps1'                    = @{ Mode = 'bridge'; Action = 'add_to_live'; Data = @{} }
    'org_trash.ps1'                          = @{ Mode = 'bridge'; Action = 'trash'; Data = @{} }
    'org_archive.ps1'                        = @{ Mode = 'bridge'; Action = 'archive'; Data = @{} }
    'org_empty_trash.ps1'                    = @{ Mode = 'bridge'; Action = 'empty_trash'; Data = @{} }
    'org_new_collection.ps1'                 = @{ Mode = 'new_collection' }
    'org_empty_collections.ps1'              = @{ Mode = 'bridge'; Action = 'empty_collections'; Data = @{} }
    'org_cycle_collection.ps1'               = @{ Mode = 'bridge'; Action = 'cycle_collection'; Data = @{} }
    'org_cycle_versions_back.ps1'            = @{ Mode = 'bridge'; Action = 'cycle_live_versions'; Data = @{ direction = 'backward' } }
    'org_cycle_versions_forward.ps1'         = @{ Mode = 'bridge'; Action = 'cycle_live_versions'; Data = @{ direction = 'forward' } }
    'org_rename_selected_objects.ps1'        = @{ Mode = 'rename_selected' }
    'file_save_selected_stl_to_assets.ps1'   = @{ Mode = 'bridge'; Action = 'save_selected_stl_to_assets'; Data = @{} }
    'file_render_active_object_png_to_images.ps1' = @{ Mode = 'bridge'; Action = 'render_active_object_png_to_images'; Data = @{} }
    'file_cura.ps1'                          = @{ Mode = 'cura' }
    'file_orca.ps1'                          = @{ Mode = 'orca' }
    'util_cursor_center_hole.ps1'            = @{ Mode = 'bridge'; Action = 'cursor_center_hole'; Data = @{} }
    'util_alignment_tools.ps1'               = @{ Mode = 'bridge'; Action = 'alignment_tools'; Data = @{}; Notes = 'Default-action export from the inline alignment tool.' }
    'util_flatten_revolve_tools.ps1'         = @{ Mode = 'bridge'; Action = 'flatten_revolve_tools'; Data = @{}; Notes = 'Default-action export from the inline flatten/revolve tool.' }
    'util_smart_axis_base.ps1'               = @{ Mode = 'bridge'; Action = 'smart_axis_lock'; Data = @{ command = 'baseline' } }
    'util_smart_axis_x.ps1'                  = @{ Mode = 'bridge'; Action = 'smart_axis_lock'; Data = @{ command = 'cycle_x' } }
    'util_smart_axis_y.ps1'                  = @{ Mode = 'bridge'; Action = 'smart_axis_lock'; Data = @{ command = 'cycle_y' } }
    'util_smart_axis_z.ps1'                  = @{ Mode = 'bridge'; Action = 'smart_axis_lock'; Data = @{ command = 'cycle_z' } }
    'util_smart_axis_live.ps1'               = @{ Mode = 'bridge'; Action = 'smart_axis_lock'; Data = @{ command = 'toggle_live' } }
    'util_flowcell_custom_org_trash.ps1'     = @{ Mode = 'bridge'; Action = 'trash'; Data = @{} }
    'util_flowcell_custom_org_snapshot_3.ps1' = @{ Mode = 'bridge'; Action = 'snapshot'; Data = @{} }
    'util_flowcell_custom_org_snapshot_4.ps1' = @{ Mode = 'bridge'; Action = 'snapshot'; Data = @{} }
}

function Get-CopiedSourceExportSpec {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $rawContent = Get-Content -LiteralPath $SourcePath -Raw
    $normalized = $rawContent -replace "`r`n", "`n"
    if ([System.IO.Path]::GetFileName($SourcePath) -ieq 'custom_hdri_world_tools.py') {
        $normalized = Transform-HdriWorldExportSource -Content $normalized
    }
    $normalized = Ensure-DescriptionComment -Content $normalized -Description $Description
    return [pscustomobject]@{
        Content    = $normalized.TrimEnd() + "`n"
        Encoding   = 'UTF8'
        SourceKind = 'copied_source'
        SourcePath = $SourcePath
        Action     = ''
        Notes      = ''
    }
}

function Get-GeneratedExportSpec {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$BuiltInSpec,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $mode = [string]$BuiltInSpec.Mode
    $actionName = if ($BuiltInSpec.ContainsKey('Action')) { [string]$BuiltInSpec['Action'] } else { '' }
    $notes = if ($BuiltInSpec.ContainsKey('Notes')) { [string]$BuiltInSpec['Notes'] } else { '' }
    $defaultData = if ($BuiltInSpec.ContainsKey('Data') -and $BuiltInSpec['Data'] -is [hashtable]) { [hashtable]$BuiltInSpec['Data'] } else { @{} }
    $content = switch ($mode) {
        'bridge' {
            Get-GenericBridgePython -Description $Description -ActionName $actionName -DefaultData $defaultData
        }
        'new_collection' {
            Get-NewCollectionPython -Description $Description
        }
        'rename_selected' {
            Get-RenameSelectedPython -Description $Description
        }
        'cura' {
            Get-SlicerLauncherPython -Description $Description -DisplayName 'UltiMaker Cura' -SearchPatterns @(
                'UltiMaker Cura*/UltiMaker-Cura.exe',
                'Programs/UltiMaker Cura*/UltiMaker-Cura.exe'
            )
        }
        'orca' {
            Get-SlicerLauncherPython -Description $Description -DisplayName 'OrcaSlicer' -SearchPatterns @(
                'OrcaSlicer*/orca-slicer.exe',
                'Programs/OrcaSlicer*/orca-slicer.exe'
            )
        }
        default {
            throw "Unsupported export mode: $mode"
        }
    }

    return [pscustomobject]@{
        Content    = ($content.TrimEnd() + "`n")
        Encoding   = 'ASCII'
        SourceKind = 'generated_python'
        SourcePath = ''
        Action     = Get-FirstNonEmptyValue @($actionName, $mode)
        Notes      = $notes
    }
}

function Resolve-ButtonExportSpec {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Button
    )

    $label = [string]$Button.Label
    $tooltip = [string]$Button.Tooltip
    $target = if ($Button.PSObject.Properties['Target']) { [string]$Button.Target } else { '' }
    $executionTarget = if ($Button.PSObject.Properties['ExecutionTarget']) { [string]$Button.ExecutionTarget } else { '' }
    $preferredDescription = Get-FirstNonEmptyValue @($tooltip, $label)

    $overrideSourcePath = ''
    if ($copySourceOverridesByLabel.ContainsKey($label)) {
        $overrideSourcePath = [string]$copySourceOverridesByLabel[$label]
    }
    if (-not [string]::IsNullOrWhiteSpace($overrideSourcePath) -and (Test-Path -LiteralPath $overrideSourcePath -PathType Leaf)) {
        return Get-CopiedSourceExportSpec -SourcePath $overrideSourcePath -Description $preferredDescription
    }

    $existingTargets = @()
    foreach ($candidatePath in @($target, $executionTarget)) {
        if ([string]::IsNullOrWhiteSpace($candidatePath)) {
            continue
        }
        if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
            $existingTargets += [string]$candidatePath
        }
    }

    foreach ($existingTarget in @($existingTargets)) {
        if (Test-IsManagedMirrorPath -Path ([string]$existingTarget)) {
            continue
        }
        if ([System.IO.Path]::GetExtension($existingTarget) -ieq '.py' -and (Test-FlowCellPythonEntrypoint -Path $existingTarget)) {
            return Get-CopiedSourceExportSpec -SourcePath $existingTarget -Description $preferredDescription
        }
    }

    foreach ($existingTarget in @($existingTargets)) {
        if (Test-IsManagedMirrorPath -Path ([string]$existingTarget)) {
            continue
        }
        if ([System.IO.Path]::GetExtension($existingTarget) -ne '.ps1') {
            continue
        }

        $wrapperMeta = Get-WrapperMetadata -Path $existingTarget
        $leafName = [System.IO.Path]::GetFileName($existingTarget)
        if ($builtInSpecsByLeafName.ContainsKey($leafName)) {
            $description = Get-FirstNonEmptyValue @($wrapperMeta.Description, $preferredDescription)
            return Get-GeneratedExportSpec -BuiltInSpec ([hashtable]$builtInSpecsByLeafName[$leafName]) -Description $description
        }

        $sourcePythonFile = [string]$wrapperMeta.SourcePythonFile
        if (-not [string]::IsNullOrWhiteSpace($sourcePythonFile) -and (Test-Path -LiteralPath $sourcePythonFile -PathType Leaf) -and (Test-FlowCellPythonEntrypoint -Path $sourcePythonFile)) {
            $description = Get-FirstNonEmptyValue @($wrapperMeta.Description, $preferredDescription)
            return Get-CopiedSourceExportSpec -SourcePath $sourcePythonFile -Description $description
        }

        $fallbackAction = Get-FirstNonEmptyValue @($wrapperMeta.SourceBridgeAction, $wrapperMeta.Action)
        if (-not [string]::IsNullOrWhiteSpace($fallbackAction)) {
            $description = Get-FirstNonEmptyValue @($wrapperMeta.Description, $preferredDescription)
            $fallbackData = @{}
            if ($wrapperMeta.Data -is [System.Collections.IDictionary]) {
                foreach ($key in @($wrapperMeta.Data.Keys)) {
                    $fallbackData[[string]$key] = $wrapperMeta.Data[$key]
                }
            }
            if (-not [string]::IsNullOrWhiteSpace([string]$wrapperMeta.Direction)) {
                $fallbackData.direction = [string]$wrapperMeta.Direction
            }
            return Get-GeneratedExportSpec -BuiltInSpec @{
                Mode  = 'bridge'
                Action = $fallbackAction
                Data  = $fallbackData
                Notes = ''
            } -Description $description
        }
    }

    throw ('Could not resolve an Add Script source for Blender button "{0}" ({1}).' -f $label, [string]$Button.Id)
}

if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
    throw "FlowCell state file not found: $StatePath"
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$blenderProgram = @($state.Programs | Where-Object { $_.ProgramConfig.NormalizedName -eq 'blender' })[0]
if ($null -eq $blenderProgram) {
    throw "Could not find the Blender program in $StatePath"
}

$panelSequence = @($blenderProgram.Panels | Where-Object { @($_.Buttons).Count -gt 0 })
$panelFolders = @($panelSequence | ForEach-Object { Join-Path $OutputRoot ([string]$_.Name) })
$recycledPaths = New-Object System.Collections.Generic.List[string]

foreach ($panelFolder in @($panelFolders)) {
    New-Item -ItemType Directory -Path $panelFolder -Force | Out-Null
    foreach ($file in @(Get-ChildItem -LiteralPath $panelFolder -File -Recurse -ErrorAction SilentlyContinue)) {
        if (Send-FileToRecycleBin -Path $file.FullName) {
            $recycledPaths.Add($file.FullName) | Out-Null
        }
    }
}

if (Test-Path -LiteralPath $legacyManifestPath -PathType Leaf) {
    if (Send-FileToRecycleBin -Path $legacyManifestPath) {
        $recycledPaths.Add($legacyManifestPath) | Out-Null
    }
}

$manifestEntries = New-Object System.Collections.Generic.List[object]

foreach ($panel in @($panelSequence)) {
    $panelName = [string]$panel.Name
    $panelFolder = Join-Path $OutputRoot $panelName
    $labelCounts = @{}
    $smartAxisExportEmitted = $false

    foreach ($rawButton in @($panel.Buttons)) {
        $button = $rawButton
        if (Test-SmartAxisExportGroupMember -Button $rawButton) {
            if ($smartAxisExportEmitted) {
                continue
            }

            $smartAxisGroup = @($panel.Buttons | Where-Object { Test-SmartAxisExportGroupMember -Button $_ })
            $button = New-SmartAxisExportButton -Buttons $smartAxisGroup
            $smartAxisExportEmitted = $true
        }

        $label = [string]$button.Label
        if (-not $labelCounts.ContainsKey($label)) {
            $labelCounts[$label] = 0
        }
        $labelCounts[$label] = [int]$labelCounts[$label] + 1
        $occurrenceIndex = [int]$labelCounts[$label]

        $exportSpec = Resolve-ButtonExportSpec -Button $button
        $exportSpec.Content = Ensure-FlowCellChildMetadata -Content ([string]$exportSpec.Content) -Label $label
        $fileStem = Get-SafeExportStem -Label $label -OccurrenceIndex $occurrenceIndex
        $outputPath = Join-Path $panelFolder ($fileStem + '.py')
        Write-FlowCellTextFile -Path $outputPath -Value ([string]$exportSpec.Content) -Encoding ([string]$exportSpec.Encoding)

        $manifestEntries.Add([pscustomobject]@{
            panel            = $panelName
            button_id        = [string]$button.Id
            label            = $label
            tooltip          = [string]$button.Tooltip
            source_kind      = [string]$exportSpec.SourceKind
            source_path      = [string]$exportSpec.SourcePath
            action           = [string]$exportSpec.Action
            notes            = [string]$exportSpec.Notes
            export_path      = $outputPath
        }) | Out-Null
    }
}

$panelCount = @($panelSequence).Count
$buttonCount = $manifestEntries.Count
$recycledPathsArray = @($recycledPaths | ForEach-Object { [string]$_ })
$manifestEntryArray = @($manifestEntries | ForEach-Object { $_ })

$manifestPayload = [pscustomobject]@{
    exported_at          = (Get-Date).ToString('o')
    source_state_path    = $StatePath
    output_root          = $OutputRoot
    blender_panel_count  = $panelCount
    blender_button_count = $buttonCount
    recycled_paths       = $recycledPathsArray
    entries              = $manifestEntryArray
}
Write-FlowCellTextFile -Path $ManifestPath -Value ((ConvertTo-Json -InputObject $manifestPayload -Depth 8) + "`r`n") -Encoding 'UTF8'

[pscustomobject]@{
    PanelCount    = $panelCount
    ButtonCount   = $buttonCount
    OutputRoot    = $OutputRoot
    ManifestPath  = $ManifestPath
    RecycledCount = $recycledPaths.Count
} | ConvertTo-Json -Depth 4
