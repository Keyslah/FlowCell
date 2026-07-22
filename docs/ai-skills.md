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
- The bind-only Illustrator `Actions / Set Anchor` entry is the explicit Core-action exception: it stores its shortcut under `ActionHotkeys`, is active only for foreground Illustrator, registers pass-through so the native Illustrator command still receives the keystroke, and runs the shipped Illustrator helper through immediate foreground automation so the keypress selection is captured before the action returns.
- The running Tauri process owns `tool-set-owner` and `tool-set-child` hotkeys. Their numbered binding records carry canonical Button/owner IDs without `ScriptPath`; an owner hotkey invokes the canonical managed-popout toggle directly while Main's ordinary owner click remains selection-only (Main double-click invokes the same primary toggle), and the active expanded owner popout activates a mounted child host so live tool fields and the normal Button lifecycle remain authoritative. Binds scopes Current Panel Binds to one selected Tool Set owner and its children.
- `flowcellbackend/FlowCellCommandBackend.ps1` executes hotkey script/macro requests; Blender script bindings resolve only through active `.flowcell-source.json` records.

### Non-negotiable contracts

- State owns identity, execution targets, labels, skins, placements, surfaces, popout units, fan setups, and settings.
- The polished Button Editor has exactly three panes: left navigation and placement controls, center Button workspace, and right Skin Editor. It exposes no source/action library pane.
- Program, Panel, Button, and Placement navigation resolves only existing Main, Pop, or saved Fan placements. The Editor never offers a synthetic default-Fan placement or creates or changes Fan membership. Main's selected/generic Fan commands and the complete saved Fan runtime remain supported.
- `Save placement` opens a native save dialog and writes a named `.flowcell-button-placement.json` containing only the selected surface's ordered placement geometry. The portable file excludes sizing/text policy, but the canonical scoped commit includes placement-owned sizing behavior, text fitting, and alignment with the arrangement. It is not Save Layout and must not capture skins, actions, animations, Pop/Fan state, settings, or managed-window layout.
- `Animation` opens a dedicated page with its own top-right X. Preserve its complete contract: `No animation` plus every registered preset, Apply-to-clear or Apply-to-assign, position-and-size setup, saved physical bounds, explicit setup close, and runtime playback through the retained Edit/Run workspace switch. Animation Apply and bounds saves are scoped independently from placement saves.
- Each real program panel owns one source-free `panel-owner` Button on the program's main panel-rail surface. The actual main rail renders that Button, and saved fans reuse it with exact Fan placements; never fabricate an empty fan setup for editor navigation.
- The functional host owns execution, pointer/keyboard routing, hit testing, text fit, drag/resize, collision prevention, native windows, and persistence participation.
- Button size is a placement-owned host policy. Responsive constrains the core to exact independent dimensions, translation-normalizes its authored resting offset, and does not scale the root; Proportional uniformly scales from each measured natural core ratio and aspect-locks it; Stretch explicitly permits independent X/Y root scaling. The Skin Editor previews width, height, and behavior before `Assign Size` applies the target to the focused placement or `Assign Size to Panel` applies it once to every Button beside that placement on its current Main, Pop, Fan, or other Button surface. Responsive and Stretch use the exact target; Proportional preserves each Button's measured natural aspect when available and otherwise its current aspect. Assigned sizing disables label-driven geometry growth. Those actions never enable the separate legacy uniform-size format or rewrite skin source.
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
- Reorder and `Snap to top left corner` are explicit undoable Editor actions that rewrite exact placement geometry and z-order. Rows are first-class during these actions: Snap left-packs each exact existing row and stacks the same rows upward without changing membership; Reorder exposes every slot in every row plus explicit new-row boundaries and never rebalances untouched Buttons between rows. `Save placement` writes and commits that arrangement; restore continues to use it without reflowing, and Save Layout remains a separate application-wide operation.
- Stored Pop/Fan `windowFitMode` values remain runtime-owned semantic frame choices for the saved surface, all Button hitboxes, or current Button visuals. The streamlined Editor does not expose separate fit or native-preview actions; Save placement leaves the existing runtime values intact.
- Native Pop/Fan windows are fixed, non-resizable transparent canvases covering the active monitor work area and any outlying semantic content. Set cursor-ignore before show. An explicit open must request its scoped normal-band reveal after show; passive layout restore must not. One shared native worker emits changed physical cursor/modifier snapshots; physical bounds and cursor points must be converted to WebView CSS coordinates with the live `devicePixelRatio` (native monitor DPI is only the fallback because WebView zoom can differ). Each window reacts to those changes and local geometry/DOM invalidation, enabling its HWND only when the native explicit-open or owning-program entitlement is active and the pointer is over a placement-owned Button host, tool field, or Pop resize handle. Gaps, inactive program scope, taskbar previews, listener/query failures, and effect cleanup must return it to ignored. Subscribe before querying initial native state, retry transient listener/query and cursor-style failures, and fail closed while state is unavailable. The hit-test hook rejects points outside the semantic frame before exact testing, may cache interactive membership, and must read exact viewport rectangles live because ancestor frame movement can change position without resizing a host. It must not resume per-window continuous polling merely because an envelope or content frame moved.
- Render the visible frame absolutely inside that canvas. Fit changes, hover overflow, Fan expansion, and tool-set collapse/expansion change only semantic frame/envelope state. Grow or rehome the native canvas only when content escapes it, and use a capacity margin while dragging/resizing so monitor-edge motion stays visible. New unsized Pops start at one design pixel per WebView CSS pixel; restored physical bounds use the destination WebView's effective pixel ratio. Preserve one invariant physical surface origin, normalize ancestor content scale to design units, and retain skin-root/animated overflow scale. Persist Pop/Fan semantic physical bounds and layout snapshots, never the monitor-sized host or transient envelope.
- Layout snapshots are strict version 8 `FlowCellWindowLayout` documents and persist only `button-editor`, `button-popout`, and `button-fan` Button window kinds; unknown fields and old window kinds are rejected.
- Only stable placement-owned skin-host rectangles are native Button hit-test regions; their resting dimensions derive from the measured `[data-core]`. Gaps stay pointer-inert.
- Program-scoped topmost is an exact native process rule: only the owning manifest's actual foreground executable may select `TOPMOST`. An explicit Pop/Fan open may receive a post-show, input-active reveal at the front of the normal band, never `TOPMOST`; preserve that transient grant when the mounted page re-registers its label, but keep it tied only to the opening FlowCell HWND and then the revealed HWND so any other focus ends it. FlowCell self/sibling focus is otherwise at most a normal-band continuation of the last proven owning app; taskbar previews and unrelated apps clear the grant and place the scoped window behind the actual foreground HWND, not merely call `HWND_NOTOPMOST`.

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
- In Run mode, Tool Set children with `fieldPatch` and/or `toggleFields` derive their authored pressed visual from live field values: all patched values must match and all toggled fields must be true. Different fixed values for one field create ordinary radio choices. For an optional radio where every choice may be released, give each choice a Boolean toggle and patch its peers to `false`; do not add a program-specific selection store or renderer.
- A child with `inlineEditField` edits one hidden number/text field inside that real Button's existing HTML `{{label}}` node. Primary pointer-down anywhere in its `[data-core]` explicitly focuses the native popout, then focuses/selects that editor, not just clicks directly on the label glyphs. Keep it `execute: false` with no field service; its placement, literal skin, `[data-core]` hitbox, movement, resizing, and authored states remain canonical. Use `activationPatch` on mode Buttons when activation should reset the editable value without making that default part of selected-state matching.
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
5. The core supplies the measured and accessible geometry and owns the activation, context, double-click, hover, press, and keyboard listeners. The placement host remains browser-reachable only as the shadow bridge; its unused gutters perform no Button action.
6. Native transparent windows map the physical cursor to the webview through the live `devicePixelRatio`, discover each core through its placement host, and hit-test the live core rectangle; non-Button controls use their own DOM geometry.

