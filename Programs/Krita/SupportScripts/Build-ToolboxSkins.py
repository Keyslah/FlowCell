"""Encode exported native Krita icons as lossless inline SVG skin artwork.

FlowCell skins disallow image URLs. Equal RGBA pixel runs become SVG paths;
the source icon's pixels, transparency and geometry are preserved exactly.
"""
import json
from collections import defaultdict
from pathlib import Path
from PIL import Image

support = Path(__file__).resolve().parent
tools = json.loads((support / "flowcell_layers/tools.json").read_text(encoding="utf-8"))
skins = {}
for tool in tools:
    with Image.open(support / "toolbox-icons" / (tool["slug"] + ".png")) as source:
        icon = source.convert("RGBA")
    paths = defaultdict(list)
    for y in range(icon.height):
        x = 0
        while x < icon.width:
            color = icon.getpixel((x, y))
            end = x + 1
            while end < icon.width and icon.getpixel((end, y)) == color:
                end += 1
            if color[3]:
                paths[color].append(f"M{x} {y}h{end-x}v1h{x-end}z")
            x = end
    # Native glyphs are grayscale. Keep their exact shades and alpha while
    # exposing a symbol root independently of the button's surface material.
    assert all(r == g == b for r, g, b, _ in paths), tool["slug"]
    symbol_shades = "".join(
        f'--flowcell-button-shade-symbol-tone-{tone}:rgb(from var(--button-ink,var(--flowcell-button-color-symbol,#d2d2d2)) calc(r + {tone-210}) calc(g + {tone-210}) calc(b + {tone-210}));'
        for tone in sorted({r for r, _, _, _ in paths if r != 210}))
    artwork = "".join(
        (f'<path fill="currentColor"' if r == 210 else
         f'<path style="fill:var(--flowcell-button-shade-symbol-tone-{r},#{r:02x}{g:02x}{b:02x});"')
        + f' fill-opacity="{alpha/255:.9f}" d="{"".join(runs)}"/>'
        for (r, g, b, alpha), runs in paths.items())
    skin_id = "krita-toolbox-native-" + tool["slug"]
    skin = {section: "" for section in ("keyframes", "play", "held", "release", "disabled", "error")}
    skin.update({
        "id": skin_id, "name": "Krita " + tool["label"],
        "structure": '<div data-core style="display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:40px;height:40px;border-radius:3px;border:1px solid var(--tool-border,transparent);background:var(--tool-face,#454545);cursor:pointer;">'
                     + f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {icon.width} {icon.height}" width="28" height="28" style="pointer-events:none;color:var(--button-ink,var(--flowcell-button-color-symbol,#d2d2d2));">{artwork}</svg></div>',
        "base": "--flowcell-button-color-surface:#454545;--flowcell-button-color-symbol:#d2d2d2;"
                "--flowcell-button-shade-surface-hover:rgb(from var(--flowcell-button-color-surface,#454545) calc(r + 16) calc(g + 16) calc(b + 16));"
                "--flowcell-button-shade-surface-hover-edge:rgb(from var(--flowcell-button-color-surface,#454545) calc(r + 67) calc(g + 67) calc(b + 67));"
                "--flowcell-button-shade-surface-pressed:rgb(from var(--flowcell-button-color-surface,#454545) calc(r + 4) calc(g + 31) calc(b + 52));"
                "--flowcell-button-shade-surface-pressed-edge:rgb(from var(--flowcell-button-color-surface,#454545) calc(r + 62) calc(g + 103) calc(b + 134));"
                "--tool-face:var(--flowcell-button-color-surface,#454545);--tool-border:transparent;" + symbol_shades,
        "hover": "--tool-face:var(--flowcell-button-shade-surface-hover,#555555);--tool-border:var(--flowcell-button-shade-surface-hover-edge,#888888);",
        "pressed": "--tool-face:var(--flowcell-button-shade-surface-pressed,#496479);--tool-border:var(--flowcell-button-shade-surface-pressed-edge,#83accb);",
        "metadata": {"kritaNativeToolId": tool["id"]}, "compileCache": None
    })
    skins[tool["slug"]] = skin
(support / "toolbox-skins.json").write_text(json.dumps(skins, indent=2) + "\n", encoding="utf-8")
print("Generated %d native-symbol skins." % len(skins))
