# Blender Theme Page Button

Blender Theme is an ordinary Blender-owned, page-enabled FlowCell Button package
for Blender UI colors, Place Picture viewport overlays, and HDRI world settings.
Its page, actions, schemas, assets, Blender helpers, and lifecycle hooks live in
the package rather than FlowCell Core.

## Install Or Open

Adding the Blender program installs Theme as a declared starter in the
`toolset` panel. To install it again after an intentional deletion:

1. On Main, open Blender's `toolset` panel and choose Add Button. The locked
   Buttons Editor opens its native content picker automatically.
2. Select
   `Programs/Blender/Blender Git Scripts/Toolsets/theme/flowcell.script.json`.
3. Use Save Main Page Settings after the Button is added, then name its
   `.json` file in the native save dialog.
4. Reload the FlowCell Blender add-on or restart Blender after deployment.

To use an installed copy, select its Blender panel and activate the `theme`
owner Button. FlowCell opens that owner's package page in the generic isolated
page host. The installed
copy under `Blender Local Scripts/<ownerButtonId>/source/` is what runs; the Git
Scripts package is only the catalog source.

The compact default page starts directly at `Theme Palette`: four slightly
taller bucket cards fit per row, each bucket's swatch, hex value, and `Apply`
share one control line, and the darkness profile controls sit directly after
`Load Buckets`. `Gradient 2` has one unlabeled checkbox directly beside its
name instead of a separate gradient row. A separate `Popped Button Colors`
section follows Theme Palette, then the full Place Picture section, with HDRI
below it. Every action Button exposes its original
explanatory hover tooltip; newer controls describe their current behavior.

## Basic Workflow

1. Use the top `Browse` Button to choose a theme image. FlowCell samples it,
   stages the returned colors, and also stages it as the Place Picture path.
2. Use `Absorb Theme` instead when the current Blender theme should populate the
   declared color fields.
3. Choose `Dark Theme` or `Light Theme`, then tune the color fields.
4. Press `Apply` to send the current theme mode and colors to Blender.
5. Use `Save Package` to copy the theme/Place Picture images and staged fields
   into one portable package. `Open Package`, `Previous`, and `Next` restore a
   package, apply or clear its Place Picture first, and apply its theme last so
   Blender saves both halves as one startup bundle.
6. Use `Save Buckets` or `Load Buckets` when only a JSON field snapshot is
   needed.
7. Use the Place Picture and HDRI controls independently as needed.

## Popped Button Colors

This section manages aggregate Surface colors for action Buttons in currently
open Blender Pop-out and Fan windows. It never lists Button names or offers
per-Button controls. Expanded regular and Tool Set Pop-outs contribute their
rendered placements. Authored Pop-out Fans and legacy standalone Fans contribute
the exact Fan-surface owner plus every member even while collapsed, so the owner
and the Buttons revealed by fanning out already share the applied gradient.
Closed or minimized windows, the separate Main/Panel occurrence of a Fan owner,
Button Editor preview Fans, and other programs remain outside the scope.

The action controls share one row in this exact order: `Rescan`,
`Apply Gradient`, `Apply Buckets`, `Refill`, `Scatter`, then `Toggle Text`.
Every ordered stop is visible in one horizontally scrollable row: `Top`, the
intermediate `Color 2` through `Color N-1` controls, then `Bottom`. The
`Gradient Colors` count control follows that stop row rather than joining the
action row.