The host never imposes another shape over the skin. Shadows, glows, wrappers, and decorative SVG may overflow but never become clickable.
Main-page script, macro, and Tool Set owner hosts separate gestures: an ordinary click toggles the exact multi-selection, dispatches no authored runtime event or activation effect, and latches the selected Button into the skin's authored pressed state until deselection; a double-click dispatches that Button's primary action directly on Main. Explicit Pop/Fan controls open the current selection, and their mounted runtime hosts retain ordinary single-click execution.

## skin-author

**Use when:** authoring, converting, or debugging a skin pasted into FlowCell Buttons Editor.

### FlowCell Button Editor Skin Author

The Skin Editor toolbar is ordered `Assign Skin`, `Assign Skin to Panel`, `Load
skin`, `Save skin`, and `Save as new skin`. Source and paste edits remain in an
isolated working copy. Load never assigns. Assign Skin writes only the focused
placement override and forks edited shared source, including the document-wide
default skin, before saving; Assign Skin to
Panel is the only panel-wide action and is limited to the exact Main panel surface.
Recognized paste source updates an always-visible working preview through both
native paste and normal WebView input paths, distributes into the canonical
section editors, and clears the transient paste field; unparseable input remains for
correction. Save updates the library entry,
while Save as new opens a native picker, writes canonical paste-ready
`.flowcell-button-skin.txt` source, and creates an unassigned entry.
There are no Apply Named Sections, Replace Entire Skin, or Apply Button Text
buttons. The Button Size section keeps width, height, and Responsive,
Proportional, or Stretch behavior in a working preview. Assign Size applies that
preview only to the focused placement; Assign Size to Panel applies the target
once to every Button on the edited placement's current surface, preserving each natural aspect in
Proportional mode, and does not write the legacy linked-size format. The Button
Behavior section uses an outer mode dropdown plus nested logical-state,
interaction-trigger, and visual-state dropdowns. `momentary`, `toggle`, and `cycle`
behavior and per-state/per-trigger labels are Button-owned. The placement owns the
skin-dependent visual mapping, and the current activation-state index is runtime-only
session state that resets when FlowCell restarts. The Button Text section uses matching
state and trigger dropdowns to update the Button draft label for Rest, Hover, Play,
Pressed, Held, Release, Selected, Disabled, or Error. Fit mode, horizontal `Use skin`, `Left`,
`Center`, or `Right` alignment, starting text size, and minimum shrink size are
independent focused-placement settings committed by Save placement. Alignment
overrides the rendered text only for that placement and never rewrites skin source;
`Use skin` removes the override and restores the authored alignment.
The raw Base, Hover, Play, Pressed, Held, Release, Disabled, and Error source
sections remain directly editable; the mapping dropdowns select among them and do
not replace their code editors. The visual-state selector reflects the working skin
and marks empty sections so their declarations can be authored. Because edited shared skin source can affect every
inheriting placement and tool-set child, default to a forked focused-placement
override and expose the blast radius before any explicit panel-wide or global change.
Use `Apply Button state setup` in either Button Behavior or Button Text to commit
the Button-owned mode/labels and its placement-owned visual maps. `Save skin`
continues to persist visual source and is not a substitute for this state-setup action.

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

