from __future__ import annotations

import importlib
import pathlib
import sys
import traceback

_fallback_module = None


def register():
    global _fallback_module
    try:
        import addon_utils

        addons_path = pathlib.Path(__file__).resolve().parents[1] / "addons"
        addons_text = str(addons_path)
        if addons_text not in sys.path:
            sys.path.insert(0, addons_text)

        current = sys.modules.get("flowcell_actions")
        if getattr(current, "__addon_enabled__", False) or _fallback_module is not None:
            return
        try:
            addon_utils.enable("flowcell_actions", default_set=True, persistent=True)
        except Exception:
            flowcell_actions = importlib.import_module("flowcell_actions")
            flowcell_actions = importlib.reload(flowcell_actions)
            addon_register = getattr(flowcell_actions, "register", None)
            if callable(addon_register):
                # Retain cleanup ownership even if manual registration fails partway.
                _fallback_module = flowcell_actions
                addon_register()
    except Exception:
        traceback.print_exc()


def unregister():
    global _fallback_module
    try:
        import addon_utils

        current = sys.modules.get("flowcell_actions")
        if getattr(current, "__addon_enabled__", False):
            addon_utils.disable("flowcell_actions", default_set=False)
        elif _fallback_module is not None:
            addon_unregister = getattr(_fallback_module, "unregister", None)
            if callable(addon_unregister):
                addon_unregister()
    except Exception:
        traceback.print_exc()
    finally:
        _fallback_module = None
