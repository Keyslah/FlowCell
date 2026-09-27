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
- `Popped Button Colors` owns two independent gradient boxes, `Button Fill` and
  `Button Text`, plus separate hover/active highlight and glow controls. Packages
  save both gradients (stops, curve, angle, whole-screen option), spread, scatter
  and seed with the effects. The settings apply to any Blender Pop-out or Fan,
  including collapsed owners and newly opened tools; they take precedence over the
  Main Theme only on these popped surfaces.
- Each box has ordered Start-to-End color stops, a curve box, an Angle and a
  `Whole Screen` checkbox. Button Fill needs 2-16 stops and keeps Spread and
  Scatter; Button Text takes 1-16 stops, where one stop is a solid label color.
  `Apply Gradient` (fill) and `Apply Text Gradient` apply each box independently;
  a sample grid above the boxes previews both together.
- The curve box maps position along the gradient (left to right) to progress
  through the stops (bottom to top); its left strip shows the stops and its
  bottom strip the result. The default bottom-left to top-right line is linear.
  Click to add points (up to 32), drag points or their Bezier handles, double-click
  or press Delete to remove one; Shift snaps and Alt breaks a handle. Points can be
  Smooth, Corner, Bezier or Broken, with exact Position/Value fields. Presets
  include Ease In/Out/In-Out, Hold Middle, Peak, Valley, Wave and Steps (one flat
  band per stop), plus Flip, Mirror and Reset.
- Angle tilts the gradient: 0 degrees runs top to bottom, 90 left to right, 180
  bottom to top and -90 right to left. Drag the dial (Shift snaps to 15 degrees),
  use the slider, or type a value. Tilted gradients project each Button center
  along the angle, so the corner Buttons of a window hold the Start and End stops.
- `Lock All Popped Button Settings`, at the top of Popped Button Colors, covers
  both gradients (stops, curves, angles), Spread, Scatter, highlights and glow.
  It temporarily keeps the current popped appearance when opening
  or cycling packages. Unlocking applies the selected package's saved settings.
  Switching packages never writes their files. Older packages without popped
  settings keep the last-used appearance. First use adopts the saved page
  gradient and the common current popout effects, without replacing skins.
- The per-Button Individual Buttons list was removed in Theme 3.0.20. Aggregate
  color buckets and `Apply Buckets` remain. Per-occurrence colors left from the
  old list are cleared when a new fill or text gradient is applied (fill clears
  Surface overrides, text clears Text overrides); `Toggle Text` also replaces a
  text gradient with solid black or white.
- Shared appearance applies directly when switching packages. The buckets remain
  visible and refresh asynchronously; bucket edits are disabled until the refreshed
  scan arrives. `Rescan` remains available. Legacy packages retain the current
  shared appearance, and packages saved before gradient curves/angles load as
  linear, 0-degree gradients with a solid text color.
- Popped gradients use the exact chosen Start/End colors and pass through every
  ordered intermediate stop. Spread adjusts each blend's width; Scatter varies
  interior blends without changing stop anchors. Increasing Gradient Colors
  retains the existing chosen colors and inserts new blends between them.
- `Whole Screen` spans the visible popped Button centers on each monitor, in both
  directions for tilted gradients. Moving, collapsing, opening or closing a window
  updates this live range without saving geometry into packages or rescanning on
  package switches. Collapsed hidden members do not move the endpoints. Authored
  skin shading is preserved.

Place Picture controls:

- `Browse`, `Place Picture`, `Grid`, `Remove Grid`, `Startup`, and `Clear`
  operate on the declared image-path and grid fields. `Remove Grid` leaves the
  picture and fake gizmos active.
- New pictures and saved states without an explicit grid choice start with the
  grid off. `Grid` enables it; explicit saved on/off choices are still respected.
  Theme 3.0.19 uses Blender's native floor, orthographic grid and axes. The
  picture retains its fixed full-viewport fit during navigation. With a picture
  and grid enabled, a GPU-only native viewport cache supplies object occlusion,
  grid planes and antialiasing. It refreshes outside Blender's draw engine and
  presents on the following redraw, before native viewport text and gizmos.
  Turning the grid off frees this cache and restores the inexpensive picture
  path. Clearing the picture restores the previous viewport settings.
- Grid spacing and units follow Blender. The old near/distance/far controls
  are hidden; their saved values remain readable for package compatibility.

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
