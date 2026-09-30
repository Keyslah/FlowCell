"""Exercise the real STL export path in factory-startup Blender, never the live scene."""
import runpy
import struct
import sys
import tempfile
from pathlib import Path

import bpy

root = Path(__file__).resolve().parent.parent
addon = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else root / "Blender Addons - Copy contents Into Blender"
sys.path.insert(0, str(addon))
import flowcell_actions as actions

triangle = runpy.run_path(str(root / "Blender Git Scripts/Shapes/Triangle.py"))["run_flowcell_action"]
cases = 0
with tempfile.TemporaryDirectory(prefix="flowcell-triangle-export-") as folder:
    actions.get_assets_3d_directory_from_current_file = lambda: Path(folder)
    for unit_scale in (1.0, 0.001):
        for hidden_from_render in (False, True):
            for obj in list(bpy.data.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.context.scene.unit_settings.scale_length = unit_scale
            triangle()
            obj = bpy.context.object
            obj.hide_render = hidden_from_render
            bpy.ops.object.mode_set(mode="EDIT")
            result = actions.perform_save_selected_stl_to_assets_result(bpy.context)
            payload = Path(result["exported_paths"][0]).read_bytes()
            facets = struct.unpack_from("<I", payload, 80)[0]
            assert facets == 8 and len(payload) == 84 + 50 * facets, (hidden_from_render, facets)
            vertices = [struct.unpack_from("<3f", payload, 84 + i * 50 + 12 + j * 12)
                        for i in range(facets) for j in range(3)]
            height = max(v[2] for v in vertices) - min(v[2] for v in vertices)
            assert abs(height - 4.0) < 1e-4, height
            assert bpy.context.object is obj and obj.mode == "EDIT" and obj.select_get()
            assert obj.hide_render is hidden_from_render
            bpy.ops.object.mode_set(mode="OBJECT")
            cases += 1

    # Render-hidden collections must also retain printable viewport geometry.
    obj.users_collection[0].hide_render = True
    result = actions.perform_save_selected_stl_to_assets_result(bpy.context)
    assert struct.unpack_from("<I", Path(result["exported_paths"][0]).read_bytes(), 80)[0] == 8
    cases += 1

    # A genuinely empty evaluated mesh must fail before Orca receives a path.
    obj.data.clear_geometry()
    try:
        actions.perform_save_selected_stl_to_assets_result(bpy.context)
        raise AssertionError("Empty STL was accepted")
    except ValueError as error:
        assert "contains no triangles" in str(error), error
    assert bpy.context.object is obj and obj.select_get()
    cases += 1

print(f"TRIANGLE_EXPORT_PROBE_OK: {cases} cases")
