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

- The page opens without a decorative header. Four slightly taller bucket cards
  fit per row; each card keeps its original label visible and keeps swatch, hex,
  and `Apply` on one control line. Gradient 2 carries one unlabeled checkbox
  directly beside its name instead of a separate description row. Darkness
  profile controls sit directly after `Load Buckets`. Every action Button has
  its original explanatory hover tooltip, with behavior-accurate descriptions
  for newer controls.
- `Browse` selects and samples a reference image through the generic
  `image.sample-palette` broker capability.
- `Absorb Theme` reads Blender's current theme into the package fields.
- `Refill`, `Dark Theme`, `Light Theme`, the tone slider, and named profiles stage colors
  with package-owned tone logic.
- Every visible color bucket has a package-declared per-bucket Apply action;
  the full `Apply` action sends the complete staged theme.
- `Save Buckets` and `Load Buckets` use generic field-file operations.
- `Previous`, `Open Package`, `Next`, and `Save Package` use the generic package
  library operations and the package's declared field and asset mappings.
- `Popped Button Colors` also owns text color and separate hover/active highlight
  and glow controls. Packages save these settings with the palette, gradient
  stops, spread, scatter, seed, and screen-gradient option. The settings apply
  to any Blender Pop-out or Fan, including collapsed owners and newly opened
  tools; they take precedence over the Main Theme only on these popped surfaces.
- `Lock All Popped Button Settings`, at the top of Popped Button Colors, covers
  colors, every gradient stop, Spread, Scatter, text, highlights and glow.
  It temporarily keeps the current popped appearance when opening
  or cycling packages. Unlocking applies the selected package's saved settings.
  Switching packages never writes their files. Older packages without popped
  settings keep the last-used appearance. First use adopts the saved page
  gradient and the common current popout effects, without replacing skins.
- Individual Buttons stay listed below the aggregate color buckets, with their
  names, owning group, and separate Fill and Text pickers. Select any subset for
  one-click Black Text or White Text, or choose a custom text color and Apply to
  Selected. Use Theme Colors restores the selected buttons' shared appearance.
- Individual edits override only the selected popped occurrences; shared effects,
  authored skins, actions and Main-page buttons stay intact. Button Settings files
  round-trip these edits. Unlocked package switches restore package colors; Lock
  All Popped Button Settings preserves individual edits too. Portable theme packages
  continue to apply their palette to whichever tools are currently popped out.
- Shared appearance applies directly when switching packages. The button list
  remains visible and refreshes asynchronously; stale edits are disabled until
  the refreshed list arrives. `Rescan` remains available. Legacy packages retain
  the current shared appearance.
- Popped gradients use the exact chosen top/bottom colors and pass through every
  ordered intermediate stop. Spread adjusts each blend's width; Scatter varies
  interior blends without changing stop anchors. Increasing Gradient Colors
  retains the existing chosen colors and inserts new blends between them.
- Screen Top-to-Bottom spans the visible popped Button centers on each monitor.
  Moving, collapsing, opening or closing a window updates this live range without
  saving geometry into packages or rescanning on package switches. Collapsed
  hidden members do not move the endpoints. Authored skin shading is preserved.

Place Picture controls:

- `Browse`, `Place Picture`, `Grid`, `Remove Grid`, `Startup`, and `Clear`
  operate on the declared image-path and grid fields. `Remove Grid` leaves the
  picture and fake gizmos active.
- Near spacing, distance, and far spacing are owner-state fields sent only to
  fixed package-declared `theme.py` commands.

HDRI controls:

- `HDRI Browse`, `HDRI Apply`, `Clear`, and `Reset` manage the world
  image.
- `X`, `Y`, `Z`, and `WS` apply the declared rotation and strength fields.

The page declares the owner-contained `blender-theme-page` capability. Startup
restoration remains declared by the package as
`restore-project-theme-state`; it resolves the installed owner instead of a
hardcoded Theme action name.

Theme apply commits the current theme and live Place Picture as one owner
startup bundle, including grid values and grid visibility. Package load applies
or clears its picture first and applies the theme last, so a saved theme cannot
restore with an older picture.

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
