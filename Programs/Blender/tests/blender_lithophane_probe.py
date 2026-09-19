"""Validate a Lithophane source against one PNG in an isolated Blender process.

Usage:
    blender --background --factory-startup --python blender_lithophane_probe.py -- \
        <lithophane.py> <image.png> <width-mm> <height-mm> [scene-scale] [object-name]
        [expect-numeric-suffix]
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy


def _arguments() -> tuple[Path, Path, float, float, float, str | None, bool]:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) < 4:
        raise ValueError("Expected source path, PNG path, width mm, and height mm.")
    return (
        Path(values[0]).expanduser().resolve(),
        Path(values[1]).expanduser().resolve(),
        float(values[2]),
        float(values[3]),
        float(values[4]) if len(values) > 4 else 1.0,
        values[5] if len(values) > 5 else None,
        len(values) > 6 and values[6] == "expect-numeric-suffix",
    )


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location("flowcell_lithophane_probe_target", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load Lithophane source: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def _non_manifold_edge_count(obj: bpy.types.Object) -> int:
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return sum(1 for edge in bm.edges if not edge.is_manifold)
    finally:
        bm.free()


def _data_counts() -> dict[str, int]:
    return {
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "textures": len(bpy.data.textures),
        "images": len(bpy.data.images),
    }


def main() -> None:
    (
        source_path,
        image_path,
        width_mm,
        height_mm,
        scene_scale,
        object_name,
        expect_numeric_suffix,
    ) = _arguments()
    module = _load_module(source_path)

    _clear_scene()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = scene_scale
    target_xy = (
        module._meters_to_blender_units(bpy.context, width_mm / 1000.0),
        module._meters_to_blender_units(bpy.context, height_mm / 1000.0),
    )
    expected_object_name = object_name
    existing_objects = []
    if expect_numeric_suffix:
        if object_name is None:
            raise AssertionError("The numeric-suffix probe requires an object name.")
        for existing_name in (object_name, f"{object_name}1"):
            existing_mesh = bpy.data.meshes.new(name=f"{existing_name}_ExistingMesh")
            existing_object = bpy.data.objects.new(
                name=existing_name,
                object_data=existing_mesh,
            )
            bpy.context.scene.collection.objects.link(existing_object)
            existing_objects.append((existing_name, existing_object))
        expected_object_name = f"{object_name}2"

    result = module._create_lithophane_from_path(
        bpy.context,
        str(image_path),
        module.DEFAULT_DPI,
        target_xy=target_xy,
        object_name=object_name,
    )
    obj = bpy.data.objects[result["object"]]
    actual_width_mm = abs(float(obj.dimensions.x)) * scene_scale * 1000.0
    actual_height_mm = abs(float(obj.dimensions.y)) * scene_scale * 1000.0
    actual_depth_mm = abs(float(obj.dimensions.z)) * scene_scale * 1000.0
    non_manifold_edges = _non_manifold_edge_count(obj)

    if not math.isclose(actual_width_mm, width_mm, rel_tol=1e-5, abs_tol=0.001):
        raise AssertionError(f"Width mismatch: {actual_width_mm} != {width_mm}")
    if not math.isclose(actual_height_mm, height_mm, rel_tol=1e-5, abs_tol=0.001):
        raise AssertionError(f"Height mismatch: {actual_height_mm} != {height_mm}")
    if expected_object_name is not None and obj.name != expected_object_name:
        raise AssertionError(
            f"Object name mismatch: {obj.name!r} != {expected_object_name!r}"
        )
    for existing_name, existing_object in existing_objects:
        if bpy.data.objects.get(existing_name) is not existing_object:
            raise AssertionError(f"The preexisting {existing_name!r} object was changed.")
    if tuple(round(float(value), 7) for value in obj.scale) != (1.0, 1.0, 1.0):
        raise AssertionError(f"Object scale was not applied: {tuple(obj.scale)}")
    if obj.modifiers:
        raise AssertionError(f"Lithophane retained modifiers: {[modifier.name for modifier in obj.modifiers]}")
    if non_manifold_edges:
        raise AssertionError(f"Lithophane contains {non_manifold_edges} non-manifold edge(s).")

    if expect_numeric_suffix:
        print(
            "FLOWCELL_LITHOPHANE_NUMERIC_SUFFIX_PROBE_OK "
            + json.dumps(
                {
                    "requested": object_name,
                    "created": obj.name,
                    "preserved": [name for name, _item in existing_objects],
                },
                sort_keys=True,
            ),
            flush=True,
        )

    print(
        "FLOWCELL_LITHOPHANE_PROBE_OK "
        + json.dumps(
            {
                "object": obj.name,
                "widthMm": actual_width_mm,
                "heightMm": actual_height_mm,
                "depthMm": actual_depth_mm,
                "vertices": len(obj.data.vertices),
                "faces": len(obj.data.polygons),
                "nonManifoldEdges": non_manifold_edges,
                "removedAlphaFaces": result.get("removed_alpha_faces", 0),
                "sceneScale": scene_scale,
            },
            sort_keys=True,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
