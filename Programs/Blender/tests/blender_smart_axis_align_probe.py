"""Verify Smart Axis and Align together in disposable factory-startup Blender.

Optional arguments after ``--``: addon directory, Align script, Smart Axis script.
Never run this probe in an existing Blender scene: it replaces the factory data.
"""
import math
from pathlib import Path
import runpy
import sys

import bpy
from mathutils import Vector


root = Path(__file__).resolve().parents[1]
arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
addon = Path(arguments[0]) if arguments else root / "Blender Addons - Copy contents Into Blender"
align_path = (Path(arguments[1]) if len(arguments) > 1 else
              root / "Blender Git Scripts/Toolsets/alignment-tools/alignment tools.py")
smart_path = (Path(arguments[2]) if len(arguments) > 2 else
              root / "Blender Git Scripts/Toolsets/smart-axis/smart axis.py")
sys.path.insert(0, str(addon))

import flowcell_actions as actions
import flowcell_bridge as bridge


smart = runpy.run_path(str(smart_path))
bpy.context.preferences.edit.use_global_undo = True
bpy.utils.register_class(actions.OBJECT_OT_flowcell_bridge_undoable_action)
actions.load_custom_actions_registry = lambda: [{
    "action": "probe_align",
    "pythonPath": str(align_path),
    "functionName": "run_flowcell_action",
}]
# Do not write runtime status for this disposable process.
bridge._write_runtime_status = lambda *args, **kwargs: None
TOLERANCE = 3e-5
checks = 0


def close(actual, expected, label):
    global checks
    assert abs(float(actual) - float(expected)) <= TOLERANCE, (label, actual, expected)
    checks += 1


def select(objects, active):
    for obj in bpy.context.view_layer.objects:
        obj.select_set(obj in objects)
    bpy.context.view_layer.objects.active = active
    bpy.context.view_layer.update()


def bounds(obj):
    bpy.context.view_layer.update()
    return bridge._smart_axis_world_bounds(obj, bpy.context)


def tick():
    entry = bridge.LIVE_TOOL_REGISTRY["smart_axis_lock"]
    entry["tick_fn"](bpy.context, entry)
    bpy.context.view_layer.update()
    assert bridge.is_live_tool_enabled("smart_axis_lock")


def property_value(value):
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    if hasattr(value, "keys"):
        return {key: property_value(value[key]) for key in value.keys()}
    return tuple(property_value(item) for item in value)


def assert_value(actual, expected, label):
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys(), label
        for key in expected:
            assert_value(actual[key], expected[key], (label, key))
    elif isinstance(expected, tuple):
        assert len(actual) == len(expected), label
        for index, value in enumerate(expected):
            assert_value(actual[index], value, (label, index))
    elif isinstance(expected, (int, float)):
        close(actual, expected, label)
    else:
        assert actual == expected, (label, actual, expected)


def state():
    bpy.context.view_layer.update()
    return {
        obj.name: {
            "matrix": tuple(value for row in obj.matrix_world for value in row),
            "props": {key: property_value(obj[key]) for key in obj.keys()},
            "selected": obj.select_get(),
        }
        for obj in bpy.data.objects
    }


def assert_state(expected, label):
    actual = state()
    assert actual.keys() == expected.keys(), label
    for name, previous in expected.items():
        current = actual[name]
        assert current["selected"] == previous["selected"], (label, name, "selection")
        assert current["props"].keys() == previous["props"].keys(), (label, name, "properties")
        for index, value in enumerate(previous["matrix"]):
            close(current["matrix"][index], value, (label, name, "matrix", index))
        assert_value(current["props"], previous["props"], (label, name, "properties"))
    assert bpy.context.view_layer.objects.active.name == "Anchor", (label, "active anchor")


