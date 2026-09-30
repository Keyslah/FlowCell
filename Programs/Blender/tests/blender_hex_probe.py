"""Run in factory-startup Blender, passing Hex.py after --."""
from pathlib import Path
import runpy
import sys

import bpy

namespace = runpy.run_path(str(Path(sys.argv[sys.argv.index("--") + 1])))
action = namespace["run_flowcell_action"]
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

for expected in ("Hexagon", "Hexagon1", "Hexagon2"):
    result = action()
    obj = bpy.context.active_object
    assert result["object_name"] == obj.name == expected
    assert result["sides"] == 6
    assert len(obj.data.vertices) == 12 and len(obj.data.polygons) == 8
    assert abs(obj.dimensions.z - 0.004) < 1e-6

for sides in (3, 4, 7, 12, 100):
    result = action(data={"sides": sides})
    assert result["object_name"] == f"{sides}-Sided Polygon"
    assert len(bpy.context.object.data.vertices) == sides * 2
    assert len(bpy.context.object.data.polygons) == sides + 2

for invalid in (2, 0, -1, True, 3.5, "6", 10001):
    before = len(bpy.data.objects)
    try:
        action(data={"sides": invalid})
    except ValueError:
        pass
    else:
        raise AssertionError(f"Accepted invalid sides: {invalid!r}")
    assert len(bpy.data.objects) == before

# Verify dispatch without trying to open an interactive dialog in background mode.
calls = []
original_prompt = action.__globals__["prompt_for_sides"]
action.__globals__["prompt_for_sides"] = lambda: calls.append(True) or {"changed": 0}
for key in ("shift",):
    before = len(bpy.data.objects)
    assert action(data={"modifiers": {key: True}})["changed"] == 0
    assert len(bpy.data.objects) == before
assert len(calls) == 1
for key in ("ctrl", "alt", "meta"):
    assert action(data={"modifiers": {key: True}})["sides"] == 6
assert len(calls) == 1
assert action(data={"modifiers": {"shift": False, "ctrl": False, "alt": False, "meta": False}})["sides"] == 6
action.__globals__["prompt_for_sides"] = original_prompt

operator = namespace["FLOWCELL_OT_hex_sides"]
bpy.utils.register_class(operator)
properties = bpy.ops.flowcell.hex_sides.get_rna_type().properties
assert properties["sides"].default == 6
assert properties["sides"].hard_min == 3
assert bpy.ops.flowcell.hex_sides("EXEC_DEFAULT", sides=9) == {"FINISHED"}
assert bpy.context.object.name == "9-Sided Polygon"
operator._prompt_active = True
before = len(bpy.data.objects)
assert original_prompt()["status"] == "CANCELLED"
class CancelProbe:
    _prompt_active = True

operator.cancel(CancelProbe(), bpy.context)
assert not CancelProbe._prompt_active and len(bpy.data.objects) == before
operator._prompt_active = False
bpy.utils.unregister_class(operator)
print("HEX_PROBE_OK: geometry, names, validation, all modifiers, operator confirmation and cancellation")
