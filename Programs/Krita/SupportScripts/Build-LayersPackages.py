"""Build ordinary self-contained Windows-script button packages from the action list."""
import json
from pathlib import Path

support = Path(__file__).resolve().parent
program = support.parent
actions = json.loads((support / 'flowcell_layers/actions.json').read_text(encoding='utf-8'))
manifest_path = program / 'flowcell.program.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
if 'Layers' not in manifest['defaultPanels']:
    manifest['defaultPanels'].append('Layers')
if not any(p['id'] == 'layers' for p in manifest['panels']):
    manifest['panels'].append({'id': 'layers', 'label': 'Layers', 'defaultSelected': True})
previous_sources = {s['id']: s for s in manifest['bundledSources']}
sources = [s for s in manifest['bundledSources'] if not s['id'].startswith('plain-krita.layers.')]
for action, label, tooltip in actions:
    source_id = 'plain-krita.layers.' + action.replace('_', '-')
    # Display labels may be symbols such as < and >; keep package paths stable.
    relative_path = previous_sources.get(source_id, {}).get(
        'sourcePath', 'Krita Git Scripts/Layers/' + action.replace('_', '-'))
    package = program / relative_path
    package.mkdir(parents=True, exist_ok=True)
    (package / 'flowcell.script.json').write_text(json.dumps({
        'schemaVersion': 1, 'id': source_id, 'label': label, 'tooltip': tooltip,
        'program': 'Krita', 'source': 'run.ps1'
    }, indent=2) + '\n', encoding='utf-8')
    (package / 'run.ps1').write_text(
        "$ErrorActionPreference = 'Stop'\n& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action '" + action + "'\n",
        encoding='utf-8')
    (package / 'Invoke-KritaLayers.ps1').write_bytes((support / 'Invoke-KritaLayers.ps1').read_bytes())
    sources.append({'id': source_id, 'version': '1.0.2', 'panelName': 'Layers',
                    'sourcePath': relative_path, 'importKind': 'script',
                    'displayLabel': label, 'sourceKind': 'script', 'required': False,
                    'dependencies': [], 'installEffects': [tooltip], 'installIfMissing': True})
manifest['bundledSources'] = sources
manifest['addonReloadNotes'] = 'Install SupportScripts/Install-KritaLayers.ps1 while Krita is closed, then open Krita to load FlowCell Layers.'
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('Generated %d Krita Layers packages.' % len(actions))
