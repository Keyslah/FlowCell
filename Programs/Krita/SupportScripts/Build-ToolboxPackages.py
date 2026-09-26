"""Build ordinary Toolbox Buttons using the same installer as Layers."""
import json
from pathlib import Path

support = Path(__file__).resolve().parent
program = support.parent
tools = json.loads((support / "flowcell_layers/tools.json").read_text(encoding="utf-8"))
manifest_path = program / "flowcell.program.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
if "Toolbox" not in manifest["defaultPanels"]:
    manifest["defaultPanels"].append("Toolbox")
if not any(panel["id"] == "toolbox" for panel in manifest["panels"]):
    manifest["panels"].append({"id": "toolbox", "label": "Toolbox", "defaultSelected": True})
sources = [source for source in manifest["bundledSources"]
           if not source["id"].startswith("plain-krita.toolbox.")]
for tool in tools:
    source_id = "plain-krita.toolbox." + tool["slug"]
    relative_path = "Krita Git Scripts/Toolbox/" + tool["slug"]
    package = program / relative_path
    package.mkdir(parents=True, exist_ok=True)
    tooltip = tool["label"]
    (package / "flowcell.script.json").write_text(json.dumps({
        "schemaVersion": 1, "id": source_id, "label": tool["label"],
        "tooltip": tooltip, "program": "Krita", "source": "run.ps1"
    }, indent=2) + "\n", encoding="utf-8")
    (package / "run.ps1").write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action 'tool:"
        + tool["id"] + "'\n", encoding="utf-8")
    (package / "Invoke-KritaLayers.ps1").write_bytes((support / "Invoke-KritaLayers.ps1").read_bytes())
    sources.append({
        "id": source_id, "version": "1.0.0", "panelName": "Toolbox",
        "sourcePath": relative_path, "importKind": "script", "displayLabel": tool["label"],
        "sourceKind": "script", "required": False, "dependencies": [],
        "installEffects": ["Select Krita's " + tool["label"] + "."], "installIfMissing": True, "installOnAdd": True
    })
manifest["bundledSources"] = sources
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print("Generated %d Krita Toolbox packages." % len(tools))
