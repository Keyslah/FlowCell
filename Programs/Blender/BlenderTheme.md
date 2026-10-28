# Blender Theme Contribution

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

The script manifest retains one canonical `single-script` owner without an
ordinary Button placement. Open Main Theme and select Blender to edit it;
there is no separate Theme entry in Blender's toolset, Pop, or Fan. The
manifest's `page.themeContribution` declaration supplies the original Blender page
through the generic isolated installed-page host. Theme UI, labels, field
definitions, tone logic, action mappings, and Blender command selection remain
in this package; Core discovers the contribution from its manifest.

Theme 3.1.0 replaces the separate editor opened by Theme 3.0.37 with this shared
editor, retaining the existing Button owner. Main and each registered program
are separate targets. Blender's common Button controls and program features use
one named-theme library beneath the resolved local data root at `themes/Blender/`.
Main uses `themes/main/`. Program themes control program-owned Buttons even when
those Buttons appear on Main; Main theme edits affect Main-owned controls.

Theme 3.1.1 also supplies the unchanged Popped Button Colors card to the built-in
program Theme host. Other registered programs use the same script and styling
with only that card rendered and Core actions scoped to the selected program.
The program header contains only Target; the Theme name row and separate
Buttons and arrangements view have been removed.

Theme 3.0.37 renames the top-left `Browse` Button to `Find Picture`. It fills
the theme buckets from the chosen picture and places that picture in the
viewport background; `Place Picture` still only places a picture.

Theme 3.0.36 uses the original eyedropper inside each color swatch's popup.
The separate buttons labeled `Eyedropper` under Fill/Text gradient stops have
been removed. Swatches, hex fields and existing Apply behavior are unchanged.

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

Canonical Button state owns Button identity, placement, binding, active source
identity, and committed Button appearance, including popped gradients, individual
colors, exclusions and locks. Owner-runtime state retains the program fields,
tone profiles, editing state and selected theme identity. Embedded controls read
the canonical appearance; they do not initialize a second appearance state or
write a separate named-theme library.
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
- `Find Picture` (top left) chooses a picture, samples it into the theme
  buckets through the generic `image.sample-palette` broker capability, and
  then places that same picture in the viewport background, all as one
  operation; cancel does nothing. Its row shows only the active theme name
  next to Find Picture, not the reference image path. `Clear Picture` and
  `Place Picture` are in this same row, in that order. Place Picture opens the
  image chooser and immediately places the selected image without sampling it
  or changing the theme buckets; cancel does nothing.
- `Absorb Theme` reads Blender's current theme into the package fields.
- `Refill`, `Dark Theme`, `Light Theme`, the tone slider, and named profiles stage colors
  with package-owned tone logic.
- Every visible color bucket has a package-declared per-bucket Apply action;
  the full `Apply` action sends the complete staged theme.
- `Save Buckets` and `Load Buckets` use generic field-file operations.
- `Previous`, `Open Theme`, `Next`, and `Save Theme` use the unified target
  library. `Import Theme` previews compatible supplied themes or a local file,
  checks its included settings and required tools, and waits for Apply Theme.
  `Export Theme` creates one portable named archive from the saved theme.
- A complete Blender theme includes declared UI colors, tone profiles, reference
  and Place Picture images, grid settings, HDRI image, X/Y/Z rotations and world
  strength, plus effective Button presentation and exact internal arrangements.
  Button scope can cover all panels and pop-outs, pop-outs only, or one selected
  panel. Blender interface and environment features remain program-wide.
  Desktop window layouts remain in the separate Layout system.
- `Popped Button Colors` owns two independent gradient boxes, `Button Fill` and
  `Button Text`, plus independent Regular, Hover, and Active controls in
  `Highlights and Glow`. Regular affects only idle buttons; the existing Hover
  and Active controls remain fully editable. Themes
  save both gradients (stops, curve, angle, whole-layout option), spread, scatter
  and seed with the effects. The settings apply to any Blender Pop-out or Fan,
  including collapsed owners and newly opened tools; they take precedence over the
  shared per-Button defaults on those surfaces. The Blender target also owns
  its Main/Panel Button occurrences through the common editor.