New skins, conversions, and complete replacements must include every canonical header, including empty optional sections, so stale keyframes or state declarations cannot survive from the previous skin. Omit headers only for an explicitly requested partial named-section update.

### Structure rules

- Include `{{label}}` once inside `data-core` when visible Button text belongs there; omit it for a textless or animation-only skin.
- Include exactly one `data-core`. Its measured post-label geometry is the real Button hitbox.
- Use a neutral render-only `div` or `span` core. Interactive, form, media, and navigation elements such as `button`, `a`, `input`, `select`, `textarea`, `form`, `img`, `video`, and `audio` are forbidden because the host owns Button semantics and behavior.
- A newly authored packed core is the intended resting clickable body footprint; do not invent demo margins or hidden layout gutters. A literal conversion preserves the source interactive control's complete box model, including its own transparent padding when that padding positions a face, base, depth layer, or press travel. Remove only spacing owned by an outer demo/page wrapper.
- Core font metrics must be deterministic across Editor/Main/Pop/Fan hosts. Do not inherit them on `data-core`; a labeled core, or a core with `em` geometry, requires an effective pixel font size and pixel line-height so host typography cannot change its measured aspect.
- For an animation-only skin, keep `data-core` nonzero and measurable but visually unpainted if desired. FlowCell adds no label or fallback Button face; the saved Button label remains the accessible name.
- Keep decorative wrappers and layers pointer-inert. They may be inside or outside `data-core` when literal source stacking requires it.
- A complete alternate visual for a logical Button state is a Skin Author-produced composite paste block with pointer-inert nested faces inside that same `data-core`. Reveal faces through canonical state declarations and CSS custom properties. Never create another functional Button, another `data-core`, another hitbox, or a runtime skin swap for an alternate appearance.
- No scripts, event-handler attributes, network access, navigation, backend calls, or state mutation.
- No React skin registry in version one.
- Put `data-anim="token"` on real animated elements; do not add unconditional animation in structure.

