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
   `.flowcell-button-settings.json` file in the native save dialog.
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
name instead of a separate gradient row. The full Place Picture section follows
Theme Palette, with HDRI below it. Every action Button exposes its original
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
After either path, reload the FlowCell Blender add-on or restart Blender before
testing the changed deployment.

Deleting the Theme owner closes its page and removes its canonical graph, active
record, owned Local Scripts package, bindings, generated bridge artifacts,
registered Blender lifecycle hooks, overlays, timers, and Button-owned startup
state. The Git Scripts catalog package remains available for a future install.
Saved packages under `flowcellbackend/local/blender_themes/` are explicit shared
Blender program data, not owner runtime state, so they remain available after a
launcher is deleted and reinstalled.
