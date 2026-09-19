"""Launch this program's catalog updater from its owned Local Scripts package.

Context: Blender/Fusion ordinary script runner; source root comes from its existing
bridge context/registry. No arguments or scene edits. Starts the packaged PowerShell
helper, which stages catalog-only writes, preserves conflicts and recycles deletions.
Requires Windows PowerShell supplied by Windows, not a Python/Git installation.
"""
import json
import os
from pathlib import Path
import subprocess


def run_flowcell_action(context=None, data=None):
    source_root = globals().get("FLOWCELL_SOURCE_ROOT")
    if source_root:
        root = Path(source_root)
    else:
        entry_file = Path(__file__).absolute()
        if (entry_file.parent / "updater.json").is_file():
            root = entry_file.parent
        else:
            # Fusion deploys only the entry file, retaining the Local source in
            # its existing owner registry. Never locate a catalog or selected panel.
            registry_path = entry_file.parent.parent / "flowcell_fusion_actions.json"
            registry = json.loads(registry_path.read_text(encoding="utf-8-sig"))
            matches = [item for item in registry["actions"]
                       if Path(item["source"]).name == entry_file.name]
            if len(matches) != 1:
                raise RuntimeError("Updater's installed Fusion owner is not unique.")
            root = Path(matches[0]["sourcePath"]).parent
    helper = root / "Update-Catalog.ps1"
    if not helper.is_file():
        raise RuntimeError("The installed updater package is incomplete.")
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    subprocess.Popen([str(powershell), "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA",
                      "-File", str(helper), "-PackageRoot", str(root), "-ShowUi"],
                     creationflags=subprocess.CREATE_NO_WINDOW)
    return {"status": "FINISHED", "message": "Updating Git Scripts; progress and results appear in the updater window."}
