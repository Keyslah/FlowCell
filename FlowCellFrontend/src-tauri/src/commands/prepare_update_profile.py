"""Run inside the selected Blender before FlowCell publishes any scripts."""
import json
import os
from pathlib import Path

import bpy


def prepare_profile(plan):
    profile = {"version": bpy.app.version_string, "scripts": bpy.utils.user_resource("SCRIPTS")}
    expected = plan.get("expectedVersion")
    if expected and profile["version"] != expected:
        raise ValueError(f"Expected Blender {expected}, but this executable reports {profile['version']}.")

    preferences = Path(bpy.utils.user_resource("CONFIG")) / "userpref.blend"
    if preferences.is_file() or not bpy.ops.preferences.copy_prev.poll():
        return profile

    choice = plan.get("preferenceChoice")
    if choice is None:
        return {**profile, "needsPreferenceChoice": True}
    if os.environ.get("FLOWCELL_TARGET_BLENDER_OPEN") == "1":
        raise RuntimeError("Save your work and close the selected Blender before setting up its preferences.")
    if choice == "import":
        if "FINISHED" not in bpy.ops.preferences.copy_prev():
            raise RuntimeError("Blender could not import its previous settings.")
    elif choice != "defaults":
        raise ValueError("Unknown Blender preference choice.")

    # An old profile may contain scripts but no saved preferences. Completing
    # first-run setup prevents a subsequent splash import overwriting the sync.
    if not preferences.is_file():
        if "FINISHED" not in bpy.ops.wm.save_userpref() or not preferences.is_file():
            raise RuntimeError("Blender could not save its first-run preferences.")
    return profile


if __name__ == "__main__":
    plan = json.loads(Path(os.environ["FLOWCELL_UPDATE_PLAN"]).read_text(encoding="utf-8-sig"))
    try:
        profile = prepare_profile(plan)
    except Exception as error:
        print("FLOWCELL_PROFILE_ERROR=" + str(error))
        raise
    print("FLOWCELL_PROFILE=" + json.dumps(profile))
