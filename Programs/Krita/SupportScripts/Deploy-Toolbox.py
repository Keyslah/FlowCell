"""Deploy only Toolbox changes to an explicitly selected installed data root.

Close FlowCell before --apply. This never restarts or saves Krita documents.
Without --apply, validate and print the proposed deployment without writing.
"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def deploy(local_root, krita_resources, apply=False):
    if apply:
        processes = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq flowcell_frontend.exe", "/FO", "CSV", "/NH"],
            check=True, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        if "flowcell_frontend.exe" in processes.stdout.lower():
            raise RuntimeError("Close FlowCell before applying a deployment to its live state.")
    support = Path(__file__).resolve().parent
    program = support.parent
    local_root = Path(local_root).resolve(strict=True)
    krita_resources = Path(krita_resources).resolve(strict=True)
    target = local_root / "Programs/Krita"
    manifest_path = target / "flowcell.program.json"
    registration_path = local_root / "program-registration/plain-krita.json"
    # An existing installation and canonical state are required. Never create a
    # second data root because of a misspelled path or copy development state.
    for path in (manifest_path, registration_path, local_root / "button-system/button-state.json"):
        if not path.is_file():
            raise ValueError("Missing installed state: " + str(path))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    registration = json.loads(registration_path.read_text(encoding="utf-8-sig"))
    if manifest["programId"] != "plain-krita" or registration["programId"] != "plain-krita":
        raise ValueError("Destination is not the registered Krita program.")
    source = json.loads((program / "flowcell.program.json").read_text(encoding="utf-8-sig"))
    contributions = [s for s in source["bundledSources"] if s["id"].startswith("plain-krita.toolbox.")]
    if len(contributions) != 37 or len({s["id"] for s in contributions}) != 37:
        raise ValueError("Expected 37 unique Toolbox contributions.")
    planned = {}
    for contribution in contributions:
        relative = Path(contribution["sourcePath"])
        if relative.is_absolute() or ".." in relative.parts or relative.parts[:2] != ("Krita Git Scripts", "Toolbox"):
            raise ValueError("Invalid Toolbox package path.")
        for name in ("flowcell.script.json", "run.ps1", "Invoke-KritaLayers.ps1"):
            planned[target / relative / name] = (program / relative / name).read_bytes()
    for name in ("plugin.py", "toolbox.py", "tools.json", "toolbox_selftest.py"):
        content = (support / "flowcell_layers" / name).read_bytes()
        planned[target / "SupportScripts/flowcell_layers" / name] = content
        planned[krita_resources / "pykrita/flowcell_layers" / name] = content
    planned[target / "toolbox.md"] = (program / "toolbox.md").read_bytes()
    skins_path = support / "toolbox-skins.json"
    pending_symbols = 0
    if skins_path.is_file():
        skins = json.loads(skins_path.read_text(encoding="utf-8"))
        planned[target / "SupportScripts/toolbox-skins.json"] = skins_path.read_bytes()
        state_path = local_root / "button-system/button-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8-sig"))
        state_changed = False
        for slug, skin in skins.items():
            prefix = "bundled-plain-krita-plain-krita-toolbox-" + slug + "-"
            matches = [b for b in state["buttons"].values() if b["id"].startswith(prefix)]
            if len(matches) > 1:
                raise ValueError("Ambiguous Toolbox Button: " + slug)
            if not matches:
                pending_symbols += 1
                continue
            button = matches[0]
            if state["skins"].get(skin["id"]) != skin or button["defaultSkinId"] != skin["id"]:
                state["skins"][skin["id"]] = skin
                button["defaultSkinId"] = skin["id"]
                state_changed = True
        if state_changed:
            state["revision"] += 1
            planned[state_path] = encoded(state)
    if "Toolbox" not in manifest["defaultPanels"]:
        manifest["defaultPanels"].append("Toolbox")
    if not any(p["id"] == "toolbox" for p in manifest["panels"]):
        manifest["panels"].append({"id": "toolbox", "label": "Toolbox", "defaultSelected": True})
    incoming = {s["id"]: s for s in contributions}
    manifest["bundledSources"] = [s for s in manifest["bundledSources"] if s["id"] not in incoming] + contributions
    enabled = {s["sourceId"] for s in registration["enabledSources"]}
    registration["enabledSources"] += [
        {"sourceId": s["id"], "panelName": "Toolbox", "version": s["version"]}
        for s in contributions if s["id"] not in enabled]
    planned[manifest_path] = encoded(manifest)
    planned[registration_path] = encoded(registration)
    originals = {}
    for path in planned:
        resolved = path.resolve()
        if not (resolved.is_relative_to(local_root) or resolved.is_relative_to(krita_resources)):
            raise ValueError("Destination escapes its selected root: " + str(path))
        originals[path] = path.read_bytes() if path.exists() else None
    changed = {p: value for p, value in planned.items() if value != originals[p]}
    report = {"localRoot": str(local_root), "kritaResources": str(krita_resources),
              "changedFiles": len(changed), "toolboxButtons": len(contributions),
              "symbolsPendingFirstInstall": pending_symbols, "applied": False}
    if apply and changed:
        backup = local_root / "backups" / ("krita-toolbox-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
        backup.mkdir(parents=True)
        inventory = []
        for index, (path, value) in enumerate(changed.items()):
            old = originals[path]
            backup_name = str(index) + ".bak" if old is not None else None
            if old is not None:
                (backup / backup_name).write_bytes(old)
            inventory.append({"path": str(path), "backup": backup_name,
                              "sha256": hashlib.sha256(value).hexdigest()})
        (backup / "files.json").write_bytes(encoded(inventory))
        # Check every target again before publishing any file.
        for path in changed:
            if (path.read_bytes() if path.exists() else None) != originals[path]:
                raise RuntimeError("Destination changed during preparation: " + str(path))
        for path, value in changed.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
            if path.read_bytes() != value:
                raise RuntimeError("Deployment verification failed: " + str(path))
        (target / "Panels/Toolbox").mkdir(parents=True, exist_ok=True)
        report.update(applied=True, backup=str(backup))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-root", required=True)
    parser.add_argument("--krita-resources", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(deploy(args.local_root, args.krita_resources, args.apply), indent=2))
