"""Portable package checks; behavioral tests run in real Krita via selftest.py."""
import ast
import json
from pathlib import Path
import unittest

PROGRAM = Path(__file__).resolve().parents[1]


class Packages(unittest.TestCase):
    def test_all_actions_have_independent_self_contained_packages(self):
        actions = json.loads((PROGRAM / 'SupportScripts/flowcell_layers/actions.json').read_text())
        manifest = json.loads((PROGRAM / 'flowcell.program.json').read_text())
        sources = {s['id']: s for s in manifest['bundledSources']}
        for action, label, _ in actions:
            with self.subTest(action=action):
                source = sources['plain-krita.layers.' + action.replace('_', '-')]
                package = PROGRAM / source['sourcePath']
                script = json.loads((package / 'flowcell.script.json').read_text())
                self.assertEqual(script['label'], label)
                self.assertEqual(script['program'], 'Krita')
                self.assertTrue((package / script['source']).is_file())
                self.assertEqual((package / 'Invoke-KritaLayers.ps1').read_bytes(),
                                 (PROGRAM / 'SupportScripts/Invoke-KritaLayers.ps1').read_bytes())
                self.assertIn("-Action '" + action + "'", (package / script['source']).read_text())
                self.assertEqual(source['panelName'], 'Layers')
        self.assertEqual(len(actions), len({a[0] for a in actions}))
        self.assertFalse({'sort', 'sort_live', 'end_preview', '3d'} & {a[0] for a in actions})

    def test_plugin_python_syntax(self):
        for path in (PROGRAM / 'SupportScripts/flowcell_layers').glob('*.py'):
            with self.subTest(path=path.name):
                ast.parse(path.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
