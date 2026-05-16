# Description: Import an OBJ, rotate it -90 degrees on X, scale it 10x, and apply transforms. (from Illustrator export)

# Source Bridge Action: flowtest_custom_util_import_obj_fix_transform
# Source Python Filename: flowtest_custom_util_import_obj_fix_transform.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\flowtest_custom_util_import_obj_fix_transform.py

# Source Action Function: run_flowcell_action
# Source Action Start Line: 139

# Source Action Logic:

# def run_flowcell_action(context=None, data=None):
#     if data and data.get("filepath"):
#         return perform_import_obj_fix_transform(context=context, data=data)
# 
#     ensure_picker_operator_registered()
#     bpy.ops.flowtest.import_obj_fix_transform("INVOKE_DEFAULT")
#     return _result("FINISHED", "OBJ picker opened in Blender.")

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'flowtest_custom_util_import_obj_fix_transform' -Label 'util_import_obj_fix_transform'
exit $LASTEXITCODE
