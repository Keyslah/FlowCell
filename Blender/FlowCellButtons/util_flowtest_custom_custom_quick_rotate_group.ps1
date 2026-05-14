# Description: Run custom_quick_rotate_group through the FlowTest Blender bridge.

# Source Bridge Action: flowtest_custom_custom_quick_rotate_group
# Source Python Filename: flowtest_custom_custom_quick_rotate_group.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_custom_quick_rotate_group.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 187

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     context = _ctx(context)
#     payload = data or {}
#     command = str(payload.get("command", "apply") or "apply").strip().lower()
#     if command != "apply":
#         raise ValueError(f"Unsupported quick rotate command: {command}")
# 
#     objects = _selected_objects(context)
#     if not objects:
#         raise ValueError("Select at least one object.")
# 
#     axis = str(payload.get("axis", "Z") or "Z").strip().upper()
#     center_mode = str(payload.get("center_mode", "WORLD") or "WORLD").strip().upper()
#     operation_mode = (
#         str(payload.get("operation_mode", "TRANSFORM") or "TRANSFORM").strip().upper()
#     )
#     angle_deg = float(payload.get("angle_deg", 15.0) or 15.0)
#     distribute_count = max(1, int(round(float(payload.get("distribute_count", 3) or 3))))
# 
#     if operation_mode not in SUPPORTED_OPERATION_MODES:
#         raise ValueError(f"Unsupported operation mode: {operation_mode}")
# 
#     pivot = _pivot_point(context, objects, center_mode)
#     if operation_mode == "DISTRIBUTE":
#         full_turn = 360.0 if angle_deg >= 0 else -360.0
#         return _perform_distribute(context, objects, pivot, axis, full_turn, distribute_count)
#     return _perform_transform(context, objects, pivot, axis, angle_deg)

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_custom_quick_rotate_group' -Label 'custom_quick_rotate_group'
exit $LASTEXITCODE
