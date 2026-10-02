"""Exercise real timers, keyboard Undo, and the Theme modal in disposable Blender.

Run without --background and with --factory-startup --enable-event-simulate.
Arguments after --: --report PATH, --retire disabled|generation, and optional
--addon PATH, --theme PATH, --rotate PATH. The process exits after its checks.
Never run in an existing Blender scene: the probe replaces the factory data.
"""

import argparse
import json
from pathlib import Path
import runpy
import sys
import traceback

import bpy
from mathutils import Vector


root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--report", required=True)
parser.add_argument("--retire", choices=("disabled", "generation"), default="disabled")
parser.add_argument("--addon", default=str(root / "Blender Addons - Copy contents Into Blender"))
parser.add_argument("--theme", default=str(root / "Blender Git Scripts/Toolsets/theme/theme.py"))
parser.add_argument("--rotate", default=str(root / "Blender Git Scripts/Toolsets/rotate/rotate.py"))
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
if bpy.app.background:
    raise RuntimeError("This probe requires Blender's actual GUI event loop.")
sys.path.insert(0, args.addon)
import flowcell_actions as actions


theme = runpy.run_path(args.theme)
modal_class = theme["VIEW3D_OT_flowcell_place_picture_fake_gizmo_modal"]
modal_globals = modal_class.modal.__globals__
state_key = theme["VIEWPORT_OVERLAY_NAMESPACE_KEY"]
bpy.utils.register_class(modal_class)
bpy.utils.register_class(actions.OBJECT_OT_flowcell_bridge_undoable_action)
actions.load_custom_actions_registry = lambda: [{
    "action": "probe_rotate", "pythonPath": args.rotate,
    "functionName": "run_flowcell_action",
}]
bpy.context.preferences.edit.use_global_undo = True
report = {"retirement": args.retire, "checks": [], "steps": []}
snapshots = {}
phase = 0


def view_context():
    window = bpy.context.window_manager.windows[0]
    area = next(item for item in window.screen.areas if item.type == "VIEW_3D")
    region = next(item for item in area.regions if item.type == "WINDOW")
    return {"window": window, "area": area, "region": region}


def event(event_type, value, dx=0, ctrl=False, shift=False):
    context = view_context()
    region = context["region"]
    context["window"].event_simulate(
        type=event_type, value=value,
        x=region.x + region.width // 2 + dx,
        y=region.y + region.height // 2,
        ctrl=ctrl, shift=shift,
    )


def keyboard_undo(redo=False):
    event("MOUSEMOVE", "NOTHING")
    event("Z", "PRESS", ctrl=True, shift=redo)
    event("Z", "RELEASE", ctrl=True, shift=redo)


def scene_state():
    bpy.context.view_layer.update()
    return {
        obj.name: tuple(round(value, 4) for row in obj.matrix_world for value in row)
        for obj in bpy.data.objects
    }


def check(expected, label):
    actual = scene_state()
    assert actual == expected, (label, actual, expected)
    report["checks"].append(label)


def start_listener():
    bpy.app.driver_namespace[state_key] = {"enabled": True, "generation": phase + 1}
    with bpy.context.temp_override(**view_context()):
        result = bpy.ops.view3d.flowcell_place_picture_fake_gizmo_modal("INVOKE_DEFAULT")
    assert result == {"RUNNING_MODAL"}, result


direct = actions._execute_bridge_operator_direct


def execute(action, data):
    if action == "probe_start_listener":
        start_listener()
        return {"message": "Started disposable Theme listener."}
    return direct(action, data)


actions._execute_bridge_operator_direct = execute


def setup_cube():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(3, 0, 0))
    bpy.context.object.name = "ProbeCube"
    bpy.context.view_layer.update()
    bpy.ops.ed.undo_push(message="Disposable keyboard undo probe baseline")


def deterministic_hit(region, rv3d, mouse):
    # Keep viewport projection/picking out of this undo test. The real modal
    # still receives mouse events, applies its transform, and commits its drag.
    return {
        "kind": "MOVE", "axis_index": 0, "axis": Vector((1, 0, 0)),
        "screen_dir": Vector((1, 0)), "origin": bpy.context.object.matrix_world.translation.copy(),
        "origin_2d": mouse.copy(),
    }


def tick():
    global phase
    try:
        report["steps"].append({"phase": phase, "state": scene_state()})
        if phase == 0:
            # Factory startup's splash otherwise consumes the test keystrokes.
            event("ESC", "PRESS")
            event("ESC", "RELEASE")
            actions.execute_bridge_operator("probe_start_listener", {})
            snapshots["before_rotate"] = scene_state()
            actions.execute_bridge_operator("probe_rotate", {
                "command": "apply", "operation_mode": "TRANSFORM", "axis": "Z", "angle_deg": 90,
            })
            snapshots["after_rotate"] = scene_state()
        elif phase == 1:
            actions.execute_bridge_operator("probe_rotate", {
                "command": "apply", "operation_mode": "DISTRIBUTE", "axis": "Z", "distribute_count": 3,
            })
            snapshots["after_distribute"] = scene_state()
            assert len(snapshots["after_distribute"]) == 3
        elif phase == 2:
            state = bpy.app.driver_namespace[state_key]
            if args.retire == "disabled":
                state["enabled"] = False
            else:
                state["generation"] += 1
            keyboard_undo()
        elif phase == 3:
            check(snapshots["after_rotate"], "first keyboard Undo removes Distribute")
            keyboard_undo()
        elif phase == 4:
            check(snapshots["before_rotate"], "second keyboard Undo removes Rotate")
            keyboard_undo(redo=True)
        elif phase == 5:
            check(snapshots["after_rotate"], "first keyboard Redo restores Rotate")
            keyboard_undo(redo=True)
        elif phase == 6:
            check(snapshots["after_distribute"], "second keyboard Redo restores Distribute")
            setup_cube()
            snapshots["before_drag"] = scene_state()
            modal_globals["_hit_test_fake_gizmo"] = deterministic_hit
            modal_globals["_get_transform_objects"] = lambda: list(bpy.context.selected_objects)
            modal_globals["_world_units_per_pixel_at"] = lambda *unused: 1.0
            start_listener()
            event("MOUSEMOVE", "NOTHING")
            event("LEFTMOUSE", "PRESS")
        elif phase == 7:
            event("MOUSEMOVE", "NOTHING", dx=20)
        elif phase == 8:
            event("LEFTMOUSE", "RELEASE", dx=20)
        elif phase == 9:
            snapshots["after_drag"] = scene_state()
            assert snapshots["after_drag"] != snapshots["before_drag"], "Real modal drag must move the object"
            keyboard_undo()
        elif phase == 10:
            check(snapshots["before_drag"], "completed gizmo drag remains undoable")
            keyboard_undo(redo=True)
        elif phase == 11:
            check(snapshots["after_drag"], "completed gizmo drag remains redoable")
            report["status"] = "ok"
            print("FLOWCELL_TIMER_KEYBOARD_UNDO_OK " + json.dumps({
                "retirement": args.retire, "checks": len(report["checks"]),
            }), flush=True)
        phase += 1
        if phase <= 11:
            return 0.25
    except Exception:
        report["status"] = "error"
        report["error"] = traceback.format_exc()
        print(report["error"], flush=True)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    bpy.ops.wm.quit_blender()
    return None


setup_cube()
bpy.app.timers.register(tick, first_interval=1.0)
