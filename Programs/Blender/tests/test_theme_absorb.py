import ast
import json
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'Blender Git Scripts/Toolsets/theme'

class ThemeAbsorbTests(unittest.TestCase):
    def sample(self, color):
        tree = ast.parse((ROOT / 'theme.py').read_text(encoding='utf-8-sig'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '_absorb_current_theme')
        namespace = {
            '_ctx': lambda context: context,
            '_sample_theme_hex_from_paths': lambda *args: color,
            '_safe_theme_path_value': lambda *args: None,
            '_current_theme_rgb': lambda *args: None,
            '_result': lambda message, **payload: {'message': message, **payload},
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'theme.py', 'exec'), namespace)
        context = types.SimpleNamespace(preferences=types.SimpleNamespace(themes=[object()]))
        return namespace['_absorb_current_theme'](context)['fieldPatch']

    def test_missing_blender_fields_do_not_emit_null_colors(self):
        patch = self.sample(None)
        self.assertEqual(patch, {'viewport_gradient_enabled': False})
        manifest = json.loads((ROOT / 'flowcell.script.json').read_text(encoding='utf-8-sig'))
        absorb = next(action for action in manifest['page']['actions'] if action['id'] == 'theme.absorb')
        schema = absorb['responseSchema']['properties']['fieldPatch']
        self.assertFalse(schema.get('required'))
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(schema['properties']['darks_hex']['type'], 'string')

    def test_supported_colors_are_preserved(self):
        patch = self.sample('#123456')
        self.assertEqual(patch['tabs_hex'], '#123456')
        self.assertEqual(patch['darks_hex'], '#123456')
        self.assertNotIn('viewport_background_hex', patch)

if __name__ == '__main__':
    unittest.main()
