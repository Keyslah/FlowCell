"""Exercise both request consumers with real Align, Undo and Redo in factory Blender."""
import json
from pathlib import Path
import sys
import tempfile
import types

import bpy

root = Path(__file__).resolve().parents[1]
arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
addon = Path(arguments[0]) if arguments else root / 'Blender Addons - Copy contents Into Blender'
align = Path(arguments[1]) if len(arguments) > 1 else root / 'Blender Git Scripts/Toolsets/alignment-tools/alignment tools.py'
sys.path.insert(0, str(addon))
import flowcell_actions as actions
import flowcell_bridge as bridge

bpy.context.preferences.edit.use_global_undo = True
bpy.utils.register_class(actions.OBJECT_OT_flowcell_bridge_undoable_action)

# Simulate importlib.reload retaining older registered callbacks from both modules.
stale_callbacks = []
for module in (actions, bridge):
    for _ in range(2):
        stale = types.FunctionType(module.poll_bridge_requests.__code__, module.__dict__, 'poll_bridge_requests')
        bpy.app.timers.register(stale, first_interval=60)
        stale_callbacks.append(stale)
def unrelated_timer():
    return 60
bpy.app.timers.register(unrelated_timer, first_interval=60)
for _ in range(3):
    actions._start_bridge_request_timer()
    assert bpy.app.timers.is_registered(actions.poll_bridge_requests)
    assert all(not bpy.app.timers.is_registered(stale) for stale in stale_callbacks)
    assert bpy.app.timers.is_registered(unrelated_timer)
actions._stop_bridge_request_timers()
assert not bpy.app.timers.is_registered(actions.poll_bridge_requests)
assert bpy.app.timers.is_registered(unrelated_timer)
bpy.app.timers.unregister(unrelated_timer)
print('FLOWCELL_SINGLE_REQUEST_TIMER_OK stale_callbacks=4 unrelated_timer_preserved=True', flush=True)
registry = [{'action': 'probe_align', 'pythonPath': str(align), 'functionName': 'run_flowcell_action'}]
actions.load_custom_actions_registry = lambda: registry
bridge.load_custom_actions_registry = lambda: registry
bridge.sync_custom_action_lifecycles = lambda: None


def state():
    return {o.name: tuple(round(v, 5) for row in o.matrix_world for v in row) for o in bpy.data.objects}


with tempfile.TemporaryDirectory(prefix='flowcell-align-undo-') as temp:
    request = Path(temp) / 'request.json'
    response = Path(temp) / 'response.json'
    for module in (actions, bridge):
        module.get_request_path = lambda: request
        module.get_response_path = lambda: response
    sequence = 0
    for first, second in ((actions, bridge), (bridge, actions), (bridge, bridge), (actions, actions)):
        for group in (False, True):
            for alt in (False, True):
                for obj in list(bpy.data.objects):
                    bpy.data.objects.remove(obj, do_unlink=True)
                for name, location in [('Anchor', (10, 20, 30)), ('Mover', (60, 70, 80)), ('Other', (90, 100, 110))]:
                    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
                    bpy.context.object.name = name
                for obj in bpy.data.objects:
                    obj.select_set(True)
                bpy.context.view_layer.objects.active = bpy.data.objects['Anchor']
                bpy.context.view_layer.update()
                bpy.ops.ed.undo_push(message='Align probe baseline')
                baseline = state()
                bpy.ops.transform.translate('EXEC_DEFAULT', True, value=(2, 3, 4))
                bpy.context.view_layer.update()
                prior = state()
                results = []
                for module, command in ((first, 'x_center'), (second, 'y_center')):
                    sequence += 1
                    request.write_text(json.dumps({'id': f'align-{sequence}', 'action': 'probe_align',
                                                  'data': {'command': command, 'group': group, 'modifiers': {'alt': alt}}}))
                    module.poll_bridge_requests()
                    reply = json.loads(response.read_text())
                    assert reply['status'] == 'ok', reply
                    bpy.context.view_layer.update()
                    results.append(state())
                    request.write_text(json.dumps({'id': f'status-{sequence}', 'action': 'probe_align', 'data': {'command': 'status'}}))
                    module.poll_bridge_requests()
                    assert json.loads(response.read_text())['status'] == 'ok'
                    assert state() == results[-1]
                assert prior != results[0] != results[1]
                for expected in (results[0], prior, baseline):
                    assert bpy.ops.ed.undo() == {'FINISHED'}
                    bpy.context.view_layer.update()
                    assert state() == expected, ('undo skipped state', first.__name__, second.__name__, group, alt)
                for expected in (prior, results[0], results[1]):
                    assert bpy.ops.ed.redo() == {'FINISHED'}
                    bpy.context.view_layer.update()
                    assert state() == expected, ('redo skipped state', first.__name__, second.__name__, group, alt)
    print(f'FLOWCELL_ALIGN_BRIDGE_UNDO_OK operations={sequence} undo_redo_checks={sequence * 3}', flush=True)
