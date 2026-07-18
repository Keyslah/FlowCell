# FlowCell AI Skills

Use this document as the repository-local routing guide for FlowCell work. Inspect live files before editing and keep `PROGRAM_SUMMARY.txt` current.

## Skill Links

- [flowcell](#flowcell)
- [layout](#layout)
- [toolsets](#toolsets)
- [blender-theme](#blender-theme)
- [react-tauri-button-skin-contract](#react-tauri-button-skin-contract)
- [skin-author](#skin-author)

## flowcell

**Use when:** changing the FlowCell Tauri/React app, program packages, script installation, Button state, hotkeys, layouts, or runtime bridges.

### Ownership map

- `FlowCellFrontend/src/button/` owns all Button state, rendering, editing, skins, regular popouts, tool-set popouts, fans, and Button managed windows.
- `flowcellbackend/local/button-system/button-state.json` is the canonical, versioned Button document.
- `FlowCellFrontend/src-tauri/src/button_state.rs` owns atomic Button-state commits.
- `FlowCellFrontend/src-tauri/src/program_sources/` owns program manifests and the install, update, execute, uninstall, record, and one-time migration lifecycle.
- `Programs/<Program>/<Program> Git Scripts/` is a source catalog. It is never the installed runtime source.
- `Programs/<Program>/<Program> Local Scripts/<ownerButtonId>/` is the Button-owned installed package and runtime source of truth.
- Package code/assets live under `source/`; mutable per-Button settings live under
  `runtime/`, which Update preserves and Delete recycles with the owner.
- `Programs/<Program>/Panels/<Panel>/<ownerButtonId>.flowcell-source.json` is the active routing record.
- `Programs/<Program>/flowcell.program.json` declares program folders, allowed source types, and runner behavior.
- `flowcellbackend/FlowCellBackend.ahk` owns existing path-based script hotkeys and direct backend automation; those `ScriptPath` bindings remain available with the frontend closed.
- The running Tauri process owns only `tool-set-child` hotkeys. Their numbered binding records carry canonical child/owner Button IDs, and the active expanded owner popout activates the mounted child host so live tool fields and the normal Button lifecycle remain authoritative.
- `flowcellbackend/FlowCellCommandBackend.ps1` executes hotkey script/macro requests; Blender script bindings resolve only through active `.flowcell-source.json` records.

### Non-negotiable contracts

- State owns identity, execution targets, labels, skins, placements, surfaces, popout units, fan setups, and settings.
- Each real program panel owns one source-free `panel-owner` Button on the program's main panel-rail surface. The actual main rail renders that Button, and saved fans reuse it with exact Fan placements; never fabricate an empty fan setup for editor navigation.
- The functional host owns execution, pointer/keyboard routing, hit testing, text fit, drag/resize, collision prevention, native windows, and persistence participation.
- A skin owns render-only markup, SVG, declarations, typography, effects, states, transitions, and keyframes.
- A skin has exactly one measurable `[data-core]` and zero or one `{{label}}` token. That authored core's geometry is the actual interactive hitbox; textless skins receive no host overlay, label, or fallback chrome.
- Transparent or decorative overflow is pointer-inert.
- Do not add filename classifiers, program-name switches, one-off Button runtimes, or alternate Button state. Reusable tool-page renderers and capability services must be selected by validated installed manifest data.
- Do not special-case program scripts in the main page. Program-specific meaning belongs in manifests, source packages, or the relevant runner/bridge.
- Deleting a Button must atomically remove its state graph, active record, owned Local Scripts package, owned bridge artifacts, and owned bindings. All filesystem deletion goes through the Recycle Bin.
- Panel/program rename must migrate both native source ownership and canonical Button scope while preserving stable presentation IDs. Native folder, record, and bindings changes roll back together; if canonical persistence fails afterward, reverse the native rename unless current state proves the new scope already landed.

### Workflow

1. Read `PROGRAM_SUMMARY.txt`, `docs/buttons.md`, and the relevant program manifest.
2. Inspect narrow references with `rg` before opening broad files.
3. Preserve unrelated working-tree changes.
4. Update `PROGRAM_SUMMARY.txt` with behavior or ownership changes.
5. Validate in proportion to the changed runtime surface.

### Validation

- Button/frontend: `npx tsc --noEmit`, `npm run test:button`.
- Rust: `cargo check` from `FlowCellFrontend/src-tauri`.
- Full release: `npm run tauri build` from `FlowCellFrontend`.
- PowerShell: parse every changed `.ps1` with the PowerShell AST parser.
- AutoHotkey: validate `flowcellbackend/FlowCellBackend.ahk` with the bundled AutoHotkey v2 runtime.
- Runtime: update the frontend build stamp, restart through `Start-FlowCellFrontend.ps1 -ForceRestart`, then inspect fresh launcher/backend logs.
- Blender package/bridge changes: reload the FlowCell add-on or restart Blender as documented by `flowcell.program.json`.

## layout

**Use when:** diagnosing or changing save/load, native bounds, managed Button windows, DPI placement, transparency, topmost, or fan/popout restoration.

### Current managed windows

- `button-editor`: one stable editor window.
- `button-popout`: regular and tool-set popout units. A tool-set owner reuses one stable window for collapsed and expanded states.
- `button-fan`: one regular fan window per stable panel-owner Button.

Core utility windows such as Binds, Macro Lab, Organization Setup, Window Grid, and Motion Settings remain managed core windows. Program tool pages open through installed owner Buttons and reusable manifest-selected renderers.

### Layout contracts

- Placement geometry uses canonical surface design units.
- Saved Button Editor bounds and Pop/Fan semantic content frames use physical desktop pixels; the oversized Pop/Fan host canvas is runtime-only.
- Restore physical semantic bounds verbatim. Pop/Fan must derive local CSS coordinates from the fixed canvas origin and effective WebView pixel ratio rather than reading the host HWND as saved content geometry.
- Stable native labels derive from stable IDs, never editable labels.
- A panel Fan and the Main-page panel rail share one stable `panel-owner` Button identity, but each occurrence is resolved through its own placement ID and may have its own geometry and skin override.
- Exact saved geometry wins; do not rerun starter layout during restoration.
- Reorder and `Snap to top left corner` are explicit undoable Editor actions that rewrite exact placement geometry and z-order; restore continues to use the saved result without reflowing it.
- On a Pop or Fan surface, the selected `windowFitMode` is the Editor's immediate labeled semantic frame for Saved Surface, all Button hitboxes, or current Button visuals. The frame mirrors transient active overflow; opening the real native draft remains a separate `Open Pop` or `Open Fan` action, and Save persists only the resting fit.
- Native Pop/Fan windows are fixed, non-resizable transparent canvases covering the active monitor work area and any outlying semantic content. Set cursor-ignore before show. One shared native worker emits changed physical cursor/modifier snapshots; physical bounds and cursor points must be converted to WebView CSS coordinates with the live `devicePixelRatio` (native monitor DPI is only the fallback because WebView zoom can differ). Each window reacts to those changes and local geometry/DOM invalidation, enabling its HWND only when the native owning-program entitlement is active and the pointer is over a placement-owned Button host, tool field, or Pop resize handle. Gaps, inactive program scope, taskbar previews, listener/query failures, and effect cleanup must return it to ignored. Subscribe before querying initial native state, retry transient listener/query and cursor-style failures, and fail closed while state is unavailable. The hit-test hook rejects points outside the semantic frame before exact testing, may cache interactive membership, and must read exact viewport rectangles live because ancestor frame movement can change position without resizing a host. It must not resume per-window continuous polling merely because an envelope or content frame moved.
- Render the visible frame absolutely inside that canvas. Fit changes, hover overflow, Fan expansion, and tool-set collapse/expansion change only semantic frame/envelope state. Grow or rehome the native canvas only when content escapes it, and use a capacity margin while dragging/resizing so monitor-edge motion stays visible. New unsized Pops start at one design pixel per WebView CSS pixel; restored physical bounds use the destination WebView's effective pixel ratio. Preserve one invariant physical surface origin, normalize ancestor content scale to design units, and retain skin-root/animated overflow scale. Persist Pop/Fan semantic physical bounds and layout snapshots, never the monitor-sized host or transient envelope.
- Layout snapshots are strict version 8 `FlowCellWindowLayout` documents and persist only `button-editor`, `button-popout`, and `button-fan` Button window kinds; unknown fields and old window kinds are rejected.
- Only measured visible `[data-core]` regions are native hit-test regions. Gaps stay pointer-inert.
- Program-scoped topmost is an exact native process rule: only the owning manifest's actual foreground executable may select `TOPMOST`. FlowCell self/sibling focus is at most a normal-band continuation of the last proven owning app; taskbar previews and unrelated apps must place the scoped window behind the actual foreground HWND, not merely call `HWND_NOTOPMOST`.

### Primary files

- `FlowCellFrontend/src/button/windows/buttonWindows.ts`
- `FlowCellFrontend/src/button/windows/useFixedButtonCanvas.ts`
- `FlowCellFrontend/src/button/windows/useNativeButtonHitboxes.ts`
- `FlowCellFrontend/src/button/popout/ButtonPopoutWindowPage.tsx`
- `FlowCellFrontend/src/button/fan/ButtonFanWindowPage.tsx`
- `FlowCellFrontend/src/lib/layoutSnapshots.ts`
- `FlowCellFrontend/src/pages/main/MainPage.tsx`
- `FlowCellFrontend/src-tauri/src/main.rs`

## toolsets

**Use when:** importing, creating, executing, or laying out one tool-set owner and its child buttons.

### Package contract

A catalog package is a folder containing `flowcell.toolset.json`, its declared source file, and optional assets. The manifest declares:

- stable package ID and version
- program, label, tooltip, and source
- child `slot`, label, tooltip, and optional payload
- optional bridge data, fields, layout, and events
- optional validated page presentation metadata for a reusable renderer
- generic runner metadata where required

Core treats each child slot as command identity and merges payload in this order:

1. manifest/record bridge data
2. child payload
3. runtime field payload

Runtime values win. Core does not interpret Blender axes, angles, solvers, colors, or other program data.

### Runtime contract

- The owner has role `tool-set-owner` and no execution target.
- Each child has role `tool-set-child`, its own label, skin, text policy, placement, and `tool-set-action` target.
- Tool-set children render only on their tool-set popout surface.
- The shared Button popout renderer is the only tool-set visual renderer.
- A validated `layout.presentation` may select a reusable view inside that same canonical popout; it may not bypass `ButtonHost` execution or own separate state.
- One stable native window per owner toggles between the exact owner footprint and exact saved expanded bounds.
- Regular popouts and regular fan windows never contain tool-set children.
- A fan setup stores tool-set owners as separate collapsed windows at exact physical anchors.

### Primary files

- `Programs/<Program>/flowcell.program.json`
- `Programs/<Program>/<Program> Git Scripts/Toolsets/<Package>/flowcell.toolset.json`
- `FlowCellFrontend/src-tauri/src/program_sources/install.rs`
- `FlowCellFrontend/src-tauri/src/program_sources/execute.rs`
- `FlowCellFrontend/src/button/runtime/ButtonRuntimeAdapter.ts`
- `FlowCellFrontend/src/button/popout/`
- `FlowCellFrontend/src/button/editor/`

## blender-theme

**Use when:** changing the Blender Theme tool-set source, payload fields, or Blender-side theme application.

- The catalog package is `Programs/Blender/Blender Git Scripts/Toolsets/theme/`.
- Import creates a Button-owned package under `Blender Local Scripts/<ownerButtonId>/`; later catalog edits do not silently change that installed Button.
- Theme child commands, fields, and presentation mapping are manifest data. The reusable `ThemeWorkbench` renderer is selected only by `layout.presentation.renderer`; never select it by Blender name, label, or filename.
- Blender-side meaning remains in the installed Python source and Blender bridge.
- Validate Python syntax and manifest JSON, then reload the live FlowCell Blender add-on after deployment changes.

## react-tauri-button-skin-contract

**Use when:** implementing or debugging a Button skin, measured geometry, label fit, fan/popout hit testing, or transparent native regions.

### Pipeline

1. The host provides the current label and state.
2. `ButtonSkinRenderer` compiles and mounts the authored skin in its isolated render root.
3. The skin must contain exactly one measurable `[data-core]` and may contain one `{{label}}` token at the intended text location.
4. The host measures that exact core after optional label insertion and text-fit resolution.
5. The host attaches activation, context, double-click, hover, press, and keyboard behavior directly to that core.
6. Native transparent windows map the physical cursor to the webview through the live `devicePixelRatio` and use the shadow root's DOM hit test for those exact cores; a bounding rectangle is only an early rejection check.

The host never imposes another shape over the skin. Shadows, glows, wrappers, and decorative SVG may overflow but never become clickable.

## skin-author

**Use when:** authoring, converting, or debugging a skin pasted into FlowCell Buttons Editor.

### FlowCell Button Editor Skin Author

The source of truth for section names is `FlowCellFrontend/src/button/skins/buttonSkinFormat.ts`. Produce canonical lowercase headers only:

```text
=== structure ===
<render-only HTML with exactly one data-core and zero or one {{label}} token>
=== keyframes ===
<@keyframes blocks only>
=== base ===
<CSS declarations>
=== hover ===
<CSS declarations>
=== play ===
<CSS declarations>
=== pressed ===
<CSS declarations>
=== held ===
<CSS declarations>
=== release ===
<CSS declarations>
=== disabled ===
<CSS declarations>
=== error ===
<CSS declarations>
```

`structure` is required for a complete replacement. A named-section update may contain any subset. An explicitly present empty optional section clears only that section; omitted sections remain unchanged. Header lines tolerate surrounding whitespace and letter case, and blank lines before the first header are ignored; canonical lowercase remains the authored form.

### Structure rules

- Include `{{label}}` once inside `data-core` when visible Button text belongs there; omit it for a textless or animation-only skin.
- Include exactly one `data-core`. Its measured post-label geometry is the real Button hitbox.
- For an animation-only skin, keep `data-core` nonzero and measurable but visually unpainted if desired. FlowCell adds no label or fallback Button face; the saved Button label remains the accessible name.
- Keep decorative wrappers outside the core and pointer-inert.
- No scripts, event-handler attributes, network access, navigation, backend calls, or state mutation.
- No React skin registry in version one.
- Put `data-anim="token"` on real animated elements; do not add unconditional animation in structure.

### State and keyframe rules

- State sections contain declarations only: no selectors, braces, markup, or at-rules.
- The core's inline `style` compiles into a lowest-priority `[data-core]` rule, so ordinary state declarations override inline defaults on that core. Nested visual elements remain literal and must consume state-controlled custom properties initialized explicitly in `base`.
- Use custom properties for decoration shared across the structure.
- `keyframes` contains only `@keyframes` or `@-webkit-keyframes` blocks.
- Trigger animations with `--anim-<token>` in a state section.
- `play` is a one-shot latch; never use an infinite animation there.
- Forbidden source includes scripts, `on*` handlers, `javascript:`, `expression(`, and fixed-position escape surfaces.

### Scope

The same format applies to single-script Buttons, panel owners, tool-set owners, every tool-set child button, regular-popout members, and fan members. Skins persist only in `button-state.json`; they do not modify any other application state file.
