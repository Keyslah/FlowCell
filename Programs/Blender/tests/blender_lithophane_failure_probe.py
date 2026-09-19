"""Verify that a rejected lithophane leaves no new Blender data blocks."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import bpy


def _arguments() -> tuple[Path, Path, float]:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) < 2:
        raise ValueError("Expected source path and fully transparent PNG path.")
    return (
        Path(values[0]).expanduser().resolve(),
        Path(values[1]).expanduser().resolve(),
        float(values[2]) if len(values) > 2 else 1.0,
    )


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location("flowcell_lithophane_failure_target", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load Lithophane source: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def _counts() -> dict[str, int]:
    return {
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "textures": len(bpy.data.textures),
        "images": len(bpy.data.images),
    }


def main() -> None:
    source_path, image_path, scene_scale = _arguments()
    module = _load_module(source_path)
    _clear_scene()
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = scene_scale
    before = _counts()

    try:
        module._create_lithophane_from_path(
            bpy.context,
            str(image_path),
            module.DEFAULT_DPI,
            target_xy=(
                module._meters_to_blender_units(bpy.context, 0.05),
                module._meters_to_blender_units(bpy.context, 0.05),
            ),
        )
    except ValueError as exc:
        if "no visible pixels" not in str(exc):
            raise AssertionError(f"Unexpected rejection: {exc}") from exc
    else:
        raise AssertionError("A fully transparent PNG unexpectedly created a lithophane.")

    after = _counts()
    if after != before:
        raise AssertionError(f"Failed creation leaked Blender data: before={before}, after={after}")
    print(
        "FLOWCELL_LITHOPHANE_FAILURE_PROBE_OK "
        + json.dumps({"before": before, "after": after, "sceneScale": scene_scale}, sort_keys=True),
        flush=True,
    )


if __name__ == "__main__":
    main()
