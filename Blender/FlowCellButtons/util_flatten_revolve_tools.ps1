# Description: Flattens the active mesh into a centered profile, hides the source object, and generates revolve output in place.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowcell_actions.py

# Source Action Function: perform_flowcell_flatten_revolve_tool
# Source Action Start Line: 950

# Source Action Logic:

# def perform_flowcell_flatten_revolve_tool(context: bpy.types.Context, data: dict) -> dict[str, str]:
#     command = str(data.get("command", "flatten_profile") or "flatten_profile").strip().lower()
#     if command == "probe":
#         return {"message": "Flatten revolve bridge is ready."}
# 
#     if command == "cleanup_legacy":
#         moved_count = cleanup_legacy_flatten_revolve_collections(context)
#         return {"message": f"Removed legacy FR collections and moved {moved_count} object link(s) to the active collection."}
# 
#     cleanup_legacy_flatten_revolve_collections(context)
# 
#     center_mode = str(data.get("center_mode", "GEOMETRY") or "GEOMETRY").strip().upper()
#     if center_mode not in {"GEOMETRY", "ORIGIN", "WORLD", "CURSOR", "OBJECT"}:
#         raise ValueError(f"Unsupported center mode: {center_mode}")
# 
#     if command == "flatten_profile":
#         source_obj = active_mesh_object(context)
#         flatten_axis = str(data.get("flatten_axis", "Y") or "Y").strip().upper()
#         profile_obj = create_flowcell_flatten_profile(context, source_obj, flatten_axis, center_mode)
#         return {"message": f"Created profile '{profile_obj.name}' and hid '{source_obj.name}'."}
# 
#     if command == "generate_revolve":
#         target_obj = get_flowcell_revolve_target(context, center_mode)
#         apply_flowcell_revolve(
#             context,
#             target_obj,
#             str(data.get("revolve_axis", "Z") or "Z"),
#             center_mode,
#             float(data.get("angle_deg", 360.0) or 360.0),
#             int(data.get("revolve_steps", 128) or 128),
#             float(data.get("merge_distance", 0.0001) or 0.0001),
#         )
#         return {"message": f"Revolved '{target_obj.name}' in place."}
# 
#     raise ValueError(f"Unsupported flatten revolve command: {command}")

param(
    [switch]$SelfTest,
    [string]$StatusPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($StatusPath)) {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $StatusPath = Join-Path $repoRoot 'FlowCell\local\logs\last_action_status.txt'
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

if ($SelfTest) {
    Write-Output 'Flatten revolve tools script self-test OK'
    exit 0
}

$message = 'Reload FlowCell to use the inline Flatten/Revolve utility controls.'
Write-Status $message
Write-Output $message
exit 0