- Each box has ordered Start-to-End color stops, a curve box, an Angle and a
  `Whole Layout` checkbox. Button Fill needs 2-16 stops and keeps Spread and
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
  along the angle, so the first and last occupied positions hold the Start and End
  stops, even in sparse or diagonal layouts.
- `Lock All Popped Button Settings`, at the top of Popped Button Colors, covers
  both gradients (stops, curves, angles), Spread, Scatter, highlights and glow.
  It temporarily keeps the current popped appearance when opening
  or cycling themes. Unlocking applies the selected theme's saved settings.
  Switching themes never writes their files. Older themes without popped
  settings keep the last-used appearance. Opening the embedded controls reads
  current canonical settings without applying defaults or replacing skins.
- Theme 3.0.35 gives Glow separate Regular, Active, and Hover curve tabs, and
  Highlight separate Regular and Active tabs. The Regular Highlight curve also
  scales the existing Hover Highlight amount. Each tab has a link checkbox:
  editing a checked tab updates the other checked curves in that section;
  unchecked curves stay independent. Checking a tab alone does not copy a curve.
  Tabs and link selections persist in page state, and themes retain each curve.
  Each curve multiplies its state's configured Highlights and Glow amount by
  0-100% at each Button center, so 100% uses that amount without changing it.
  Angle and Whole Layout are shared by the tabs within each effect section.
  Angle determines direction in both modes: Whole Layout spans visible
  Buttons on each monitor, while disabling it spans each window independently.
  A single-position layout samples Start. Fade runs from full strength at Start
  to zero at End: top to bottom at 0 degrees, left to right at 90 degrees.
  Full and Reset give constant 100% strength, also the default for older themes.
  Apply Highlights & Glow commits all state curves with the state amounts. Themes
  and the appearance lock retain the curves, angles, and Whole Layout choices.
- Theme 3.0.34 gives every Button its own named color row and checkbox, even when
  multiple Buttons have the same color. Color/hex changes apply directly to only
  that Button. Material-only skins also expose a color control, with an unset
  hex until a color is explicitly chosen; loading never invents a Surface color.
  The checkbox defaults checked and controls only participation in gradients and
  other bulk theme changes. Unchecked Buttons remain individually editable;
  direct edits update their retained color without changing their retained text
  or Regular/Hover/Active effects. Exclusions and manual colors persist in
  Button state and saved themes. Rechecking includes the Button in bulk theme changes again.
  Checkbox and individual color requests run in order in the background; only a
  pending checkbox is disabled, and responses preserve in-progress field edits
  without rebuilding the page. Other Apply/Save operations wait for queued changes.
  Native visibility/monitor reads run concurrently with fresh stale-state guards.
  Checked per-occurrence colors are cleared when a new fill or text gradient is applied (fill clears
  Surface overrides, text clears Text overrides); `Toggle Text` also replaces a
  text gradient with solid black or white.
- Themes also save individual Button color overrides and staged swatch edits,
  keyed by verified Button/placement identity rather than display names or
  transient window labels. Loading restores them alongside shared settings;
  currently unchecked Buttons remain protected from theme changes. Save waits
  for pending manual changes and captures remaining staged edits without issuing
  an extra live Apply. Legacy themes without these records remain supported.
- Shared appearance applies directly when switching themes. The buckets remain
  visible and refresh asynchronously; bucket edits are disabled until the refreshed
  scan arrives. `Rescan` remains available. Legacy themes retain the current
  shared appearance, and themes saved before gradient curves/angles load as
  linear, 0-degree gradients with a solid text color.
- Popped gradients use the exact chosen Start/End colors and pass through every
  ordered intermediate stop. Spread adjusts each blend's width; Scatter varies
  interior blends without changing stop anchors. Increasing Gradient Colors
  retains the existing chosen colors and inserts new blends between them.
- `Whole Layout` spans the visible popped Button centers on each monitor for
  Fill, Text, Highlight and Glow along each channel's Angle, including diagonals.
  It changes the coverage, not the direction. Its checkbox sits beside
  the corresponding Apply button. Moving, collapsing, opening or closing a window
  updates this live range without saving geometry into themes or rescanning on
  theme switches. Collapsed hidden members do not move the endpoints. Authored
  skin shading is preserved.

