# Blender Theme Tool Set

The Blender `theme` tool set opens a dedicated FlowCell toolbox for three related jobs: Blender UI theme colors, Place Picture viewport overlays, and HDRI world settings.

## Open The Tool

Open the Blender program in FlowCell and use the `theme` owner button from the panel where it is installed. The button opens Theme, Place Picture, and HDRI controls for Blender UI colors, fake viewport picture grid/gizmos, world path, X/Y/Z rotation, and world strength.

`theme.py` can be added through `Add Script` into any Blender panel as one child-bearing owner button. Double-click, Pop, and Fan routes for matching theme records open the dedicated Theme/Place Picture/HDRI toolbox.

## Theme Workflow

1. Use `Browse` to pick an image and sample five theme colors, or use `Absorb Theme` to read the current Blender theme into the visible buckets.
2. Press `Dark Theme` or `Light Theme` to stage a generated theme preset on the page. These buttons do not send the theme to Blender by themselves.
3. Optionally choose a darkness profile from the dropdown beside `Dark Theme`. `Save Darkness Profile...` stores the current darkness pattern for later dark/light remapping.
4. Fine-tune the staged colors with the bucket color pickers or hex fields.
5. Press `Apply` to send the currently visible theme role colors to Blender.
6. Use `Save Buckets` and `Load Buckets` to preserve and restore staged bucket values.

## Theme Controls

| Control | Hover Description |
| --- | --- |
| `Browse` | Pick an image and sample five theme colors. |
| `Absorb Theme` | Read the current Blender theme and stage all visible buckets. |
| `Save Buckets` | Save the current staged Blender theme buckets for later reuse. |
| `Load Buckets` | Load saved Blender theme buckets back into this page. |
| `Dark Theme` | Stage a dark theme preset on this page. Apply sends it to Blender. |
| Darkness profile dropdown | Choose a saved darkness profile for Dark Theme. |
| `Light Theme` | Stage a light theme preset on this page. Apply sends it to Blender. |
| `Apply` | Apply the currently visible theme role colors. |

## Color Buckets

Each color bucket has two redundant editing controls: a swatch picker and a hex text field. The swatch opens the native color picker for that bucket, and the hex field lets you type the same color manually. Both only stage values until `Apply` is pressed.

Bucket roles:

| Bucket | What It Affects |
| --- | --- |
| `Tab Fill` | Tab and toolbar-style fills. |
| `Header` | Header strips, panel headers, and related header surfaces. |
| `random text` | General Blender UI text. |
| `tool text` | Text on controls, widgets, and tool buttons. |
| `scene/header text` | Accent text and header-label text. |
| `Panel` | Editor and panel backgrounds. |
| `Collection Row` | Outliner collection-row coloring. |
| `Control Fill` | Button, field, and widget fills. |
| `Highlights` | Active, selected, and highlighted states. |
| `Viewport BG` | Primary 3D viewport background color. |
| `Gradient 2` | Secondary viewport gradient color when the gradient toggle is enabled. |
| `Gradient` | Enables or disables the viewport background gradient. |

Blender does not expose every visible UI surface as a simple one-to-one field, so FlowCell maps these buckets across several Blender theme paths and widget states.

## Place Picture

Place Picture draws a temporary viewport picture layer with a metric grid and active-tool fake transform gizmos. The separate Grid control can also show or refresh the grid and gizmos without placing a picture.

| Control | Hover Description |
| --- | --- |
| `Place Picture` | Creates fake gizmos and a metric grid on top of a background image. |
| `Grid` | Apply the near/distance/far grid rule and show or refresh the grid and gizmos without requiring a picture. |
| Near grid spacing field | Grid spacing used while the viewport is at or inside the distance threshold from world origin. |
| `>` | Apply the rule; it also reads as "farther than the following distance." |
| Distance field | Distance from world origin where the grid switches from near spacing to far spacing. |
| Far grid spacing field | Grid spacing used when the viewport is farther from world origin than the distance field. |
| Picture path field | Image path used by Place Picture. |
| `Browse` | Pick a Place Picture image. |
| `Startup` | Save the current Place Picture image so Blender restores it on startup. |
| `Clear` | Remove the Place Picture fake background, grid, and gizmos while keeping the path field. |

All three grid fields accept meters by default. Bare numbers are meters; values such as `8in` or `8 in` are converted and displayed as `0.2032 m` after applying (the fields are still saved/restored, but the live grid now uses adaptive zoom-based spacing instead of those fixed values). The live grid step follows the visible zoom so the on-screen line count stays bounded and the viewport stays fast: it stays a sparse ~34-line-per-axis grid that refines as you zoom in, reaching a 1 mm floor only when you are zoomed in very close, and coarsens in nice metric steps (1/2/5 mm, cm, …) as you pull back. Grid projection uses one cached per-frame clip-space matrix and near-clips each line in homogeneous space, rather than calling Blender's per-point screen projection (`location_3d_to_region_2d`) for every line, so the grid drags and orbits smoothly; it probes the visible XY footprint with a light fixed sample set, caps the generated grid to a zoom-scaled radius so grazing/horizon views stay fast, lightly boosts grid contrast/width as the plane becomes grazing, only counts segments that overlap the viewport, and bounds the per-axis line budget (target 34, cap 90 — the proven ultra-fast density).

## HDRI World

The HDRI section stages a world image path plus rotation and strength values. Path edits and numeric edits are staged in the toolbox; use the matching apply button to send them to Blender.

| Control | Hover Description |
| --- | --- |
| `HDRI` | Apply the HDRI path in the field. |
| HDRI path field | HDRI path to load into the Blender world environment. |
| `Browse` | Pick an HDRI file. |
| `Clear` | Clear the current HDRI world from this file. |
| `Reset` | Rebuild a clean Blender world for this file and reapply the current HDRI values. |
| `Z` | Apply the entered Z rotation. |
| `Y` | Apply the entered Y rotation. |
| `X` | Apply the entered X rotation. |
| `WS` | Apply the entered world strength. |

Rotation fields are degrees. `WS` is world background strength. The default staged values are X `90`, Y `0`, Z `30`, and WS `0.25`.

## Quick Notes

- `Dark Theme`, `Light Theme`, color bucket edits, path edits, and numeric edits stage values in the toolbox.
- `Apply`, per-bucket `Apply`, `Place Picture`, `Grid`, `Startup`, `HDRI`, `Clear`, `Reset`, `X`, `Y`, `Z`, and `WS` send their current values to Blender.
- Place Picture `Clear` keeps the picture path in the toolbox. HDRI `Clear` resets the world in the current Blender file.
- If the theme tool code or bridge action is changed, refresh/resync the Blender FlowCell add-on/custom actions and reopen the theme toolbox before testing the new behavior.
