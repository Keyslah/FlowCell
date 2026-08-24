"""Validate Blender Align centering in an isolated factory-startup process.

Usage:
    blender --background --factory-startup --python blender_alignment_probe.py
    blender --background --factory-startup --python blender_alignment_probe.py -- "C:\\path\\to\\alignment tools.py"
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ALIGN_SOURCE = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Toolsets"
    / "alignment-tools"
    / "alignment tools.py"
)


def _target_path() -> Path:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return Path(arguments[0]).expanduser().resolve() if arguments else ALIGN_SOURCE


def _load_alignment_module(path: Path):
    spec = importlib.util.spec_from_file_location("flowcell_alignment_probe_target", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load Align source: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def _new_box(name: str, location: tuple[float, float, float], size: tuple[float, float, float]):
    x, y, z = (value / 2.0 for value in size)
    vertices = [
        (-x, -y, -z),
        (x, -y, -z),
        (x, y, -z),
        (-x, y, -z),
        (-x, -y, z),
        (x, -y, z),
        (x, y, z),
        (-x, y, z),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 7, 6, 5),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (4, 0, 3, 7),
    ]
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.select_set(True)
    return obj


def _matrix_values(obj) -> tuple[float, ...]:
    return tuple(value for row in obj.matrix_world for value in row)


def _assert_vector(actual: Vector, expected: tuple[float, float, float]) -> None:
    assert all(abs(actual[index] - expected[index]) <= 1e-6 for index in range(3)), (
        tuple(actual),
        expected,
    )


def main() -> None:
    target = _target_path()
    if not target.is_file():
        raise FileNotFoundError(f"Align source not found: {target}")
    alignment = _load_alignment_module(target)

    _clear_scene()
    active = _new_box("Active Reference", (10.0, 20.0, 30.0), (4.0, 8.0, 6.0))
    mover = _new_box("Moved Object", (100.0, 70.0, 70.0), (2.0, 4.0, 8.0))
    bpy.context.view_layer.objects.active = active
    bpy.context.view_layer.update()

    active_before = _matrix_values(active)
    selected_before = sorted(obj.name for obj in bpy.context.selected_objects)
    xy_result = alignment.run_flowcell_action(bpy.context, {"command": "center_xy"})
    bpy.context.view_layer.update()

    assert xy_result["message"] == "Centered 1 object(s) on X and Y."
    _assert_vector(mover.matrix_world.translation, (10.0, 20.0, 70.0))
    assert _matrix_values(active) == active_before
    assert bpy.context.view_layer.objects.active is active
    assert sorted(obj.name for obj in bpy.context.selected_objects) == selected_before

    mover.matrix_world.translation = Vector((100.0, 70.0, 70.0))
    bpy.context.view_layer.update()
    all_result = alignment.run_flowcell_action(bpy.context, {"command": "center_everything"})
    bpy.context.view_layer.update()

    assert all_result["message"] == "Centered 1 object(s)."
    _assert_vector(mover.matrix_world.translation, (10.0, 20.0, 30.0))
    assert _matrix_values(active) == active_before
    assert bpy.context.view_layer.objects.active is active
    assert sorted(obj.name for obj in bpy.context.selected_objects) == selected_before

    status = alignment.run_flowcell_action(bpy.context, {"command": "status"})
    assert status["message"] == "Alignment tools ready."
    print(f"FLOWCELL_ALIGN_PROBE_OK target={target}", flush=True)


if __name__ == "__main__":
    main()
