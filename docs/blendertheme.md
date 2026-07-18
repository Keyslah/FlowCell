# Blender Theme Tool Set

Blender Theme is an installable FlowCell tool set for Blender UI colors, Place
Picture viewport overlays, and HDRI world settings. It runs in the shared
canonical Button popout.

## Install Or Open

Adding the Blender program installs Theme as a declared starter in the
`toolset` panel. To install it again after an intentional deletion:

1. Open the Buttons Editor and choose Add Tool Set.
2. Select
   `Programs/Blender/Blender Git Scripts/Toolsets/theme/flowcell.toolset.json`.
3. Choose the Blender panel for the owner Button and save Button state.
4. Reload the FlowCell Blender add-on or restart Blender after deployment.

To use an installed copy, select its Blender panel and activate the `theme`
owner Button. FlowCell opens that owner's shared tool-set popout. The installed
copy under `Blender Local Scripts/<ownerButtonId>/source/` is what runs; the Git
Scripts package is only the catalog source.

## Basic Workflow

1. Use the top `Browse` Button to choose a theme image. FlowCell samples it,
   stages the returned colors, and also stages it as the Place Picture path.
2. Use `Absorb Theme` instead when the current Blender theme should populate the
   declared color fields.
3. Choose `Dark Theme` or `Light Theme`, then tune the color fields.
4. Press `Apply` to send the current theme mode and colors to Blender.
5. Use `Save Package` to copy the theme/Place Picture images and staged fields
   into one portable package. `Open Package`, `Previous`, and `Next` restore a
   package, apply its theme, and rerun Place Picture.
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
them through the installed `apply_theme_bucket` child and supplies the selected
bucket/value as a per-click payload; the shared renderer contains no Blender
bucket names.

The color fields map to these Blender surface groups:

| Field | Blender surface group |
| --- | --- |
| `Tabs` | Tab and toolbar-style fills. |
| `Tab text` | Text on tabs. |
| `Headers` | Header strips and panel headers. |
| `Header text` | Text on header surfaces. |
| `Text` | General UI text. |
| `Control text` | Text on controls and widgets. |
| `Accent text` | Accent and scene/header text. |
| `Editor` | Editor and panel backgrounds. |
| `Scene` | Scene and collection-style surfaces. |
| `Controls` | Button, field, and widget fills. |
| `Highlights` | Active, selected, and highlighted states. |
| `Viewport` | Primary 3D viewport background. |
| `Gradient color` | Secondary viewport gradient color. |
| `Gradient` | Enables or disables the viewport gradient. |

Blender exposes many related theme paths rather than one field per visible
surface, so the installed Theme source maps each group across the appropriate
Blender theme properties.

On the first updated owner load, FlowCell imports the old Theme Toolbox darkness
profile JSON and the proven pre-refactor local-storage keys into the new
owner-scoped state. The old file and keys are not modified or deleted. Migration
maps role/field names from manifest data and records completion so profiles are
not duplicated on later opens.

## Place Picture

| Control | Behavior |
| --- | --- |
| `Place Picture` | Applies the staged image and grid values to the viewport overlay. |
| Place Picture path | Holds the image path. |
| `Browse` | Chooses the Place Picture path without applying it. |
| `Grid` | Applies the staged near, distance, and far grid values. |
| `Startup` | Saves the staged Place Picture state for Blender startup restoration. |
| `Clear` | Removes the overlay while clearing the active Blender-side picture state. |

The near spacing, distance threshold, and far spacing fields are expressed in
meters and are passed through the installed owner action. Place Picture and the
grid are Blender-side behavior; FlowCell core only hosts the declared controls
and transports their payload.

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
For an ad hoc local change, use Update in the Buttons Editor for the same owner.
After either path, reload the FlowCell Blender add-on or restart Blender before
testing the changed deployment.

Deleting the Theme owner removes its children, popout, placements, active
record, owned Local Scripts package, bindings, and generated bridge artifacts.
The Git Scripts catalog package remains available for a future install.
