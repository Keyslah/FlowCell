import importlib.util
import sys
import types
import unittest
from contextlib import contextmanager
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Files"
    / "obj import.py"
)


def load_module(bpy_module):
    props_module = types.ModuleType("bpy.props")
    props_module.StringProperty = lambda **_kwargs: None
    io_utils_module = types.ModuleType("bpy_extras.io_utils")

    class ImportHelper:
        def invoke(self, _context, _event):
            state = bpy_module._flowcell_test_state
            if not state.override_active:
                raise AssertionError("picker invoked outside the explicit UI context")
            return {"RUNNING_MODAL"}

    io_utils_module.ImportHelper = ImportHelper
    bpy_extras_module = types.ModuleType("bpy_extras")
    bpy_extras_module.io_utils = io_utils_module

    replacements = {
        "bpy": bpy_module,
        "bpy.props": props_module,
        "bpy_extras": bpy_extras_module,
        "bpy_extras.io_utils": io_utils_module,
    }
    previous = {name: sys.modules.get(name) for name in replacements}
    sys.modules.update(replacements)
    try:
        spec = importlib.util.spec_from_file_location("flowcell_obj_import", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, prior in previous.items():
            if prior is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior


def fake_bpy(include_view=True):
    state = types.SimpleNamespace(
        override_active=False,
        override=None,
        calls=[],
        instances=[],
        register_calls=[],
        unregister_calls=[],
    )
    region = types.SimpleNamespace(type="WINDOW")
    space = types.SimpleNamespace(type="VIEW_3D", region_3d=object())
    area = types.SimpleNamespace(
        type="VIEW_3D",
        spaces=types.SimpleNamespace(active=space),
        regions=[region],
    )
    screen = types.SimpleNamespace(areas=[area] if include_view else [])
    window = types.SimpleNamespace(screen=screen)

    @contextmanager
    def temp_override(**override):
        state.override_active = True
        state.override = override
        try:
            yield
        finally:
            state.override_active = False

    def invoke_picker(*args):
        state.calls.append(args)
        operator_class = getattr(bpy_module.types, "FLOWCELL_OT_import_obj_fix_transform")
        instance = operator_class()
        state.instances.append(instance)
        return instance.invoke(bpy_module.context, None)

    def register_class(cls):
        state.register_calls.append(cls)
        setattr(bpy_module.types, cls.__name__, cls)

    def unregister_class(cls):
        state.unregister_calls.append(cls)
        delattr(bpy_module.types, cls.__name__)

    bpy_module = types.ModuleType("bpy")
    bpy_module.context = types.SimpleNamespace(
        window_manager=types.SimpleNamespace(windows=[window]),
        temp_override=temp_override,
    )
    bpy_module.types = types.SimpleNamespace(Operator=type("Operator", (), {}))
    bpy_module.utils = types.SimpleNamespace(
        register_class=register_class,
        unregister_class=unregister_class,
    )
    bpy_module.ops = types.SimpleNamespace(
        flowcell=types.SimpleNamespace(import_obj_fix_transform=invoke_picker)
    )
    bpy_module.data = types.SimpleNamespace(objects=[])
    bpy_module._flowcell_test_state = state
    return bpy_module, state


class ObjImportTests(unittest.TestCase):
    def test_reentry_does_not_replace_an_active_picker_operator(self):
        bpy_module, state = fake_bpy()
        first_module = load_module(bpy_module)

        first_result = first_module.run_flowcell_action()
        second_module = load_module(bpy_module)
        second_result = second_module.run_flowcell_action()

        self.assertEqual(first_result["status"], "FINISHED")
        self.assertEqual(second_result["status"], "CANCELLED")
        self.assertIn("already open", second_result["message"])
        self.assertEqual(state.calls, [("INVOKE_DEFAULT",)])
        self.assertEqual(state.unregister_calls, [])
        self.assertIsNotNone(state.override)
        self.assertIsNotNone(state.override["window"])
        self.assertIsNotNone(state.override["screen"])
        self.assertEqual(state.override["area"].type, "VIEW_3D")
        self.assertEqual(state.override["region"].type, "WINDOW")

        state.instances[-1].cancel(None)
        third_module = load_module(bpy_module)
        third_result = third_module.run_flowcell_action()

        self.assertEqual(third_result["status"], "FINISHED")
        self.assertEqual(len(state.calls), 2)
        self.assertEqual(len(state.unregister_calls), 1)

    def test_picker_fails_before_invocation_without_a_3d_view(self):
        bpy_module, state = fake_bpy(include_view=False)
        module = load_module(bpy_module)

        with self.assertRaisesRegex(RuntimeError, "requires an open Blender 3D View"):
            module.run_flowcell_action()

        self.assertEqual(state.calls, [])
        self.assertEqual(state.register_calls, [])
        self.assertEqual(state.unregister_calls, [])


if __name__ == "__main__":
    unittest.main()
