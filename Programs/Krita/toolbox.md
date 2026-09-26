# Krita Toolbox

Toolbox contains 37 ordinary FlowCell Buttons, one per tool in Krita 5.3.3's
native Toolbox. Each uses the existing FlowCell Layers Python bridge to trigger
the exact native tool action and verify its checked Toolbox button. No keyboard
shortcuts or canvas coordinates are used. Unavailable tools report an error.

Button faces show Krita's actual native symbols; names remain in tooltips and
accessibility labels. `Export-ToolboxIcons.py` runs in Krita Scripter to capture
the installed toolbar icons without drawing on a canvas. `Build-ToolboxSkins.py`
uses Pillow to encode those pixels losslessly as inline SVG, compatible with
FlowCell's existing skin validator (no external image URLs or new renderer).

Surface and Symbol Color are independent skin color roots. Theme's Surface
channel changes the background and its hover/pressed shades; Theme's Text
channel changes the symbol. The symbol remains textless, with its original
geometry, grayscale shading, and alpha. Host highlight/glow controls still apply.

`SupportScripts/flowcell_layers/tools.json` records the native IDs verified against
the running Toolbox and labels from the installed Krita action definitions.
`SupportScripts/Build-ToolboxPackages.py` generates self-contained script packages
and the program manifest contributions. These install through FlowCell's normal
source lifecycle, with independently editable buttons and the usual Pop/Fan support.

The updated Python extension must be loaded before using the buttons. Install
with `SupportScripts/Install-KritaLayers.ps1` while Krita is closed, then reopen
Krita. An in-place development reload can preserve an existing document session.

## Deploying to an installed FlowCell

Keep source changes in this repository. Stop FlowCell, then run:

```text
python Programs/Krita/SupportScripts/Deploy-Toolbox.py --local-root "<live-local-root>" --krita-resources "<Krita-resource-folder>" --apply
```

Omit `--apply` to preview the number of changed files. Both destination roots are
required and must exist; the local root must already contain registered Krita
and canonical Button state. The command merges only Toolbox manifest entries
and enabled sources, deploys its 37 packages and bridge files, backs up every
overwritten file under `local/backups/krita-toolbox-*`, and verifies the writes.
It assigns the native-symbol skins only to the 37 installed Toolbox Button
records. It never copies development Button state, layouts, bindings, or other
program packages. If the Buttons have not been installed yet, start FlowCell
once, close it and rerun deployment to assign their skins. A second identical
deployment changes zero files. `files.json` in the
backup records each destination and its backup file (null means newly created).

Reload the Krita extension and restart the installed FlowCell executable against
that same local root. Core application changes use the installer build/upgrade
route described in `docs/installer-release.md`; the source development launcher
is not the deployment target for an installed session.
