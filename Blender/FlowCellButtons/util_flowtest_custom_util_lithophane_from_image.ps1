# Description: Pick one or more images in Blender, create DPI-sized planes, and turn them into lithophanes automatically.


# Source Bridge Action: flowtest_custom_util_lithophane_from_image
# Source Python Filename: flowtest_custom_util_lithophane_from_image.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_lithophane_from_image.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 323

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     if isinstance(data, dict) and (data.get("image_path") or data.get("image_paths")):
#         return perform_create_lithophane_from_images(context=context, data=data)
# 
#     ensure_picker_operator_registered()
#     bpy.ops.flowtest.create_lithophane_from_image("INVOKE_DEFAULT")
#     return _result("FINISHED", "Lithophane image picker opened in Blender.")

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_lithophane_from_image' -Label 'util_lithophane_from_image'
exit $LASTEXITCODE
