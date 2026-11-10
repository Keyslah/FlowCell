"""Exercise the exact Python emitted by the Blender setup helper."""
import importlib
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import patch


HELPER = Path(__file__).resolve().parent.parent / "SupportScripts" / "Install-FlowCellBlenderAddon.ps1"


class StartupBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.enable_error = False
        self.enable_none = False
        self.register_error = False
        self.addon = types.ModuleType("flowcell_actions")
        self.addon.__addon_enabled__ = False
        self.addon.register = self.addon_register
        self.addon.unregister = lambda: self.calls.append("addon-unregister")
        addon_utils = types.ModuleType("addon_utils")
        addon_utils.enable = self.enable
        addon_utils.disable = self.disable
        self.modules_patch = patch.dict(sys.modules, {"addon_utils": addon_utils, "flowcell_actions": self.addon})
        self.modules_patch.start()
        self.reload_patch = patch.object(importlib, "reload", side_effect=lambda module: module)
        self.reload_patch.start()
        self.trace_patch = patch("traceback.print_exc", side_effect=lambda: self.calls.append("traceback"))
        self.trace_patch.start()
        self.original_path = list(sys.path)
        source = HELPER.read_text(encoding="utf-8-sig")
        emitted = re.search(r"\$bootstrap = @'\n(.*?)\n'@", source, re.S)
        self.assertIsNotNone(emitted)
        self.namespace = {"__file__": str(Path("fixture/scripts/startup/flowcell_startup_bootstrap.py").resolve())}
        exec(compile(emitted[1], "generated_startup.py", "exec"), self.namespace)

    def tearDown(self):
        sys.path[:] = self.original_path
        self.trace_patch.stop()
        self.reload_patch.stop()
        self.modules_patch.stop()

    def addon_register(self):
        self.calls.append("addon-register")
        if self.register_error:
            raise RuntimeError("partial registration failure")

    def enable(self, name, **options):
        self.calls.append(("enable", name, options))
        if self.enable_error:
            raise RuntimeError("managed enable failed")
        if self.enable_none:
            return None
        self.addon.register()
        self.addon.__addon_enabled__ = True
        return self.addon

    def disable(self, name, **options):
        self.calls.append(("disable", name, options))
        self.addon.__addon_enabled__ = False
        self.addon.unregister()

    def test_import_has_no_activation_and_register_is_idempotent(self):
        self.assertEqual(self.calls, [])
        self.namespace["register"]()
        self.namespace["register"]()
        self.assertEqual(self.calls, [("enable", "flowcell_actions", {"default_set": True, "persistent": True}), "addon-register"])

    def test_unregister_cleans_once_and_preserves_saved_addon_preference(self):
        self.namespace["register"]()
        self.calls.clear()
        self.namespace["unregister"]()
        self.namespace["unregister"]()
        self.assertEqual(self.calls, [("disable", "flowcell_actions", {"default_set": False}), "addon-unregister"])

    def test_host_disabled_addon_is_not_disabled_again_on_shutdown(self):
        self.namespace["register"]()
        self.disable("flowcell_actions", default_set=False)
        self.calls.clear()
        self.namespace["unregister"]()
        self.assertEqual(self.calls, [])

    def test_fallback_does_not_shadow_register_and_cleans_once(self):
        self.enable_error = True
        register = self.namespace["register"]
        register()
        self.assertIs(self.namespace["register"], register)
        self.assertIs(self.namespace["_fallback_module"], self.addon)
        register()
        self.assertEqual(self.calls.count("addon-register"), 1)
        self.namespace["unregister"]()
        self.namespace["unregister"]()
        self.assertEqual(self.calls.count("addon-unregister"), 1)
        self.assertFalse(any(isinstance(call, tuple) and call[0] == "disable" for call in self.calls))

    def test_partial_fallback_registration_retains_cleanup_ownership(self):
        self.enable_error = self.register_error = True
        self.namespace["register"]()
        self.assertIn("traceback", self.calls)
        self.namespace["unregister"]()
        self.assertEqual(self.calls.count("addon-unregister"), 1)

    def test_managed_enable_failure_result_does_not_claim_registration(self):
        self.enable_none = True
        self.namespace["register"]()
        self.namespace["unregister"]()
        self.assertEqual(len(self.calls), 1)
        self.assertIsNone(self.namespace["_fallback_module"])


if __name__ == "__main__":
    unittest.main()
