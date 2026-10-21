"""Factory-startup probe; pass Illustrator geometry-request.json and geometry-areas.json after --."""
import json
import math
from pathlib import Path
import runpy
import sys

import bpy
import bmesh
from mathutils import Vector

bpy.ops.preferences.addon_enable(module="io_curve_svg")
source = Path(__file__).resolve().parents[1] / "Blender Git Scripts/Files/Import Illustrator SVG/import illustrator svg.py"
action = runpy.run_path(str(source))["run_flowcell_action"]
arguments = sys.argv[sys.argv.index("--") + 1:]
request = json.loads(Path(arguments[0]).read_text(encoding="utf-8-sig"))
areas = json.loads(Path(arguments[1]).read_text(encoding="utf-8-sig"))

for scale in (1.0, 0.001):
    bpy.context.scene.unit_settings.scale_length = scale
    for item in request["items"]:
        fixture_name = item["layerName"]
        item = {**item, "layerName": f"3 {fixture_name}", "extrudeMm": 999}
        before = set(bpy.data.objects)
        action(data={"items": [item]})
        obj, = set(bpy.data.objects) - before
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.transform(obj.matrix_world)
        assert all(edge.is_manifold for edge in bm.edges), item["layerName"]
        volume_mm3 = abs(bm.calc_volume()) * (scale * 1000) ** 3
        expected = areas[fixture_name] * (25.4 / 72) ** 2 * 3
        assert math.isclose(volume_mm3, expected, rel_tol=2e-4), (item["layerName"], volume_mm3, expected)
        assert math.isclose(obj.dimensions.z * scale * 1000, 3, rel_tol=1e-5)
        bm.free()
        # A vertical ray through the original hole must miss the actual finished
        # mesh, except in the solid-overlap fixture. Avoid the center island.
        sample_x_pt, sample_y_pt = 35, 50
        width_pt = item["widthMm"] / (25.4 / 72)
        height_pt = item["heightMm"] / (25.4 / 72)
        x_mm = (sample_x_pt - width_pt / 2) * (25.4 / 72) + item["offsetXmm"]
        y_mm = (sample_y_pt - height_pt / 2) * (25.4 / 72) + item["offsetYmm"]
        world_origin = Vector((x_mm / (scale*1000), y_mm / (scale*1000), 10 / (scale*1000)))
        origin = obj.matrix_world.inverted() @ world_origin
        direction = obj.matrix_world.to_3x3().inverted() @ Vector((0, 0, -1))
        hit = obj.ray_cast(origin, direction)[0]
        assert hit == (fixture_name == "overlapping-solids"), (item["layerName"], "hole filled", hit)
        print(f"SVG_GEOMETRY_OK {item['layerName']} scale={scale} volume_mm3={volume_mm3:.6f}")
print("BLENDER_SVG_GEOMETRY_PROBE_OK")
