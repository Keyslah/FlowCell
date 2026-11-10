"""Native physical-depth regression; use --full-resolution for the unchanged production mesh density.

blender --background --factory-startup --python this_file.py -- source.py output_folder [--full-resolution]
"""
import importlib.util
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector


args = sys.argv[sys.argv.index("--") + 1:]
source, output = Path(args[0]).resolve(), Path(args[1]).resolve()
full_resolution = "--full-resolution" in args
output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("flowcell_lithophane_depth_native", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if not full_resolution:
    module.SUBSURF_LEVELS = 2
    module.TOP_FACE_SUBDIVISION_CUTS = 4


def clear_owned_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.textures, bpy.data.images):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def save_image(name, brightness, hole=False):
    hdr = brightness < 0 or brightness > 1
    image = bpy.data.images.new(name, width=8, height=8, alpha=True, float_buffer=hdr)
    pixels = []
    for y in range(8):
        for x in range(8):
            alpha = 0.0 if hole and 2 <= x < 6 and 2 <= y < 6 else 1.0
            pixels.extend((brightness, brightness, brightness, alpha))
    image.pixels = pixels
    image.filepath_raw = str(output / (name + (".exr" if hdr else ".png")))
    image.file_format = "OPEN_EXR" if hdr else "PNG"
    image.save()
    path = image.filepath_raw
    bpy.data.images.remove(image)
    return path


cases = [(scale, shade, False, (0.8, 3.0)) for scale in (1.0, 0.001) for shade in (0.0, 1.0)]
cases += [(scale, 0.0, True, (0.8, 3.0)) for scale in (1.0, 0.001)]
cases += [(1.0, shade, False, (1.2, 4.5)) for shade in (0.0, 1.0)]
cases += [(0.001, 0.5, False, (2.0, 2.0))]
cases += [(1.0, shade, False, (0.8, 3.0)) for shade in (-1.0, 4.0)]
cases += [(scale, shade, False, (0.1, 17.0)) for scale in (1.0, 0.001) for shade in (0.0, 1.0)]
cases += [(scale, 0.5, False, (17.0, 17.0)) for scale in (1.0, 0.001)]
cases += [(scale, 0.0, True, (0.1, 17.0)) for scale in (1.0, 0.001)]
if full_resolution:
    cases = [(1.0, 1.0, True, (0.1, 17.0))]

results = []
for index, (scale, brightness, hole, thickness) in enumerate(cases):
    clear_owned_scene()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = scale
    image_path = save_image(f"depth-{index}", brightness, hole)
    data = {"image_path": image_path, "width_mm": 20, "height_mm": 10, "object_name": "QA Lithophane"}
    if thickness != (0.1, 17.0):
        data.update(min_thickness_mm=thickness[0], max_thickness_mm=thickness[1])
    result = module.run_flowcell_action(bpy.context, data)
    obj = bpy.data.objects[result["created_objects"][0]]
    dims = [float(value) * scale * 1000 for value in obj.dimensions]
    expected_depth = thickness[1] if brightness >= 1 else thickness[0]
    assert math.isclose(dims[0], 20, abs_tol=0.001), dims
    assert math.isclose(dims[1], 10, abs_tol=0.001), dims
    assert math.isclose(dims[2], expected_depth, abs_tol=0.001), (dims, expected_depth)
    assert not obj.modifiers
    assert tuple(obj.scale) == (1.0, 1.0, 1.0)
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        nonmanifold = sum(not edge.is_manifold for edge in bm.edges)
        volume = abs(bm.calc_volume()) * (scale * 1000) ** 3
    finally:
        bm.free()
    assert nonmanifold == 0 and volume > 0, (nonmanifold, volume)
    if hole:
        hit = obj.ray_cast(Vector((0, 0, 10 / scale)), Vector((0, 0, -1)))[0]
        assert not hit, "alpha hole must stay open through the solid"
        assert result["changed"] == 1
    record = {"sceneScale": scale, "brightness": brightness, "alphaHole": hole,
              "thicknessRangeMm": thickness, "dimensionsMm": dims, "nonManifoldEdges": nonmanifold,
              "volumeMm3": volume, "vertices": len(obj.data.vertices), "faces": len(obj.data.polygons)}
    results.append(record)
    print("FLOWCELL_DEPTH_CASE_PASS " + json.dumps(record), flush=True)

module.ensure_picker_operator_registered()
properties = bpy.ops.flowcell.create_lithophane_from_image.get_rna_type().properties
assert math.isclose(properties["min_thickness_mm"].default, 0.1, abs_tol=1e-6)
assert math.isclose(properties["max_thickness_mm"].default, 17.0, abs_tol=1e-6)
assert properties["min_thickness_mm"].hard_min > 0
report = {"status": "PASS", "fullResolution": full_resolution, "subsurfLevels": module.SUBSURF_LEVELS,
          "subdivisionCuts": module.TOP_FACE_SUBDIVISION_CUTS, "cases": results,
          "pickerPropertiesRegistered": True}
(output / "results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("FLOWCELL_LITHOPHANE_DEPTH_PASS " + json.dumps(report), flush=True)