| Control | Behavior |
| --- | --- |
| `Rescan` | Enumerates live Blender Pop-out and Fan windows, reads canonical windows plus Main-owned settings-backed live drafts, groups equal effective Surface colors, and records the exact hidden placement membership behind each aggregate bucket. A Fan contributes its real Fan-surface owner and members in either collapsed or expanded state. |
| `Apply Gradient` | Applies the current ordered multi-color gradient, Spread, and gradient Scatter controls with the remembered seed to every currently scoped placement. Adjacent colors form smooth gradient segments, and every stop can be edited directly. By default the gradient follows each Pop-out or Fan's local Button layout. With `Screen Top-to-Bottom` checked, each Button center is mapped through its window frame to its containing monitor, so the monitor top is the Top color and the monitor bottom is the Bottom color. An authored Fan must be expanded while this screen mode is applied so its live full frame is available; a legacy Fan uses its saved surface envelope anchored to the collapsed owner. |
| `Apply Buckets` | Writes the edited aggregate buckets back as per-placement Surface overrides. Any changed open-window set, draft, placement, color, or canonical revision makes the operation fail with a Rescan prompt instead of overwriting newer work. |
| `Refill` | Freshly samples exactly the number of distinct colors requested by `Gradient Colors` from the current Theme image, stores and displays them in sampler order as the gradient stops, updates Top and Bottom, advances the remembered seed, and applies that smooth gradient to the currently scoped Buttons. It fails without changing the current gradient when the image returns too few distinct colors. |
| `Scatter` | Redistributes the currently present popped-Button bucket colors across the remembered placements. It advances the persisted seed and hashes that seed with each hidden placement ID, so the color mapping remains deterministic until Scatter is pressed again. |
| `Toggle Text` | Resolves the current live Blender Pop-out/Fan scope and switches all scoped Button label text together between black and white. The action changes only per-placement Text overrides; Surface colors and saved skins are preserved. |
| `Gradient Colors` | Accepts a whole number from 2 through 16. It is the exact count of ordered colors that `Refill` requests from the current Theme image, displays between Top and Bottom, and includes in the smooth gradient. Changing the count resamples and immediately redraws every current stop so `Apply Gradient` remains usable before the next Refill. |
| Aggregate color bucket | Shows one editable color plus the count of popped Buttons currently using it. Editing a bucket stages that color for every remembered member. |
| Skin materials | Shows the exact non-text material colors for a tint-only skin that has no honest single Surface root. These groups stay read-only until `Refill` establishes an explicit Surface color. |
| Top / intermediate colors / Bottom | Edit any ordered color in the popped-Button Surface gradient. Top and Bottom are the endpoints; every intermediate color appears between them. |
| Spread | Controls how much of the Top-to-Bottom range is used. |
| Gradient Scatter | Adds the same deterministic per-placement color jitter used by the Main Theme Editor. It remains part of the gradient controls used by `Apply Gradient`, independently of the `Scatter` action Button. |
| `Screen Top-to-Bottom` | When checked, anchors `Apply Gradient` to each Button's physical position from the top to the bottom of its monitor work area instead of repeating the local gradient inside each Pop-out. The setting is off by default. |

The gradient color count and ordered stops, scatter seed, gradient controls, screen-gradient checkbox,
aggregate buckets, and internal placement mapping are stored in the installed Theme Button's owner
state. Scatter uses the stable hidden placement identity rather than the
visible bucket order, so rescanning, reordering, or reopening the same settings
choice does not reshuffle colors while the saved seed is unchanged. Canonical
Pop-out colors are saved and published; settings-backed Open Pop colors are
published only to that isolated live draft and do not rewrite its settings
file. Saved skin source, actions, membership, and geometry are not changed.
`Toggle Text` derives its next black-or-white result from the current live
aggregate scope on every press, so it does not store a separate page toggle
state or expose individual Button choices.

## Theme Controls

| Control | Behavior |
| --- | --- |
| Theme image field | Holds the image used for color sampling. |
| `Browse` | Chooses an image, samples it, and stages the resulting colors. |
| `Absorb Theme` | Reads Blender's current theme into the declared color fields. |
| `Save Buckets` | Saves the Theme/Place Picture snapshot fields to JSON; HDRI and world controls are excluded. |
| `Load Buckets` | Loads only current snapshot fields, or maps a declared legacy `flowcell-blender-theme-v1` snapshot. |
| `Save Package` | Saves only the Theme/Place Picture snapshot fields plus copied image assets under `flowcellbackend/local/blender_themes`; HDRI and world controls are excluded. Choose a new package name in that library because existing packages are never overwritten. |
| `Open Package` | Opens a current package or a legacy `flowcell-blender-theme-pack-v1` package, then applies it. |
| `Previous` / `Next` | Cycles the saved package library and immediately applies each selection. |
| `Dark Theme` | Selects dark visual mode without applying to Blender. |
| `Light Theme` | Selects light visual mode without applying to Blender. |
| `Apply` | Applies the current theme mode and color fields to Blender. |