def setup(engine, parented=False):
    bridge.cleanup_live_tools(clear_registry=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for key in list(bpy.context.scene.keys()):
        if key.startswith("_flowcell_smart_axis_"):
            del bpy.context.scene[key]

    bpy.ops.mesh.primitive_cube_add(size=2, location=(5, 6, 2))
    mover = bpy.context.object
    mover.name = "Mover"
    if parented:
        parent = bpy.data.objects.new("Parent", None)
        bpy.context.collection.objects.link(parent)
        parent.rotation_euler = (0, math.radians(35), math.radians(20))
        parent.scale = (1.2, 0.8, 1.6)
        mover.parent = parent

    bpy.ops.mesh.primitive_cube_add(size=2, location=(10, 20, 30))
    anchor = bpy.context.object
    anchor.name = "Anchor"
    select([mover], mover)

    def command(name):
        if engine == "package":
            result = smart["run_flowcell_action"](bpy.context, {"command": name})
        else:
            result = bridge.execute_smart_axis_lock_command(bpy.context, {"command": name})
        # Explicit ticks make this probe independent of elapsed wall-clock time.
        bridge._stop_live_tool_timer()
        return result

    command("baseline")
    command("cycle_z")
    command("toggle_live")
    assert bridge.is_live_tool_enabled("smart_axis_lock")
    return mover, anchor, command


def checked_action(payload, label, undo=False):
    global undo_redo_cycles
    if undo:
        bpy.ops.ed.undo_push(message="Smart Axis additional regression baseline")
    before = state()
    result = actions.execute_bridge_operator("probe_align", payload)
    assert result.get("status", "ok") == "ok", result
    after = state()
    tick()
    assert_state(after, (label, "tick"))
    if undo and after != before:
        assert bpy.ops.ed.undo() == {"FINISHED"}, label
        tick()
        assert_state(before, (label, "Undo"))
        assert bpy.ops.ed.redo() == {"FINISHED"}, label
        tick()
        assert_state(after, (label, "Redo"))
        undo_redo_cycles += 1
    return result


def expect_conflict(payload, message_part, label):
    before = state()
    try:
        actions.execute_bridge_operator("probe_align", payload)
    except Exception as exc:
        message = str(exc)
        assert "Smart Axis conflict" in message and message_part in message, (label, message)
    else:
        raise AssertionError((label, "expected a conflict"))
    assert_state(before, (label, "conflict must not mutate objects"))


def checked_surface(label, *, axis="Z", group=False, report=True):
    global surface_operations
    result = checked_action({"command": f"{axis.lower()}_surface", "group": group}, label, undo=True)
    message = str(result.get("message", ""))
    if report:
        assert axis in message and "locked" in message.lower() and "cannot" in message.lower(), (label, message)
    else:
        assert "Surface used the free side" not in message, (label, message)
    surface_operations += 1
    return result


compatible_cases = 0
pending_cases = 0
undo_redo_cycles = 0
signed_cases = 0
signed_operations = 0
additional_cases = 0
surface_cases = 0
surface_operations = 0
try:
    for engine in ("package", "builtin"):
        for parented in (False, True):
            for align_command in ("x_center", "center_xy"):
                label = (engine, parented, align_command)
                mover, anchor, command = setup(engine, parented)
                reference = float(mover["_Z_min_ref"])
                select([mover, anchor], anchor)
                tick()
                bpy.ops.ed.undo_push(message="Smart Axis Align baseline")
                before = state()
                result = actions.execute_bridge_operator("probe_align", {"command": align_command})
                assert result.get("status", "ok") == "ok", result
                after_align = state()
                assert after_align != before, (label, "Align did not move")
                tick()
                assert_state(after_align, (label, "tick after Align"))
                mover = bpy.data.objects["Mover"]
                close(bounds(mover)[0].z, reference, (label, "baseline after Align"))
                close(mover.matrix_world.translation.x, 10, (label, "aligned X"))
                if align_command == "center_xy":
                    close(mover.matrix_world.translation.y, 20, (label, "aligned Y"))

                assert bpy.ops.ed.undo() == {"FINISHED"}, (label, "Undo")
                tick()
                assert_state(before, (label, "Undo and tick"))
                assert bpy.ops.ed.redo() == {"FINISHED"}, (label, "Redo")
                tick()
                assert_state(after_align, (label, "Redo and tick"))
                undo_redo_cycles += 1

                mover = bpy.data.objects["Mover"]
                aligned_xy = tuple(mover.matrix_world.translation[:2])
                mover.scale.z *= 1.6
                bpy.context.view_layer.update()
                tick()
                close(bounds(mover)[0].z, reference, (label, "baseline after scale"))
                for index in (0, 1):
                    close(mover.matrix_world.translation[index], aligned_xy[index],
                          (label, "pin must not shift world XY", index))
                compatible_cases += 1

        for scenario in ("status_before_tick", "new_anchor_before_tick", "new_anchor_align_before_tick"):
            label = (engine, scenario)
            mover, anchor, command = setup(engine)
            reference = float(mover["_Z_min_ref"])
            mover.scale.z = 1.6
            bpy.context.view_layer.update()
            if scenario == "status_before_tick":
                command("status")
            else:
                select([mover, anchor], anchor)
                if scenario == "new_anchor_align_before_tick":
                    actions.execute_bridge_operator("probe_align", {"command": "x_center"})
            tick()
            close(bounds(mover)[0].z, reference, (label, "pending scale pin"))
            close(mover["_Z_min_ref"], reference, (label, "baseline unchanged"))
            close(mover["_sz"], mover.scale.z, (label, "scale tracking"))
            if scenario == "new_anchor_align_before_tick":
                close(mover.matrix_world.translation.x, 10, (label, "aligned X retained"))
            pending_cases += 1

        for locked_side in ("MIN", "MAX"):
            direction = 1 if locked_side == "MIN" else -1
            for feature in ("EDGE", "CENTER", "ORIGIN"):
                label = (engine, locked_side, feature)
                mover, anchor, command = setup(engine)
                geometry_offset = direction * 0.4 if feature == "ORIGIN" else 0.0
                for vertex in mover.data.vertices:
                    vertex.co.z += geometry_offset
                base_local_z = -direction + geometry_offset
                far_local_z = direction + geometry_offset
                mover.location.z = -base_local_z
                bpy.context.view_layer.update()
                command("baseline")
                if locked_side == "MAX":
                    command("cycle_z")
                select([mover, anchor], anchor)
                tick()
                pin_reference = float(mover[f"_Z_{locked_side.lower()}_ref"])
                close(pin_reference, 0, (label, "fixed plane"))

                # Track original material endpoints: reflection swaps sorted bounds.
                def material_z(obj, coordinate):
                    bpy.context.view_layer.update()
                    return float((obj.matrix_world @ Vector((0, 0, coordinate))).z)

                for target_distance in (5, 0, 0, -3, 2):
                    mover = bpy.data.objects["Mover"]
                    anchor = bpy.data.objects["Anchor"]
                    target = direction * target_distance
                    anchor.location.z = target - direction if feature == "EDGE" else target
                    bpy.context.view_layer.update()
                    payload = {"command": ("z_max" if locked_side == "MIN" else "z_min")
                               if feature == "EDGE" else "z_center",
                               "modifiers": {"alt": feature == "ORIGIN"}}
                    bpy.ops.ed.undo_push(message="Smart Axis signed Align target")
                    before = state()
                    result = actions.execute_bridge_operator("probe_align", payload)
                    assert result.get("status", "ok") == "ok", result
                    after_align = state()
                    tick()
                    assert_state(after_align, (label, target, "tick after signed Align"))
                    mover = bpy.data.objects["Mover"]
                    close(material_z(mover, base_local_z), 0, (label, target, "material base"))
                    expected_far = target if feature == "EDGE" else target * (2 if feature == "CENTER" else 1 / 0.3)
                    close(material_z(mover, far_local_z), expected_far,
                          (label, target, "material opposite endpoint"))
                    close(mover[f"_Z_{locked_side.lower()}_ref"], 0, (label, target, "saved pin"))
                    if feature == "ORIGIN":
                        close(mover.matrix_world.translation.z, target, (label, target, "origin target"))

                    if after_align != before:
                        assert bpy.ops.ed.undo() == {"FINISHED"}, (label, target, "Undo")
                        tick()
                        assert_state(before, (label, target, "signed Undo and tick"))
                        assert bpy.ops.ed.redo() == {"FINISHED"}, (label, target, "Redo")
                        tick()
                        assert_state(after_align, (label, target, "signed Redo and tick"))
                        undo_redo_cycles += 1
                    signed_operations += 1

                    # Further ordinary scaling must keep the same material base,
                    # including while the stretched object is on the opposite side.
                    if target_distance:
                        mover = bpy.data.objects["Mover"]
                        mover.scale.z *= 1.25
                        bpy.context.view_layer.update()
                        tick()
                        close(material_z(mover, base_local_z), 0, (label, target, "base after further scale"))
                        close(material_z(mover, far_local_z), expected_far * 1.25,
                              (label, target, "opposite endpoint after further scale"))
                signed_cases += 1

    # A later object whose origin is its fixed base cannot partially apply an
    # earlier object's valid stretch before reporting the conflict.
    mover, anchor, command = setup("package")
    mover.location.z = 1
    bpy.ops.mesh.primitive_cube_add(size=2, location=(9, 6, 0))
    other = bpy.context.object
    other.name = "Other"
    for vertex in other.data.vertices:
        vertex.co.z += 1
    select([mover, other], mover)
    command("baseline")
    select([mover, other, anchor], anchor)
    tick()
    expect_conflict({"command": "z_center", "modifiers": {"alt": True}},
                    "chosen point is locked", "later origin fixed at pin")
    additional_cases += 1

    # All three saved nonzero rows must survive simultaneous collapse and undo.
    mover, anchor, command = setup("package")
    mover.location = (1, 1, 1)
    bpy.context.view_layer.update()
    command("baseline")
    command("cycle_x")
    command("cycle_y")
    select([mover, anchor], anchor)
    tick()
    for target in ((3, 4, 5), (0, 0, 0), (-2, 3, -4)):
        anchor = bpy.data.objects["Anchor"]
        anchor.location = target
        bpy.context.view_layer.update()
        checked_action({"command": "center_everything"}, ("All XYZ pinned", target), undo=True)
        mover = bpy.data.objects["Mover"]
        base = mover.matrix_world @ Vector((-1, -1, -1))
        far = mover.matrix_world @ Vector((1, 1, 1))
        for index in range(3):
            close(base[index], 0, ("All fixed material corner", target, index))
            close(far[index], target[index] * 2, ("All target material corner", target, index))
    additional_cases += 1

    mover, anchor, command = setup("package")
    reference = float(mover["_Z_min_ref"])
    select([mover, anchor], anchor)
    tick()
    checked_action({"command": "center_xy"}, "XY free axes", undo=True)
    checked_action({"command": "center_everything"}, "All mixes XY translation and Z stretch", undo=True)
    mover = bpy.data.objects["Mover"]
    for index, expected in enumerate((10, 20, 30)):
        close(mover.matrix_world.translation[index], expected, ("mixed All center", index))
    close(bounds(mover)[0].z, reference, "mixed All fixed base")
    additional_cases += 1

    # Group scaling keeps both original bases fixed and snaps the shared center.
    for mismatch in (False, True):
        mover, anchor, command = setup("package")
        mover.location.z = 1
        bpy.ops.mesh.primitive_cube_add(size=4, location=(9, 6, 3 if mismatch else 2))
        other = bpy.context.object
        other.name = "Other"
        select([mover, other], mover)
        command("baseline")
        select([mover, other, anchor], anchor)
        tick()
        if mismatch:
            expect_conflict({"command": "z_center", "group": True},
                            "different locked baselines", "Group different bases")
        else:
            for target in (3, 0, -2):
                anchor = bpy.data.objects["Anchor"]
                anchor.location.z = target
                bpy.context.view_layer.update()
                checked_action({"command": "z_center", "group": True}, ("Group", target), undo=True)
                mover, other = bpy.data.objects["Mover"], bpy.data.objects["Other"]
                lo_a, hi_a = bounds(mover)
                lo_b, hi_b = bounds(other)
                close((min(lo_a.z, lo_b.z) + max(hi_a.z, hi_b.z)) / 2, target,
                      ("Group combined center", target))
                close((mover.matrix_world @ Vector((0, 0, -1))).z, 0, ("Group mover base", target))
                close((other.matrix_world @ Vector((0, 0, -2))).z, 0, ("Group other base", target))
        additional_cases += 1

    mover, anchor, command = setup("package")
    original_scale = tuple(mover.scale)
    reference = float(mover["_Z_min_ref"])
    command("toggle_live")
    select([mover, anchor], anchor)
    result = actions.execute_bridge_operator("probe_align", {"command": "z_center"})
    assert result.get("status", "ok") == "ok", result
    bpy.context.view_layer.update()
    assert not bridge.is_live_tool_enabled("smart_axis_lock")
    close(mover.matrix_world.translation.z, 30, "Live OFF translates")
    close(mover["_Z_min_ref"], reference, "Live OFF keeps baseline")
    for index in range(3):
        close(mover.scale[index], original_scale[index], ("Live OFF does not scale", index))
    additional_cases += 1

    mover, anchor, command = setup("package")
    reference = float(mover["_Z_min_ref"])
    select([mover, anchor], anchor)
    tick()
    anchor.location.z = reference - 1
    bpy.context.view_layer.update()
    checked_action({"command": "z_max"}, "collapse before fixed-side no-op", undo=True)
    mover, anchor = bpy.data.objects["Mover"], bpy.data.objects["Anchor"]
    anchor.location.z = reference + 1
    bpy.context.view_layer.update()
    before = state()
    checked_action({"command": "z_min"}, "zero fixed-side already at pin")
    assert_state(before, "zero fixed-side no-op must not expand")
    additional_cases += 1

    mover, anchor = bpy.data.objects["Mover"], bpy.data.objects["Anchor"]
    select([mover], mover)
    command("baseline")
    assert mover.get(bridge._smart_axis_key("stretch_z")) is None, "Baseline must clear previous stretch basis"
    select([mover, anchor], anchor)
    tick()
    anchor.location.z = reference + 4
    bpy.context.view_layer.update()
    expect_conflict({"command": "z_center"}, "no nonzero", "reset collapsed baseline has no old shape")
    additional_cases += 1

    # Pin a pending scale on the active reference before deriving the Align target.
    mover, anchor, command = setup("package")
    select([mover, anchor], anchor)
    command("baseline")
    tick()
    anchor_reference = float(anchor["_Z_min_ref"])
    anchor.scale.z = 2
    bpy.context.view_layer.update()
    active_before = tuple(value for row in anchor.matrix_world for value in row)
    result = actions.execute_bridge_operator("probe_align", {"command": "z_max"})
    assert result.get("status", "ok") == "ok", result
    after_align = state()
    assert_value(after_align["Anchor"]["matrix"], active_before, "Align leaves pending active anchor fixed")
    tick()
    assert_value(state()["Mover"], after_align["Mover"], "pending anchor tick must not change mover")
    close(bounds(anchor)[0].z, anchor_reference, "active anchor pending pin settled")
    close(bounds(mover)[1].z, bounds(anchor)[1].z, "Align targets settled active anchor")
    additional_cases += 1

    # An already collapsed member stays collapsed when its group is centered,
    # then collapsed together and recovered from the group's saved proportions.
    mover, anchor, command = setup("package")
    mover.location.z = 1
    bpy.ops.mesh.primitive_cube_add(size=4, location=(9, 6, 2))
    other = bpy.context.object
    other.name = "Other"
    select([mover, other], mover)
    command("baseline")
    select([mover, anchor], anchor)
    tick()
    anchor.location.z = -1
    bpy.context.view_layer.update()
    checked_action({"command": "z_max"}, "collapse one member before Group")
    select([mover, other, anchor], anchor)
    tick()
    for target in (2, 0, 3):
        anchor = bpy.data.objects["Anchor"]
        anchor.location.z = target
        bpy.context.view_layer.update()
        checked_action({"command": "z_center", "group": True}, ("partly zero Group", target), undo=True)
        mover, other = bpy.data.objects["Mover"], bpy.data.objects["Other"]
        close(bounds(mover)[0].z, 0, ("zero group member base", target))
        close(bounds(mover)[1].z, 0, ("zero group member stays collapsed", target))
        close((other.matrix_world @ Vector((0, 0, -2))).z, 0, ("nonzero group member base", target))
        close((other.matrix_world @ Vector((0, 0, 2))).z, target * 2,
              ("nonzero group member controls center", target))
    additional_cases += 1

    for transform_case in ("rotated_z", "parent_aligned_z", "delta_transforms"):
        mover, anchor, command = setup("package")
        mover.rotation_euler.z = math.radians(27)
        if transform_case == "parent_aligned_z":
            parent = bpy.data.objects.new("Parent", None)
            bpy.context.collection.objects.link(parent)
            parent.rotation_euler.z = math.radians(19)
            parent.scale = (1.2, 0.8, 1.6)
            parent.location = (2, -3, 0.7)
            mover.parent = parent
        elif transform_case == "delta_transforms":
            mover.delta_location = (2, -3, 0.7)
            mover.delta_rotation_euler.z = math.radians(19)
            mover.delta_scale = (1.2, 0.8, 1.4)
        bpy.context.view_layer.update()
        command("baseline")
        reference = float(mover["_Z_min_ref"])
        unchanged_xy = tuple(tuple(mover.matrix_world[index]) for index in (0, 1))
        unchanged_rotation = tuple(mover.rotation_euler)
        unchanged_delta = (tuple(mover.delta_location), tuple(mover.delta_rotation_euler), tuple(mover.delta_scale))
        select([mover, anchor], anchor)
        tick()
        for target in (reference + 4, reference, reference - 3):
            anchor = bpy.data.objects["Anchor"]
            anchor.location.z = target
            bpy.context.view_layer.update()
            checked_action({"command": "z_center"}, (transform_case, target), undo=True)
            mover = bpy.data.objects["Mover"]
            close((mover.matrix_world @ Vector((0, 0, -1))).z, reference,
                  (transform_case, target, "material base"))
            close(mover.matrix_world.translation.z, target, (transform_case, target, "exact center"))
            assert_value(tuple(tuple(mover.matrix_world[index]) for index in (0, 1)), unchanged_xy,
                         (transform_case, target, "world XY rows"))
            assert_value(tuple(mover.rotation_euler), unchanged_rotation, (transform_case, target, "rotation"))
            assert_value((tuple(mover.delta_location), tuple(mover.delta_rotation_euler), tuple(mover.delta_scale)),
                         unchanged_delta, (transform_case, target, "delta transforms"))
        additional_cases += 1

    mover, anchor, command = setup("package")
    mover.rotation_euler.y = math.radians(31)
    bpy.context.view_layer.update()
    command("baseline")
    select([mover, anchor], anchor)
    tick()
    expect_conflict({"command": "z_center"}, "shear", "world Z stretch would shear rotated object")
    additional_cases += 1

    # Surface keeps its two opposing source/target pairs. A pinned source cannot
    # move to the other reference face, so use the reachable free-source pair.
    for locked_side, fixed, expected_endpoints in (
        ("MIN", 0, (4, 4, 4)),
        ("MIN", 10, (4, 6, 6)),
        ("MAX", 0, (6, 4, 4)),
        ("MAX", 10, (6, 6, 6)),
    ):
        direction = 1 if locked_side == "MIN" else -1
        label = ("Surface", locked_side, fixed)
        mover, anchor, command = setup("package")
        mover.location.z = fixed + direction
        bpy.context.view_layer.update()
        command("baseline")
        if locked_side == "MAX":
            command("cycle_z")
        anchor.location.z = 5
        select([mover, anchor], anchor)
        tick()
        for index, expected_far in enumerate(expected_endpoints):
            checked_surface((label, index))
            mover = bpy.data.objects["Mover"]
            close((mover.matrix_world @ Vector((0, 0, -direction))).z, fixed,
                  (label, index, "fixed material side"))
            close((mover.matrix_world @ Vector((0, 0, direction))).z, expected_far,
                  (label, index, "reachable opposite face"))
        surface_cases += 1

    for locked_side in ("MIN", "MAX"):
        direction = 1 if locked_side == "MIN" else -1
        mover, anchor, command = setup("package")
        mover.location.z = direction
        bpy.context.view_layer.update()
        command("baseline")
        if locked_side == "MAX":
            command("cycle_z")
        select([mover, anchor], anchor)
        tick()
        for anchor_center, expected_far in ((direction, 0), (direction, 0),
                                             (-direction * 4, -direction * 5),
                                             (-direction * 4, -direction * 3)):
            anchor = bpy.data.objects["Anchor"]
            anchor.location.z = anchor_center
            bpy.context.view_layer.update()
            checked_surface(("Surface zero/cross", locked_side, anchor_center, expected_far))
            mover = bpy.data.objects["Mover"]
            close((mover.matrix_world @ Vector((0, 0, -direction))).z, 0,
                  ("Surface zero/cross fixed side", locked_side, expected_far))
            close((mover.matrix_world @ Vector((0, 0, direction))).z, expected_far,
                  ("Surface zero/cross free side", locked_side, expected_far))
        surface_cases += 1

    mover, anchor, command = setup("package")
    select([mover, anchor], anchor)
    tick()
    for expected_x in (12, 8):
        checked_surface(("Surface free X", expected_x), axis="X", report=False)
        mover = bpy.data.objects["Mover"]
        close(mover.matrix_world.translation.x, expected_x, "free X Surface retains alternating translation")
        close(bounds(mover)[0].z, 1, "free X Surface keeps pinned Z")
        assert_value(tuple(mover.scale), (1, 1, 1), "free X Surface does not scale")
    surface_cases += 1

    mover, anchor, command = setup("package")
    command("toggle_live")
    select([mover, anchor], anchor)
    for expected_z in (32, 28):
        result = actions.execute_bridge_operator("probe_align", {"command": "z_surface"})
        assert "Surface used the free side" not in result.get("message", ""), result
        bpy.context.view_layer.update()
        close(mover.matrix_world.translation.z, expected_z, "Live OFF Surface retains alternating translation")
        assert_value(tuple(mover.scale), (1, 1, 1), "Live OFF Surface does not scale")
        close(mover["_Z_min_ref"], 1, "Live OFF Surface keeps stored baseline")
        surface_operations += 1
    surface_cases += 1

    mover, anchor, command = setup("package")
    mover.location.z = 1
    bpy.ops.mesh.primitive_cube_add(size=4, location=(9, 6, 2))
    other = bpy.context.object
    other.name = "Other"
    select([mover, other], mover)
    command("baseline")
    select([mover, other, anchor], anchor)
    tick()
    for anchor_center, expected_other_far in ((7, 6), (1, 0), (-4, -5), (-4, -3)):
        anchor = bpy.data.objects["Anchor"]
        anchor.location.z = anchor_center
        bpy.context.view_layer.update()
        checked_surface(("Surface Group", anchor_center, expected_other_far), group=True)
        mover, other = bpy.data.objects["Mover"], bpy.data.objects["Other"]
        close((mover.matrix_world @ Vector((0, 0, -1))).z, 0, "Surface Group first fixed side")
        close((other.matrix_world @ Vector((0, 0, -2))).z, 0, "Surface Group second fixed side")
        close((other.matrix_world @ Vector((0, 0, 2))).z, expected_other_far, "Surface Group reachable face")
        close((mover.matrix_world @ Vector((0, 0, 1))).z, expected_other_far / 2, "Surface Group proportions")
    surface_cases += 1

    mover, anchor, command = setup("package")
    mover.location.z = 1
    bpy.ops.mesh.primitive_cube_add(size=2, location=(9, 6, 11))
    other = bpy.context.object
    other.name = "Other"
    select([mover, other], mover)
    command("baseline")
    anchor.location.z = 5
    select([mover, other, anchor], anchor)
    tick()
    for expected_other_far in (4, 6):
        result = checked_surface(("Surface independent movers", expected_other_far))
        assert "locked at 0" in result["message"] and "locked at 10" in result["message"], result
        mover, other = bpy.data.objects["Mover"], bpy.data.objects["Other"]
        close((mover.matrix_world @ Vector((0, 0, -1))).z, 0, "Surface independent first base")
        close((other.matrix_world @ Vector((0, 0, -1))).z, 10, "Surface independent second base")
        close((mover.matrix_world @ Vector((0, 0, 1))).z, 4, "Surface independent fallback")
        close((other.matrix_world @ Vector((0, 0, 1))).z, expected_other_far, "Surface independent preferred")
    expect_conflict({"command": "z_surface", "group": True}, "different locked baselines",
                    "Surface preserves Group baseline conflict")
    surface_cases += 1
finally:
    bridge.cleanup_live_tools(clear_registry=True)

print(f"FLOWCELL_SMART_AXIS_ALIGN_OK compatible={compatible_cases} pending={pending_cases} "
      f"signed_cases={signed_cases} signed_operations={signed_operations} "
      f"additional_cases={additional_cases} "
      f"surface_cases={surface_cases} surface_operations={surface_operations} "
      f"undo_redo_cycles={undo_redo_cycles} numeric_checks={checks}", flush=True)