Grid controls in Theme Palette:

- `Grid`, `Grid Scale`, and `Subdivisions (unitless)` sit immediately right of
  Gradient 2, in that order. Grid help is available on hover.
- The `Grid` checkbox defaults on with Scale 0.01 and Subdivisions 10. Its
  checked state and spacing travel with saved buckets/themes. Uncheck it and
  save to keep the grid off for that theme; explicit false is never replaced
  by the default. The checkbox updates the live grid; spacing changes apply
  immediately while checked and stay saved without enabling the grid when off.
  Theme 3.0.19 uses Blender's native floor, orthographic grid and axes. The
  picture retains its fixed full-viewport fit during navigation. With a picture
  and grid enabled, a GPU-only native viewport cache supplies object occlusion,
  grid planes and antialiasing. It refreshes outside Blender's draw engine and
  presents on the following redraw, before native viewport text and gizmos.

The separate bottom Place Picture section has been removed. Picture actions
are beside the reference Find Picture controls, with no picture filename/path field.
Unchecking Grid preserves the picture and fake gizmos.
  Turning the grid off frees this cache and restores the inexpensive picture
  path. Clearing the picture restores the previous viewport settings.
- `Grid Scale` adjusts Blender's native spacing (0.001–1000). Try 0.1 or 0.01
  for finer squares when working close up. The native grid still fades its fine
  lines before the larger squares as distance increases. `Subdivisions
  (unitless)` controls the native divisions (2–100) when Scene Units is None;
  Metric and Imperial retain Blender's fixed unit-based divisions. Scene units,
  object scale and the fixed picture are not changed. Press `Grid` to apply.
- Scale and subdivisions persist with the page, themes, project and
  startup picture settings. `Clear` restores the previous native grid values.
  The old near/distance/far fields stay hidden but remain readable for legacy
  package compatibility.

HDRI controls:

- `HDRI Browse`, `HDRI Apply`, `Clear`, and `Reset` manage the world
  image.
- `X`, `Y`, `Z`, and `WS` apply the declared rotation and strength fields.

The page declares the owner-contained `blender-theme-page` capability. Startup
restoration remains declared by the package as
`restore-project-theme-state`; it resolves the installed owner instead of a
hardcoded Theme action name.

There is no Startup button: every Theme Apply automatically remembers the last-used
theme for the next Blender startup. Theme apply commits the current theme and live Place Picture as one owner
startup bundle, including grid values and grid visibility. Unified theme load
applies environment settings first, restores the picture and grid next, and
applies UI colors last so the startup snapshot contains the selected picture.
An explicitly empty HDRI path clears the world without loading a default HDRI;
its saved rotation and strength values remain staged. Older files preserve
fields they do not contain.

## Validation And Reload

After changing the catalog package:

1. Run `node --test tests/theme-page.test.mjs` from the package directory.
2. Compile-check `theme.py` and parse `flowcell.script.json`.
3. Bump the declared bundled source version for a release. Normal registered
   program synchronization updates the installed package for the existing owner;
   use the normal source replacement lifecycle for an ad hoc installation.
4. Close and reopen Theme Editor after synchronization. Reload the FlowCell
   Blender add-on or restart Blender when Blender-side source or deployment
   artifacts changed; page-only changes do not require a Blender restart.

See [`../../docs/blendertheme.md`](../../docs/blendertheme.md) for the user
workflow and [`../../docs/buttons.md`](../../docs/buttons.md) for the generic
Button-source lifecycle.

Saving and sharing themes:
- `Save Theme` writes the selected named theme to `themes/Blender/` beneath the
  resolved local data root. Saving the same theme updates that identity; a
  different theme with the same name is rejected instead of silently replaced.
- `Export Theme` writes a portable archive elsewhere. Images, literal skins,
  arrangements and stable tool references travel with that saved theme; executable
  tools remain in their normal Button-owned installed sources.
- Existing `.flowtheme.json`, `.flowcell-theme-pack.json` and declared legacy
  Blender theme formats remain readable. Legacy files update only their included
  settings. Startup migration moves recognized saves into the canonical library
  and preserves recoverable previous data; it does not create another writable
  theme library or move desktop layouts out of `layouts/`.