When converting React, JSX, or styled-components source, treat the imported visual as literal. Strip imports/components/JavaScript and replace only the control semantics with neutral markup; preserve the source control's display, box model, radii, gradients, shadows, transitions, stacking, and existing state behavior. Replace pseudo-elements with equivalent real decorative children, map only states present in the source, leave absent canonical states empty, and replace the literal caption with `{{label}}` when text must stay editable. A color-only request changes only the named color values. Freeze inherited typography to the source host's resolved pixel font size and line height instead of choosing new metrics.

### State and keyframe rules

- State sections contain declarations only: no selectors, braces, markup, or at-rules.
- Base, Hover, Play, Pressed, Held, Release, Disabled, and Error remain the canonical raw authored visual sections, including an empty or authored Hover section. Button-owned momentary/toggle/cycle behavior and label sequencing map onto these sections at runtime; skin source never owns the activation index, label sequence, or execution rule.
- Visual mapping is placement-owned because the valid appearance depends on the assigned skin. Editing a map changes no skin source, and editing shared skin source changes no Button behavior.
- The core's inline `style` compiles into a lowest-priority `[data-core]` rule, so ordinary state declarations override inline defaults on that core. Nested visual elements remain literal and must consume state-controlled custom properties initialized explicitly in `base`.
- Use custom properties for decoration shared across the structure.
- `keyframes` contains only `@keyframes` or `@-webkit-keyframes` blocks.
- Trigger animations with `--anim-<token>` in a state section.
- `play` is a one-shot latch; never use an infinite animation there.
- Forbidden source includes scripts, `on*` handlers, `javascript:`, `expression(`, and fixed-position escape surfaces.

Before returning a replacement, run `.claude/skills/skin-author/scripts/validate-skin.mjs` against the exact block. It must contain every canonical header, parse successfully, reject inherited/unstable core font geometry, and return zero semantic diagnostics. For original authoring, verify the intended painted footprint. For a conversion, compare source and result at rest and in every authored state, including core/child boxes, padding, radii, colors, shadows, and transitions except for explicitly requested changes. Also verify the same natural aspect ratio in Editor and a real Pop/Fan; static validation cannot infer paint coverage.

### Scope

The same format applies to single-script Buttons, panel owners, tool-set owners, every tool-set child button, regular-popout members, and fan members. Skins persist only in `button-state.json`; they do not modify any other application state file.
