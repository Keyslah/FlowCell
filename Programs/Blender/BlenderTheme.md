# Blender Theme Page Package

Blender Theme is an ordinary page-enabled Blender Button package. Its catalog
source is:

```text
Blender Git Scripts/Toolsets/theme/
|-- flowcell.script.json
|-- theme.py
|-- page/
|   |-- index.html
|   |-- page.css
|   `-- page.js
`-- tests/
    `-- theme-page.test.mjs
```

The script manifest installs one canonical `single-script` owner. Its primary
execution target opens the declared package page through FlowCell's generic
installed-page host. Theme UI, labels, field definitions, tone logic, action
mappings, and Blender command selection all live in this package; Core does not
select a Theme renderer or infer this package from a product identifier.

## Install And Ownership

Use Add Button and select `flowcell.script.json` or its package folder. FlowCell
creates one owner and copies every declared package file into:

```text
Blender Local Scripts/<ownerButtonId>/source/
```

That owned copy is the installed runtime source of truth. The matching active
record is:

```text
Panels/<Panel>/<ownerButtonId>.flowcell-source.json
```

Canonical Button state owns the Button identity, placement, binding, installed
page window state, and active source record. The page's field values, tone
profiles, refill counter, and active package are written to owner-runtime state.
Blender deployment creates an owner-scoped bridge
action from the installed `theme.py`. Editing the Git Scripts source does not
modify an installed Theme Button; use Update to replace the installed copy for
that same owner.

Deleting the owner removes its placement, binding, installed page state and
window, active record, complete Local Scripts package, saved owner-runtime
state, and generated Blender bridge artifacts through the standard
rollback-capable Recycle Bin lifecycle. The catalog source remains.

## Manifest-Declared Controls

`flowcell.script.json` declares every page resource, field, label, action,
request/response schema, capability, data format, and window dimension. The
contained page calls only `window.flowcellPage.request(actionId, payload)`.
It has no direct Tauri, filesystem, process, navigation, popup, download, or
network access.

Theme controls:

- `Browse` selects and samples a reference image through the generic
  `image.sample-palette` broker capability.
- `Absorb` reads Blender's current theme into the package fields.
- `Refill`, `Dark`, `Light`, the tone slider, and named profiles stage colors
  with package-owned tone logic.
- Every visible color bucket has a package-declared per-bucket Apply action;
  the full `Apply` action sends the complete staged theme.
- `Save Fields` and `Load Fields` use generic field-file operations.
- `Previous`, `Open`, `Next`, and `Save Package` use the generic package
  library operations and the package's declared field and asset mappings.

Place Picture controls:

- `Browse`, `Apply Picture`, `Apply Grid`, `Startup`, and `Clear` operate on the
  declared image-path and grid fields.
- Near spacing, distance, and far spacing are owner-state fields sent only to
  fixed package-declared `theme.py` commands.

HDRI controls:

- `Browse`, `Apply HDRI`, `Clear World`, and `Reset World` manage the world
  image.
- `X`, `Y`, `Z`, and `WS` apply the declared rotation and strength fields.

The page declares the owner-contained `blender-theme-page` capability. Startup
restoration remains declared by the package as
`restore-project-theme-state`; it resolves the installed owner instead of a
hardcoded Theme action name.

## Validation And Reload

After changing the catalog package:

1. Run `node --test tests/theme-page.test.mjs` from the package directory.
2. Compile-check `theme.py` and parse `flowcell.script.json`.
3. Use Update to replace the intended owner's installed package and deployment
   artifacts.
4. Reload the FlowCell Blender add-on or restart Blender before runtime testing.

See [`../../docs/blendertheme.md`](../../docs/blendertheme.md) for the user
workflow and [`../../docs/buttons.md`](../../docs/buttons.md) for the generic
Button-source lifecycle.