Each color role also has its own `Apply` control. The manifest routes all of
them through the installed package action and supplies the selected bucket/value
as a per-click payload; the generic page host contains no Blender bucket names.

The color fields map to these Blender surface groups:

| Field | Blender surface group |
| --- | --- |
| `Tab Fill` | Tab and toolbar-style fills. |
| `Tab text` | Text on tabs. |
| `Header` | Header strips and panel headers. |
| `Header text` | Text on header surfaces. |
| `random text` | General UI text. |
| `tool text` | Text on controls and widgets. |
| `scene/header text` | Accent and scene/header text. |
| `Panel` | Editor and panel backgrounds. |
| `Collection Row` | Scene and collection-style surfaces. |
| `Control Fill` | Button, field, and widget fills. |
| `Highlights` | Active, selected, and highlighted states. |
| `Viewport BG` | Primary 3D viewport background. |
| `Gradient 2` | Secondary viewport gradient color; the adjacent checkbox enables or disables it. |

Blender exposes many related theme paths rather than one field per visible
surface, so the installed Theme source maps each group across the appropriate
Blender theme properties.

Page field values and darkness profiles are stored in the installed Button's
owner-scoped state. One Theme Button cannot read or overwrite another owner's
state.

## Place Picture

| Control | Behavior |
| --- | --- |
| `Place Picture` | Applies the staged image and grid values to the viewport overlay. |
| Place Picture path | Holds the image path. |
| `Browse` | Chooses the Place Picture path without applying it. |
| `Grid` | Applies the staged near, distance, and far grid values. |
| `Remove Grid` | Removes only the fake grid while leaving the picture and fake gizmos active. |
| `Startup` | Saves the staged Place Picture state, including grid visibility, for Blender startup restoration. |
| `Clear` | Removes the overlay while clearing the active Blender-side picture state. |

The near spacing, distance threshold, and far spacing fields are expressed in
meters and are passed through the installed owner action. Place Picture and the
grid are Blender-side behavior; FlowCell core only hosts the declared controls
and transports their payload.

Applying a theme writes one owner-runtime startup snapshot containing the theme
and the currently active Place Picture, grid values, and grid visibility. A
saved package therefore cannot restore its theme with an older package's
picture. A pictureless package explicitly clears the older startup picture.

## HDRI World

| Control | Behavior |
| --- | --- |
| `HDRI Apply` | Applies the staged `.hdr` or `.exr` path. |
| HDRI path | Holds the world image path. |
| `HDRI Browse` | Chooses the HDRI path without applying it. |
| `Clear` | Resets the current file to a plain world. |
| `Reset` | Rebuilds a clean world and reapplies the staged HDRI values. |
| `X`, `Y`, `Z` | Applies the matching rotation field in degrees. |
| `WS` | Applies the staged world strength. |

The initial manifest values are X `90`, Y `0`, Z `30`, and strength `0.25`.

## Updating Or Deleting

Ordinary catalog edits do not silently affect an installed Theme Button. A
release-owned Theme update must also bump the matching
`bundledSources[].version` in `Programs/Blender/flowcell.program.json`; normal
registered-program synchronization then updates the existing owner in place.
Ad hoc local edits are not updated from the Buttons Editor; intentionally replace
the owner through the normal source lifecycle instead.
After either path, close and reopen the installed Theme page after its owner has
synchronized. Reload the FlowCell Blender add-on or restart Blender only when
the package's Blender-side source also changed.

Deleting the Theme owner closes its page and removes its canonical graph, active
record, owned Local Scripts package, bindings, generated bridge artifacts,
registered Blender lifecycle hooks, overlays, timers, and Button-owned startup
state. The Git Scripts catalog package remains available for a future install.
Saved packages under `flowcellbackend/local/blender_themes/` are explicit shared
Blender program data, not owner runtime state, so they remain available after a
launcher is deleted and reinstalled.
